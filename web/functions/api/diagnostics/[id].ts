import { json, ownerOf, unauthorized } from '../../_owner-gate/owner';
import { type Env, blobBytes, encodeBase64, paramId } from '../../_lib/sync';

/** One error record: read whole (with its payload), or deleted. Owner-scoped, like sessions. */

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const owner = ownerOf(ctx.data as Record<string, unknown>);
  if (!owner) return unauthorized();
  const id = paramId(ctx.params);
  if (!id) return json({ error: 'not_found' }, 404);

  const row = await ctx.env.RUNS_DB.prepare(
    `SELECT id, created_at, synced_at, phase, error, error_kind, practice, vin, km, firmware, app_build, payload_gz
     FROM m35080_diagnostics WHERE id = ? AND owner = ?`,
  )
    .bind(id, owner.id)
    .first<Record<string, unknown>>();
  if (!row) return json({ error: 'not_found' }, 404);

  const blob = blobBytes(row.payload_gz);
  const { payload_gz: _omit, ...meta } = row;
  void _omit;
  return json({ ...meta, payloadGz: blob ? encodeBase64(blob) : null });
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  const owner = ownerOf(ctx.data as Record<string, unknown>);
  if (!owner) return unauthorized();
  const id = paramId(ctx.params);
  if (!id) return json({ error: 'not_found' }, 404);

  const res = await ctx.env.RUNS_DB.prepare('DELETE FROM m35080_diagnostics WHERE id = ? AND owner = ?').bind(id, owner.id).run();
  if (res.meta.changes === 0) return json({ error: 'not_found' }, 404);
  return json({ id, deleted: true });
};
