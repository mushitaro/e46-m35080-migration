'use client';

/**
 * RESTORE's side panel. Same backup, same "never touch the odometer" rule; what differs is the
 * chip. A blank one gets the whole array; a used one gets only the bytes it has lost.
 */

import type { RefusalCode, RepairPlan, ResetPlan, Refusal } from '@/lib/domain/operations';
import type { recommend, StepId } from '@/lib/domain/workflow';
import { t } from '@/lib/i18n';
import { g } from '@/lib/copy/guide';
import { CHROME } from '@/lib/copy/chrome';
import { DropZone } from '@/components/DropZone';
import { JobPanel, PlanNote, Recommendation } from '@/components/panels/JobParts';

export function RestorePanel({
  rec,
  step,
  chipBlank,
  restorePlan,
  repairPlan,
  onBackupFile,
  fileError,
}: {
  rec: ReturnType<typeof recommend>;
  step: StepId;
  chipBlank: boolean;
  restorePlan: ResetPlan | Refusal | null;
  repairPlan: RepairPlan | Refusal | null;
  onBackupFile: (file: File) => void;
  fileError: { code: RefusalCode; fileSize?: number } | null;
}) {
  const c = g();
  const copy = t();
  return (
    <JobPanel>
      <Recommendation rec={rec} step={step} />
      {chipBlank ? (
        <>
          <p className="text-[11px] leading-relaxed text-slate-300">{c.restoreLead}</p>
          <ul className="flex flex-col gap-0.5 rounded bg-slate-900 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-slate-400">
            <li>{c.restoreRowData}</li>
            <li>{c.restoreRowVin}</li>
            <li>{c.restoreRowOdo}</li>
          </ul>
        </>
      ) : (
        <>
          <p className="text-[11px] leading-relaxed text-slate-300">{c.repairLead}</p>
          <p className="text-[11px] leading-relaxed text-slate-400">{c.repairSafe}</p>
          {repairPlan?.ok && (
            <p className="font-mono text-[10px] text-slate-400">
              {repairPlan.byteWrites.length > 0 ? c.repairCount(repairPlan.addresses.length) : c.repairNothing}
            </p>
          )}
        </>
      )}
      <DropZone onFile={onBackupFile} hint={CHROME.drop.backup} />
      {fileError && (
        <p className="font-mono text-[10px] text-red-400">
          {copy.refusal(fileError).reason}
          {copy.refusal(fileError).detail && (
            <span className="block text-slate-500">{copy.refusal(fileError).detail}</span>
          )}
        </p>
      )}
      <PlanNote plan={chipBlank ? restorePlan : repairPlan} />
      {chipBlank ? (
        <>
          <p className="text-[11px] leading-relaxed text-slate-400">{c.restoreProcedure}</p>
          {/* The sync is conditional, so the promise cannot be. */}
          <p className="text-[11px] leading-relaxed text-amber-400">{c.restoreVerify}</p>
        </>
      ) : (
        <p className="text-[11px] leading-relaxed text-amber-400">{c.repairRetentionTest}</p>
      )}
      <p className="text-[10px] leading-snug text-slate-600">{c.restoreBasis}</p>
    </JobPanel>
  );
}
