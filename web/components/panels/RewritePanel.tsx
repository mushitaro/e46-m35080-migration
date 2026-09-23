'use client';

/**
 * REWRITE's side panel - the job (lib/domain/job.ts): where the chip's data comes from, the
 * odometer, the VIN, the coding, and what the one write will do. It plans nothing itself: page.tsx
 * derives the plan from these inputs, and the hub writes it.
 *
 * Every refusal is rendered here, in words, in the section's reserved line at the foot - naming
 * which part refused - so the ring's CHECK PLAN always has its reason on screen.
 */

import { X } from 'lucide-react';

import { DropZone } from '@/components/DropZone';
import { FormField, JobPanel, Recommendation } from '@/components/panels/JobParts';
import { LABEL, MicroLabel, TextButton, pillClass } from '@/components/ui';
import { CHROME } from '@/lib/copy/chrome';
import { cc } from '@/lib/copy/coding';
import { jc } from '@/lib/copy/job';
import { t } from '@/lib/i18n';
import { jobDetails, type JobInput, type JobPlan, type JobRefusal } from '@/lib/domain/job';
import type { OdometerDecode } from '@/lib/domain/odometer';
import type { RefusalCode, VinAction } from '@/lib/domain/operations';
import { VIN_LENGTH } from '@/lib/domain/vin';
import type { recommend } from '@/lib/domain/workflow';

export type SourceKind = 'chip' | 'dump';

export function RewritePanel({
  rec,
  hasChip,
  chipBlank,
  odometer,
  sourceKind,
  onSourceKind,
  dump,
  onDumpFile,
  onClearDump,
  dumpError,
  targetKm,
  onTargetKm,
  vinAction,
  onVinAction,
  vinInput,
  onVinInput,
  input,
  plan,
  coding,
}: {
  rec: ReturnType<typeof recommend>;
  hasChip: boolean;
  chipBlank: boolean;
  odometer: OdometerDecode | null;
  sourceKind: SourceKind;
  onSourceKind: (k: SourceKind) => void;
  dump: { name: string } | null;
  onDumpFile: (file: File) => void;
  onClearDump: () => void;
  dumpError: { code: RefusalCode; fileSize?: number } | null;
  targetKm: string;
  onTargetKm: (v: string) => void;
  vinAction: VinAction;
  onVinAction: (a: VinAction) => void;
  vinInput: string;
  onVinInput: (v: string) => void;
  /** The job as asked, and as planned - null while there is nothing to plan (no chip, no dump). */
  input: JobInput | null;
  plan: JobPlan | JobRefusal | null;
  /** The coding section, where this build draws it. */
  coding: React.ReactNode;
}) {
  const c = jc();
  const copy = t();
  const refused = plan && !plan.ok ? plan : null;
  const ok = plan?.ok ? plan : null;

  return (
    <JobPanel>
      <p className="text-[10px] leading-snug text-slate-400">{c.lead}</p>
      <Recommendation rec={rec} />

      {/* ------------------------------ SOURCE ------------------------------ */}
      <FormField label={CHROME.job.source}>
        <div className="flex flex-wrap items-center gap-2">
          {(['chip', 'dump'] as const).map((k) => (
            <button
              key={k}
              type="button"
              disabled={k === 'chip' && !hasChip}
              onClick={() => onSourceKind(k)}
              aria-pressed={sourceKind === k}
              className={`${pillClass(sourceKind === k ? 'primary' : 'neutral')} transition-colors disabled:opacity-40`}
            >
              {k === 'chip' ? CHROME.job.chip : CHROME.job.dump}
            </button>
          ))}
          {sourceKind === 'dump' && dump && (
            <>
              <span className="min-w-0 truncate font-mono text-[10px] text-slate-300">{dump.name}</span>
              <TextButton tone="danger" Icon={X} onClick={onClearDump} className="ml-auto">
                {CHROME.job.clear}
              </TextButton>
            </>
          )}
        </div>
        {sourceKind === 'dump' && !dump && <DropZone onFile={onDumpFile} hint={CHROME.drop.dump} />}
        {dumpError && (
          <p className="font-mono text-[10px] text-red-400">
            {copy.refusal(dumpError).reason}
            {copy.refusal(dumpError).detail && <span className="block text-slate-500">{copy.refusal(dumpError).detail}</span>}
          </p>
        )}
        <p className="text-[10px] leading-snug text-slate-500">
          {sourceKind === 'chip'
            ? hasChip
              ? c.source.chip
              : c.source.noChip
            : !hasChip
              ? c.source.noChip
              : chipBlank
                ? c.source.blank
                : c.source.used}
        </p>
        {ok && sourceKind === 'dump' && (
          <p className="font-mono text-[10px] text-slate-400">
            {hasChip && `${c.source.bytes(ok.sourceBytes)} `}
            <span className={ok.sourceChecksums === 'ok' ? 'text-emerald-400' : 'text-slate-500'}>
              {ok.sourceChecksums === 'ok' ? c.source.checksumsOk : c.source.checksumsUnchecked}
            </span>
          </p>
        )}
      </FormField>

      {/* ----------------------------- ODOMETER ----------------------------- */}
      <FormField label={CHROME.job.odometer}>
        <div className="flex items-center gap-2">
          <span className="w-28 shrink-0 font-mono text-sm text-slate-300">{odometer?.ok ? `${odometer.km.toLocaleString()} km` : '—'}</span>
          <span className="text-slate-600">&rarr;</span>
          <input
            inputMode="numeric"
            value={targetKm}
            disabled={!hasChip}
            onChange={(e) => onTargetKm(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder={hasChip ? CHROME.coding.keep : '—'}
            aria-label={`${CHROME.job.odometer} ${CHROME.readout.target}`}
            className="min-w-0 flex-1 rounded bg-slate-800 px-2 py-1 font-mono text-sm text-blue-400 outline-none
                       placeholder:text-slate-700 focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
          />
        </div>
        <p className="text-[10px] leading-snug text-slate-500">{hasChip ? c.odometer.keep : c.odometer.needsChip}</p>
        {ok && ok.secureOps.length > 0 && <p className="text-[10px] leading-snug text-amber-400">{c.odometer.irreversible}</p>}
      </FormField>

      {/* -------------------------------- VIN ------------------------------- */}
      <FormField label={CHROME.job.vin}>
        <div className="flex flex-wrap gap-2">
          {(['keep', 'write', 'blank'] as const).map((k) => (
            <button
              key={k}
              type="button"
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
            className="w-full rounded bg-slate-800 px-2 py-1 font-mono text-sm tracking-widest
                       text-slate-200 outline-none placeholder:text-slate-700 focus:ring-1 focus:ring-blue-500"
          />
        )}
        {/* Field by field - the label is the promise, so it names every address, including the
            checksum a coded-field write recomputes. */}
        {ok && ok.vinWrites.length > 0 && (
          <ul className="flex flex-col gap-0.5 font-mono text-[10px] leading-snug text-slate-400">
            {ok.vinWrites.map((w) => (
              <li key={w.address}>{w.label}</li>
            ))}
          </ul>
        )}
      </FormField>

      {/* ------------------------------ CODING ------------------------------ */}
      {coding && (
        <div className="-mx-5 border-t border-slate-800">
          <div className="px-5 pt-4">
            <MicroLabel as="h3">{CHROME.job.coding}</MicroLabel>
          </div>
          {coding}
        </div>
      )}

      {/* ------------------------------ CHANGES ----------------------------- */}
      <div className="-mx-5 flex flex-col gap-2 border-t border-slate-800 px-5 pt-4">
        <MicroLabel as="h3">{CHROME.job.changes}</MicroLabel>
        {refused ? (
          <div className="rounded bg-red-900/20 px-2 py-1.5">
            <p className={`${LABEL} text-red-400`}>{CHROME.job[refused.part]}</p>
            <p className="text-[10px] leading-snug text-red-300">
              {refused.refusal.code === 'no-chip'
                ? c.source.noChip
                : refused.part === 'coding'
                  ? cc().refused[(refused.refusal as { code: keyof ReturnType<typeof cc>['refused'] }).code]
                  : copy.refusal(refused.refusal as Parameters<typeof copy.refusal>[0]).reason}
            </p>
          </div>
        ) : ok && input ? (
          /* What the job changes: with a chip, what differs on it - nothing, once it holds the plan;
             without one, the VIN and coding edits, and the line below says what writing needs. */
          (hasChip ? ok.byteWrites.length + ok.secureOps.length : ok.vinWrites.length + (ok.coding?.changes.length ?? 0)) === 0 ? (
            hasChip && <p className="text-[10px] leading-snug text-slate-500">{c.nothing}</p>
          ) : (
            <ul className="flex flex-col gap-0.5 font-mono text-[10px] leading-snug text-slate-400">
              {jobDetails(ok, input).map((line, i) => (
                <li key={i} className="whitespace-pre-wrap">
                  {line}
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="text-[10px] leading-snug text-slate-500">{c.source.noChip}</p>
        )}
        {!hasChip && ok && <p className="text-[10px] leading-snug text-amber-400">{c.noChipToWrite}</p>}
        <p className="text-[10px] leading-snug text-slate-600">{c.undo}</p>
        {sourceKind === 'dump' && chipBlank && <p className="text-[10px] leading-snug text-amber-400">{c.source.verify}</p>}
      </div>
    </JobPanel>
  );
}
