'use client';

/**
 * The cluster link's state for the UI: the one place TEST's operations are started, and the ONE
 * FINISH PATH every session ends through (tsunagi-m-link section 11).
 *
 * A session ends because the reader pressed STOP, because the cable was lost, or because the
 * reader disconnected - and all three land in `finish`, which ends the diagnostic session (9F),
 * stops the heartbeat and the live inputs, and records how it ended. A button that ran its own
 * teardown would leave the other two ways out without one.
 *
 * PRACTICE is not a mock of this hook or of the link: it is the real WebSerialTransport and the
 * real KombiLink, talking to a simulated cluster through a simulated port. What PRACTICE shows is
 * what the gate, the retries and the finish path actually did.
 *
 * Long-running work (a sweep, the EEPROM read, the live inputs) reads the session and the
 * cancellation flag through refs, so a STOP pressed half way is seen at the next step - never
 * after a stale closure has finished its loop.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { WebSerialTransport, getSerial, isDs2Error, toHex, type SerialPortLike } from '@tsunagi/ds2-core';
import { KombiGateError, KombiLink } from '@/lib/kombi/kombiLink';
import { lampBits, OUTPUT_PORT_MASK, type GaugeId, type KombiVariant } from '@/lib/kombi/protocol';
import { practiceKombiOptions, simulatedKombiPort } from '@/lib/kombi/simulatedKombi';
import { isArduinoPort } from '@/lib/kombi/ports';
import {
  compareEeprom,
  compareOdometer,
  compareVin,
  eepromReadRange,
  lampKey,
  outputKey,
  sweepNeedle,
  type CheckId,
  type ItemResult,
  type Observation,
  type Reference,
} from '@/lib/kombi/checks';
import { buildReport, downloadReport, reportFilename, type SessionEnd, type TestSession } from '@/lib/kombi/report';
import type { GateRefusal } from '@/lib/kombi/runGate';
import { presetImage } from '@/lib/link/mockLink';
import { setLinkBusy } from '@/lib/pwa/linkBusy';
import { tc } from '@/lib/copy/test';

export type KombiPhase = 'disconnected' | 'connecting' | 'connected' | 'stopping';

export type CheckRun =
  | { status: 'running'; done?: number; total?: number }
  | { status: 'done' }
  | { status: 'failed'; code: string; message: string }
  | { status: 'refused'; reason: GateRefusal };

/** The item lit and waiting for the reader's answer, while lamps or outputs are being stepped. */
export type Stepping = { check: 'lamps' | 'outputs'; keys: string[]; index: number } | null;

export type Commanded = {
  needles: Partial<Record<GaugeId, number>>;
  lamps: number[] | null;
  outputs: number | null;
};

/** Tester present, while a session is open. */
const HEARTBEAT_MS = 2000;
/** How often LIVE re-reads the inputs. */
const LIVE_MS = 800;

/** Codes after which the cable is gone, not merely a reply lost: the session ends. */
const FATAL = new Set(['READ_FAILED', 'WRITE_FAILED', 'PORT_NOT_OPEN', 'NOT_CONNECTED']);

const NO_COMMAND: Commanded = { needles: {}, lamps: null, outputs: null };

export function useKombiLink() {
  const [phase, setPhase] = useState<KombiPhase>('disconnected');
  const [practice, setPractice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [runs, setRuns] = useState<Partial<Record<CheckId, CheckRun>>>({});
  const [running, setRunning] = useState<CheckId | null>(null);
  const [stepping, setStepping] = useState<Stepping>(null);
  const [live, setLive] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const linkRef = useRef<KombiLink | null>(null);
  /** The session is a mutable record the async work appends to; `bump` re-renders after each change. */
  const sessionRef = useRef<TestSession | null>(null);
  const commandedRef = useRef<Commanded>(NO_COMMAND);
  const cancelRef = useRef(false);
  const liveRef = useRef(false);
  const runningRef = useRef<CheckId | null>(null);
  const finishedRef = useRef(true);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* A cable on a cluster counts as busy for the service worker, like the bridge does. */
  useEffect(() => {
    setLinkBusy(phase !== 'disconnected');
  }, [phase]);

  /* Leaving the page mid-session: stop the timers; the port closes with the page. */
  useEffect(
    () => () => {
      liveRef.current = false;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    },
    [],
  );

  const setRun = useCallback((id: CheckId, run: CheckRun) => setRuns((r) => ({ ...r, [id]: run })), []);

  const command = useCallback((next: Partial<Commanded>) => {
    commandedRef.current = { ...commandedRef.current, ...next };
    bump();
  }, []);

  /* ------------------------------ the one finish ------------------------------ */

  const finish = useCallback(
    async (end: 'stopped' | 'failed' | 'disconnected', failure?: unknown): Promise<void> => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      cancelRef.current = true;
      liveRef.current = false;
      setLive(false);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
      setPhase('stopping');
      setStepping(null);

      const link = linkRef.current;
      const ended = link ? await link.stop() : false;
      commandedRef.current = NO_COMMAND;
      setSessionOpen(false);

      const s = sessionRef.current;
      if (s) {
        const code = isDs2Error(failure) ? failure.code : failure instanceof Error ? failure.name : 'unknown';
        const message = failure instanceof Error ? failure.message : String(failure ?? '');
        const how: SessionEnd =
          end === 'failed'
            ? { kind: 'failed', code, message, sessionEnded: ended }
            : { kind: end, sessionEnded: ended };
        sessionRef.current = { ...s, end: how, endedAt: Date.now() };
      }
      if (end === 'failed') setError(tc().linkLost(isDs2Error(failure) ? failure.code : String(failure)));
      setNotice(ended ? tc().sessionEnded : tc().sessionEndUnanswered);
      setPhase(link?.isConnected ? 'connected' : 'disconnected');
      bump();
    },
    [],
  );

  /** A check's failure, sorted: a refusal by the gate, a reply that did not come, or the cable gone. */
  const failed = useCallback(
    (id: CheckId, e: unknown) => {
      if (e instanceof KombiGateError) {
        setRun(id, { status: 'refused', reason: e.reason });
        return;
      }
      const code = isDs2Error(e) ? e.code : e instanceof Error ? e.name : 'unknown';
      const message = e instanceof Error ? e.message : String(e);
      setRun(id, { status: 'failed', code, message });
      if (FATAL.has(code)) void finish('failed', e);
    },
    [finish, setRun],
  );

  /* --------------------------------- connect --------------------------------- */

  /**
   * Must be called from the click itself: the port picker only opens inside a user gesture.
   * `reference` is what the session compares against; it is fixed for the session so the report
   * names one.
   */
  const connect = useCallback(
    async (mode: 'serial' | 'practice', reference: Reference | null, practiceVariant: KombiVariant = 'KOMBI46') => {
      setError(null);
      setNotice(null);
      let port: SerialPortLike;
      let requestPort: () => Promise<SerialPortLike>;
      if (mode === 'practice') {
        const sim = simulatedKombiPort(practiceKombiOptions(practiceVariant, reference?.image ?? presetImage('late')));
        requestPort = sim.requestPort;
      } else {
        const serial = getSerial();
        if (!serial) {
          setError(tc().noWebSerial);
          return;
        }
        try {
          port = await serial.requestPort();
        } catch {
          return; // the reader closed the picker
        }
        if (isArduinoPort(port)) {
          setError(tc().unoRefused);
          return;
        }
        requestPort = async () => port;
      }

      setPhase('connecting');
      const link = new KombiLink(new WebSerialTransport({ requestPort }));
      try {
        const identity = await link.connect();
        linkRef.current = link;
        setPractice(mode === 'practice');
        sessionRef.current = {
          practice: mode === 'practice',
          startedAt: Date.now(),
          endedAt: null,
          end: { kind: 'in-progress' },
          ident: identity.ident,
          variant: identity.variant,
          benchConfirmed: false,
          reference,
          vin: null,
          odometer: null,
          clusterVin: null,
          clusterKm: null,
          faults: null,
          inputs: null,
          eeprom: null,
          items: [],
          released: null,
          telegrams: link.sent,
        };
        commandedRef.current = NO_COMMAND;
        cancelRef.current = false;
        finishedRef.current = false;
        setRuns({});
        setSessionOpen(true);
        heartbeatRef.current = setInterval(() => void linkRef.current?.keepAlive(), HEARTBEAT_MS);
        setNotice(
          mode === 'practice'
            ? tc().practiceConnected
            : identity.variant
              ? tc().connected(identity.variant)
              : tc().variantUnknown,
        );
        setPhase('connected');
      } catch (e) {
        linkRef.current = null;
        setPhase('disconnected');
        setError(tc().noIdent(isDs2Error(e) ? e.code : e instanceof Error ? e.message : String(e)));
      }
      bump();
    },
    [],
  );

  const disconnect = useCallback(async () => {
    await finish('disconnected');
    try {
      await linkRef.current?.disconnect();
    } catch {
      /* already gone */
    }
    linkRef.current = null;
    setPhase('disconnected');
    setPractice(false);
    setRunning(null);
    runningRef.current = null;
    bump();
  }, [finish]);

  const stop = useCallback(() => finish('stopped'), [finish]);

  const setBench = useCallback((on: boolean) => {
    linkRef.current?.setBenchConfirmed(on);
    if (sessionRef.current) sessionRef.current = { ...sessionRef.current, benchConfirmed: on };
    bump();
  }, []);

  /* ---------------------------------- checks ---------------------------------- */

  /** Runs one check. One at a time: the gate would serialise them anyway, the reader should see it. */
  const exclusive = useCallback(
    async (id: CheckId, work: (link: KombiLink) => Promise<void>) => {
      const link = linkRef.current;
      if (!link || runningRef.current || finishedRef.current) return;
      runningRef.current = id;
      setRunning(id);
      setRun(id, { status: 'running' });
      try {
        await work(link);
        setRun(id, { status: 'done' });
      } catch (e) {
        failed(id, e);
      } finally {
        runningRef.current = null;
        setRunning(null);
        bump();
      }
    },
    [failed, setRun],
  );

  const patchSession = (p: Partial<TestSession>) => {
    if (sessionRef.current) sessionRef.current = { ...sessionRef.current, ...p };
  };

  const itemResult = (item: string, sent: ItemResult['sent'], error: string | null) => {
    const s = sessionRef.current;
    if (!s) return;
    // A re-run replaces the item's earlier row: the report keeps the latest answer per item.
    sessionRef.current = { ...s, items: [...s.items.filter((x) => x.item !== item), { item, sent, error, observed: null }] };
  };

  const run = useCallback(
    (id: CheckId) => {
      const ref = sessionRef.current?.reference ?? null;
      switch (id) {
        case 'vin':
          return exclusive(id, async (link) => {
            const d = await link.readVin();
            patchSession({ vin: compareVin(d, ref), clusterVin: d.ok ? d.value : null });
          });
        case 'odometer':
          return exclusive(id, async (link) => {
            const d = await link.readOdometer();
            patchSession({ odometer: compareOdometer(d, ref), clusterKm: d.ok ? d.value : null });
          });
        case 'faults':
          return exclusive(id, async (link) => {
            const d = await link.readFaults();
            patchSession({ faults: d.ok ? { bytes: toHex(d.value).toUpperCase() } : { error: d.reason } });
          });
        case 'inputs':
          return exclusive(id, async (link) => {
            const d = await link.readInputs();
            patchSession({ inputs: d.ok ? d.value : null });
          });
        case 'eeprom':
          return exclusive(id, async (link) => {
            const variant = link.variant;
            // With no variant the gate refuses the read; ask it rather than deciding here.
            const { from, count } = eepromReadRange(variant ?? 'KOMBI46');
            const d = await link.readEepromWords(from, count, (done, total) =>
              setRun('eeprom', { status: 'running', done, total }),
            );
            patchSession({ eeprom: compareEeprom(d.ok ? d.value : null, from, count, ref) });
          });
        case 'gong':
        case 'piezo':
          return exclusive(id, async (link) => {
            try {
              await (id === 'gong' ? link.soundGong() : link.soundPiezo());
              itemResult(id, 'acknowledged', null);
            } catch (e) {
              if (!(e instanceof KombiGateError)) itemResult(id, 'failed', isDs2Error(e) ? e.code : String(e));
              throw e;
            }
          });
        case 'needles':
        case 'lamps':
        case 'outputs':
        case 'release':
          // Stepped, or answered: see runNeedle / startStepping / release.
          return;
        default: {
          const unreachable: never = id;
          return unreachable;
        }
      }
    },
    [exclusive, setRun],
  );

  /** One needle, swept up and back. The reader then says whether it moved. */
  const runNeedle = useCallback(
    (gauge: GaugeId) =>
      exclusive('needles', async (link) => {
        cancelRef.current = false;
        try {
          await sweepNeedle(link, gauge, {
            cancelled: () => cancelRef.current,
            onStep: (d) => command({ needles: { ...commandedRef.current.needles, [gauge]: d } }),
          });
          itemResult(gauge, 'acknowledged', null);
        } catch (e) {
          if (!(e instanceof KombiGateError)) itemResult(gauge, 'failed', isDs2Error(e) ? e.code : String(e));
          throw e;
        }
      }),
    [command, exclusive],
  );

  /** Lamps or output bits, one at a time: light the first and wait for the reader's answer. */
  const startStepping = useCallback(
    (check: 'lamps' | 'outputs') =>
      exclusive(check, async (link) => {
        const variant = link.variant;
        const keys =
          check === 'lamps'
            ? lampBits(variant ?? 'KOMBI46').map((b) => lampKey(b.byte, b.bit))
            : Array.from({ length: 4 }, (_, bit) => bit)
                .filter((bit) => (OUTPUT_PORT_MASK >> bit) & 1)
                .map(outputKey);
        await lightItem(link, check, keys, 0);
        setStepping({ check, keys, index: 0 });
      }),
    [exclusive],
  );

  /** Sends the one item at `index` (and only it). */
  async function lightItem(link: KombiLink, check: 'lamps' | 'outputs', keys: string[], index: number) {
    const key = keys[index]!;
    try {
      if (check === 'lamps') {
        const m = /^B(\d+)\.b(\d)$/.exec(key)!;
        const byte = Number(m[1]);
        const bit = Number(m[2]);
        await link.showLamp(byte, bit);
        const bytes = lampBits(link.variant ?? 'KOMBI46').reduce<number[]>((acc, b) => {
          acc[b.byte - 1] = 0;
          return acc;
        }, []);
        bytes[byte - 1] = 1 << bit;
        command({ lamps: bytes });
      } else {
        const bit = Number(key.slice(4));
        await link.setOutputs(1 << bit);
        command({ outputs: 1 << bit });
      }
      itemResult(key, 'acknowledged', null);
    } catch (e) {
      if (!(e instanceof KombiGateError)) itemResult(key, 'failed', isDs2Error(e) ? e.code : String(e));
      throw e;
    }
  }

  /** The reader's answer for an item; while stepping, it also lights the next one. */
  const observe = useCallback(
    (item: string, observation: Observation) => {
      const s = sessionRef.current;
      if (!s) return;
      sessionRef.current = {
        ...s,
        items: s.items.map((x) => (x.item === item ? { ...x, observed: observation } : x)),
      };
      bump();
      const st = stepping;
      if (!st || st.keys[st.index] !== item) return;
      const next = st.index + 1;
      void exclusive(st.check, async (link) => {
        if (next < st.keys.length && !cancelRef.current) {
          await lightItem(link, st.check, st.keys, next);
          setStepping({ ...st, index: next });
        } else {
          if (st.check === 'lamps') {
            await link.lampsOff();
            command({ lamps: null });
          } else {
            await link.setOutputs(0);
            command({ outputs: null });
          }
          setStepping(null);
        }
      });
    },
    [exclusive, stepping],
  );

  /** After STOP: did the cluster take everything back? */
  const release = useCallback((answer: 'returned' | 'not-returned') => {
    if (sessionRef.current) sessionRef.current = { ...sessionRef.current, released: answer };
    setRuns((r) => ({ ...r, release: { status: 'done' } }));
    bump();
  }, []);

  /** LIVE inputs: re-read while on, skipping a beat whenever a check holds the line. */
  const toggleLive = useCallback(() => {
    if (liveRef.current) {
      liveRef.current = false;
      setLive(false);
      return;
    }
    const link = linkRef.current;
    if (!link || finishedRef.current) return;
    liveRef.current = true;
    setLive(true);
    void (async () => {
      while (liveRef.current && linkRef.current === link && link.isConnected) {
        if (!runningRef.current && !link.isBusy) {
          try {
            const d = await link.readInputs();
            patchSession({ inputs: d.ok ? d.value : null });
            setRun('inputs', { status: 'done' });
            bump();
          } catch (e) {
            liveRef.current = false;
            setLive(false);
            failed('inputs', e);
          }
        }
        await new Promise((r) => setTimeout(r, LIVE_MS));
      }
    })();
  }, [failed, setRun]);

  const saveReport = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const report = buildReport(s);
    downloadReport(report, reportFilename(s.clusterVin, s.clusterKm, new Date(), s.practice));
  }, []);

  const busy = phase === 'connecting' || phase === 'stopping' || running !== null;

  return {
    phase,
    practice,
    error,
    notice,
    busy,
    running,
    runs,
    stepping,
    live,
    sessionOpen,
    session: sessionRef.current,
    commanded: commandedRef.current,
    gate: linkRef.current?.gateContext ?? null,
    connect,
    disconnect,
    stop,
    setBench,
    run,
    runNeedle,
    startStepping,
    observe,
    release,
    toggleLive,
    saveReport,
  };
}

export type UseKombiLink = ReturnType<typeof useKombiLink>;
