'use client';

/**
 * REWRITE's pieces: the panel column, the recommendation the tool states for itself, and a form
 * row. Moved out of page.tsx; RESTORE, which shared them, is now REWRITE's SOURCE.
 */

import type { recommend } from '@/lib/domain/workflow';
import { g } from '@/lib/copy/guide';
import { LABEL } from '@/components/ui';

export function JobPanel({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4 px-5 py-4">{children}</div>;
}

/**
 * What this chip allows, stated by the tool.
 *
 * The increment-only rule is the one thing a reader must not have to work out for themselves, so
 * the comparison is made here rather than left implicit in a refusal they meet later.
 */
export function Recommendation({ rec }: { rec: ReturnType<typeof recommend> }) {
  const c = g();
  if (rec.kind === 'unknown') return <div className="min-h-[28px]" />;

  const text =
    rec.kind === 'restore-ready'
      ? c.recRestoreReady
      : rec.kind === 'rewrite-possible'
        ? c.recRewritePossible(rec.currentKm, rec.targetKm)
        : c.recNeedsNewChip(rec.currentKm, rec.targetKm);

  const tone = rec.kind === 'needs-new-chip' ? 'text-amber-400' : 'text-emerald-400';

  return (
    <div className="min-h-[28px] rounded bg-slate-900 px-2 py-1.5">
      <p className={`${LABEL} text-slate-600`}>{c.recTitle}</p>
      <p className={`mt-0.5 text-[10px] leading-snug ${tone}`}>{text}</p>
    </div>
  );
}

/** A form row: a label over an input. Not ui.tsx's Field, which is a read-only readout. */
export function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`${LABEL} text-slate-500`}>{label}</span>
      {children}
    </div>
  );
}
