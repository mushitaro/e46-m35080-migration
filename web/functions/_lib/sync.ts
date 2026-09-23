/**
 * What the two SYNC routes share: the binding, and the few byte-level checks both make before
 * anything reaches D1.
 *
 * Who a row belongs to is NOT decided here. It comes from `ownerOf(context.data)` - the account the
 * owner gate resolved for this request - and each handler reads it itself, first, so that a route
 * whose owner check was forgotten is visible in the route rather than hidden behind a helper.
 *
 * There is no token and no CORS: every caller is a page on this origin, carrying the cookie the gate
 * set, and the gate refuses a state-changing /api request from any other origin.
 */

export interface Env {
  /** tsunagi-m-preview-runs, SHARED with E46M3 /// MONITORING. This app's tables are m35080_*. */
  RUNS_DB: D1Database;
  /** The gate's client secret on m3. Read by `_middleware.ts`, never here. */
  M3_CLIENT_SECRET?: string;
}

/**
 * A row id the device minted (lib/domain/records.ts: a UUID, or its fallback). Opaque to the
 * server, but shaped: it is a URL path segment on the way back.
 */
export const isRowId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);

export function paramId(params: Record<string, string | string[]>): string | null {
  const raw = params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  return isRowId(id) ? id : null;
}

export function decodeBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function encodeBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The gzip magic. The diagnostics payload column holds compressed JSON and nothing else. */
export const isGzip = (b: Uint8Array) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

/**
 * A BLOB as D1 hands it back. The runtime has returned these as a plain array of numbers and as an
 * ArrayBuffer at different times; both are accepted rather than one assumed.
 */
export function blobBytes(v: unknown): Uint8Array | null {
  if (v == null) return null;
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  return null;
}

/** base64 that decodes, or the reason it was refused. */
export function base64Field(b64: unknown, name: string): Uint8Array | string {
  if (typeof b64 !== 'string' || b64.length === 0) return `${name} is required.`;
  try {
    return decodeBase64(b64);
  } catch {
    return `${name} is not valid base64.`;
  }
}

/** SHA-256 as lowercase hex - the same digest lib/domain/image.ts `hashImage` writes on the device. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const optText = (v: unknown, max = 200): string | null =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;

export const optInt = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
