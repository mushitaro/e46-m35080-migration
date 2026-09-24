/**
 * The preview's first-run notice, and the one bit it leaves behind: the owner has read what the
 * preview sends, and why, and confirmed it.
 *
 * Until then the preview sends nothing. The dialog (components/PreviewNotice.tsx) covers the app
 * on first launch, and every send path asks `noticeAcknowledged()` as well - lib/sync/cloud.ts
 * `maySend()` for SYNC and the account's lists, lib/sync/errorRecords.ts for the error records and
 * the outbox. So an error record filed before the confirmation waits on this device, as it would
 * without a connection, and nothing makes a request until the owner has said yes.
 *
 * m3 used to say this on its own /preview-notice page before it issued the session. The operator
 * moved it into the app (2026-09-24), as TUNER's first-run dialog is: the app is where the sending
 * happens, so the app says it.
 *
 * Framework-free, like owner-sync.ts. The React half is in the component.
 *
 * WHAT IS STORED
 *
 * `preview-notice:v1` in localStorage, holding when it was confirmed; its presence is the answer.
 * The version is in the KEY: when what the preview sends changes enough to be said again, the next
 * notice is `v2`, and every owner is asked once more.
 *
 * Storage that cannot be read cannot say the notice was confirmed, so the notice is shown. Storage
 * that cannot be written does not trap the owner behind it: the confirmation holds in memory for
 * this page load, and the notice comes back on the next.
 *
 * Once this page has seen a confirmation it keeps it until the page is closed. A notice that came
 * back mid-session because the storage was cleared somewhere else - over a write in progress, say -
 * would be worse than one that waits for the next load.
 */

import type { Variant } from '@/lib/domain/variant';

export const NOTICE_KEY = 'preview-notice:v1';

let seen = false;
const listeners = new Set<() => void>();

/** Whether the owner has confirmed the notice on this browser. Never throws. */
export function noticeAcknowledged(): boolean {
  if (seen) return true;
  try {
    seen = localStorage.getItem(NOTICE_KEY) !== null;
  } catch {
    // No storage, or it refused: nothing here can say it was confirmed.
  }
  return seen;
}

/** The one way past the notice: its CONFIRM button. Never throws. */
export function acknowledgeNotice(at: number = Date.now()): void {
  seen = true;
  try {
    localStorage.setItem(NOTICE_KEY, new Date(at).toISOString());
  } catch {
    // Not kept: confirmed for this page load only, and asked again on the next.
  }
  for (const l of listeners) l();
}

/** For useSyncExternalStore. A confirmation in another tab of this browser counts here too. */
export function subscribeNotice(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === NOTICE_KEY) fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Whether the notice covers the app: in the preview, until it has been confirmed. Production and
 * staging send nothing and so have nothing to say - whatever the browser has stored.
 */
export function noticeRequired(variant: Variant, acknowledged: boolean): boolean {
  return variant === 'preview' && !acknowledged;
}
