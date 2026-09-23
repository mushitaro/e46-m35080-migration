'use client';

/**
 * Confirm before the irreversible.
 *
 * States the CONCRETE consequence - which bytes, to where, what cannot be
 * undone - not "are you sure". During the point-of-no-return phase there is no
 * dismiss affordance at all: no X, no backdrop click, no Cancel. Once the chip
 * has been told to write, there is no honest way to offer a cancel.
 */

import { AlertTriangle, Loader2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import { CHROME } from '@/lib/copy/chrome';
import { LABEL } from '@/components/ui';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** The consequence, in the reader's language. Newlines become paragraphs. */
  body: string;
  /** Lines naming the exact bytes/registers this will touch. */
  details?: string[];
  confirmLabel?: string;
  /** True once the write has started - removes every way out. */
  inProgress?: boolean;
  progressLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  body,
  details = [],
  confirmLabel,
  inProgress = false,
  progressLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  const copy = t();

  return (
    <>
      {/* Scrim. Blurred only on a wide layout: on a phone the blur costs about a
          second to paint, on the one dialog that has to appear at once. */}
      <div
        className="fixed inset-0 z-[100] bg-slate-950/70 min-[900px]:backdrop-blur-sm"
        onClick={inProgress ? undefined : onCancel}
      />
      {/* 560 x 346 is phi. max-h only clamps it on a short viewport. The one
          outline in the app: this card floats, detached from the page. */}
      <div
        role="dialog"
        aria-modal="true"
        className="fixed left-1/2 top-1/2 z-[110] flex w-[560px] max-w-[calc(100vw-24px)]
                   h-[346px] max-h-[80vh] -translate-x-1/2 -translate-y-1/2 flex-col
                   rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl
                   animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex h-6 shrink-0 items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-400" />
          <h2 className={`${LABEL} text-red-400`}>
            {title}
          </h2>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          {body.split('\n').map((line, i) =>
            line.trim() === '' ? (
              <div key={i} className="h-2" />
            ) : (
              <p key={i} className="text-[11px] leading-relaxed text-slate-300">
                {line}
              </p>
            ),
          )}

          {details.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-slate-800 pt-3">
              {details.map((d, i) => (
                <li key={i} className="font-mono text-[10px] text-slate-400">
                  {d}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Reserved footer: same height whether or not it holds buttons, so the
            dialog does not resize at the moment it becomes uncancellable. */}
        <div className="flex h-[34px] shrink-0 items-center justify-end gap-3 pt-2">
          {inProgress ? (
            <span className={`flex items-center gap-2 ${LABEL} text-amber-400`}>
              <Loader2 className="h-3 w-3 animate-spin" />
              {progressLabel ?? CHROME.hub.writing}
              <span className="ml-2 font-normal normal-case tracking-normal text-slate-500">
                {copy.noCancelDuringWrite}
              </span>
            </span>
          ) : (
            <>
              <button
                onClick={onCancel}
                className={`${LABEL} text-slate-500
                           transition-colors hover:text-slate-300`}
              >
                {CHROME.cancel}
              </button>
              <button
                onClick={onConfirm}
                className={`rounded bg-red-600 px-3 py-1 ${LABEL} text-white
                           transition-colors hover:bg-red-500`}
              >
                {confirmLabel ?? CHROME.proceed}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
