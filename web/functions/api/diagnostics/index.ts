import { MAX_ROW_BYTES, conflict, json, ownerOf, rowBytes, tooLarge, unauthorized } from '../../_owner-gate/owner';
import { type Env, base64Field, isGzip, isRowId, optInt, optText } from '../../_lib/sync';

/**
 * Error records - one row per failure, sent by the app on its own.
 *
 * A sibling of /api/sessions rather than part of it, because the two are sent for opposite reasons.
 * A record goes up because the owner pressed SYNC. An error record goes up by itself, the moment the
 * link reports a failure or a refusal (useM35080Link's fail() and refuse()), because a failure is
 * worth most at the instant it happens and is exactly the thing nobody saves. See
 * lib/sync/errorRecords.ts for the client half.
 */

const LIST_COLUMNS = `
  id, created_at, synced_at, phase, error, error_kind, practice, vin, km, firmware, app_build,
  length(payload_gz) AS payload_bytes
`;

/** GET /api/diagnostics - this owner's, most recent first. */
export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const owner = ownerOf(ctx.data as Record<string, unknown>);
  if (!owner) return unauthorized();

  const limit = Math.min(500, Math.max(1, Number(new URL(ctx.request.url).searchParams.get('limit') ?? 100) || 100));
  const { results } = await ctx.env.RUNS_DB.prepare(
    `SELECT ${LIST_COLUMNS} FROM m35080_diagnostics WHERE owner = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(owner.id, limit)
    .all();
  return json({ diagnostics: results });
};

interface DiagnosticBody {
  id?: unknown;
  createdAt?: unknown;
  phase?: unknown;
  error?: unknown;
  errorKind?: unknown;
  practice?: unknown;
  vin?: unknown;
  km?: unknown;
  firmware?: unknown;
  appBuild?: unknown;
  /** base64 of gzipped JSON: the image hash, the status bits, the progress. Optional. */
  payloadGz?: unknown;
}

/**
 * POST /api/diagnostics - store one record. Idempotent on the client's id, because the outbox
 * resends after a failure it cannot tell apart from a lost response. The same owner rule as
 * sessions: another owner's id is a 409, not an overwrite.
 */
export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const owner = ownerOf(ctx.data as Record<string, unknown>);
  if (!owner) return unauthorized();

  let body: DiagnosticBody;
  try {
    body = (await ctx.request.json()) as DiagnosticBody;
  } catch {
    return json({ error: 'Body is not JSON.' }, 400);
  }
  if (!isRowId(body.id)) return json({ error: 'id is missing or malformed.' }, 400);
  const createdAt = optInt(body.createdAt);
  if (createdAt === null) return json({ error: 'createdAt must be a number.' }, 400);
  // What was being attempted, stated by the caller - a failed connect has no image to infer it from.
  const phase = optText(body.phase, 40);
  if (!phase) return json({ error: 'phase is required.' }, 400);
  let payload: Uint8Array | null = null;
  if (body.payloadGz != null) {
    const blob = base64Field(body.payloadGz, 'payloadGz');
    if (typeof blob === 'string') return json({ error: blob }, 400);
    if (!isGzip(blob)) return json({ error: 'payloadGz is not gzip data.' }, 400);
    payload = blob;
  }

  const values = [
    body.id,
    owner.id,
    createdAt,
    Date.now(),
    phase,
    optText(body.error, 2000),
    optText(body.errorKind, 40),
    body.practice === true ? 1 : 0,
    optText(body.vin, 17),
    optInt(body.km),
    optText(body.firmware, 40),
    optText(body.appBuild, 40),
    payload,
  ];
  const bytes = rowBytes(values);
  if (bytes > MAX_ROW_BYTES) return tooLarge(bytes);

  const res = await ctx.env.RUNS_DB.prepare(
    `INSERT INTO m35080_diagnostics (
       id, owner, created_at, synced_at, phase, error, error_kind, practice, vin, km, firmware, app_build, payload_gz
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       synced_at = excluded.synced_at,
       error = excluded.error,
       error_kind = excluded.error_kind,
       payload_gz = excluded.payload_gz
     WHERE m35080_diagnostics.owner = excluded.owner`,
  )
    .bind(...values)
    .run();

  if (res.meta.changes === 0) return conflict();
  return json({ id: body.id, storedBytes: bytes });
};
