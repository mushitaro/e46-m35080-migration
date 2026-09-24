/**
 * Error records: sent by the app itself, the moment the link reports a failure.
 *
 * The opposite of a record SYNC in every respect that matters. A record goes up because the owner
 * pressed SYNC; a failure is worth most at the instant it happens, is small, and is exactly the
 * thing nobody saves. So this is automatic, best-effort and silent (tsunagi-m-chrome section 7):
 *
 *   - it never throws into the caller and never awaits on the caller's path - the operation it
 *     describes has already failed, and a report about it must not become a second failure;
 *   - it is called from the two sinks every failure already passes through, `fail()` and
 *     `refuse()` in lib/hooks/useM35080Link.ts, so a failed CONNECT (no image, no bridge) is
 *     recorded too - with what was being attempted and nothing else;
 *   - a record that cannot be sent (offline, the session expired, the server down) goes into a small
 *     outbox in IndexedDB and is sent after the next send that succeeds - only while the gate says
 *     the session is active, and only to the account it was queued under (owner-sync.ts `outbox`).
 *
 * Each record carries what the link was doing, the error and its kind, the PRACTICE flag (a list
 * mixing a simulated chip with real ones is worse than none), the short VIN and odometer of the
 * image on screen, the bridge firmware and the build id; the gzipped payload adds the image's hash,
 * the chip's status bits and the progress. Not the image itself: that is what SYNC is for.
 *
 * Preview only: `canSync()` is false in production and under `next dev`, and then this does
 * nothing at all - no request, no IndexedDB.
 *
 * And not before the owner has confirmed the first-run notice (lib/sync/previewNotice.ts). Until
 * then `send` answers "not sent" without a request, so a failure waits in the outbox exactly as it
 * would without a connection, and the outbox is not flushed - not even asked whether the session
 * is active.
 */
import { api, gzipB64, outbox } from './owner-sync';
import { appBuild, canSync, maySend } from './cloud';
import { noticeAcknowledged } from './previewNotice';
import { decodeOdometer } from '@/lib/domain/odometer';
import { hashImage, secureOf } from '@/lib/domain/image';
import { recordVin } from '@/lib/domain/vin';
import type { StatusBits } from '@/lib/domain/status';

const box = outbox('m35080-outbox');

export interface LinkFailure {
  /** What the link was doing: connecting, reading, writing, verifying, connected. */
  phase: string;
  error: string;
  /** transport | semantic | refused. */
  errorKind: string | null;
  practice: boolean;
  /** The image on screen when it failed - the chip it was about, if one had been read. */
  image: Uint8Array | null;
  status: StatusBits | null;
  firmware: string | null;
  progress: { done: number; total: number; label: string } | null;
}

/**
 * Sent, or not worth sending again. A 400/409/413 will be refused the same way every time, so it
 * leaves the queue rather than blocking every record behind it; only "could not reach it" and "not
 * signed in" keep it waiting.
 */
async function send(body: unknown): Promise<boolean> {
  // Before the notice is confirmed nothing goes: "not sent", so it waits in the outbox.
  if (!noticeAcknowledged()) return false;
  const r = await api('/api/diagnostics', { method: 'POST', body });
  if (r.ok) return true;
  return r.status === 400 || r.status === 409 || r.status === 413;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

/** The wire body for one failure. Exported for the tests; the app calls `reportLinkFailure`. */
export async function diagnosticBody(f: LinkFailure, at = Date.now()) {
  const vin = f.image ? recordVin(f.image) : null;
  const odo = f.image ? decodeOdometer(secureOf(f.image)) : null;
  return {
    id: newId(),
    createdAt: at,
    phase: f.phase,
    error: f.error,
    errorKind: f.errorKind,
    practice: f.practice,
    vin,
    km: odo?.ok ? odo.km : null,
    firmware: f.firmware,
    appBuild: appBuild(),
    payloadGz: await gzipB64(
      JSON.stringify({
        imageHash: f.image ? await hashImage(f.image).catch(() => null) : null,
        status: f.status,
        progress: f.progress,
        userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
      }),
    ),
  };
}

/** Fire and forget. Returns immediately; nothing it does can reach the caller. */
export function reportLinkFailure(f: LinkFailure): void {
  if (!canSync()) return;
  void (async () => {
    try {
      const body = await diagnosticBody(f);
      if (await send(body)) await box.flush(send);
      else await box.add(body);
    } catch {
      // Nowhere to put it. The operation already failed; this must not add a second failure.
    }
  })();
}

/** Send whatever is waiting - after a SYNC went through, say. Never throws. */
export async function flushErrorRecords(): Promise<number> {
  if (!maySend()) return 0;
  return box.flush(send);
}

/** How many records are waiting on this device. */
export function waitingErrorRecords(): Promise<number> {
  if (!canSync()) return Promise.resolve(0);
  return box.count();
}
