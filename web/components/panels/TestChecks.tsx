'use client';

/**
 * TEST's checks: what to ask the cluster, and what it said.
 *
 * Every drive button asks the gate what it WOULD say before the reader presses anything, and a
 * refusal is written in the row's reserved line - not in a tooltip a touch screen cannot show
 * (tsunagi-m-mobile section 10). The panel never decides for itself: `mayRun` is asked about the
 * same bytes the link would send.
 *
 * Results are reported, not graded: EQUAL / DIFFERENT / NOT COMPARED with both sides and the chip
 * address; SEEN / NOT SEEN as the reader answered.
 */

import { Eye, EyeOff, FileDown, Pause, Play, Radio } from 'lucide-react';
import type { ReactNode } from 'react';
import { MicroLabel, Pill, TextButton, type Tone } from '@/components/ui';
import { CHROME } from '@/lib/copy/chrome';
import { tc } from '@/lib/copy/test';
import type { CheckRun, UseKombiLink } from '@/lib/hooks/useKombiLink';
import * as drives from '@/lib/kombi/actuations';
import * as reads from '@/lib/kombi/reads';
import {
  checksFor,
  sweepPlan,
  type CheckId,
  type Compare,
  type FieldCheck,
  type ItemResult,
  type Observation,
  type Reference,
} from '@/lib/kombi/checks';
import { GAUGES, type GaugeId, type KombiRequest, type KombiVariant } from '@/lib/kombi/protocol';
import { mayRun, type GateRefusal } from '@/lib/kombi/runGate';

const COMPARE_TONE: Record<Compare, Tone> = { equal: 'ok', different: 'danger', 'not-compared': 'neutral' };
const COMPARE_WORD: Record<Compare, string> = {
  equal: CHROME.test.equal,
  different: CHROME.test.different,
  'not-compared': CHROME.test.notCompared,
};

export function TestChecks({ kombi, reference }: { kombi: UseKombiLink; reference: Reference | null }) {
  const c = tc();
  const s = kombi.session;
  const variant: KombiVariant | null = s?.variant ?? null;
  const open = kombi.phase === 'connected' && kombi.sessionOpen;
  const v = variant ?? 'KOMBI46';

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
            <Row label={CHROME.test.part}>{s.ident.value.partNumber}</Row>
            <Row label={CHROME.test.variant}>{variant ?? CHROME.test.unknown}</Row>
            <Row label={CHROME.test.diag}>{`0x${s.ident.value.diagIndex.toString(16).toUpperCase().padStart(2, '0')}`}</Row>
          </>
        ) : (
          <span className="text-slate-600">{kombi.phase === 'disconnected' ? CHROME.awaiting.connection : CHROME.test.unknown}</span>
        )}
        <span className="truncate text-slate-500">
          {reference ? c.referenceFrom(reference.label) : c.noReference}
        </span>
      </div>

      {/* ---- the bench, stated by the reader ---- */}
      <label className={`flex items-start gap-2 ${open ? 'cursor-pointer' : 'opacity-60'}`}>
        <input
          type="checkbox"
          checked={s?.benchConfirmed ?? false}
          disabled={!open}
          onChange={(e) => kombi.setBench(e.target.checked)}
          className="mt-0.5 h-3 w-3 accent-amber-500"
        />
        <span className="flex flex-col gap-0.5">
          <MicroLabel className={s?.benchConfirmed ? 'text-amber-400' : ''}>{CHROME.test.onBench}</MicroLabel>
          <span className="text-[11px] leading-snug text-slate-300">{c.benchStatement}</span>
          <span className="text-[10px] leading-snug text-slate-500">{c.benchWhy}</span>
        </span>
      </label>

      {/* ---- the checks ---- */}
      {checksFor(variant).map((id) => (
        <Check
          key={id}
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
          <CheckResult id={id} kombi={kombi} refusal={refusal} canRun={canRun} item={item} />
        </Check>
      ))}

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
  refusal,
  canRun,
  item,
}: {
  id: CheckId;
  kombi: UseKombiLink;
  refusal: (req: KombiRequest) => GateRefusal | null;
  canRun: boolean;
  item: (key: string) => ItemResult | undefined;
}) {
  const c = tc();
  const s = kombi.session;
  if (!s) return null;
  switch (id) {
    case 'vin':
      return s.vin ? <Fields checks={s.vin} /> : null;
    case 'odometer':
      return s.odometer ? <Fields checks={[s.odometer]} /> : null;
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
              <li key={p.port} className="flex gap-2">
                <span className="w-7 text-slate-600">{port}</span>
                <span className="text-slate-300">{`0x${p.value.toString(16).toUpperCase().padStart(2, '0')}`}</span>
                <span className="truncate text-slate-500">{bits.map((bit) => `${port}.b${bit}`).join(' ')}</span>
              </li>
            );
          })}
        </ul>
      ) : null;
    case 'eeprom':
      return s.eeprom ? (
        <div className="flex flex-col gap-0.5 font-mono text-[10px]">
          <span className="flex items-center gap-2">
            <Pill tone={COMPARE_TONE[s.eeprom.result]}>{COMPARE_WORD[s.eeprom.result]}</Pill>
            <span className="text-slate-400">
              {s.eeprom.result === 'not-compared' && s.eeprom.why
                ? c.notCompared[s.eeprom.why]
                : `${s.eeprom.differing.length} / ${s.eeprom.words * 2}`}
            </span>
          </span>
          {s.eeprom.differing.length > 0 && (
            <span className="break-all text-red-400">
              {s.eeprom.differing
                .slice(0, 12)
                .map((a) => `0x${a.toString(16).toUpperCase().padStart(3, '0')}`)
                .join(' ')}
              {s.eeprom.differing.length > 12 ? ' …' : ''}
            </span>
          )}
          <span className="text-slate-600">{c.mappingNote}</span>
        </div>
      ) : null;
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
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-indigo-300">{st.keys[st.index]}</span>
              <span className="font-mono text-[10px] text-slate-500">{`${st.index + 1}/${st.keys.length}`}</span>
              <span className="ml-auto">
                <Answer result={item(st.keys[st.index]!)} onAnswer={(o) => kombi.observe(st.keys[st.index]!, o)} />
              </span>
            </span>
          )}
          {keys.length > 0 && (
            <span className="font-mono text-[10px] text-slate-500">
              {`${CHROME.test.seen} ${seen} · ${CHROME.test.notSeen} ${notSeen}`}
              {keys
                .filter((x) => x.observed === 'not-seen')
                .map((x) => ` ${x.item}`)
                .join('')}
            </span>
          )}
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

/** Cluster value against chip value, and the verdict with its reason when it could not be made. */
function Fields({ checks }: { checks: FieldCheck[] }) {
  const c = tc();
  return (
    <ul className="flex flex-col gap-1 font-mono text-[10px]">
      {checks.map((f) => (
        <li key={f.field} className="flex flex-col">
          <span className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-slate-600">{CHROME.test.field[f.field]}</span>
            <Pill tone={COMPARE_TONE[f.result]}>{COMPARE_WORD[f.result]}</Pill>
          </span>
          <span className="flex gap-2 pl-[104px] text-slate-300">
            <span className="text-slate-600">{CHROME.test.cluster}</span>
            <span>{f.cluster ?? '—'}</span>
          </span>
          <span className="flex gap-2 pl-[104px] text-slate-300">
            <span className="text-slate-600">{CHROME.test.chip}</span>
            <span>{f.chip ?? '—'}</span>
            {f.at && <span className="text-slate-600">{f.at}</span>}
          </span>
          {f.why && <span className="pl-[104px] text-slate-500">{c.notCompared[f.why]}</span>}
        </li>
      ))}
    </ul>
  );
}
