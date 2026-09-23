'use client';

/**
 * The pieces REWRITE and RESTORE share: the panel column, the recommendation the tool states
 * for itself, and the rendered refusal. Moved out of page.tsx unchanged.
 */

import type { Refusal } from '@/lib/domain/operations';
import type { recommend } from '@/lib/domain/workflow';
import type { StepId } from '@/lib/domain/workflow';
import { t } from '@/lib/i18n';
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
export function Recommendation({ rec, step }: { rec: ReturnType<typeof recommend>; step: StepId }) {
  const c = g();
  if (rec.kind === 'unknown') return <div className="min-h-[28px]" />;

  /* A blank chip means something different per tab. On REWRITE the useful fact is that any
     value is reachable; saying that on RESTORE contradicts the procedure directly beneath it,
     which is that no mileage is written here. */
  const text =
    rec.kind === 'restore-ready'
      ? step === 'restore'
        ? c.recBlankForRestore
        : c.recRestoreReady
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

type PlanLike = { ok: true } | Refusal | null;

/**
 * A refusal is RENDERED, in the reader's language, with the actionable detail. The domain layer
 * never writes prose, so a refusal cannot arrive in the author's language.
 */
export function PlanNote({ plan }: { plan: PlanLike }) {
  if (!plan || plan.ok) return <div className="min-h-[28px]" />;
  const { reason, detail } = t().refusal(plan);
  return (
    <div className="min-h-[28px] rounded bg-red-900/20 px-2 py-1.5">
      <p className="text-[10px] leading-snug text-red-400">{reason}</p>
      {detail && <p className="mt-0.5 font-mono text-[10px] text-slate-400">{detail}</p>}
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
