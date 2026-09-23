'use client';

/**
 * MODE - what the tool is working on, in the hub panel's bottom-LEFT corner (lib/domain/modes.ts).
 *
 * TUNER's corner, in this app's ramp: a quiet row - the word MODE and the mode's name - that opens
 * a sheet listing the modes, each with one line on what it is for. The mode chooses the tabs, the
 * cable and the hub, so it is touched once per job, not per write: a corner, not a control beside
 * the dial.
 *
 * It never disappears. When the mode cannot change (a write in progress, a cluster session that
 * may be holding a needle) the row still opens the sheet, with the reason at its top and the
 * options inert - `title` has no hover on a phone, and a control that will not move and will not
 * say why is the one that gets reported as broken.
 *
 * The sheet is the app's second floating surface (the confirm dialog is the first): pinned to the
 * viewport's foot on a phone, anchored above the corner from 900px up, one outline, a scrim that
 * closes it on pointer-down - tinted on a phone so an open sheet never looks like a frozen screen.
 */

import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';

import { LABEL } from '@/components/ui';
import { CHROME } from '@/lib/copy/chrome';
import { jc } from '@/lib/copy/job';
import type { AppMode, ModeLock } from '@/lib/domain/modes';

export function ModeCorner({
  mode,
  modes,
  onChange,
  lock,
}: {
  mode: AppMode;
  /** What this build offers (modes.ts selectableModes) - a release offers CHIP only. */
  modes: readonly AppMode[];
  onChange: (next: AppMode) => void;
  lock: ModeLock;
}) {
  const c = jc();
  const [open, setOpen] = useState(false);
  const locked = lock !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="group flex h-7 items-center gap-2"
      >
        {/* Blue whenever the tool is on something other than the chip - the chip is what almost
            every session is, so the accent there would only mean "a mode exists". */}
        <span className={`${LABEL} transition-colors ${mode === 'chip' ? 'text-slate-600 group-hover:text-slate-400' : 'text-blue-400'}`}>
          {CHROME.mode.title}
        </span>
        <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-slate-400">
          {CHROME.mode[mode]}
          {/* Rendered, not a title: it answers "why will this not move" before the sheet opens. */}
          {locked && <Lock className="size-2.5 text-slate-600" />}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-slate-950/60 min-[900px]:bg-transparent" onPointerDown={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label={CHROME.mode.title}
            className="fixed inset-x-3 bottom-[60px] z-50 rounded border border-slate-700 bg-slate-900 p-3 shadow-xl
                       min-[900px]:absolute min-[900px]:inset-x-auto min-[900px]:bottom-9 min-[900px]:left-0 min-[900px]:w-80"
          >
            <p className={`${LABEL} text-slate-500`}>{CHROME.mode.title}</p>
            <p className="mb-3 text-[10px] leading-snug text-slate-600">{c.mode.caption}</p>
            {lock && <p className="mb-3 text-[10px] leading-snug text-amber-400">{c.mode.lock[lock]}</p>}
            <div className="flex flex-col gap-1">
              {modes.map((m) => {
                const active = m === mode;
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      onChange(m);
                      setOpen(false);
                    }}
                    className={`w-full rounded px-2 py-2 text-left transition-colors
                      ${active ? 'bg-slate-800' : 'hover:bg-slate-800/60'}
                      ${locked ? 'cursor-default opacity-40' : 'cursor-pointer'}`}
                  >
                    <span className={`block ${LABEL} ${active ? 'text-blue-400' : 'text-slate-300'}`}>{CHROME.mode[m]}</span>
                    <span className="block text-[10px] leading-snug text-slate-500">{c.mode.produces[m]}</span>
                  </button>
                );
              })}
            </div>
            {!locked && <p className="mt-3 border-t border-slate-800 pt-2 text-[10px] leading-snug text-slate-600">{c.mode.note}</p>}
          </div>
        </>
      )}
    </div>
  );
}
