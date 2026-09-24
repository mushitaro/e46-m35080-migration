'use client';

/**
 * What this preview sends, and why - said once, before it sends anything.
 *
 * The first time the preview opens in a browser, this covers the app until the owner confirms it.
 * m3 used to say it on its own /preview-notice page before issuing the session; the operator moved
 * it into the app (2026-09-24), as TUNER's first-run dialog is. The words are m3's, with the lines
 * about error records made exact for this app (lib/copy/sync.ts), and the privacy policy says the
 * same at length under #preview.
 *
 * A gate, not a dialog: no X, no backdrop click, no Escape. The one way past it is CONFIRM AND
 * CONTINUE, and behind it the header and the work area are `inert` (page.tsx), so neither a click
 * nor Tab reaches a control. The dialog is not what holds the data back, though: every send path
 * waits for the same acknowledgement (lib/sync/previewNotice.ts), so an error record filed before
 * it waits on the device.
 *
 * The list-shaped modal of tsunagi-m-design section 5.4 - 440 x 712, vertical phi - because the
 * notice is a column of items read top to bottom. Focus goes to the card, not the button: the
 * notice is there to be read, and Enter on arrival should not confirm it unread.
 *
 * Production and staging draw nothing, and do not even read the storage (usePreviewNoticeOpen).
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Shield } from 'lucide-react';
import { LABEL, Pane, Section } from '@/components/ui';
import { useVariant } from '@/lib/domain/variant';
import { NOTICE_TITLE, privacyUrl, syncCopy } from '@/lib/copy/sync';
import { acknowledgeNotice, noticeAcknowledged, noticeRequired, subscribeNotice } from '@/lib/sync/previewNotice';

const yes = () => true;
const listenToNothing = () => () => {};

/**
 * Whether the notice covers the app now.
 *
 * False in the prerender, and wherever this build is not the preview - where the storage is not
 * even read. In the preview it is open until the owner confirms it here or in another tab.
 */
export function usePreviewNoticeOpen(): boolean {
  const variant = useVariant();
  const asks = variant === 'preview';
  const acknowledged = useSyncExternalStore(asks ? subscribeNotice : listenToNothing, asks ? noticeAcknowledged : yes, yes);
  return noticeRequired(variant, acknowledged);
}

/** What is sent, and the prose around it. The "when" lines step back one shade. */
const WHAT = 'text-[11px] leading-relaxed text-slate-300';
const AROUND = 'text-[11px] leading-relaxed text-slate-400';

export function PreviewNotice({ open }: { open: boolean }) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) card.current?.focus();
  }, [open]);

  if (!open) return null;
  const c = syncCopy().notice;

  return (
    <>
      {/* Scrim, with no handler: clicking beside the notice does nothing. Blurred only on a wide
          layout, as ConfirmDialog's is. */}
      <div className="fixed inset-0 z-[100] bg-slate-950/70 min-[900px]:backdrop-blur-sm" />
      {/* A floating surface, so the one outline it is allowed (check_ui_tokens.mjs). max-h only
          clamps it on a short viewport; the body scrolls then, and the footer stays. */}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-notice-title"
        aria-describedby="preview-notice-lead"
        tabIndex={-1}
        className="fixed left-1/2 top-1/2 z-[110] flex h-[712px] max-h-[80vh] w-[440px] max-w-[calc(100vw-24px)]
                   -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-slate-700 bg-slate-900 p-4
                   shadow-xl outline-none"
      >
        <div className="flex h-6 shrink-0 items-center gap-2">
          <Shield className="h-4 w-4 shrink-0 text-slate-500" />
          <h2 id="preview-notice-title" className={`${LABEL} text-slate-300`}>
            {NOTICE_TITLE}
          </h2>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          <Pane>
            <p id="preview-notice-lead" className={WHAT}>
              {c.lead}
            </p>
            <Section title={c.sessionsTitle}>
              <p className={WHAT}>{c.sessions}</p>
              <p className={AROUND}>{c.sessionsWhen}</p>
            </Section>
            <Section title={c.recordsTitle}>
              <p className={WHAT}>{c.records}</p>
              <p className={AROUND}>{c.recordsWhen}</p>
            </Section>
            <p className={AROUND}>{c.alsoSent}</p>
            <Section title={c.purposeTitle}>
              <p className={WHAT}>{c.purpose}</p>
            </Section>
            <Section title={c.whereTitle}>
              <p className={WHAT}>{c.where}</p>
            </Section>
            <Section title={c.deleteTitle}>
              <p className={WHAT}>{c.deleteBody}</p>
            </Section>
          </Pane>
        </div>

        {/* The policy, in a new tab: a same-tab navigation would drop the page this notice is the
            door to. Then the one button. */}
        <div className="mt-3 flex shrink-0 items-center justify-between gap-4 border-t border-slate-800 pt-3">
          <a
            href={privacyUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-blue-400 underline underline-offset-2 transition-colors hover:text-blue-300"
          >
            {c.policy}
          </a>
          <button
            type="button"
            onClick={() => acknowledgeNotice()}
            className={`shrink-0 rounded bg-blue-600 px-3 py-1 ${LABEL} text-white transition-colors hover:bg-blue-500`}
          >
            {c.confirm}
          </button>
        </div>
      </div>
    </>
  );
}
