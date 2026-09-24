'use client';

/**
 * RECORDS › SYNC - the preview build's account copy of this device's records, and the error
 * records the app sent by itself.
 *
 * Drawn only in the preview (page.tsx gates it on the variant, and every call below checks
 * `maySend()` again), beside the RECORDS table it extends. Production draws none of it and makes no
 * request, and neither does the preview until its owner has confirmed the first-run notice
 * (components/PreviewNotice.tsx): no account read, no outbox flush, no SYNC.
 *
 *   SYNC     sends every record on this device the account does not have yet. Records never change,
 *            so "has it" is a question of the id; a second SYNC sends nothing.
 *   RESTORE  puts an account copy back into this device's records, with its own id and date
 *            (lib/sync/recordImport.ts), so it is the same record in both places.
 *   DELETE   removes the account copy only, after saying so; the device keeps its own.
 *
 * "Sign in again" is offered only when it can cost nothing but a page load: the session has
 * actually expired (not merely "unknown" - m3 unreachable), the device is online, the bridge is
 * disconnected and nothing here is running. It is a same-tab navigation through m3, so an open
 * serial link would be dropped by it; changes to a file on REWRITE that SAVE EDITED has not saved
 * are confirmed first.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { CloudUpload, Download, LogIn, Trash2 } from 'lucide-react';
import { LABEL, Pane, Pill, Section, TextButton } from '@/components/ui';
import type { DeviceRecord } from '@/lib/domain/records';
import type { Phase } from '@/lib/hooks/useM35080Link';
import {
  deleteCloudRecord,
  deleteDiagnostic,
  fetchCloudRecord,
  listCloudRecords,
  listDiagnostics,
  maySend,
  sendRecord,
  type CloudDiagnosticRow,
  type CloudRecordRow,
} from '@/lib/sync/cloud';
import { flushErrorRecords, waitingErrorRecords } from '@/lib/sync/errorRecords';
import { gateStatus, reauthHref, type GateState } from '@/lib/sync/owner-sync';
import { importRecord } from '@/lib/sync/recordImport';
import { SYNC_WORDS, syncCopy } from '@/lib/copy/sync';
import { usePreviewNoticeOpen } from '@/components/PreviewNotice';

type Notice = { text: string; tone: 'info' | 'ok' | 'warn' | 'error' };

const subscribeOnline = (fn: () => void) => {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
};
function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

const TONE: Record<Notice['tone'], string> = {
  info: 'text-slate-400',
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

const when = (ms: number) => new Date(ms).toLocaleString();

/** The account's side, read in one go. Records waiting in the outbox go when the gate says active. */
async function readAccount() {
  const [s, d, gate, n] = await Promise.all([listCloudRecords(), listDiagnostics(), gateStatus(), waitingErrorRecords()]);
  let waiting = n;
  if (gate.state === 'active' && n > 0) {
    await flushErrorRecords();
    waiting = await waitingErrorRecords();
  }
  return {
    gate,
    waiting,
    cloud: s.ok && s.data ? s.data.sessions : null,
    diagnostics: d.ok && d.data ? d.data.diagnostics : null,
  };
}

export function SyncPanel({
  records,
  onRecordsChanged,
  linkPhase,
  linkBusy,
  unsavedWork,
}: {
  /** This device's records, as the RECORDS table shows them. */
  records: DeviceRecord[];
  /** Re-read the device's records after a RESTORE. */
  onRecordsChanged: () => void;
  linkPhase: Phase;
  linkBusy: boolean;
  /** Something a page load would lose: a file's changes on REWRITE that SAVE EDITED has not saved. */
  unsavedWork: boolean;
}) {
  const c = syncCopy();
  const online = useOnline();
  const noticeOpen = usePreviewNoticeOpen();
  const [gate, setGate] = useState<{ state: GateState; label: string | null } | null>(null);
  const [cloud, setCloud] = useState<CloudRecordRow[] | null>(null);
  const [diagnostics, setDiagnostics] = useState<CloudDiagnosticRow[] | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const refresh = useCallback(async () => {
    if (!maySend()) return;
    const snap = await readAccount();
    setGate(snap.gate);
    setWaiting(snap.waiting);
    setCloud(snap.cloud);
    setDiagnostics(snap.diagnostics);
  }, []);

  // Opened, back online while open, or the first-run notice just confirmed. Nothing is fetched for
  // a tab nobody is looking at, and nothing at all before the notice is confirmed (`refresh`).
  useEffect(() => {
    void refresh();
  }, [online, noticeOpen, refresh]);

  const cloudIds = useMemo(() => new Set((cloud ?? []).map((r) => r.id)), [cloud]);
  const localIds = useMemo(() => new Set(records.map((r) => r.id)), [records]);
  const pending = cloud === null ? null : records.filter((r) => !cloudIds.has(r.id)).length;

  const expire = useCallback(() => setGate((g) => ({ state: 'expired', label: g?.label ?? null })), []);

  const sync = useCallback(async () => {
    if (!maySend()) return;
    setBusy('sync');
    try {
      // The account as it is now, not as the panel last saw it: another device may have sent some.
      const list = await listCloudRecords();
      if (!list.ok || !list.data) {
        if (list.expired) expire();
        setNotice({ text: list.expired ? c.sendExpired : c.sendFailed, tone: 'error' });
        return;
      }
      const have = new Set(list.data.sessions.map((r) => r.id));
      const toSend = records.filter((r) => !have.has(r.id));
      if (toSend.length === 0) {
        setNotice({ text: c.nothingToSend, tone: 'info' });
        return;
      }
      let sent = 0;
      let tooLarge = false;
      for (const r of toSend) {
        const res = await sendRecord(r);
        if (res.ok) {
          sent++;
          continue;
        }
        if (res.tooLarge) {
          tooLarge = true;
          continue;
        }
        if (res.expired) expire();
        setNotice({ text: res.expired ? c.sendExpired : c.sendFailed, tone: 'error' });
        return;
      }
      setNotice(tooLarge ? { text: c.tooLarge, tone: 'warn' } : { text: c.sent(sent), tone: 'ok' });
      if (sent > 0) await flushErrorRecords();
    } finally {
      await refresh();
      setBusy(null);
    }
  }, [records, refresh, expire, c]);

  const restore = useCallback(
    async (id: string) => {
      setBusy(`restore:${id}`);
      try {
        const { record, result } = await fetchCloudRecord(id);
        if (!record) {
          if (result.expired) expire();
          setNotice({ text: result.expired ? c.sendExpired : c.restoreFailed, tone: 'error' });
          return;
        }
        const r = await importRecord(record);
        setNotice(
          r === 'added'
            ? { text: c.restored, tone: 'ok' }
            : r === 'exists'
              ? { text: c.restoreExists, tone: 'info' }
              : { text: c.restoreBadHash, tone: 'error' },
        );
        onRecordsChanged();
      } catch {
        setNotice({ text: c.restoreFailed, tone: 'error' });
      } finally {
        setBusy(null);
      }
    },
    [onRecordsChanged, expire, c],
  );

  const removeCloud = useCallback(
    async (row: CloudRecordRow) => {
      const what = `${row.kind.toUpperCase()} ${row.vin ?? ''} ${when(row.created_at)}`.replace(/\s+/g, ' ').trim();
      if (!window.confirm(c.deleteConfirm(what))) return;
      setBusy(`delete:${row.id}`);
      const r = await deleteCloudRecord(row.id);
      if (r.ok) setNotice({ text: c.deleted, tone: 'ok' });
      else {
        if (r.expired) expire();
        setNotice({ text: r.expired ? c.sendExpired : c.sendFailed, tone: 'error' });
      }
      await refresh();
      setBusy(null);
    },
    [refresh, expire, c],
  );

  const removeDiagnostic = useCallback(
    async (id: string) => {
      if (!window.confirm(c.deleteDiagConfirm)) return;
      setBusy(`diag:${id}`);
      const r = await deleteDiagnostic(id);
      if (!r.ok) {
        if (r.expired) expire();
        setNotice({ text: r.expired ? c.sendExpired : c.sendFailed, tone: 'error' });
      }
      await refresh();
      setBusy(null);
    },
    [refresh, expire, c],
  );

  const expired = gate?.state === 'expired';
  const canReauth = expired && online && linkPhase === 'disconnected' && !linkBusy && busy === null;
  const reauth = useCallback(() => {
    if (unsavedWork && !window.confirm(c.reauthConfirm)) return;
    location.assign(reauthHref());
  }, [unsavedWork, c]);

  const active = gate?.state === 'active';
  const status = !online
    ? c.offline
    : gate === null
      ? c.checking
      : active
        ? c.savedTo(gate.label ?? '')
        : expired
          ? c.expired
          : c.unknown;

  return (
    <div className="px-5 py-4">
      <Pane>
        <Section
          title={SYNC_WORDS.account}
          actions={
            <>
              {canReauth && (
                <TextButton tone="caution" Icon={LogIn} onClick={reauth}>
                  {SYNC_WORDS.signIn}
                </TextButton>
              )}
              <TextButton
                Icon={CloudUpload}
                onClick={() => void sync()}
                disabled={!online || !active || busy !== null || records.length === 0}
              >
                {busy === 'sync' ? SYNC_WORDS.syncing : SYNC_WORDS.sync}
              </TextButton>
            </>
          }
        >
          <p className="text-[11px] leading-relaxed text-slate-400">{c.lead}</p>
          <p className={`text-[11px] leading-relaxed ${active ? 'text-slate-300' : 'text-amber-400'}`}>{status}</p>
          {expired && !canReauth && linkPhase !== 'disconnected' && (
            <p className="text-[11px] leading-relaxed text-slate-500">{c.reauthWhenIdle}</p>
          )}
          {active && pending !== null && <p className="text-[11px] leading-relaxed text-slate-500">{c.pending(pending)}</p>}
          {/* One line, reserved, so a result appearing does not move the list under the pointer. */}
          <p className={`min-h-[18px] text-[11px] leading-snug ${notice ? TONE[notice.tone] : ''}`} role="status">
            {notice?.text ?? ''}
          </p>

          {cloud !== null && cloud.length === 0 && <p className="text-[11px] text-slate-600">{c.accountEmpty}</p>}
          {cloud !== null && cloud.length > 0 && (
            <div className="flex flex-col">
              {cloud.map((row) => (
                <div key={row.id} className="flex items-center gap-2 border-b border-slate-800/50 py-1.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Pill tone="primary">{row.kind}</Pill>
                      {row.practice === 1 && <Pill tone="caution">{SYNC_WORDS.practice}</Pill>}
                      <span className="font-mono text-[11px] text-slate-300">{row.vin ?? '—'}</span>
                      <span className="font-mono text-[11px] tabular-nums text-blue-400">
                        {row.km === null ? '—' : `${row.km.toLocaleString()} km`}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-600">
                      {when(row.created_at)} · {row.hash.slice(0, 10)}
                    </span>
                  </div>
                  {localIds.has(row.id) ? (
                    <span className={`${LABEL} text-slate-600`}>{SYNC_WORDS.onDevice}</span>
                  ) : (
                    <TextButton Icon={Download} onClick={() => void restore(row.id)} disabled={busy !== null}>
                      {SYNC_WORDS.restore}
                    </TextButton>
                  )}
                  <TextButton
                    tone="danger"
                    Icon={Trash2}
                    onClick={() => void removeCloud(row)}
                    disabled={busy !== null}
                    title={SYNC_WORDS.delete}
                    aria-label={SYNC_WORDS.delete}
                  >
                    {''}
                  </TextButton>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title={SYNC_WORDS.errors}>
          <p className="text-[11px] leading-relaxed text-slate-500">{c.errorsLead}</p>
          {waiting > 0 && <p className="text-[11px] text-amber-400">{c.waiting(waiting)}</p>}
          {diagnostics !== null && diagnostics.length === 0 && <p className="text-[11px] text-slate-600">{c.errorsEmpty}</p>}
          {diagnostics !== null && diagnostics.length > 0 && (
            <div className="flex flex-col">
              {diagnostics.map((d) => (
                <div key={d.id} className="flex items-center gap-2 border-b border-slate-800/50 py-1.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Pill tone={d.error_kind === 'refused' ? 'caution' : 'danger'}>{d.phase}</Pill>
                      {d.practice === 1 && <Pill tone="caution">{SYNC_WORDS.practice}</Pill>}
                      <span className="font-mono text-[10px] text-slate-600">{when(d.created_at)}</span>
                    </div>
                    <span className="truncate text-[11px] text-slate-400" title={d.error ?? ''}>
                      {d.error ?? '—'}
                    </span>
                  </div>
                  <TextButton
                    tone="danger"
                    Icon={Trash2}
                    onClick={() => void removeDiagnostic(d.id)}
                    disabled={busy !== null}
                    title={SYNC_WORDS.delete}
                    aria-label={SYNC_WORDS.delete}
                  >
                    {''}
                  </TextButton>
                </div>
              ))}
            </div>
          )}
        </Section>

      </Pane>
    </div>
  );
}
