'use client';

/**
 * TEST's checks: what to ask the cluster, and what it said.
 *
 * Every drive button asks the gate what it WOULD say before the reader presses anything, and a
 * refusal is written in the row's reserved line - not in a tooltip a touch screen cannot show
 * (tsunagi-m-mobile section 10). The panel never decides for itself: `mayRun` is asked about the
 * same bytes the link would send.
 *
 * Results are reported, not graded. A read's result is what the cluster answered, and it needs
 * nothing else to be one; only when there is a chip image does EQUAL / DIFFERENT / NOT COMPARED
 * appear under it, with the chip's value and address. A drive's result is SEEN / NOT SEEN as the
 * reader answered.
 */

import { ChevronDown, ChevronUp, Eye, EyeOff, FileDown, Pause, Play, Radio, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { DropZone } from '@/components/DropZone';
import { MicroLabel, Pill, TextButton, type Tone } from '@/components/ui';
import { CHROME } from '@/lib/copy/chrome';
import { jc } from '@/lib/copy/job';
import { tc } from '@/lib/copy/test';
import { t } from '@/lib/i18n';
import type { CheckRun, UseKombiLink } from '@/lib/hooks/useKombiLink';
import type { LineSilence } from '@/lib/kombi/kombiLink';
import * as drives from '@/lib/kombi/actuations';
import * as reads from '@/lib/kombi/reads';
import {
  checksFor,
  compareReads,
  DRIVE_CHECKS,
  referenceFromFile,
  sweepPlan,
  type CheckId,
  type Compare,
  type Comparison,
  type EepromCheck,
  type EepromRead,
  type FieldCheck,
  type ItemResult,
  type Observation,
  type Reference,
} from '@/lib/kombi/checks';
import type { Decoded } from '@/lib/kombi/decode';
import { GAUGES, wordToByteAddress, type GaugeId, type KombiRequest, type KombiVariant } from '@/lib/kombi/protocol';
import { mayRun, type GateRefusal } from '@/lib/kombi/runGate';
import { bitName, namesFor, type BitGroup } from '@/lib/kombi/names';
import { describeOrigin, type RefLoad } from '@/lib/refdata/load';
import type { VariantNames } from '@/lib/refdata/types';

type Lang = 'ja' | 'en';

/** A bit's position, and its name beside it when the reference data has one. */
function BitLabel({ names, group, id, lang }: { names: VariantNames | null; group: BitGroup; id: string; lang: Lang }) {
  const n = bitName(names, group, id, lang);
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 font-mono">{id}</span>
      {n && <span className="min-w-0 truncate font-sans text-slate-400">{n.text}</span>}
    </span>
  );
}

const COMPARE_TONE: Record<Compare, Tone> = { equal: 'ok', different: 'danger', 'not-compared': 'neutral' };
const COMPARE_WORD: Record<Compare, string> = {
  equal: CHROME.test.equal,
  different: CHROME.test.different,
  'not-compared': CHROME.test.notCompared,
};

export function TestChecks({
  kombi,
  reference,
  onReference,
  lang,
  namesLoad,
  onOpenNames,
}: {
  kombi: UseKombiLink;
  /** What the reads are held against - the session follows it - or null to compare nothing. */
  reference: Reference | null;
  onReference: (reference: Reference | null) => void;
  lang: Lang;
  /** The names reference data, or null while it is being fetched. */
  namesLoad: RefLoad<'kombi-names'> | null;
  onOpenNames: (file: File) => void;
}) {
  const c = tc();
  const s = kombi.session;
  const variant: KombiVariant | null = s?.variant ?? null;
  const names = namesFor(namesLoad?.ok ? namesLoad.doc : null, variant);
  const open = kombi.phase === 'connected' && kombi.sessionOpen;
  const v = variant ?? 'KOMBI46';
  /* The reads, held against the reference when there is one. No check waits for this. */
  const compared = s && reference ? compareReads(s, reference) : null;
  /* ON THE BENCH is asked where it is needed: just above the first check that moves something. */
  const checks = checksFor(variant);
  const firstDrive = checks.find((id) => DRIVE_CHECKS.has(id));

  /** What the gate would say about these bytes now. Null while there is no link to ask. */
  const refusal = (req: KombiRequest): GateRefusal | null => {
    if (!kombi.gate) return null;
    const verdict = mayRun(req, kombi.gate);
    return verdict.ok ? null : verdict.reason;
  };
  const item = (key: string): ItemResult | undefined => s?.items.find((x) => x.item === key);

  const probe: Partial<Record<CheckId, KombiRequest>> = {
    vin: reads.readVin(),
    odometer: reads.readOdometer(),
    faults: reads.readFaults(),
    inputs: reads.readInputs(v)[0],
    eeprom: reads.readEeprom(v, 0, 16),
    lamps: drives.lampsOff(v),
    outputs: drives.setOutputs(0),
    gong: drives.soundGong(),
    piezo: drives.soundPiezo(),
  };

  /** One check at a time, and none while a lamp or output bit waits for an answer. */
  const canRun = open && kombi.running === null && kombi.stepping === null;
  const reasonFor = (id: CheckId): string | null => {
    const req = probe[id];
    const r = req ? refusal(req) : null;
    return r ? c.refused[r] : null;
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] leading-relaxed text-slate-400">{c.checksLead}</p>

      {/* ---- who answered ---- */}
      <div className="flex flex-col gap-1 rounded bg-slate-900 px-2.5 py-2 font-mono text-[10px]">
        {s?.ident?.ok ? (
          <>
            <Row label={CHROME.test.part}>{s.ident.value.partNumber ?? '—'}</Row>
            <Row label={CHROME.test.variant}>{variant ?? CHROME.test.unknown}</Row>
            <Row label={CHROME.test.diag}>{`0x${s.ident.value.diagIndex.toString(16).toUpperCase().padStart(2, '0')}`}</Row>
          </>
        ) : s?.ident && !s.ident.ok ? (
          <span className="text-red-400">{c.unreadable(s.ident.reason, s.ident.got)}</span>
        ) : (
          <span className="text-slate-600">{kombi.phase === 'disconnected' ? CHROME.awaiting.connection : CHROME.test.unknown}</span>
        )}
        {/* What the cluster actually said to IDENT: the first thing to look at when it names no variant. */}
        {s?.identReply && <Row label="IDENT">{s.identReply}</Row>}
        {s && !variant && (
          <p className="whitespace-normal font-sans text-[10px] leading-snug text-amber-400">
            {c.variantWhy(s.ident?.ok ? `0x${s.ident.value.diagIndex.toString(16).toUpperCase().padStart(2, '0')}` : null)}
          </p>
        )}
      </div>

      {/* ---- a CONNECT that got no answer: where the line went quiet, and what to check for THAT ---- */}
      {kombi.phase === 'disconnected' && kombi.connectFailure?.silence && (
        <SilenceChecks code={kombi.connectFailure.code} silence={kombi.connectFailure.silence} />
      )}

      {/* ---- what the reads are held against, if anything: a dump the reader opens here comes first ---- */}
      <ReferencePick reference={reference} onReference={onReference} />

      {/* ---- the checks: the reads, then ON THE BENCH, then what moves the cluster ---- */}
      {checks.map((id) => (
        <Fragment key={id}>
          {id === firstDrive && (
            <BenchConfirm confirmed={s?.benchConfirmed ?? false} enabled={open} onChange={kombi.setBench} />
          )}
          <Check
            id={id}
            run={kombi.runs[id]}
            reason={id === 'needles' || id === 'release' ? null : reasonFor(id)}
            action={
              id === 'needles' || id === 'release' ? null : id === 'lamps' || id === 'outputs' ? (
                kombi.stepping?.check === id ? null : (
                  <TextButton Icon={Play} disabled={!canRun || reasonFor(id) !== null} onClick={() => void kombi.startStepping(id)}>
                    {CHROME.test.start}
                  </TextButton>
                )
              ) : (
                <span className="flex items-center gap-3">
                  {id === 'inputs' && (
                    <TextButton Icon={kombi.live ? Pause : Radio} tone="secondary" disabled={!open || reasonFor(id) !== null} onClick={kombi.toggleLive}>
                      {kombi.live ? CHROME.test.pause : CHROME.test.live}
                    </TextButton>
                  )}
                  <TextButton Icon={Play} disabled={!canRun || reasonFor(id) !== null} onClick={() => void kombi.run(id)}>
                    {CHROME.test.run}
                  </TextButton>
                </span>
              )
            }
          >
            <CheckResult
              id={id}
              kombi={kombi}
              compared={compared}
              refusal={refusal}
              canRun={canRun}
              item={item}
              names={names}
              lang={lang}
            />
          </Check>
        </Fragment>
      ))}

      {/* ---- where the names come from ---- */}
      <div className="flex flex-col gap-2 border-t border-slate-800 pt-4">
        <MicroLabel as="h3">{CHROME.test.names}</MicroLabel>
        {namesLoad === null ? (
          <p className="font-mono text-[10px] text-slate-500">{CHROME.coding.loading}</p>
        ) : namesLoad.ok ? (
          <p className="truncate font-mono text-[10px] text-emerald-400">{describeOrigin(namesLoad.origin)}</p>
        ) : (
          <>
            <p className="text-[10px] leading-snug text-amber-400">
              {c.names[namesLoad.reason]}
              {namesLoad.detail && <span className="ml-1 font-mono text-slate-500">({namesLoad.detail})</span>}
            </p>
            <DropZone onFile={onOpenNames} hint={CHROME.drop.names} accept=".json,application/json" />
          </>
        )}
        <p className="text-[10px] leading-snug text-slate-600">{c.namesNote}</p>
      </div>

      {/* ---- the report ---- */}
      <div className="flex flex-col gap-1 border-t border-slate-800 pt-4">
        <TextButton Icon={FileDown} disabled={!s} onClick={kombi.saveReport}>
          {CHROME.hub.saveReport}
        </TextButton>
        <p className="text-[10px] leading-snug text-slate-600">{c.reportNote}</p>
      </div>
    </div>
  );
}

/**
 * The image the reads are held against, and the place to open one. A dump opened here comes before
 * a chip read or a record; CLEAR lets go of it. Nothing here gates a check - with no image at all,
 * every read and drive still runs, and the reads show what the cluster answered.
 */
function ReferencePick({
  reference,
  onReference,
}: {
  reference: Reference | null;
  onReference: (reference: Reference | null) => void;
}) {
  const c = tc();
  const [refused, setRefused] = useState<string | null>(null);
  const sizeRefusal = (size?: number) => {
    const why = t().refusal({ code: 'backup-size', fileSize: size });
    return `${why.reason} ${why.detail ?? ''}`.trim();
  };
  const open = (file: File) => {
    setRefused(null);
    file
      .arrayBuffer()
      .then((buffer) => {
        const r = referenceFromFile(file.name, buffer);
        if (r.ok) return onReference(r.reference);
        setRefused(r.refusal.kind === 'size' ? sizeRefusal(r.refusal.size) : jc().file.notAChip(r.refusal.value));
      })
      // A file that cannot be read at all (moved, a folder) says so, and keeps what was there.
      .catch(() => setRefused(sizeRefusal()));
  };
  return (
    <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
      <MicroLabel as="h3">{CHROME.test.reference}</MicroLabel>
      <p className="text-[10px] leading-snug text-slate-500">{c.referenceLead}</p>
      {reference && (
        <span className="flex min-w-0 items-center gap-2">
          <Pill tone={reference.source === 'file' ? 'primary' : 'neutral'}>{CHROME.test.source[reference.source]}</Pill>
          {reference.source !== 'chip-read' && (
            <span className="min-w-0 truncate font-mono text-[11px] text-slate-200">{reference.label}</span>
          )}
          {reference.source === 'file' && (
            <TextButton tone="danger" Icon={X} onClick={() => onReference(null)} className="ml-auto">
              {CHROME.test.clear}
            </TextButton>
          )}
        </span>
      )}
      {reference?.source !== 'file' && <DropZone onFile={open} hint={CHROME.drop.file} />}
      {refused && <p className="font-mono text-[10px] leading-snug text-red-400">{refused}</p>}
    </div>
  );
}

/**
 * The reader's word that the cluster is out of the car, on the bench - asked right above the first
 * check that moves something, so a refused needle or lamp has its answer in sight (the gate refuses
 * every drive until it is ticked: runGate.ts).
 */
function BenchConfirm({
  confirmed,
  enabled,
  onChange,
}: {
  confirmed: boolean;
  enabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const c = tc();
  return (
    <label className={`flex items-start gap-2 border-t border-slate-800 pt-3 ${enabled ? 'cursor-pointer' : 'opacity-60'}`}>
      <input
        type="checkbox"
        checked={confirmed}
        disabled={!enabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3 w-3 accent-amber-500"
      />
      <span className="flex flex-col gap-0.5">
        <MicroLabel className={confirmed ? 'text-amber-400' : ''}>{CHROME.test.onBench}</MicroLabel>
        <span className="text-[11px] leading-snug text-slate-300">{c.benchStatement}</span>
        <span className="text-[10px] leading-snug text-slate-500">{c.benchWhy}</span>
      </span>
    </label>
  );
}

/**
 * Why CONNECT failed, drawn where there is room to read it: the hub's notice holds one line, and a
 * checklist in a truncated line is a checklist nobody reads (tsunagi-m-ux section 12).
 */
function SilenceChecks({ code, silence }: { code: string; silence: LineSilence }) {
  const s = tc().silence[silence];
  return (
    <div role="alert" className="flex flex-col gap-1.5 rounded bg-slate-900 px-2.5 py-2">
      <span className="font-mono text-[10px] text-red-400">{`IDENT · ${code}`}</span>
      <p className="text-[11px] leading-snug text-slate-300">{s.what}</p>
      <ol className="flex list-decimal flex-col gap-0.5 pl-4 text-[11px] leading-snug text-slate-400">
        {s.checks.map((check) => (
          <li key={check}>{check}</li>
        ))}
      </ol>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="w-16 shrink-0 text-slate-600">{label}</span>
      <span className="truncate text-slate-200">{children}</span>
    </span>
  );
}

/** One check: its name and state, what it does, the reserved line for why it cannot run, and its result. */
function Check({
  id,
  run,
  reason,
  action,
  children,
}: {
  id: CheckId;
  run: CheckRun | undefined;
  reason: string | null;
  action: ReactNode;
  children: ReactNode;
}) {
  const c = tc();
  const line =
    run?.status === 'failed'
      ? `${run.code} · ${run.message}`
      : run?.status === 'refused'
        ? c.refused[run.reason]
        : reason;
  return (
    <section className="flex flex-col gap-1 border-t border-slate-800 pt-3">
      <div className="flex min-h-[20px] items-center gap-2">
        <MicroLabel as="h3">{CHROME.test.name[id]}</MicroLabel>
        {run?.status === 'running' && (
          <Pill tone="secondary" className="animate-pulse">
            {run.total ? `${CHROME.test.running} ${run.done}/${run.total}` : CHROME.test.running}
          </Pill>
        )}
        {run?.status === 'failed' && <Pill tone="danger">{CHROME.test.failed}</Pill>}
        {run?.status === 'refused' && <Pill tone="caution">{CHROME.test.refused}</Pill>}
        <span className="ml-auto">{action}</span>
      </div>
      <p className="text-[10px] leading-snug text-slate-500">{c.check[id]}</p>
      {/* Reserved: a refusal or a failure is written here, in words, on every screen. */}
      <p className={`min-h-[14px] font-mono text-[10px] leading-snug ${run?.status === 'failed' ? 'text-red-400' : 'text-amber-400'}`}>
        {line ?? ''}
      </p>
      {children}
    </section>
  );
}

function CheckResult({
  id,
  kombi,
  compared,
  refusal,
  canRun,
  item,
  names,
  lang,
}: {
  id: CheckId;
  kombi: UseKombiLink;
  /** The reads held against the session's chip image, or null when it has none. */
  compared: Comparison | null;
  refusal: (req: KombiRequest) => GateRefusal | null;
  canRun: boolean;
  item: (key: string) => ItemResult | undefined;
  names: VariantNames | null;
  lang: Lang;
}) {
  const c = tc();
  const s = kombi.session;
  if (!s) return null;
  switch (id) {
    case 'vin':
      return s.vin ? (
        <div className="flex flex-col gap-1">
          <Reply read={s.vin} show={(vin) => vin} />
          {s.vin.ok && compared?.vin && <Compared checks={compared.vin} />}
        </div>
      ) : null;
    case 'odometer':
      return s.odometer ? (
        <div className="flex flex-col gap-1">
          <Reply read={s.odometer} show={km} />
          {s.odometer.ok && compared?.odometer && <Compared checks={[compared.odometer]} />}
        </div>
      ) : null;
    case 'faults':
      return s.faults ? (
        <p className="break-all font-mono text-[10px] text-slate-300">
          {'bytes' in s.faults ? s.faults.bytes || CHROME.test.noBytes : s.faults.error}
        </p>
      ) : null;
    case 'inputs':
      return s.inputs ? (
        <ul className="grid grid-cols-2 gap-x-4 font-mono text-[10px]">
          {s.inputs.map((p) => {
            const port = `P${p.port.toString(16).toUpperCase()}`;
            const bits = Array.from({ length: 8 }, (_, bit) => bit).filter((bit) => (p.value >> bit) & 1);
            return (
              <li key={p.port} className="flex min-w-0 flex-col">
                <span className="flex gap-2">
                  <span className="w-7 text-slate-600">{port}</span>
                  <span className="text-slate-300">{`0x${p.value.toString(16).toUpperCase().padStart(2, '0')}`}</span>
                </span>
                {bits.map((bit) => (
                  <span key={bit} className="flex min-w-0 pl-9 text-slate-500">
                    <BitLabel names={names} group="inputs" id={`${port}.b${bit}`} lang={lang} />
                  </span>
                ))}
              </li>
            );
          })}
        </ul>
      ) : null;
    case 'eeprom':
      return s.eeprom ? <EepromResult read={s.eeprom} check={compared?.eeprom ?? null} /> : null;
    case 'needles':
      return (
        <ul className="flex flex-col gap-1">
          {GAUGES.map((g) => {
            const gate = kombi.gate;
            const next = gate ? sweepPlan(gate.needles[g.id])[0] : 10;
            const why = refusal(drives.setNeedle(s.variant ?? 'KOMBI46', g.id, next ?? 10));
            const result = item(g.id);
            return (
              <li key={g.id} className="flex flex-col">
                <span className="flex items-center gap-2">
                  <span className="w-24 font-mono text-[10px] text-slate-300">{CHROME.test.gauge[g.id]}</span>
                  <TextButton Icon={Play} disabled={!canRun || why !== null} onClick={() => void kombi.runNeedle(g.id as GaugeId)}>
                    {CHROME.test.run}
                  </TextButton>
                  <span className="ml-auto">
                    <Answer result={result} onAnswer={(o) => kombi.observe(g.id, o)} />
                  </span>
                </span>
                {why && <span className="font-mono text-[10px] text-amber-400">{tc().refused[why]}</span>}
              </li>
            );
          })}
        </ul>
      );
    case 'lamps':
    case 'outputs': {
      const st = kombi.stepping?.check === id ? kombi.stepping : null;
      const keys = s.items.filter((x) => (id === 'lamps' ? /^B\d/.test(x.item) : /^P6/.test(x.item)));
      const seen = keys.filter((x) => x.observed === 'seen').length;
      const notSeen = keys.filter((x) => x.observed === 'not-seen').length;
      return (
        <div className="flex flex-col gap-1">
          {st && (
            <AskedRow asked={st.keys[st.index]!}>
              <span className="min-w-0 text-[11px] text-indigo-300">
                <BitLabel names={names} group={id} id={st.keys[st.index]!} lang={lang} />
              </span>
              <span className="shrink-0 font-mono text-[10px] text-slate-500">{`${st.index + 1}/${st.keys.length}`}</span>
              <span className="ml-auto">
                <Answer result={item(st.keys[st.index]!)} onAnswer={(o) => kombi.observe(st.keys[st.index]!, o)} />
              </span>
            </AskedRow>
          )}
          {keys.length > 0 && (
            <span className="font-mono text-[10px] text-slate-500">{`${CHROME.test.seen} ${seen} · ${CHROME.test.notSeen} ${notSeen}`}</span>
          )}
          {/* What was NOT seen is the finding: each one, by position and name. */}
          {keys
            .filter((x) => x.observed === 'not-seen')
            .map((x) => (
              <span key={x.item} className="flex min-w-0 text-[10px] text-red-400">
                <BitLabel names={names} group={id} id={x.item} lang={lang} />
              </span>
            ))}
        </div>
      );
    }
    case 'gong':
    case 'piezo':
      return item(id) ? <Answer result={item(id)} heard onAnswer={(o) => kombi.observe(id, o)} /> : null;
    case 'release':
      return !kombi.sessionOpen && s.end.kind !== 'in-progress' ? (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] leading-snug text-slate-300">{c.releaseQuestion}</p>
          {s.released ? (
            <Pill tone={s.released === 'returned' ? 'ok' : 'danger'}>
              {s.released === 'returned' ? CHROME.test.returned : CHROME.test.notReturned}
            </Pill>
          ) : (
            <span className="flex gap-4">
              <TextButton Icon={Eye} tone="ok" onClick={() => kombi.release('returned')}>
                {CHROME.test.returned}
              </TextButton>
              <TextButton Icon={EyeOff} tone="destructive" onClick={() => kombi.release('not-returned')}>
                {CHROME.test.notReturned}
              </TextButton>
            </span>
          )}
        </div>
      ) : null;
    default: {
      const unreachable: never = id;
      return unreachable;
    }
  }
}

/**
 * The lamp or output bit lit now, with its answer. The check does nothing until it is answered,
 * so the row brings itself into view each time a new item is lit - START sits at the section's
 * top, and the row opening below it could otherwise open off screen and leave a lit lamp that
 * looks like a stopped check.
 */
function AskedRow({ asked, children }: { asked: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, [asked]);
  return (
    <span ref={ref} className="flex min-w-0 items-center gap-2">
      {children}
    </span>
  );
}

/** The reader's answer for one item: two buttons until answered, then what they said. */
function Answer({
  result,
  heard = false,
  onAnswer,
}: {
  result: ItemResult | undefined;
  heard?: boolean;
  onAnswer: (o: Observation) => void;
}) {
  if (!result) return null;
  if (result.sent === 'failed') return <Pill tone="danger">{CHROME.test.failed}</Pill>;
  const yes = heard ? CHROME.test.heard : CHROME.test.seen;
  const no = heard ? CHROME.test.notHeard : CHROME.test.notSeen;
  if (result.observed) {
    return <Pill tone={result.observed === 'seen' ? 'ok' : 'danger'}>{result.observed === 'seen' ? yes : no}</Pill>;
  }
  return (
    <span className="flex gap-3">
      <TextButton Icon={Eye} tone="ok" onClick={() => onAnswer('seen')}>
        {yes}
      </TextButton>
      <TextButton Icon={EyeOff} tone="destructive" onClick={() => onAnswer('not-seen')}>
        {no}
      </TextButton>
    </span>
  );
}

const hex = (n: number, digits: number) => n.toString(16).toUpperCase().padStart(digits, '0');
const km = (n: number) => `${n.toLocaleString()} km`;

/** One line of a read's result: what it is, then its value. The labels line up down a check. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2 font-mono">
      <span className="w-24 shrink-0 text-[10px] text-slate-600">{label}</span>
      {children}
    </span>
  );
}

/** What the cluster answered, as it said it - or why its reply would not decode. */
function Reply<T>({ read, show }: { read: Decoded<T>; show: (value: T) => string }) {
  return (
    <Line label={CHROME.test.cluster}>
      {read.ok ? (
        <span className="text-[11px] text-slate-200">{show(read.value)}</span>
      ) : (
        <span className="text-[10px] text-red-400">{tc().unreadable(read.reason, read.got)}</span>
      )}
    </Line>
  );
}

/** The same read held against the chip image: each chip field, where it is, and the verdict. */
function Compared({ checks }: { checks: FieldCheck[] }) {
  const c = tc();
  return checks.map((f) => (
    <Line key={f.field} label={CHROME.test.field[f.field]}>
      <span className="text-[11px] text-slate-300">
        {f.chip === null ? '—' : f.field === 'odometer' ? km(Number(f.chip)) : f.chip}
      </span>
      {f.at && <span className="text-[10px] text-slate-600">{f.at}</span>}
      <Pill tone={COMPARE_TONE[f.result]}>{COMPARE_WORD[f.result]}</Pill>
      {f.why && <span className="truncate text-[10px] text-slate-500">{c.notCompared[f.why]}</span>}
    </Line>
  ));
}

/**
 * The EEPROM as the cluster read it out: which words, and the words themselves when asked for -
 * 32 or 64 lines of hex open by default would push every check below it off the panel. With a
 * chip image, the verdict under it, and the bytes that differ marked in the words.
 */
function EepromResult({ read, check }: { read: EepromRead; check: EepromCheck | null }) {
  const c = tc();
  const [shown, setShown] = useState(false);
  const last = read.fromWord + read.words - 1;
  const chipFrom = wordToByteAddress(read.fromWord);
  const chipTo = wordToByteAddress(last) + 1;
  return (
    <div className="flex flex-col gap-1">
      <Line label={CHROME.test.cluster}>
        {read.bytes.ok ? (
          <>
            <span className="text-[11px] text-slate-200">{c.eepromWords(hex(read.fromWord, 3), hex(last, 3), read.words)}</span>
            <TextButton Icon={shown ? ChevronUp : ChevronDown} tone="secondary" onClick={() => setShown(!shown)}>
              {shown ? CHROME.test.hide : CHROME.test.show}
            </TextButton>
          </>
        ) : (
          <span className="text-[10px] text-red-400">{c.unreadable(read.bytes.reason, read.bytes.got)}</span>
        )}
      </Line>
      {shown && read.bytes.ok && <Words fromWord={read.fromWord} bytes={read.bytes.value} differing={check?.differing ?? []} />}
      {check && read.bytes.ok && (
        <>
          <Line label={CHROME.test.chip}>
            <span className="text-[10px] text-slate-600">{`0x${hex(chipFrom, 3)}-0x${hex(chipTo, 3)}`}</span>
            <Pill tone={COMPARE_TONE[check.result]}>{COMPARE_WORD[check.result]}</Pill>
            {check.differing.length > 0 && (
              <span className="text-[10px] text-slate-400">{c.differingBytes(check.differing.length, check.words * 2)}</span>
            )}
          </Line>
          {check.differing.length > 0 && (
            <span className="break-all pl-[104px] font-mono text-[10px] text-red-400">
              {check.differing
                .slice(0, 12)
                .map((a) => `0x${hex(a, 3)}`)
                .join(' ')}
              {check.differing.length > 12 ? ' …' : ''}
            </span>
          )}
        </>
      )}
      <span className="font-mono text-[10px] text-slate-600">{c.mappingNote}</span>
    </div>
  );
}

/**
 * The words as the cluster sent them, eight to a line, each line by its first word's number. A
 * byte the chip image holds differently - under the stated mapping - is marked.
 */
function Words({ fromWord, bytes, differing }: { fromWord: number; bytes: Uint8Array; differing: readonly number[] }) {
  const marked = new Set(differing);
  const chipAt = wordToByteAddress(fromWord);
  const lines: number[] = [];
  for (let i = 0; i < bytes.length; i += 16) lines.push(i);
  return (
    <div className="flex flex-col">
      {lines.map((i) => (
        <Line key={i} label={hex(fromWord + i / 2, 3)}>
          <span className="flex gap-2 text-[10px] leading-snug">
            {Array.from({ length: Math.min(8, (bytes.length - i) / 2) }, (_, w) => (
              <span key={w}>
                {[0, 1].map((b) => {
                  const at = i + w * 2 + b;
                  return (
                    <span key={b} className={marked.has(chipAt + at) ? 'text-red-400' : 'text-slate-300'}>
                      {hex(bytes[at] ?? 0, 2)}
                    </span>
                  );
                })}
              </span>
            ))}
          </span>
        </Line>
      ))}
    </div>
  );
}
