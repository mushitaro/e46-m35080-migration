'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plug, Zap, Loader2, Save, Upload, Unplug, FileCode } from 'lucide-react';

import { useM35080Link, type WriteJob } from '@/lib/hooks/useM35080Link';
import { Tabs, type TabDef } from '@/components/Tabs';
import { Hub, SubActionRow, NoticeLine, type HubConfig, type SubAction } from '@/components/Hub';
import { StatusRow, type LedState } from '@/components/StatusLED';
import { HexView, HexLegend } from '@/components/HexView';
import { VehicleInfo } from '@/components/VehicleInfo';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DropZone } from '@/components/DropZone';
import { WiringDiagram } from '@/components/WiringDiagram';
import { SetupPanel } from '@/components/panels/SetupPanel';
import { RecordsTable } from '@/components/panels/RecordsPanel';
import { StructurePanel } from '@/components/panels/StructurePanel';
import { AddressPanel } from '@/components/panels/AddressPanel';
import { GUIDE_STEPS, type GuideStepId } from '@/components/AssemblyGuide';
import {
  planRewrite,
  planReset,
  planRepairStandard,
  applyPlanPreview,
  type VinAction,
  type Refusal,
  type RefusalCode,
} from '@/lib/domain/operations';
import { deriveSteps, recommend, type StepId } from '@/lib/domain/workflow';
import { enabledSurfaces } from '@/lib/domain/features';
import { usePreviewScope } from '@/lib/domain/variant';
import { VariantBadge } from '@/components/VariantBadge';
import { parseImageFile } from '@/lib/domain/image';
import { vinRange } from '@/lib/domain/addressMap';
import { listRecords, deleteRecord, type DeviceRecord } from '@/lib/domain/records';
import {
  applyLangToDocument,
  getLang,
  setLang,
  subscribeLang,
  t,
  STATIC_LANG,
  type Lang,
} from '@/lib/i18n';
import { g } from '@/lib/copy/guide';
import { isWebSerialSupported } from '@/lib/transport/webSerialTransport';

/**
 * Re-render chrome when the resolved language changes.
 *
 * The initial state is the language the SERVER rendered, not the resolved one.
 * i18n.ts resolves the browser's language at IMPORT time - before React
 * hydrates - so seeding from getLang() would hydrate against markup the server
 * never produced.
 */
function useLang(): Lang {
  const [lang, setL] = useState<Lang>(STATIC_LANG);
  useEffect(() => {
    applyLangToDocument();
    setL(getLang());
    return subscribeLang(setL);
  }, []);
  return lang;
}

export default function Page() {
  const lang = useLang();
  const copy = t();
  const c = g();
  const link = useM35080Link();

  /* Whether this render may draw non-stable surfaces. A release always says
     false; in preview the badge can force it false too. */
  const previewScope = usePreviewScope();
  const [step, setStep] = useState<StepId>('setup');
  const [targetKm, setTargetKm] = useState('');
  const [vinAction, setVinAction] = useState<VinAction>({ kind: 'keep' });
  const [vinInput, setVinInput] = useState('');
  const [backupFile, setBackupFile] = useState<Uint8Array | null>(null);
  const [fileError, setFileError] = useState<RefusalCode | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [records, setRecords] = useState<DeviceRecord[]>([]);
  const [pending, setPending] = useState<{ job: WriteJob; body: string; details: string[] } | null>(
    null,
  );

  /* SETUP-local: which procedure step is open, and which wire is singled out. */
  const [guideStep, setGuideStep] = useState<GuideStepId>('parts');
  const [guideDone, setGuideDone] = useState<Set<GuideStepId>>(new Set());
  const [wire, setWire] = useState<string | null>(null);

  /* Web Serial support is a CLIENT-ONLY fact; seeded true so SSR and the first
     client render agree, then corrected on mount. */
  const [serialSupported, setSerialSupported] = useState(true);
  useEffect(() => {
    setSerialSupported(isWebSerialSupported());
  }, []);

  const { image, status, chip, odometer, vin, phase, busy, progress } = link;
  const backedUp = link.backedUpHash !== null;

  /* ------------------------- derived, never stored ---------------------- */

  const effectiveVinAction: VinAction = useMemo(
    () => (vinAction.kind === 'write' ? { kind: 'write', vin: vinInput } : vinAction),
    [vinAction, vinInput],
  );

  const targetKmNum = useMemo(() => {
    const n = Number.parseInt(targetKm, 10);
    return Number.isFinite(n) ? n : null;
  }, [targetKm]);

  /* A blank target means "leave the odometer where it is", not "no plan".
     Changing only the VIN is a real job, and making it require a mileage the
     user does not want to change invites them to type one - which is the last
     field on this screen anyone should be guessing at. Planning to the CURRENT
     reading produces zero secure writes, so the odometer is genuinely untouched. */
  const effectiveTargetKm = targetKmNum ?? (odometer?.ok ? odometer.km : null);
  const rewritePlan = useMemo(
    () =>
      image && effectiveTargetKm !== null
        ? planRewrite(image, effectiveTargetKm, effectiveVinAction)
        : null,
    [image, effectiveTargetKm, effectiveVinAction],
  );
  /* RESTORE = the backup's cluster data onto a new chip, VIN blanked, odometer
     untouched. It needs a backup: there is no restore without one. */
  const restorePlan = useMemo(
    () => (image && backupFile ? planReset(image, backupFile) : null),
    [image, backupFile],
  );
  /* The same backup against a chip that is NOT blank: put back only the
     standard-array bytes it has lost, touching neither the odometer nor the
     VIN. Repeatable, so it doubles as a data-retention test. */
  const repairPlan = useMemo(
    () => (image && backupFile ? planRepairStandard(image, backupFile) : null),
    [image, backupFile],
  );

  /** The whole strip, derived from live state. Nothing about progress is stored. */
  const workflow = useMemo(
    () => ({
      connected: phase !== 'disconnected',
      hasImage: !!image,
      backedUp,
      chipBlank: chip?.blank ?? false,
      odometerKm: odometer?.ok ? odometer.km : null,
      recordCount: records.length,
    }),
    [phase, image, backedUp, chip, odometer, records.length],
  );

  const steps = useMemo(() => deriveSteps(workflow), [workflow]);
  const rec = useMemo(() => recommend(workflow, targetKmNum), [workflow, targetKmNum]);

  const LABEL: Record<StepId, string> = {
    setup: c.stepSetup,
    read: c.stepRead,
    restore: c.stepRestore,
    rewrite: c.stepRewrite,
    records: c.stepRecords,
  };

  /* The registry says WHICH surfaces may be drawn; workflow.ts keeps the order
     and the numbering. Ordinals are re-derived after the filter so a closed
     surface does not leave a hole in the count. */
  const visible = useMemo(() => enabledSurfaces(previewScope), [previewScope]);
  const tabs: TabDef<StepId>[] = steps
    .filter((s) => visible.has(s.id))
    .map((s, i) => ({
      id: s.id,
      label: LABEL[s.id],
      enabled: s.enabled,
      ordinal: i + 1,
      complete: s.complete,
    }));

  /* Turning a surface off while the reader is standing on it would leave the
     work area rendering something the strip no longer offers. */
  useEffect(() => {
    if (!visible.has(step)) setStep('setup');
  }, [visible, step]);

  /** The image as it WILL be, so the hex view shows the change before it is sent. */
  const preview = useMemo(() => {
    if (!image) return null;
    if (step === 'rewrite' && rewritePlan?.ok)
      return applyPlanPreview(image, rewritePlan.byteWrites, rewritePlan.secureOps);
    if (step === 'restore') {
      const p = chip?.blank ? restorePlan : repairPlan;
      if (p?.ok) return applyPlanPreview(image, p.byteWrites);
    }
    return null;
  }, [image, step, rewritePlan, restorePlan, repairPlan, chip]);

  const changedCount = useMemo(() => {
    if (!image || !preview) return null;
    let n = 0;
    for (let i = 0; i < image.length; i++) if (image[i] !== preview[i]) n++;
    return n;
  }, [image, preview]);

  /* ------------------------------ the hub ------------------------------- */

  const ask = useCallback((job: WriteJob, body: string, details: string[]) => {
    setPending({ job, body, details });
  }, []);

  const hub: HubConfig = useMemo(() => {
    if (busy) {
      const label =
        phase === 'connecting'
          ? copy.connecting
          : phase === 'reading'
            ? copy.reading
            : phase === 'verifying'
              ? copy.verifying
              : copy.writing;
      return { label, Icon: Loader2, onClick: () => {}, spin: true, disabled: true };
    }
    if (phase === 'disconnected') {
      return { label: copy.connect, Icon: Plug, onClick: () => void link.connect('serial') };
    }
    /* Reading lands the user on the tab that shows the result. Pressing READ
       from SETUP used to leave them on the wiring diagram with the image
       silently loaded behind it. Only on success - a refused read keeps the
       PREVIOUS image, so navigating would show the wrong chip's data. */
    if (!image) {
      return {
        label: copy.read,
        Icon: Zap,
        onClick: () => void link.read().then((ok) => ok && setStep('read')),
      };
    }

    // Backup is not a side quest: it is the next step in the sequence, and
    // gating it here is what makes "backup before write" structural.
    if (!backedUp) return { label: 'BACKUP', Icon: Save, onClick: () => void link.backup() };

    if (step === 'rewrite' && rewritePlan?.ok) {
      return {
        label: 'WRITE ODO',
        Icon: Zap,
        danger: true,
        disabled: rewritePlan.secureOps.length === 0 && rewritePlan.byteWrites.length === 0,
        onClick: () =>
          ask(
            { kind: 'rewrite', byteWrites: rewritePlan.byteWrites, secureOps: rewritePlan.secureOps },
            copy.confirmOdometer(
              /* NOT `?? 0`. When the secure area does not decode, the same
                 screen says so in red - printing "from 0 km" on the one dialog
                 whose job is to state the true consequence made the tool assert
                 a reading it had just refused to give. */
              rewritePlan.currentKm,
              rewritePlan.targetKm,
              rewritePlan.secureOps.length,
            ),
            [
              ...rewritePlan.secureOps.map(
                (o) =>
                  `WRINC 0x${o.address.toString(16).padStart(2, '0').toUpperCase()}  0x${o.from
                    .toString(16)
                    .toUpperCase()} -> 0x${o.to.toString(16).toUpperCase()}`,
              ),
              ...rewritePlan.byteWrites.map((w) => w.label),
            ],
          ),
      };
    }
    /* RESTORE: one path. The backup's cluster data onto a new chip, the VIN
       blanked, the odometer untouched (planReset). */
    if (step === 'restore' && chip?.blank && restorePlan?.ok) {
      return {
        label: 'WRITE CHIP',
        Icon: Upload,
        danger: true,
        onClick: () =>
          ask(
            { kind: 'restore', byteWrites: restorePlan.byteWrites, secureOps: [] },
            copy.confirmReset,
            [
              ...restorePlan.byteWrites.map((w) => w.label),
              'odometer 0x00-0x1F: not written (stays 0 km)',
            ],
          ),
      };
    }
    /* Not blank: repair what the array has lost instead. Same backup, same
       "never touch the odometer" rule - and repeatable, because it raises no
       counter, which is what lets it be used as a retention test. */
    if (step === 'restore' && !chip?.blank && repairPlan?.ok && repairPlan.byteWrites.length > 0) {
      return {
        label: 'REPAIR',
        Icon: Upload,
        danger: true,
        onClick: () =>
          ask(
            { kind: 'restore', byteWrites: repairPlan.byteWrites, secureOps: [] },
            copy.confirmRepair(repairPlan.addresses.length),
            [
              ...repairPlan.byteWrites.map((w) => w.label),
              'odometer 0x00-0x1F: not written',
            ],
          ),
      };
    }
    if (step === 'restore') {
      const label = !backupFile
        ? 'SELECT BACKUP'
        : !chip?.blank && repairPlan?.ok
          ? 'NOTHING TO REPAIR'
          : 'CHECK BACKUP';
      return { label, Icon: Upload, onClick: () => {}, disabled: true };
    }
    return {
      label: copy.read,
      Icon: Zap,
      onClick: () => void link.read().then((ok) => ok && setStep('read')),
    };
  }, [
    busy,
    phase,
    image,
    backedUp,
    step,
    rewritePlan,
    restorePlan,
    repairPlan,
    chip,
    backupFile,
    copy,
    link,
    ask,
  ]);

  /**
   * There is exactly one way to save an image, and it is BACKUP.
   *
   * This row used to carry an EXPORT .BIN beside it. Both produced the same
   * file, so the pair read as two names for one job while only BACKUP opened
   * the write gate - the ambiguity the hub exists to remove. BACKUP writes the
   * .bin AND records it; an older image is re-downloaded from RECORDS.
   */
  const subActions: SubAction[] = useMemo(() => {
    const out: SubAction[] = [];
    if (phase !== 'disconnected') {
      out.push({
        label: copy.disconnect,
        Icon: Unplug,
        danger: true,
        onClick: () => void link.disconnect(),
      });
    }
    return out;
  }, [phase, copy, link]);

  /* ----------------------------- records ------------------------------- */

  useEffect(() => {
    listRecords()
      .then(setRecords)
      .catch(() => setRecords([]));
  }, [step, phase, link.backedUpHash]);

  const onBackupFile = useCallback((file: File) => {
    setFileError(null);
    file.arrayBuffer().then((buf) => {
      const r = parseImageFile(buf);
      if (r.ok) setBackupFile(r.image);
      else {
        setBackupFile(null);
        setFileError('backup-size');
      }
    });
  }, []);

  /* ------------------------------ render -------------------------------- */

  const linkLed: LedState =
    phase === 'disconnected' ? 'idle' : busy ? 'busy' : link.error ? 'error' : 'ok';
  const chipLed: LedState = !image ? 'idle' : chip?.blank ? 'ok' : 'idle';

  const noticeText = link.error ?? link.notice;
  const noticeTone = link.error ? 'error' : link.notice === copy.writeOk ? 'ok' : 'info';

  /** The wire the diagram should light: an explicit pick beats the step's set. */
  const diagramHighlight =
    wire !== null
      ? [wire]
      : (GUIDE_STEPS.find((s) => s.id === guideStep)?.highlight ?? null);

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <header className="relative flex h-[48px] shrink-0 items-center gap-4 bg-slate-950/80 px-6 backdrop-blur-md">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5"
          style={{
            background:
              'linear-gradient(to right, #0A9BDB 0 33.333%, #9B84E8 33.333% 66.667%, #F11A22 66.667% 100%)',
          }}
        />
        <h1 className="text-sm font-bold uppercase tracking-widest text-slate-200">
          E46 M35080{' '}
          <span className="tracking-tight" aria-hidden="true">
            <span className="text-blue-500">/</span>
            <span className="text-indigo-400">/</span>
            <span className="text-red-500">/</span>
          </span>{' '}
          Migration
        </h1>
        <div className="ml-8 flex items-center gap-4 border-l border-slate-800 pl-8 font-mono text-[9px] text-slate-500">
          <span>
            BRIDGE <span className="text-slate-300">{link.info?.firmware ?? '—'}</span>
          </span>
          <span>
            E46 IKE <span className="text-slate-300">1 KB</span>
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <VariantBadge />
          <div className="flex items-center gap-1">
          {(['ja', 'en'] as const).map((l) => (
            <button
              key={l}
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
              disabled={busy}
              className={`px-1.5 font-mono text-[10px] transition-colors disabled:opacity-30 ${
                lang === l ? 'text-blue-400' : 'text-slate-600 hover:text-slate-400'
              }`}
            >
              {l}
            </button>
          ))}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden min-[900px]:flex-row">
        {/* Work surface - 61.8% */}
        <section className="flex h-[38.2%] min-h-0 flex-col border-b border-slate-900 min-[900px]:h-full min-[900px]:w-[61.8%] min-[900px]:border-b-0 min-[900px]:border-r">
          <div className="flex h-[44px] shrink-0 items-center border-b border-slate-900 bg-slate-900/50 px-4 backdrop-blur-sm">
            <Tabs tabs={tabs} active={step} onSelect={setStep} />
          </div>

          <div className="min-h-0 flex-1 overflow-hidden px-4 py-2">
            {step === 'setup' ? (
              <WiringDiagram highlight={diagramHighlight} onSelectPin={setWire} />
            ) : step === 'records' ? (
              <RecordsTable
                records={records}
                onDelete={async (id) => {
                  await deleteRecord(id);
                  setRecords(await listRecords());
                }}
              />
            ) : !image ? (
              <EmptyState
                label={phase === 'disconnected' ? c.awaitingConnection : c.awaitingRead}
              />
            ) : (
              <div className="flex h-full flex-col gap-2">
                <HexLegend changedCount={changedCount} vin={vinRange(preview ?? image)} />
                <div className="min-h-0 flex-1">
                  <HexView
                    vin={vinRange(preview ?? image)}
                    image={preview ?? image}
                    reference={preview ? image : null}
                    changeMode="pending"
                    selected={selected}
                    onSelect={setSelected}
                  />
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Instrument + controls - 38.2% */}
        <aside className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto min-[900px]:w-[38.2%] min-[900px]:flex-none">
          <div className="flex h-[44px] shrink-0 items-center border-b border-slate-900 bg-slate-900/50 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 backdrop-blur-sm">
            {step === 'read' ? 'VEHICLE' : LABEL[step]}
          </div>

          {/* Wrapper so the 38.2% resolves BELOW the 44px bar */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="relative min-h-[140px] flex-1 overflow-y-auto">
              {step === 'setup' ? (
                <SetupPanel
                  guideStep={guideStep}
                  onGuideStep={(id) => {
                    setGuideStep(id);
                    setWire(null); // an explicit pick is per-step, not sticky
                  }}
                  doneIds={guideDone}
                  onToggleDone={(id) =>
                    setGuideDone((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                  wire={wire}
                  onWire={setWire}
                />
              ) : step === 'rewrite' ? (
                <JobPanel>
                  <Recommendation rec={rec} step={step} />
                  <Field label={copy.currentKm}>
                    <span className="font-mono text-sm text-slate-300">
                      {odometer?.ok ? `${odometer.km.toLocaleString()} km` : '—'}
                    </span>
                  </Field>
                  <Field label={copy.targetKm}>
                    <input
                      inputMode="numeric"
                      value={targetKm}
                      onChange={(e) => setTargetKm(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="155940"
                      className="w-full rounded bg-slate-800 px-2 py-1 font-mono text-sm text-blue-400 outline-none
                                 placeholder:text-slate-700 focus:ring-1 focus:ring-blue-500"
                    />
                  </Field>
                  <Field label={copy.vin}>
                    <div className="flex flex-wrap gap-2">
                      {(['keep', 'write', 'blank'] as const).map((k) => (
                        <button
                          key={k}
                          onClick={() =>
                            setVinAction(k === 'write' ? { kind: 'write', vin: vinInput } : { kind: k })
                          }
                          className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest transition-colors ${
                            vinAction.kind === k
                              ? 'bg-blue-900 text-blue-200'
                              : 'bg-slate-800 text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                    {vinAction.kind === 'write' && (
                      <input
                        value={vinInput}
                        onChange={(e) => setVinInput(e.target.value.toUpperCase())}
                        placeholder="ABC12345"
                        // 17, not 7: a 7-character field rejected ABC12345, the
                        // VIN actually on the chip in front of us.
                        maxLength={17}
                        className="mt-2 w-full rounded bg-slate-800 px-2 py-1 font-mono text-sm tracking-widest
                                   text-slate-200 outline-none placeholder:text-slate-700 focus:ring-1 focus:ring-blue-500"
                      />
                    )}
                  </Field>
                  <PlanNote plan={rewritePlan} />
                </JobPanel>
              ) : step === 'restore' ? (
                <JobPanel>
                  <Recommendation rec={rec} step={step} />
                  {/* Same backup, same "never touch the odometer" rule; what
                      differs is the chip. A blank one gets the whole array and
                      a blanked VIN; a used one gets only the bytes it has lost. */}
                  {chip?.blank ? (
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
                          {repairPlan.byteWrites.length > 0
                            ? c.repairCount(repairPlan.addresses.length)
                            : c.repairNothing}
                        </p>
                      )}
                    </>
                  )}
                  <DropZone onFile={onBackupFile} hint={c.dropBackup} />
                  {fileError && (
                    <p className="font-mono text-[10px] text-red-400">
                      {copy.refusal({ code: fileError }).reason}
                    </p>
                  )}
                  <PlanNote plan={chip?.blank ? restorePlan : repairPlan} />
                  {chip?.blank ? (
                    <>
                      <p className="text-[11px] leading-relaxed text-slate-400">
                        {c.restoreProcedure}
                      </p>
                      {/* The sync is conditional, so the promise cannot be. */}
                      <p className="text-[11px] leading-relaxed text-amber-400">{c.restoreVerify}</p>
                    </>
                  ) : (
                    <p className="text-[11px] leading-relaxed text-amber-400">
                      {c.repairRetentionTest}
                    </p>
                  )}
                  <p className="text-[9px] leading-snug text-slate-600">{c.restoreBasis}</p>
                </JobPanel>
              ) : (
                <div className="flex flex-col">
                  <VehicleInfo odometer={odometer} vin={vin} chip={chip} status={status} />
                  {image && (
                    <>
                      {/* What each address holds, for the two things that are
                          actually known. Above the structure list because a
                          reader wants the meaning before the shape. */}
                      <div className="border-t border-slate-800 px-5 py-4">
                        <AddressPanel image={image} onSelect={setSelected} />
                      </div>
                      <div className="border-t border-slate-800 px-5 py-4">
                        <StructurePanel image={image} onSelect={setSelected} />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Control panel - declared 38.2%, floor wins on a short viewport */}
            <div className="flex h-[38.2%] min-h-fit flex-none flex-col overflow-y-auto px-5 pb-5 pt-4">
              <StatusRow
                label="LINK"
                state={linkLed}
                value={
                  phase === 'disconnected'
                    ? serialSupported
                      ? copy.linkIdle
                      : 'NO WEB SERIAL'
                    : link.practice
                      ? 'PRACTICE'
                      : copy.linkReady
                }
              />
              <StatusRow
                label="CHIP"
                state={chipLed}
                value={!image ? copy.chipUnknown : chip?.blank ? copy.chipBlank : copy.chipUsed}
                reason={chip?.reasons.join(' · ')}
              />

              <NoticeLine
                text={progress ? `${progress.label} ${progress.done}/${progress.total}` : noticeText}
                tone={progress ? 'info' : noticeTone}
              />

              <div className="flex min-h-0 flex-1 items-center justify-center">
                <Hub config={hub} busy={busy} />
              </div>

              <SubActionRow actions={subActions} />

              {phase === 'disconnected' && (
                <button
                  onClick={() => void link.connect('practice', 'used')}
                  className="mt-1 text-[9px] font-bold uppercase tracking-widest text-slate-600 transition-colors hover:text-amber-400"
                >
                  {c.practiceButton}
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={copy.confirmWriteTitle}
        body={pending?.body ?? ''}
        details={pending?.details ?? []}
        inProgress={phase === 'writing' || phase === 'verifying'}
        progressLabel={progress ? `${progress.label} ${progress.done}/${progress.total}` : undefined}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          const job = pending?.job;
          if (!job) return;
          const ok = await link.runWrite(job);
          setPending(null);
          if (ok) setStep('read');
        }}
      />
    </main>
  );
}

/* ------------------------------- pieces --------------------------------- */

function JobPanel({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4 px-5 py-4">{children}</div>;
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-slate-700">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-slate-800 opacity-50">
        <FileCode className="h-6 w-6 opacity-50" />
      </div>
      <p className="font-mono text-xs opacity-50">{label}</p>
    </div>
  );
}

/**
 * What this chip allows, stated by the tool.
 *
 * The increment-only rule is the one thing a reader must not have to work out
 * for themselves, so the comparison is made here rather than left implicit in a
 * refusal they meet later.
 */
function Recommendation({
  rec,
  step,
}: {
  rec: ReturnType<typeof recommend>;
  step: StepId;
}) {
  const c = g();
  if (rec.kind === 'unknown') return <div className="min-h-[28px]" />;

  /* A blank chip means something different per tab. On REWRITE the useful fact
     is that any value is reachable; saying that on RESTORE contradicts the
     procedure directly beneath it, which is that no mileage is written here. */
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
      <p className="text-[8px] font-bold uppercase tracking-widest text-slate-600">{c.recTitle}</p>
      <p className={`mt-0.5 text-[10px] leading-snug ${tone}`}>{text}</p>
    </div>
  );
}

type PlanLike = { ok: true } | Refusal | null;

/**
 * A refusal is RENDERED, in the reader's language, with the actionable detail.
 * The domain layer never writes prose, so a refusal cannot arrive in the
 * author's language.
 */
function PlanNote({ plan }: { plan: PlanLike }) {
  if (!plan || plan.ok) return <div className="min-h-[28px]" />;
  const { reason, detail } = t().refusal(plan);
  return (
    <div className="min-h-[28px] rounded bg-red-900/20 px-2 py-1.5">
      <p className="text-[10px] leading-snug text-red-400">{reason}</p>
      {detail && <p className="mt-0.5 font-mono text-[10px] text-slate-400">{detail}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
      {children}
    </div>
  );
}
