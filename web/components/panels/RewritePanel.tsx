'use client';

/**
 * REWRITE's side panel: the current reading, the target, and what happens to the VIN. It plans
 * nothing itself - page.tsx derives the plan from these inputs, and the hub writes it.
 */

import type { RewritePlan, Refusal, VinAction } from '@/lib/domain/operations';
import type { OdometerDecode } from '@/lib/domain/odometer';
import type { recommend, StepId } from '@/lib/domain/workflow';
import { VIN_LENGTH } from '@/lib/domain/vin';
import { CHROME } from '@/lib/copy/chrome';
import { LABEL } from '@/components/ui';
import { FormField, JobPanel, PlanNote, Recommendation } from '@/components/panels/JobParts';

export function RewritePanel({
  rec,
  step,
  odometer,
  targetKm,
  onTargetKm,
  vinAction,
  onVinAction,
  vinInput,
  onVinInput,
  plan,
}: {
  rec: ReturnType<typeof recommend>;
  step: StepId;
  odometer: OdometerDecode | null;
  targetKm: string;
  onTargetKm: (v: string) => void;
  vinAction: VinAction;
  onVinAction: (a: VinAction) => void;
  vinInput: string;
  onVinInput: (v: string) => void;
  plan: RewritePlan | Refusal | null;
}) {
  return (
    <JobPanel>
      <Recommendation rec={rec} step={step} />
      <FormField label={CHROME.readout.current}>
        <span className="font-mono text-sm text-slate-300">
          {odometer?.ok ? `${odometer.km.toLocaleString()} km` : '—'}
        </span>
      </FormField>
      <FormField label={CHROME.readout.target}>
        <input
          inputMode="numeric"
          value={targetKm}
          onChange={(e) => onTargetKm(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="155940"
          className="w-full rounded bg-slate-800 px-2 py-1 font-mono text-sm text-blue-400 outline-none
                     placeholder:text-slate-700 focus:ring-1 focus:ring-blue-500"
        />
      </FormField>
      <FormField label={CHROME.readout.vin}>
        <div className="flex flex-wrap gap-2">
          {(['keep', 'write', 'blank'] as const).map((k) => (
            <button
              key={k}
              onClick={() => onVinAction(k === 'write' ? { kind: 'write', vin: vinInput } : { kind: k })}
              className={`rounded px-2 py-0.5 ${LABEL} transition-colors ${
                vinAction.kind === k ? 'bg-blue-900 text-blue-200' : 'bg-slate-800 text-slate-500 hover:text-slate-300'
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        {vinAction.kind === 'write' && (
          <input
            value={vinInput}
            onChange={(e) => onVinInput(e.target.value.toUpperCase())}
            placeholder="AB12345"
            // The chip holds VIN positions 11-17 and nothing else.
            maxLength={VIN_LENGTH}
            className="mt-2 w-full rounded bg-slate-800 px-2 py-1 font-mono text-sm tracking-widest
                       text-slate-200 outline-none placeholder:text-slate-700 focus:ring-1 focus:ring-blue-500"
          />
        )}
      </FormField>
      <PlanNote plan={plan} />
    </JobPanel>
  );
}
