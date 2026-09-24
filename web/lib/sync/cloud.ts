/**
 * The account half of SYNC: this app's own /api/sessions and /api/diagnostics, through the owner
 * gate, with the cookie the gate set when the owner arrived from m3.
 *
 * Every call here first asks `maySend()`, and a build that answers no makes NO request - not a
 * failed one, none. Production carries no `app-variant` tag, so `isPreviewBuild()` is false; so is
 * `next dev`, which has no tag and no /api to talk to. That is the property production's privacy
 * rests on: the release is local-only (tsunagi-m-chrome section 6). The preview answers no as well
 * until its owner has confirmed the first-run notice (lib/sync/previewNotice.ts): before that it
 * talks to its API exactly as much as production does.
 *
 * No token, no settings: the requests are same-origin and the gate knows who is asking. Nothing
 * here sends an owner id - the server takes the owner from the gate, never from the body.
 *
 * A "session" on the wire is one DeviceRecord from lib/domain/records.ts. The record store is
 * append-only and a record never changes, so "has the account got it" is a question of its id.
 */
import { api, isPreviewBuild, type ApiResult } from './owner-sync';
import { noticeAcknowledged } from './previewNotice';
import type { DeviceRecord } from '@/lib/domain/records';

/** Only the preview build syncs. */
export const canSync = (): boolean => isPreviewBuild();

/**
 * And only once its owner has read what it sends and confirmed it (components/PreviewNotice.tsx).
 * Every request this app makes to its own API is behind this.
 */
export const maySend = (): boolean => canSync() && noticeAcknowledged();

const notSent = <T>(): ApiResult<T> => ({ ok: false, status: 0, data: null, expired: false, tooLarge: false });

/** An account copy as the list shows it - every column but the image. */
export interface CloudRecordRow {
  id: string;
  created_at: number;
  synced_at: number;
  kind: string;
  vin: string | null;
  km: number | null;
  practice: number;
  parent_id: string | null;
  note: string | null;
  hash: string;
  app_build: string | null;
  image_bytes: number;
}

export interface CloudDiagnosticRow {
  id: string;
  created_at: number;
  synced_at: number;
  phase: string;
  error: string | null;
  error_kind: string | null;
  practice: number;
  vin: string | null;
  km: number | null;
  firmware: string | null;
  app_build: string | null;
  payload_bytes: number | null;
}

/** The record as it travels. */
export interface RecordWire {
  id: string;
  createdAt: number;
  kind: string;
  vin: string | null;
  km: number | null;
  practice: boolean;
  parentId: string | null;
  note: string | null;
  hash: string;
  appBuild: string | null;
  imageB64: string;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** The build this came from, as scripts/build-id.mjs stamped it. */
export function appBuild(): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('meta[name="build-id"]')?.getAttribute('content') ?? null;
}

export function toWire(r: DeviceRecord, build: string | null = appBuild()): RecordWire {
  return {
    id: r.id,
    createdAt: r.createdAt,
    kind: r.kind,
    vin: r.vin,
    km: r.km,
    practice: r.practice,
    parentId: r.parentId ?? null,
    note: r.note ?? null,
    hash: r.hash,
    appBuild: build,
    imageB64: toBase64(r.bytes),
  };
}

/**
 * An account copy back into the shape the device store holds. Shape-checked: a row this build
 * cannot read is null, never a half-filled record.
 */
export function fromCloud(row: Record<string, unknown>): DeviceRecord | null {
  const { id, created_at, kind, vin, km, practice, parent_id, note, hash, imageB64 } = row;
  if (typeof id !== 'string' || typeof created_at !== 'number' || typeof kind !== 'string' || typeof hash !== 'string') return null;
  if (typeof imageB64 !== 'string') return null;
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(imageB64);
  } catch {
    return null;
  }
  const record: DeviceRecord = {
    id,
    createdAt: created_at,
    kind: kind as DeviceRecord['kind'],
    bytes,
    hash,
    vin: typeof vin === 'string' ? vin : null,
    km: typeof km === 'number' ? km : null,
    practice: practice === 1 || practice === true,
  };
  if (typeof parent_id === 'string') record.parentId = parent_id;
  if (typeof note === 'string') record.note = note;
  return record;
}

export async function sendRecord(r: DeviceRecord): Promise<ApiResult<{ id: string; storedBytes: number }>> {
  if (!maySend()) return notSent();
  return api('/api/sessions', { method: 'POST', body: toWire(r) });
}

export async function listCloudRecords(): Promise<ApiResult<{ sessions: CloudRecordRow[] }>> {
  if (!maySend()) return notSent();
  return api('/api/sessions');
}

/** One account copy, decoded, or null with the result when it could not be fetched or read. */
export async function fetchCloudRecord(id: string): Promise<{ record: DeviceRecord | null; result: ApiResult<unknown> }> {
  if (!maySend()) return { record: null, result: notSent() };
  const r = await api<Record<string, unknown>>(`/api/sessions/${encodeURIComponent(id)}`);
  if (!r.ok || !r.data) return { record: null, result: r };
  return { record: fromCloud(r.data), result: r };
}

export async function deleteCloudRecord(id: string): Promise<ApiResult<unknown>> {
  if (!maySend()) return notSent();
  return api(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listDiagnostics(): Promise<ApiResult<{ diagnostics: CloudDiagnosticRow[] }>> {
  if (!maySend()) return notSent();
  return api('/api/diagnostics');
}

export async function deleteDiagnostic(id: string): Promise<ApiResult<unknown>> {
  if (!maySend()) return notSent();
  return api(`/api/diagnostics/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
