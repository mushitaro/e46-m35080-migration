'use client';

/**
 * REWRITE's side panel - the job (lib/domain/job.ts): where the chip's data comes from (the chip,
 * or a file), the odometer, the VIN, the coding, the bytes changed by hand, and what the one
 * write will do - or the file SAVE EDITED makes of it, to write later. It plans nothing itself:
 * page.tsx derives the plan from these inputs, and the hub writes it.
 *
 * Every refusal is rendered here, in words, in the section's reserved line at the foot - naming
 * which part refused - so the ring's CHECK PLAN always has its reason on screen.
 */

import { useMemo } from 'react';
import { Download, RotateCcw, Undo2, Wrench, X } from 'lucide-react';

import { DropZone } from '@/components/DropZone';
import { FormField, JobPanel, Recommendation } from '@/components/panels/JobParts';
import { Callout, LABEL, MicroLabel, TextButton, pillClass } from '@/components/ui';
import { CHROME } from '@/lib/copy/chrome';
import { cc } from '@/lib/copy/coding';
import { jc } from '@/lib/copy/job';
import { t } from '@/lib/i18n';
import { jobDetails, type JobInput, type JobPlan, type JobRefusal } from '@/lib/domain/job';
import { diff, formatAddress, secureOf, verdictFor } from '@/lib/domain/image';
import { detectLayout } from '@/lib/domain/layout';
import { decodeOdometer, type OdometerDecode } from '@/lib/domain/odometer';
import type { RefusalCode, VinAction } from '@/lib/domain/operations';
import { VIN_LENGTH, recordVin } from '@/lib/domain/vin';
import type { recommend } from '@/lib/domain/workflow';

export type SourceKind = 'chip' | 'dump';

/** A refusal in the reader's language - the CHANGES box's, and CODING's when it cannot list. */
export function jobRefusalText(r: JobRefusal): string {
  if (r.refusal.code === 'no-chip') return jc().source.noChip;
  if (r.part === 'coding') return cc().refused[(r.refusal as { code: keyof ReturnType<typeof cc>['refused'] }).code];
  const text = t().refusal(r.refusal as Parameters<ReturnType<typeof t>['refusal']>[0]);
  return text.detail ? `${text.reason} ${text.detail}` : text.reason;
}

export function RewritePanel({
  rec,
  hasChip,
  chipBlank,
  odometer,
  sourceKind,
  onSourceKind,
  file,
  onFile,
  onClearFile,
  fileError,
  sourceImage,
  reseal,
  onReseal,
  targetKm,
  onTargetKm,
  vinAction,
  onVinAction,
  vinInput,
  onVinInput,
  bytes,
  input,
  plan,
  coding,
  save,
}: {
  rec: ReturnType<typeof recommend>;
  hasChip: boolean;
  chipBlank: boolean;
  odometer: OdometerDecode | null;
  sourceKind: SourceKind;
  onSourceKind: (k: SourceKind) => void;
  /** The file opened as the SOURCE, if one is. */
  file: { name: string; image: Uint8Array } | null;
  onFile: (file: File) => void;
  onClearFile: () => void;
  fileError: { code: RefusalCode; fileSize?: number } | null;
  /** The source as it is - the chip, or the file - or null: its checksums line. */
  sourceImage: Uint8Array | null;
  /** FIX CHECKSUMS, on a file whose checksums do not hold. */
  reseal: boolean;
  onReseal: (on: boolean) => void;
  targetKm: string;
  onTargetKm: (v: string) => void;
  vinAction: VinAction;
  onVinAction: (a: VinAction) => void;
  vinInput: string;
  onVinInput: (v: string) => void;
  /** BYTES: how many the hand edits change, and taking them back. */
  bytes: { count: number; canUndo: boolean; onUndo: () => void; onRevert: () => void };
  /** The job as asked, and as planned - null while there is nothing to plan (no chip, no file). */
  input: JobInput | null;
  plan: JobPlan | JobRefusal | null;
  /** The coding section, where this build draws it. */
  coding: React.ReactNode;
  /** SAVE EDITED - enabled when there is a result that differs from the source. */
  save: { enabled: boolean; onSave: () => void };
}) {
  const c = jc();
  const copy = t();
  const refused = plan && !plan.ok ? plan : null;
  const ok = plan?.ok ? plan : null;
  /* What the job changes: with a chip, what differs on it - nothing, once it holds the plan;
     without one, whatever makes the result differ from the source. */
  const changes = ok ? (hasChip ? ok.byteWrites.length + ok.secureOps.length : diff(ok.base, ok.target).length) : 0;

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
              {k === 'chip' ? CHROME.job.chip : CHROME.job.file}
            </button>
          ))}
          {sourceKind === 'dump' && file && (
            <>
              <span className="min-w-0 truncate font-mono text-[10px] text-slate-300">{file.name}</span>
              <TextButton tone="danger" Icon={X} onClick={onClearFile} className="ml-auto">
                {CHROME.job.clear}
              </TextButton>
            </>
          )}
        </div>
        <p className="text-[10px] leading-snug text-slate-500">{c.source.uses}</p>
        {sourceKind === 'dump' && !file && <DropZone onFile={onFile} hint={CHROME.drop.file} />}
        {fileError && (
          <p className="font-mono text-[10px] text-red-400">
            {copy.refusal(fileError).reason}
            {copy.refusal(fileError).detail && <span className="block text-slate-500">{copy.refusal(fileError).detail}</span>}
          </p>
        )}
        {sourceKind === 'dump' && file && <FileLine image={file.image} />}
        <ChecksumLine image={sourceImage} isFile={sourceKind === 'dump'} reseal={reseal} onReseal={onReseal} />
        {(sourceKind === 'dump' || !hasChip) && (
          <p className="text-[10px] leading-snug text-slate-500">
            {!hasChip ? c.source.noChip : chipBlank ? c.source.blank : c.source.used}
          </p>
        )}
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

      {/* ------------------------------- BYTES ------------------------------ */}
      <FormField label={CHROME.job.bytes}>
        <div className="flex min-h-[20px] flex-wrap items-center gap-3">
          <span className="font-mono text-[10px] text-slate-400">{bytes.count > 0 ? c.bytes.count(bytes.count) : c.bytes.none}</span>
          <TextButton tone="neutral" Icon={Undo2} onClick={bytes.onUndo} disabled={!bytes.canUndo} className="ml-auto">
            {CHROME.job.undo}
          </TextButton>
          <TextButton tone="danger" Icon={RotateCcw} onClick={bytes.onRevert} disabled={!bytes.canUndo}>
            {CHROME.job.revert}
          </TextButton>
        </div>
        <p className="text-[10px] leading-snug text-slate-600">{c.bytes.hint}</p>
      </FormField>

      {/* ------------------------------ CHANGES ----------------------------- */}
      <div className="-mx-5 flex flex-col gap-2 border-t border-slate-800 px-5 pt-4">
        <MicroLabel as="h3">{CHROME.job.changes}</MicroLabel>
        {refused ? (
          <div className="rounded bg-red-900/20 px-2 py-1.5">
            <p className={`${LABEL} text-red-400`}>{CHROME.job[refused.part]}</p>
            <p className="text-[10px] leading-snug text-red-300">{jobRefusalText(refused)}</p>
          </div>
        ) : ok && input ? (
          changes === 0 ? (
            <p className="text-[10px] leading-snug text-slate-500">{c.nothing}</p>
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

        {/* The other way out of the job: its result as a file, to write later - case c. */}
        <div className="flex flex-col gap-1 pt-2">
          <TextButton Icon={Download} onClick={save.onSave} disabled={!save.enabled} className="self-start">
            {CHROME.job.saveEdited}
          </TextButton>
          <p className="text-[10px] leading-snug text-slate-600">{c.save}</p>
        </div>
      </div>
    </JobPanel>
  );
}

/**
 * What a file opened as the SOURCE is, in one line - checked before anything is decoded from it,
 * because a reading taken off a dead bus looks exactly like a reading.
 */
function FileLine({ image }: { image: Uint8Array }) {
  const c = jc();
  const v = useMemo(() => verdictFor(image), [image]);
  const km = useMemo(() => decodeOdometer(secureOf(image)), [image]);
  const vin = useMemo(() => recordVin(image), [image]);
  if (v.uniform) return <Callout tone="danger">{c.file.notAChip(v.uniformValue ?? 0)}</Callout>;
  return (
    <p className="flex min-w-0 flex-wrap gap-x-3 font-mono text-[10px] text-slate-500">
      <span>{c.file.distinct(v.distinct)}</span>
      {km.ok && <span className="text-slate-300">{km.km.toLocaleString()} km</span>}
      {vin && <span className="text-slate-300">VIN {vin}</span>}
      {v.secureBlank && <span className="text-emerald-400">{c.file.blank}</span>}
      {v.standardErased && <span className="text-amber-400">{c.file.erased}</span>}
    </p>
  );
}

/**
 * The source's checksums, always one line tall: OK, BROKEN (with FIX CHECKSUMS for a file),
 * FIXED (with UNDO), or a layout that has none to check. FIX is a file's only: a chip whose
 * checksums fail is read again, or replaced by a good file - not recomputed over.
 */
function ChecksumLine({
  image,
  isFile,
  reseal,
  onReseal,
}: {
  image: Uint8Array | null;
  isFile: boolean;
  reseal: boolean;
  onReseal: (on: boolean) => void;
}) {
  const c = jc();
  const layout = useMemo(() => (image ? detectLayout(image) : null), [image]);
  const broken =
    layout?.kind === 'late' && !layout.consistent
      ? layout.checksums
          .flatMap((cs) => [{ at: cs.at, stored: cs.stored }, ...cs.mirrors].filter((m) => m.stored !== cs.computed))
          .map((m) => `0x${formatAddress(m.at)}`)
          .join(', ')
      : null;
  const fixed = broken !== null && isFile && reseal;
  return (
    <>
      <div className="flex min-h-[20px] items-center gap-3 font-mono text-[10px]">
        <span className="text-slate-600">{CHROME.checksum.title}</span>
        {!layout ? (
          <span className="text-slate-600">—</span>
        ) : layout.kind !== 'late' ? (
          <span className="text-slate-500">{CHROME.checksum.unknown}</span>
        ) : broken === null ? (
          <span className="text-emerald-400">{CHROME.checksum.ok}</span>
        ) : fixed ? (
          <>
            <span className="text-amber-400">
              {CHROME.checksum.fixed} {broken}
            </span>
            <TextButton tone="neutral" Icon={Undo2} onClick={() => onReseal(false)} className="ml-auto">
              {CHROME.job.undo}
            </TextButton>
          </>
        ) : (
          <>
            <span className="min-w-0 truncate text-red-400">
              {CHROME.checksum.broken} {broken}
            </span>
            {isFile && (
              <TextButton Icon={Wrench} onClick={() => onReseal(true)} className="ml-auto">
                {CHROME.checksum.fix}
              </TextButton>
            )}
          </>
        )}
      </div>
      {broken !== null && !fixed && (
        <p className="text-[10px] leading-snug text-slate-500">{isFile ? c.checksum.fileBroken : c.checksum.chipBroken}</p>
      )}
    </>
  );
}
