/**
 * The reference data CODING and TEST read: generated outside this repository from BMW's own
 * files (tools/refdata/gen_refdata.py), uploaded by the operator to a private R2 bucket
 * (scripts/upload-refdata.mjs), and handed here to a signed-in owner's browser - never committed,
 * never in the static build (THIRD-PARTY-NOTICES.md 3.3).
 *
 * The route reads the owner itself, first (functions/api/ref/[name].ts); this file only answers
 * for a request that already has one. It answers 404 for a name it does not serve and for data
 * that has not been uploaded - never a 5xx: "not there yet" is a normal state, and the app says
 * so and offers to open the same file from disk instead.
 *
 * Written against the slice of an R2 bucket it uses, so it can be tested with a plain object and
 * typechecks under both the Workers types and the web app's.
 */

import { json, unauthorized, type Owner } from '../_owner-gate/owner';

/** The files served. Anything else is a 404, whatever is in the bucket. */
export const REF_NAMES = ['kombi-coding', 'kombi-names'] as const;
export type RefName = (typeof REF_NAMES)[number];

export interface RefObject {
  body: ReadableStream | null;
}

export interface RefBucket {
  get(key: string): Promise<RefObject | null>;
}

export interface RefEnv {
  /** m35080-refdata (wrangler.jsonc). Absent in `next dev`, where every name is a 404. */
  REFDATA?: RefBucket;
}

export function refName(raw: unknown): RefName | null {
  const name = Array.isArray(raw) ? raw[0] : raw;
  return (REF_NAMES as readonly string[]).includes(name as string) ? (name as RefName) : null;
}

/** The key a name is stored under: the generator's file name. */
export const refKey = (name: RefName): string => `${name}.json`;

const notFound = (): Response => json({ error: 'not_found' }, 404);

/** GET /api/ref/:name for `owner`. */
export async function serveRef(owner: Owner | null, rawName: unknown, bucket: RefBucket | undefined): Promise<Response> {
  if (!owner) return unauthorized();
  const name = refName(rawName);
  if (!name || !bucket) return notFound();
  const obj = await bucket.get(refKey(name));
  if (!obj?.body) return notFound();
  return new Response(obj.body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Per owner, and never kept: an intermediary or the browser cache must not hand it on.
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
