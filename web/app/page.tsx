'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Unplug, FileCode } from 'lucide-react';

import { useM35080Link, type WriteJob } from '@/lib/hooks/useM35080Link';
import { useKombiLink } from '@/lib/hooks/useKombiLink';
import { Tabs, type TabDef } from '@/components/Tabs';
import { Hub, SubActionRow, NoticeLine, type HubConfig, type SubAction } from '@/components/Hub';
import { StatusRow, type LedState } from '@/components/StatusLED';
import { HexView, HexLegend } from '@/components/HexView';
import { VehicleInfo } from '@/components/VehicleInfo';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { WiringDiagram } from '@/components/WiringDiagram';
import { DropZone } from '@/components/DropZone';
import { ModeCorner } from '@/components/ModeCorner';
import { CodingTable } from '@/components/CodingTable';
import { SetupPanel } from '@/components/panels/SetupPanel';
import { RecordsTable } from '@/components/panels/RecordsPanel';
import { StructurePanel } from '@/components/panels/StructurePanel';
import { AddressPanel } from '@/components/panels/AddressPanel';
import { InspectPanel } from '@/components/panels/InspectPanel';
import { RewritePanel, type SourceKind } from '@/components/panels/RewritePanel';
import { CodingPanel, type DonorState } from '@/components/panels/CodingPanel';
import { BenchPanel, ChecksPanel } from '@/components/panels/TestPanel';
import { GUIDE_STEPS, type GuideStepId } from '@/components/AssemblyGuide';
import { ClusterBenchDiagram } from '@/components/ClusterBenchDiagram';
import { BENCH_STEPS, type BenchStepId } from '@/components/ClusterBenchGuide';
import { ClusterDiagram } from '@/components/ClusterDiagram';
import type { BenchWireId } from '@/lib/domain/clusterBench';
import { pickReference } from '@/lib/kombi/checks';
import type { VinAction, RefusalCode } from '@/lib/domain/operations';
import { planJob, jobNote, type JobInput, type JobSource, type OdometerIntent } from '@/lib/domain/job';
import { deriveSteps, recommend, type StepId } from '@/lib/domain/workflow';
import { MODE_STEPS, modeLock, modeOf, selectableModes, type AppMode } from '@/lib/domain/modes';
import { enabledSurfaces } from '@/lib/domain/features';
import { usePreviewSurfaces } from '@/lib/domain/variant';
import { VariantBadge } from '@/components/VariantBadge';
import { PrivacyLink } from '@/components/PrivacyLink';
import { SyncPanel } from '@/components/SyncPanel';
import { parseImageFile } from '@/lib/domain/image';
import { isDirty, openWorkspace, type Workspace } from '@/lib/domain/inspect';
import { vinRanges } from '@/lib/domain/addressMap';
import { detectLayout } from '@/lib/domain/layout';
import { listRecords, deleteRecord, type DeviceRecord } from '@/lib/domain/records';
import { useRefData } from '@/lib/refdata/useRefData';
import { chooseDefinition, optionValue, rowsFor } from '@/lib/ncs/decode';
import { differingFrom, effectiveChanges, type Staged } from '@/lib/ncs/view';
import { presetImage, type PracticeChip } from '@/lib/link/mockLink';
import { codedPracticeChip } from '@/lib/ncs/practice';
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
import { cc } from '@/lib/copy/coding';
import { EmptyState, LABEL, WORDMARK, pillClass } from '@/components/ui';
import { bridgeHubFor } from '@/lib/hub/bridgeHub';
import { kombiHubFor } from '@/lib/hub/kombiHub';
import { linkOwnerOfMode } from '@/lib/hub/owner';
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

/** No picks: one shared empty map, so "nothing staged" is the same value every render. */
const NO_PICKS: Staged = new Map();

/** REWRITE's work surface: the image as it will be, or the coding list. */
type JobView = 'hex' | 'coding';

export default function Page() {
  const lang = useLang();
  const copy = t();
  const link = useM35080Link();
  /* The K+DCAN cable to a cluster on the bench: TEST mode's link. Independent of the bridge - two
     cables to two different things - and never acted on from CHIP mode (lib/hub/owner.ts). */
  const kombi = useKombiLink();

  /* Whether this render may draw non-stable surfaces. A release always says
     false; in preview the badge can force it false too. */
  const previewSurfaces = usePreviewSurfaces();

  /* MODE (lib/domain/modes.ts) and, per mode, the tab the reader was last on - so switching to
     TEST and back lands where the job was left, not at the start of it. */
  const [mode, setMode] = useState<AppMode>('chip');
  const [stepByMode, setStepByMode] = useState<Record<AppMode, StepId>>({ chip: 'setup', test: 'bench' });
  const step = stepByMode[mode];
  const setStep = useCallback((id: StepId) => {
    const m = modeOf(id);
    setStepByMode((prev) => ({ ...prev, [m]: id }));
    setMode(m);
  }, []);

  /* What the NEXT connect will talk to. The reader's value: connecting does
     not clear it, and only the reader unticks it. */
  const [practiceIntent, setPracticeIntent] = useState(false);

  /* REWRITE - the job: where the data comes from, the odometer, the VIN, the coding. */
  const [sourceKind, setSourceKind] = useState<SourceKind>('chip');
  const [dump, setDump] = useState<{ name: string; image: Uint8Array } | null>(null);
  const [dumpError, setDumpError] = useState<{ code: RefusalCode; fileSize?: number } | null>(null);
  const [targetKm, setTargetKm] = useState('');
  const [vinAction, setVinAction] = useState<VinAction>({ kind: 'keep' });
  const [vinInput, setVinInput] = useState('');
  /* The coding picks, tied to the SOURCE image and the definition they were made against - a new
     read, another dump or other data makes them someone else's picks, so they are simply not used
     then (derived below, never cleared by an effect). And the row picked. */
  const [codingPicks, setCodingPicks] = useState<{ source: Uint8Array; file: string; picks: Map<number, number> } | null>(null);
  const [codingSelected, setCodingSelected] = useState<number | null>(null);
  const [jobView, setJobView] = useState<JobView>('hex');

  /* The file workbench. Deliberately NOT `image`: that one means the bytes
     read off the chip, and every write plans and verifies against it. */
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [records, setRecords] = useState<DeviceRecord[]>([]);
  const [pending, setPending] = useState<{ job: WriteJob; body: string; details: string[] } | null>(
    null,
  );
  /* INSPECT's USE AS PRACTICE CHIP: the image the next PRACTICE connect reads, if the reader chose
     one. A copy - editing the file afterwards does not change it. */
  const [practiceChip, setPracticeChip] = useState<{ name: string; image: Uint8Array } | null>(null);

  /* SETUP-local: which procedure step is open, and which wire is singled out. */
  const [guideStep, setGuideStep] = useState<GuideStepId>('parts');
  const [guideDone, setGuideDone] = useState<Set<GuideStepId>>(new Set());
  const [wire, setWire] = useState<string | null>(null);

  /* TEST-local: the bench procedure step, and a wire singled out. */
  const [benchStep, setBenchStep] = useState<BenchStepId>('parts');
  const [benchDone, setBenchDone] = useState<Set<BenchStepId>>(new Set());
  const [benchWire, setBenchWire] = useState<BenchWireId | null>(null);

  /* Web Serial support is a CLIENT-ONLY fact; seeded true so SSR and the first
     client render agree, then corrected on mount. */
  const [serialSupported, setSerialSupported] = useState(true);
  useEffect(() => {
    setSerialSupported(isWebSerialSupported());
  }, []);

  const { image, status, chip, odometer, vins, phase, busy, progress } = link;
  const backedUp = link.backedUpHash !== null;

  /* The registry says WHICH surfaces may be drawn; the mode says which tabs and in what order. */
  const visible = useMemo(() => enabledSurfaces(previewSurfaces), [previewSurfaces]);
  const codingVisible = visible.has('coding');
  const modes = useMemo(() => selectableModes(visible), [visible]);

  /* ------------------------------ the job ------------------------------- */

  const effectiveVinAction: VinAction = useMemo(
    () => (vinAction.kind === 'write' ? { kind: 'write', vin: vinInput } : vinAction),
    [vinAction, vinInput],
  );

  const targetKmNum = useMemo(() => {
    const n = Number.parseInt(targetKm, 10);
    return Number.isFinite(n) ? n : null;
  }, [targetKm]);

  /* A blank target means "leave the odometer where it is". Changing only the VIN, or only the
     coding, is a real job, and making it require a mileage the user does not want to change
     invites them to type one - the last field on this screen anyone should be guessing at. */
  const odometerIntent: OdometerIntent = targetKmNum === null ? { kind: 'keep' } : { kind: 'set', km: targetKmNum };

  /* Without a chip the only source there can be is a dump. */
  const effectiveSource: SourceKind = image ? sourceKind : 'dump';
  const jobSource: JobSource | null =
    effectiveSource === 'dump' ? (dump ? { kind: 'dump', name: dump.name, image: dump.image } : null) : { kind: 'chip' };
  const sourceImage = effectiveSource === 'dump' ? (dump?.image ?? null) : image;

  /* The definitions: asked for the first time REWRITE's coding is looked at, or PRACTICE is ticked
     - PRACTICE builds its chip to fit them (lib/ncs/practice.ts) - then kept in memory. The preview
     serves them to its owner, and so does `npm run serve:out` on the operator's own PC. */
  const codingRef = useRefData('kombi-coding', codingVisible && (step === 'rewrite' || practiceIntent));
  /* TEST's lamp, output and input names: the same way, the first time CHECKS opens. */
  const namesRef = useRefData('kombi-names', step === 'checks');
  const codingDoc = codingRef.state?.ok ? codingRef.state.doc : null;

  /* The content the coding is read from: the source with the VIN applied - what the coding step of
     the job starts from (lib/domain/job.ts). */
  const preCoding = useMemo(() => {
    if (!jobSource) return null;
    const p = planJob({ chip: image, source: jobSource, odometer: { kind: 'keep' }, vin: effectiveVinAction, coding: null });
    return p.ok ? p.target : null;
    // jobSource is rebuilt every render; its identity is the dump's and the chip's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, effectiveSource, dump, effectiveVinAction]);

  const codingChoice = useMemo(
    () => (codingVisible && preCoding && codingDoc ? chooseDefinition(preCoding, codingDoc) : null),
    [codingVisible, preCoding, codingDoc],
  );
  const codingDef = codingChoice?.kind === 'chosen' ? codingChoice : null;
  const codingRows = useMemo(() => (preCoding && codingDef ? rowsFor(preCoding, codingDef.def) : null), [preCoding, codingDef]);
  const staged: Staged =
    codingPicks && codingDef && codingPicks.source === sourceImage && codingPicks.file === codingDef.file ? codingPicks.picks : NO_PICKS;
  const codingChanges = useMemo(() => (codingRows ? effectiveChanges(codingRows, staged) : []), [codingRows, staged]);
  const codingChanged = useMemo(() => new Set(codingChanges.map((c) => c.param)), [codingChanges]);

  const jobInput: JobInput | null = useMemo(
    () =>
      jobSource
        ? {
            chip: image,
            source: jobSource,
            odometer: odometerIntent,
            vin: effectiveVinAction,
            coding: codingDoc && codingChanges.length > 0 ? { doc: codingDoc, changes: codingChanges } : null,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [image, effectiveSource, dump, targetKmNum, effectiveVinAction, codingDoc, codingChanges],
  );
  const jobPlan = useMemo(() => (jobInput ? planJob(jobInput) : null), [jobInput]);

  /* DIFF: with a dump as the source, the parameters the dump and the chip hold differently - read
     with the same definition, so only when the chip is the same layout. */
  const chipLate = useMemo(() => (image ? detectLayout(image).kind === 'late' : false), [image]);
  const codingDiffering = useMemo(
    () => (effectiveSource === 'dump' && image && chipLate && preCoding && codingDef ? differingFrom(codingDef.def, preCoding, image) : null),
    [effectiveSource, image, chipLate, preCoding, codingDef],
  );
  const donor: DonorState =
    effectiveSource !== 'dump' || !image ? { kind: 'none' } : !chipLate ? { kind: 'layout' } : { kind: 'ok', count: codingDiffering?.size ?? 0 };

  const pickCoding = useCallback(
    (param: number, option: number | null) => {
      if (!sourceImage || !codingDef) return;
      /* Picking the value the source already holds is taking the pick back, not a change. */
      const row = codingRows?.[param];
      const to = row?.param.kind === 'fsw' ? row.param.options.find((o) => o.id === option) : undefined;
      const same = to && row?.option && optionValue(to) === optionValue(row.option);
      setCodingPicks((prev) => {
        const base = prev && prev.source === sourceImage && prev.file === codingDef.file ? prev.picks : new Map<number, number>();
        const next = new Map(base);
        if (option === null || same) next.delete(param);
        else next.set(param, option);
        return { source: sourceImage, file: codingDef.file, picks: next };
      });
      setCodingSelected(param);
    },
    [sourceImage, codingDef, codingRows],
  );

  const onDumpFile = useCallback((file: File) => {
    setDumpError(null);
    file
      .arrayBuffer()
      .then((buf) => {
        const r = parseImageFile(buf);
        if (r.ok) {
          setDump({ name: file.name, image: r.image });
          setSourceKind('dump');
        } else {
          setDump(null);
          setDumpError({ code: 'backup-size', fileSize: r.size });
        }
      })
      /* A file that cannot be read at all (moved, permission, a folder) must not leave the
         previous dump loaded and show nothing. */
      .catch(() => {
        setDump(null);
        setDumpError({ code: 'backup-size' });
      });
  }, []);

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
    rewrite: CHROME.tab.rewrite,
    inspect: CHROME.tab.inspect,
    records: CHROME.tab.records,
    bench: CHROME.tab.bench,
    checks: CHROME.tab.checks,
  };

  const tabs: TabDef<StepId>[] = MODE_STEPS[mode]
    .filter((id) => visible.has(id))
    .map((id) => ({ id, label: STEP_LABEL[id], enabled: steps.find((s) => s.id === id)?.enabled ?? true }));

  /* Turning a surface off while the reader is standing on it would leave the work area rendering
     something the strip no longer offers - and a mode with no tab left is no mode at all. */
  useEffect(() => {
    if (!modes.includes(mode)) setMode('chip');
    else if (!visible.has(step)) setStep(MODE_STEPS[mode].find((id) => visible.has(id)) ?? 'setup');
  }, [visible, modes, mode, step, setStep]);

  /* ------------------------------ the hub ------------------------------- */

  const ask = useCallback((job: WriteJob, body: string, details: string[]) => {
    setPending({ job, body, details });
  }, []);

  const bridgeHub: HubConfig = useMemo(
    () =>
      bridgeHubFor({
        busy,
        phase,
        step,
        hasImage: !!image,
        backedUp,
        job: {
          input: jobInput,
          plan: jobPlan,
          note: jobInput && jobPlan?.ok ? jobNote(jobPlan, jobInput, codingRef.state?.ok ? codingRef.state.origin.sha256 : null) : '',
        },
        copy,
        act: {
          /* PRACTICE rehearses on a late-layout chip: both VIN fields, both checksums - the
             shape of the bench's own chip, with made-up values. Or on the file INSPECT made
             the practice chip. */
          connect: () => {
            if (!practiceIntent) return void link.connect('serial');
            /* PRACTICE reads the file INSPECT chose, or a chip made to fit the definitions - so
               coding is rehearsed as on a real chip, with nothing opened - or, before any
               definitions are here, the made-up preset. */
            const coded = !practiceChip && codingDoc ? codedPracticeChip(presetImage('late'), codingDoc) : null;
            const seat: PracticeChip = practiceChip ?? (coded ? { name: coded.file, image: coded.image, coded: true } : 'late');
            void link.connect('practice', seat);
          },
          read: () => void link.read().then((ok) => ok && setStep('read')),
          backup: () => void link.backup(),
          ask,
        },
      }),
    [busy, phase, practiceIntent, practiceChip, codingDoc, image, backedUp, step, jobInput, jobPlan, codingRef.state, copy, link, ask, setStep],
  );

  /* ----------------------------- the owner ---------------------------- */

  /* The hub, the status rows, the notice line and the PRACTICE box all speak for the mode's link,
     so no control in TEST can act on the UNO and none in CHIP on the cluster. */
  const owner = linkOwnerOfMode(mode);
  const lock = modeLock({ bridgeBusy: busy, clusterSessionOpen: kombi.sessionOpen, clusterBusy: kombi.busy });

  /* What TEST compares the cluster with: this session's chip read, else the newest record of the
     same kind (practice or real). Fixed into the session at CONNECT. */
  const reference = useMemo(
    () => pickReference(image ? { image, practice: link.practice } : null, records, practiceIntent),
    [image, link.practice, records, practiceIntent],
  );

  const hub: HubConfig =
    owner === 'cluster'
      ? kombiHubFor({
          phase: kombi.phase,
          sessionOpen: kombi.sessionOpen,
          act: {
            // Straight from the click: the port picker opens only inside a user gesture.
            connect: () => void kombi.connect(practiceIntent ? 'practice' : 'serial', reference),
            stop: () => void kombi.stop(),
            saveReport: kombi.saveReport,
          },
        })
      : bridgeHub;
  const ownerBusy = owner === 'cluster' ? kombi.busy : busy;

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
    const ownerPhase = owner === 'cluster' ? kombi.phase : phase;
    if (ownerPhase !== 'disconnected') {
      out.push({
        label: CHROME.disconnect,
        Icon: Unplug,
        danger: true,
        onClick: () => void (owner === 'cluster' ? kombi.disconnect() : link.disconnect()),
      });
    }
    return out;
  }, [owner, kombi, phase, link]);

  /* ----------------------------- records ------------------------------- */

  useEffect(() => {
    listRecords()
      .then(setRecords)
      .catch(() => setRecords([]));
  }, [step, phase, link.backedUpHash]);

  /* ------------------------------ render -------------------------------- */

  const linkLed: LedState =
    owner === 'cluster'
      ? kombi.phase === 'disconnected'
        ? kombi.error
          ? 'error'
          : 'idle'
        : kombi.busy
          ? 'busy'
          : kombi.error
            ? 'error'
            : 'ok'
      : phase === 'disconnected'
        ? 'idle'
        : busy
          ? 'busy'
          : link.error
            ? 'error'
            : 'ok';
  const chipLed: LedState = !image ? 'idle' : chip?.blank ? 'ok' : 'idle';
  const clusterLed: LedState = kombi.phase === 'disconnected' ? 'idle' : kombi.session?.variant ? 'ok' : 'error';

  const noticeText = owner === 'cluster' ? (kombi.error ?? kombi.notice) : (link.error ?? link.notice);
  const noticeTone =
    owner === 'cluster'
      ? kombi.error
        ? 'error'
        : 'info'
      : link.error
        ? 'error'
        : link.notice === copy.writeOk
          ? 'ok'
          : 'info';

  /** The wire the diagram should light: an explicit pick beats the step's set. */
  const diagramHighlight =
    wire !== null
      ? [wire]
      : (GUIDE_STEPS.find((s) => s.id === guideStep)?.highlight ?? null);

  const practiceBox =
    owner === 'cluster'
      ? practiceBoxFor({ phase: kombi.phase, practice: kombi.practice, busy: kombi.busy, intent: practiceIntent })
      : practiceBoxFor({ phase, practice: link.practice, busy, intent: practiceIntent });

  /** The bench wire the TEST diagram should light: an explicit pick beats the step's set. */
  const benchHighlight =
    benchWire !== null ? [benchWire] : (BENCH_STEPS.find((s) => s.id === benchStep)?.highlight ?? null);

  /** READ's view: the chip as it was read. */
  const chipView = !image ? (
    <EmptyState
      Icon={FileCode}
      label={phase === 'disconnected' ? CHROME.awaiting.connection : CHROME.awaiting.read}
    />
  ) : (
    <div className="flex h-full flex-col gap-2">
      <HexLegend changedCount={null} vins={vinRanges(image)} />
      <div className="min-h-0 flex-1">
        <HexView vins={vinRanges(image)} image={image} reference={null} changeMode="pending" selected={selected} onSelect={setSelected} />
      </div>
    </div>
  );

  /** REWRITE's HEX view: the image as the job leaves it, every byte it changes marked. */
  function jobHex(): React.ReactNode {
    const base = image ?? dump?.image ?? null;
    if (!base) {
      return <EmptyState Icon={FileCode} label={phase === 'disconnected' ? CHROME.awaiting.connection : CHROME.awaiting.read} />;
    }
    const after = jobPlan?.ok ? jobPlan.target : base;
    let changed = 0;
    for (let i = 0; i < base.length; i++) if (base[i] !== after[i]) changed++;
    return (
      <div className="flex h-full flex-col gap-2">
        <HexLegend changedCount={changed} vins={vinRanges(after)} />
        <div className="min-h-0 flex-1">
          <HexView vins={vinRanges(after)} image={after} reference={base} changeMode="pending" selected={selected} onSelect={setSelected} />
        </div>
      </div>
    );
  }

  /** REWRITE's CODING view: every parameter of the source's own definition, or why there is none. */
  function jobCoding(): React.ReactNode {
    if (!preCoding) {
      return <EmptyState Icon={FileCode} label={CHROME.awaiting.definition} hint={cc().needImage} />;
    }
    /* Why there is nothing to list, said where the list would be - and the definitions are opened
       right here, the one place to open them. */
    if (!codingDoc) {
      const ref = codingRef.state;
      const why = ref === null ? cc().loading : ref.ok ? '' : `${cc().ref[ref.reason]}${ref.detail ? ` (${ref.detail})` : ''}`;
      return (
        <EmptyState Icon={FileCode} label={CHROME.awaiting.definition} hint={why}>
          {ref !== null && (
            <DropZone onFile={(file) => void codingRef.openFile(file)} hint={CHROME.drop.coding} accept=".json,application/json" />
          )}
        </EmptyState>
      );
    }
    if (!codingDef || !codingRows) {
      /* PRACTICE's preset chips carry made-up values, which no real definition fits. */
      const preset = effectiveSource === 'chip' && link.practice && link.practiceFile === null ? ` ${cc().practicePreset}` : '';
      return (
        <EmptyState
          Icon={FileCode}
          label={CHROME.hub.noDefinition}
          hint={codingChoice?.kind === 'none' ? `${cc().none[codingChoice.reason]}${preset}` : undefined}
        />
      );
    }
    return (
      <CodingTable
        doc={codingDoc}
        def={codingDef.def}
        rows={codingRows}
        image={preCoding}
        after={jobPlan?.ok && jobPlan.coding ? jobPlan.coding.after : null}
        lang={lang}
        staged={staged}
        changed={codingChanged}
        differing={codingDiffering}
        selected={codingSelected}
        onSelect={setCodingSelected}
        onPick={pickCoding}
      />
    );
  }

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
      case 'read':
        return chipView;
      case 'rewrite':
        return (
          <div className="flex h-full flex-col gap-2">
            {/* HEX: the image as the job leaves it. CODING: the list the coding part is picked
                from - where this build draws it. */}
            {codingVisible && (
              <div className="flex shrink-0 items-center gap-1.5">
                {(['hex', 'coding'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setJobView(v)}
                    aria-pressed={jobView === v}
                    className={`${pillClass(jobView === v ? 'primary' : 'neutral')} transition-colors`}
                  >
                    {v === 'hex' ? CHROME.job.hex : CHROME.job.coding}
                  </button>
                ))}
              </div>
            )}
            <div className="min-h-0 flex-1">{codingVisible && jobView === 'coding' ? jobCoding() : jobHex()}</div>
          </div>
        );
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
      case 'bench':
        return <ClusterBenchDiagram highlight={benchHighlight} onSelectWire={setBenchWire} />;
      case 'checks':
        return <ClusterDiagram variant={kombi.session?.variant ?? null} commanded={kombi.commanded} stepping={kombi.stepping} />;
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
      case 'read':
        return vehiclePanel;
      case 'rewrite':
        return (
          <RewritePanel
            rec={rec}
            hasChip={!!image}
            chipBlank={chip?.blank ?? false}
            odometer={odometer}
            sourceKind={effectiveSource}
            onSourceKind={setSourceKind}
            dump={dump}
            onDumpFile={onDumpFile}
            onClearDump={() => {
              setDump(null);
              setDumpError(null);
            }}
            dumpError={dumpError}
            targetKm={targetKm}
            onTargetKm={setTargetKm}
            vinAction={vinAction}
            onVinAction={setVinAction}
            vinInput={vinInput}
            onVinInput={setVinInput}
            input={jobInput}
            plan={jobPlan}
            coding={
              codingVisible ? (
                <CodingPanel
                  lang={lang}
                  refLoad={codingRef.state}
                  onReload={codingRef.reload}
                  image={preCoding}
                  choice={codingChoice}
                  rows={codingRows}
                  selected={codingSelected}
                  staged={staged}
                  onPick={pickCoding}
                  onDiscard={() => setCodingPicks(null)}
                  donor={donor}
                />
              ) : null
            }
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
            practiceChip={practiceChip}
            onUseAsPractice={() => {
              if (workspace) setPracticeChip({ name: workspace.name, image: Uint8Array.from(workspace.current) });
            }}
            onClearPractice={() => setPracticeChip(null)}
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
      case 'bench':
        return (
          <BenchPanel
            benchStep={benchStep}
            onBenchStep={(id) => {
              setBenchStep(id);
              setBenchWire(null); // an explicit pick is per-step, not sticky
            }}
            benchDone={benchDone}
            onToggleBenchDone={(id) =>
              setBenchDone((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            benchWire={benchWire}
            onBenchWire={setBenchWire}
          />
        );
      case 'checks':
        return (
          <ChecksPanel
            kombi={kombi}
            reference={reference}
            lang={lang}
            namesLoad={namesRef.state}
            onOpenNames={(file) => void namesRef.openFile(file)}
          />
        );
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
            <div className="flex h-[38.2%] min-h-fit flex-none flex-col overflow-y-auto px-5 pb-3 pt-4">
              <StatusRow
                label={CHROME.status.link}
                state={linkLed}
                value={
                  (owner === 'cluster' ? kombi.phase : phase) === 'disconnected'
                    ? serialSupported
                      ? CHROME.status.idle
                      : CHROME.status.noWebSerial
                    : (owner === 'cluster' ? kombi.practice : link.practice)
                      ? CHROME.status.practice
                      : CHROME.status.ready
                }
              />
              {owner === 'cluster' ? (
                <StatusRow
                  label={CHROME.status.cluster}
                  state={clusterLed}
                  value={
                    kombi.phase === 'disconnected'
                      ? CHROME.status.idle
                      : (kombi.session?.variant ?? CHROME.test.unknown)
                  }
                />
              ) : (
                <StatusRow
                  label={CHROME.status.chip}
                  state={chipLed}
                  value={!image ? CHROME.status.notRead : chip?.blank ? CHROME.status.blank : CHROME.status.used}
                  reason={chip?.reasons.join(' · ')}
                />
              )}

              <NoticeLine
                text={owner === 'bridge' && progress ? `${progress.label} ${progress.done}/${progress.total}` : noticeText}
                tone={owner === 'bridge' && progress ? 'info' : noticeTone}
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
                <Hub config={hub} busy={ownerBusy} />
              </div>

              <SubActionRow actions={subActions} />

              {/* THE PANEL'S BOTTOM CORNER - MODE, left (TUNER's place for it). Below the
                  sub-actions, on its own row, so it is not read as one of the hub's controls; the
                  spacer holds the row's height where TUNER keeps its other corner. */}
              <div className="flex flex-none items-center justify-between gap-4">
                <ModeCorner mode={mode} modes={modes} onChange={(m) => setMode(m)} lock={lock} />
                <span aria-hidden className="h-7" />
              </div>
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
          await link.runWrite(job);
          /* The job stays on REWRITE: the chip is read back, and the same plan against it now
             says NO CHANGES - the chip is what was planned. */
          setPending(null);
        }}
      />
    </main>
  );
}
