import { json, ownerOf, unauthorized } from '../../_owner-gate/owner';
import { type Env, blobBytes, encodeBase64, paramId } from '../../_lib/sync';

/**
 * One saved record: fetched whole for a RESTORE into this device's record store, or deleted.
 *
 * Both carry `owner = ?`. Another owner's id answers exactly as an id that does not exist - 404 -
 * so the route cannot be used to learn which ids are taken.
 */

/** GET /api/sessions/:id - the record with its image. */
export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const owner = ownerOf(ctx.data as Record<string, unknown>);
  if (!owner) return unauthorized();
  const id = paramId(ctx.params);
  if (!id) return json({ error: 'not_found' }, 404);

  const row = await ctx.env.RUNS_DB.prepare(
    `SELECT id, created_at, synced_at, kind, vin, km, practice, parent_id, note, hash, app_build, image
     FROM m35080_sessions WHERE id = ? AND owner = ?`,
  )
    .bind(id, owner.id)
    .first<Record<string, unknown>>();
  if (!row) return json({ error: 'not_found' }, 404);

  const image = blobBytes(row.image);
  const { image: _omit, ...meta } = row;
  void _omit;
  return json({ ...meta, imageB64: image ? encodeBase64(image) : null });
};

/** DELETE /api/sessions/:id - gone from the account. The copy on the device is not touched. */
export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  const owner = ownerOf(ctx.data as Record<string, unknown>);
  if (!owner) return unauthorized();
  const id = paramId(ctx.params);
  if (!id) return json({ error: 'not_found' }, 404);

  const res = await ctx.env.RUNS_DB.prepare('DELETE FROM m35080_sessions WHERE id = ? AND owner = ?').bind(id, owner.id).run();
  if (res.meta.changes === 0) return json({ error: 'not_found' }, 404);
  return json({ id, deleted: true });
};
