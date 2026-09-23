/**
 * Getting the reference data into the app: served to a signed-in owner by the preview
 * (/api/ref/<name>), or opened from the owner's own disk. Held in memory only - never written to
 * IndexedDB, never cached by the service worker (it lets /api/ through untouched).
 *
 * A release, and `next dev`, have no /api and make NO request: the answer there is 'not-preview',
 * and the app offers the same file from disk. Every result says where the data came from and its
 * sha256, so a screen can name the definitions it is using.
 */

import { isPreviewBuild } from '@/lib/sync/owner-sync';
import { validateRef } from './validate';
import type { RefDocs, RefName } from './types';

export type RefOrigin =
  | { kind: 'served'; sha256: string }
  | { kind: 'file'; name: string; sha256: string };

export type RefFailure = 'not-preview' | 'unauthorized' | 'absent' | 'unreachable' | 'invalid';

export type RefLoad<N extends RefName> =
  | { ok: true; doc: RefDocs[N]; origin: RefOrigin }
  | { ok: false; reason: RefFailure; detail?: string };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function accept<N extends RefName>(
  name: N,
  text: string,
  origin: (sha256: string) => RefOrigin,
): Promise<RefLoad<N>> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid', detail: 'not JSON' };
  }
  const bad = validateRef(name, doc);
  if (bad) return { ok: false, reason: 'invalid', detail: bad };
  return { ok: true, doc: doc as RefDocs[N], origin: origin(await sha256Hex(text)) };
}

/** From the preview's own origin, for the signed-in owner. */
export async function loadRefData<N extends RefName>(
  name: N,
  deps: { fetch?: typeof fetch; preview?: boolean } = {},
): Promise<RefLoad<N>> {
  if (!(deps.preview ?? isPreviewBuild())) return { ok: false, reason: 'not-preview' };
  const f = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`/api/ref/${name}`, { credentials: 'same-origin', cache: 'no-store' });
  } catch (e) {
    return { ok: false, reason: 'unreachable', detail: e instanceof Error ? e.message : String(e) };
  }
  if (res.status === 401) return { ok: false, reason: 'unauthorized' };
  if (res.status === 404) return { ok: false, reason: 'absent' };
  if (!res.ok) return { ok: false, reason: 'unreachable', detail: `HTTP ${res.status}` };
  return accept(name, await res.text(), (sha256) => ({ kind: 'served', sha256 }));
}

/** The same JSON, opened from disk - where there is no preview to serve it. */
export async function refFromFile<N extends RefName>(
  name: N,
  file: { name: string; text(): Promise<string> },
): Promise<RefLoad<N>> {
  let text: string;
  try {
    text = await file.text();
  } catch (e) {
    return { ok: false, reason: 'invalid', detail: e instanceof Error ? e.message : String(e) };
  }
  return accept(name, text, (sha256) => ({ kind: 'file', name: file.name, sha256 }));
}

/** `SERVED · 3f9a1c2b7d10` / `FILE · kombi-coding.json · 3f9a1c2b7d10` - what a screen shows. */
export function describeOrigin(o: RefOrigin): string {
  const short = o.sha256.slice(0, 12);
  return o.kind === 'served' ? `SERVED · ${short}` : `FILE · ${o.name} · ${short}`;
}
