import { ownerOf } from '../../_owner-gate/owner';
import { serveRef, type RefEnv } from '../../_lib/refdata';

/**
 * GET /api/ref/:name - the reference data CODING and TEST read (functions/_lib/refdata.ts).
 *
 * The owner comes from the gate, read here first, as every route does. GET only: the data is
 * uploaded by the operator with wrangler, never through this origin.
 */
export const onRequestGet: PagesFunction<RefEnv> = (ctx) =>
  serveRef(ownerOf(ctx.data as Record<string, unknown>), ctx.params.name, ctx.env.REFDATA);
