'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Unplug, FileCode } from 'lucide-react';

import { useM35080Link, type WriteJob } from '@/lib/hooks/useM35080Link';
import { Tabs, type TabDef } from '@/components/Tabs';
import { Hub, SubActionRow, NoticeLine, type HubConfig, type SubAction } from '@/components/Hub';
import { StatusRow, type LedState } from '@/components/StatusLED';
import { HexView, HexLegend } from '@/components/HexView';
import { VehicleInfo } from '@/components/VehicleInfo';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { WiringDiagram } from '@/components/WiringDiagram';
import { SetupPanel } from '@/components/panels/SetupPanel';
import { RecordsTable } from '@/components/panels/RecordsPanel';
import { StructurePanel } from '@/components/panels/StructurePanel';
import { AddressPanel } from '@/components/panels/AddressPanel';
import { InspectPanel } from '@/components/panels/InspectPanel';
import { RewritePanel } from '@/components/panels/RewritePanel';
import { RestorePanel } from '@/components/panels/RestorePanel';
import { GUIDE_STEPS, type GuideStepId } from '@/components/AssemblyGuide';
import {
  planRewrite,
  planReset,
  planRepairStandard,
  applyPlanPreview,
  type VinAction,
  type RefusalCode,
} from '@/lib/domain/operations';
import { deriveSteps, recommend, type StepId } from '@/lib/domain/workflow';
import { enabledSurfaces } from '@/lib/domain/features';
import { usePreviewSurfaces } from '@/lib/domain/variant';
import { VariantBadge } from '@/components/VariantBadge';
import { PrivacyLink } from '@/components/PrivacyLink';
import { SyncPanel } from '@/components/SyncPanel';
import { parseImageFile } from '@/lib/domain/image';
import { isDirty, openWorkspace, type Workspace } from '@/lib/domain/inspect';
import { vinRanges } from '@/lib/domain/addressMap';
import { listRecords, deleteRecord, type DeviceRecord } from '@/lib/domain/records';
import {
  applyLangToDocument,
  getLang,
  subscribeLang,
  t,
  STATIC_LANG,
  type Lang,
} from '@/lib/i18n';
import { isWebSerialSupported } from '@/lib/transport/webSerialTransport';
import { CHROME } from '@/lib/copy/chrome';
import { EmptyState, LABEL, WORDMARK } from '@/components/ui';
import { bridgeHubFor } from '@/lib/hub/bridgeHub';
import { practiceBoxFor } from '@/lib/hub/practiceBox';

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
  const link = useM35080Link();

  /* Whether this render may draw non-stable surfaces. A release always says
     false; in preview the badge can force it false too. */
  const previewSurfaces = usePreviewSurfaces();
  const [step, setStep] = useState<StepId>('setup');
  /* What the NEXT connect will talk to. The reader's value: connecting does
     not clear it, and only the reader unticks it. */
  const [practiceIntent, setPracticeIntent] = useState(false);
  const [targetKm, setTargetKm] = useState('');
  const [vinAction, setVinAction] = useState<VinAction>({ kind: 'keep' });
  const [vinInput, setVinInput] = useState('');
  const [backupFile, setBackupFile] = useState<Uint8Array | null>(null);
  /* The file workbench. Deliberately NOT `image`: that one means the bytes
     read off the chip, and every write plans and verifies against it. */
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<{ code: RefusalCode; fileSize?: number } | null>(null);
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

  const { image, status, chip, odometer, vins, phase, busy, progress } = link;
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
  /* RESTORE = the backup's cluster data onto a new chip, byte for byte (the VIN fields with
     it), odometer untouched. It needs a backup: there is no restore without one. */
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
      chipBlank: chip?.blank ?? false,
      odometerKm: odometer?.ok ? odometer.km : null,
    }),
    [phase, image, chip, odometer],
  );

  const steps = useMemo(() => deriveSteps(workflow), [workflow]);
  const rec = useMemo(() => recommend(workflow, targetKmNum), [workflow, targetKmNum]);

  const STEP_LABEL: Record<StepId, string> = {
    setup: CHROME.tab.setup,
    read: CHROME.tab.read,
    restore: CHROME.tab.restore,
    rewrite: CHROME.tab.rewrite,
    inspect: CHROME.tab.inspect,
    records: CHROME.tab.records,
  };

  /* The registry says WHICH surfaces may be drawn; workflow.ts keeps the order. */
  const visible = useMemo(() => enabledSurfaces(previewSurfaces), [previewSurfaces]);
  const tabs: TabDef<StepId>[] = steps
    .filter((s) => visible.has(s.id))
    .map((s) => ({
      id: s.id,
      label: STEP_LABEL[s.id],
      enabled: s.enabled,
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

  const hub: HubConfig = useMemo(
    () =>
      bridgeHubFor({
        busy,
        phase,
        step,
        hasImage: !!image,
        backedUp,
        chipBlank: chip?.blank ?? false,
        hasBackupFile: backupFile !== null,
        rewritePlan,
        restorePlan,
        repairPlan,
        copy,
        act: {
          /* PRACTICE rehearses on a late-layout chip: both VIN fields, both checksums - the
             shape of the bench's own chip, with made-up values. */
          connect: () => void link.connect(practiceIntent ? 'practice' : 'serial', 'late'),
          read: () => void link.read().then((ok) => ok && setStep('read')),
          backup: () => void link.backup(),
          ask,
        },
      }),
    [busy, phase, practiceIntent, image, backedUp, step, rewritePlan, restorePlan, repairPlan, chip, backupFile, copy, link, ask],
  );

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
        label: CHROME.disconnect,
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
    file
      .arrayBuffer()
      .then((buf) => {
        const r = parseImageFile(buf);
        if (r.ok) setBackupFile(r.image);
        else {
          setBackupFile(null);
          setFileError({ code: 'backup-size', fileSize: r.size });
        }
      })
      /* A file that cannot be read at all (moved, permission, a folder) used to
         leave the previous backup loaded and show nothing. */
      .catch(() => {
        setBackupFile(null);
        setFileError({ code: 'backup-size' });
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

  const practiceBox = practiceBoxFor({ phase, practice: link.practice, busy, intent: practiceIntent });

  /** The image view READ, RESTORE and REWRITE share: the chip, or the chip as it WILL be. */
  const chipView = !image ? (
    <EmptyState
      Icon={FileCode}
      label={phase === 'disconnected' ? CHROME.awaiting.connection : CHROME.awaiting.read}
    />
  ) : (
    <div className="flex h-full flex-col gap-2">
      <HexLegend changedCount={changedCount} vins={vinRanges(preview ?? image)} />
      <div className="min-h-0 flex-1">
        <HexView
          vins={vinRanges(preview ?? image)}
          image={preview ?? image}
          reference={preview ? image : null}
          changeMode="pending"
          selected={selected}
          onSelect={setSelected}
        />
      </div>
    </div>
  );

  /** What was read, and what each address holds for the things that are actually known. */
  const vehiclePanel = (
    <div className="flex flex-col">
      <VehicleInfo odometer={odometer} vins={vins} chip={chip} status={status} />
      {image && (
        <>
          {/* Above the structure list because a reader wants the meaning before the shape. */}
          <div className="border-t border-slate-800 px-5 py-4">
            <AddressPanel image={image} onSelect={setSelected} />
          </div>
          <div className="border-t border-slate-800 px-5 py-4">
            <StructurePanel image={image} onSelect={setSelected} />
          </div>
        </>
      )}
    </div>
  );

  /** The work surface (left, 61.8%). Every StepId is a case, so a new tab cannot fall through. */
  function workSurface(): React.ReactNode {
    switch (step) {
      case 'setup':
        return <WiringDiagram highlight={diagramHighlight} onSelectPin={setWire} />;
      case 'inspect':
        return workspace ? (
          <div className="flex h-full flex-col gap-2">
            <HexLegend changedCount={null} vins={vinRanges(workspace.current)} />
            <div className="min-h-0 flex-1">
              {/* reference is the file as opened, so every edit is marked against what was
                  actually on disk. */}
              <HexView
                image={workspace.current}
                reference={workspace.original}
                changeMode="pending"
                vins={vinRanges(workspace.current)}
                selected={selected}
                onSelect={setSelected}
              />
            </div>
          </div>
        ) : (
          <EmptyState Icon={FileCode} label={CHROME.awaiting.file} />
        );
      case 'records':
        return (
          <RecordsTable
            records={records}
            onDelete={async (id) => {
              await deleteRecord(id);
              setRecords(await listRecords());
            }}
          />
        );
      case 'read':
      case 'restore':
      case 'rewrite':
        return chipView;
      default: {
        const unreachable: never = step;
        return unreachable;
      }
    }
  }

  /** The side panel (right, above the controls). */
  function sidePanel(): React.ReactNode {
    switch (step) {
      case 'setup':
        return (
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
        );
      case 'inspect':
        return (
          <InspectPanel
            workspace={workspace}
            fileError={inspectError}
            selected={selected}
            onSelect={setSelected}
            onOpen={(file) => {
              setInspectError(null);
              void file
                .arrayBuffer()
                .then((buf) => {
                  const r = parseImageFile(buf);
                  if (!r.ok) {
                    const why = copy.refusal({ code: 'backup-size', fileSize: r.size });
                    setInspectError(`${why.reason} ${why.detail ?? ''}`.trim());
                    return;
                  }
                  setWorkspace(openWorkspace(file.name, r.image));
                  setSelected(null);
                })
                .catch(() => {
                  const why = copy.refusal({ code: 'backup-size' });
                  setInspectError(`${why.reason} ${why.detail ?? ''}`.trim());
                });
            }}
            onChange={setWorkspace}
            onClose={() => {
              setWorkspace(null);
              setInspectError(null);
            }}
          />
        );
      case 'rewrite':
        return (
          <RewritePanel
            rec={rec}
            step={step}
            odometer={odometer}
            targetKm={targetKm}
            onTargetKm={setTargetKm}
            vinAction={vinAction}
            onVinAction={setVinAction}
            vinInput={vinInput}
            onVinInput={setVinInput}
            plan={rewritePlan}
          />
        );
      case 'restore':
        return (
          <RestorePanel
            rec={rec}
            step={step}
            chipBlank={chip?.blank ?? false}
            restorePlan={restorePlan}
            repairPlan={repairPlan}
            onBackupFile={onBackupFile}
            fileError={fileError}
          />
        );
      case 'records':
        /* Preview only: the account copy of these records, and the error records the app sent
           by itself. A release shows what was read instead. */
        return previewSurfaces ? (
          <SyncPanel
            records={records}
            onRecordsChanged={() => {
              void listRecords()
                .then(setRecords)
                .catch(() => setRecords([]));
            }}
            linkPhase={phase}
            linkBusy={busy}
            unsavedWork={workspace ? isDirty(workspace) : false}
          />
        ) : (
          vehiclePanel
        );
      case 'read':
        return vehiclePanel;
      default: {
        const unreachable: never = step;
        return unreachable;
      }
    }
  }

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
        <h1 className={`${WORDMARK} text-slate-200`}>
          E46 M35080{' '}
          <span className="tracking-tight" aria-hidden="true">
            <span className="text-blue-500">/</span>
            <span className="text-indigo-400">/</span>
            <span className="text-red-500">/</span>
          </span>{' '}
          Migration
        </h1>
        <div className="ml-8 flex items-center gap-4 border-l border-slate-800 pl-8 font-mono text-[10px] text-slate-500">
          <span>
            BRIDGE <span className="text-slate-300">{link.info?.firmware ?? '—'}</span>
          </span>
          <span>
            E46 IKE <span className="text-slate-300">1 KB</span>
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <PrivacyLink />
          <VariantBadge />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden min-[900px]:flex-row">
        {/* Work surface - 61.8% */}
        <section className="flex h-[38.2%] min-h-0 flex-col border-b border-slate-900 min-[900px]:h-full min-[900px]:w-[61.8%] min-[900px]:border-b-0 min-[900px]:border-r">
          <div className="flex h-[44px] shrink-0 items-center border-b border-slate-900 bg-slate-900/50 px-4 backdrop-blur-sm">
            <Tabs tabs={tabs} active={step} onSelect={setStep} />
          </div>

          <div className="min-h-0 flex-1 overflow-hidden px-4 py-2">
            {workSurface()}
          </div>
        </section>

        {/* Instrument + controls - 38.2% */}
        <aside className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto min-[900px]:w-[38.2%] min-[900px]:flex-none">
          <div className={`flex h-[44px] shrink-0 items-center border-b border-slate-900 bg-slate-900/50 px-4 ${LABEL} text-slate-500 backdrop-blur-sm`}>
            {step === 'read' ? 'VEHICLE' : STEP_LABEL[step]}
          </div>

          {/* Wrapper so the 38.2% resolves BELOW the 44px bar */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="relative min-h-[140px] flex-1 overflow-y-auto">
              {sidePanel()}
            </div>

            {/* Control panel - declared 38.2%, floor wins on a short viewport */}
            <div className="flex h-[38.2%] min-h-fit flex-none flex-col overflow-y-auto px-5 pb-5 pt-4">
              <StatusRow
                label={CHROME.status.link}
                state={linkLed}
                value={
                  phase === 'disconnected'
                    ? serialSupported
                      ? CHROME.status.idle
                      : CHROME.status.noWebSerial
                    : link.practice
                      ? CHROME.status.practice
                      : CHROME.status.ready
                }
              />
              <StatusRow
                label={CHROME.status.chip}
                state={chipLed}
                value={!image ? CHROME.status.notRead : chip?.blank ? CHROME.status.blank : CHROME.status.used}
                reason={chip?.reasons.join(' · ')}
              />

              <NoticeLine
                text={progress ? `${progress.label} ${progress.done}/${progress.total}` : noticeText}
                tone={progress ? 'info' : noticeTone}
              />

              <div className="relative flex min-h-0 flex-1 items-center justify-center">
                {/* PRACTICE: top right of the hub area, a checkbox, in every link
                    state (tsunagi-m-ux section 16). A checkbox because it
                    declares what every following operation acts on rather than
                    doing anything itself. Always drawn, because a practice mark
                    that disappears on connect is gone at the one moment that
                    separates "this is the car" from "this is a rehearsal".

                    While a link is up the box shows what that link IS - the
                    authority, not the intent - and cannot change it: an open
                    link cannot be retargeted, so a live box would lie. */}
                <label
                  className={`absolute right-0 top-0 inline-flex items-center gap-1.5 ${LABEL} transition-colors
                    ${practiceBox.checked ? 'text-amber-400' : 'text-slate-500'}
                    ${practiceBox.locked ? 'opacity-60' : 'cursor-pointer hover:text-slate-300'}`}
                >
                  <input
                    type="checkbox"
                    checked={practiceBox.checked}
                    disabled={practiceBox.locked}
                    onChange={(e) => setPracticeIntent(e.target.checked)}
                    className="h-3 w-3 accent-amber-500"
                  />
                  {CHROME.practice}
                </label>
                <Hub config={hub} busy={busy} />
              </div>

              <SubActionRow actions={subActions} />

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
