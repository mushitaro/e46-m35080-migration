import { MAX_ROW_BYTES, conflict, json, ownerOf, rowBytes, tooLarge, unauthorized } from '../../_owner-gate/owner';
import { type Env, base64Field, isRowId, optInt, optText, sha256Hex } from '../../_lib/sync';

/**
 * The owner's chip records - what RECORDS › SYNC sends, one row per record, per owner.
 *
 * A "session" here is one entry of the device's append-only record store (lib/domain/records.ts):
 * a backup read off a chip, or the image a rewrite, reset or restore left on it. It carries the
 * 1 KB image, the short VIN and odometer decoded from it, what kind of record it is, the record it
 * was derived from, its note, and whether it was a PRACTICE rehearsal. Records never change on the
 * device, so a row is written once; a re-send of the same id replaces it with the same bytes.
 *
 * The image is stored as the device holds it and checked against the device's own SHA-256, so a
 * restore on another device puts back exactly the bytes that were read - the one property a backup
 * of an irreversible chip must have.
 */

/** Every column except the image. The list must never carry the bytes to describe a row. */
const LIST_COLUMNS = `
  id, created_at, synced_at, kind, vin, km, practice, parent_id, note, hash, app_build,
  length(image) AS image_bytes
`;

/**
 * GET /api/sessions - this owner's, most recent first.
 *
 * No pagination: one person's own records. A limit that silently dropped the oldest would be worse.
 */
export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const owner = ownerOf(ctx.data as Record<string, unknown>);
  if (!owner) return unauthorized();

  const limit = Math.min(500, Math.max(1, Number(new URL(ctx.request.url).searchParams.get('limit') ?? 200) || 200));
  const { results } = await ctx.env.RUNS_DB.prepare(
    `SELECT ${LIST_COLUMNS} FROM m35080_sessions WHERE owner = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(owner.id, limit)
    .all();
  return json({ sessions: results });
};

interface SessionBody {
  id?: unknown;
  createdAt?: unknown;
  kind?: unknown;
  vin?: unknown;
  km?: unknown;
  practice?: unknown;
  parentId?: unknown;
  note?: unknown;
  hash?: unknown;
  appBuild?: unknown;
  /** base64 of the image bytes. */
  imageB64?: unknown;
}

/**
 * POST /api/sessions - store one record. Idempotent on the device's own id.
 *
 * Replaces only the SAME owner's row. The upsert's WHERE makes an id that already belongs to
 * someone else change nothing, and `changes === 0` is how that is told apart from success - a 409,
 * never a silent overwrite and never a merge into another account's record.
 */
export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const owner = ownerOf(ctx.data as Record<string, unknown>);
  if (!owner) return unauthorized();

  let body: SessionBody;
  try {
    body = (await ctx.request.json()) as SessionBody;
  } catch {
    return json({ error: 'Body is not JSON.' }, 400);
  }
  if (!isRowId(body.id)) return json({ error: 'id is missing or malformed.' }, 400);
  const createdAt = optInt(body.createdAt);
  if (createdAt === null) return json({ error: 'createdAt must be a number.' }, 400);
  // The kind is the device's word (backup / rewrite / reset / restore, and whatever a later build
  // adds). Shaped, not enumerated, so a newer device's record is kept rather than refused.
  if (typeof body.kind !== 'string' || !/^[a-z][a-z-]{0,23}$/.test(body.kind)) return json({ error: 'kind is missing or malformed.' }, 400);
  if (typeof body.hash !== 'string' || !/^[0-9a-f]{64}$/.test(body.hash)) return json({ error: 'hash is missing or malformed.' }, 400);
  if (body.parentId != null && !isRowId(body.parentId)) return json({ error: 'parentId is malformed.' }, 400);
  const image = base64Field(body.imageB64, 'imageB64');
  if (typeof image === 'string') return json({ error: image }, 400);

  const values = [
    body.id,
    owner.id,
    createdAt,
    Date.now(),
    body.kind,
    optText(body.vin, 17),
    optInt(body.km),
    body.practice === true ? 1 : 0,
    body.parentId ?? null,
    optText(body.note, 2000),
    body.hash,
    optText(body.appBuild, 40),
    image,
  ];
  // Before anything else is done with the bytes: D1's own refusal of an oversized row is a bare 500,
  // and the owner needs to be told "too large" in words.
  const bytes = rowBytes(values);
  if (bytes > MAX_ROW_BYTES) return tooLarge(bytes);

  // The device hashed what it read; a row whose bytes do not match is not that record.
  if ((await sha256Hex(image)) !== body.hash) return json({ error: 'hash does not match imageB64.' }, 400);

  const res = await ctx.env.RUNS_DB.prepare(
    `INSERT INTO m35080_sessions (
       id, owner, created_at, synced_at, kind, vin, km, practice, parent_id, note, hash, app_build, image
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       synced_at = excluded.synced_at,
       kind = excluded.kind,
       vin = excluded.vin,
       km = excluded.km,
       practice = excluded.practice,
       parent_id = excluded.parent_id,
       note = excluded.note,
       hash = excluded.hash,
       app_build = excluded.app_build,
       image = excluded.image
     WHERE m35080_sessions.owner = excluded.owner`,
  )
    .bind(...values)
    .run();

  if (res.meta.changes === 0) return conflict();
  return json({ id: body.id, storedBytes: bytes });
};
