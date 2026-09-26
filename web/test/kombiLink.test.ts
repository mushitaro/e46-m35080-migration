import { afterEach, describe, expect, it } from 'vitest';
import { Ds2Error, Ds2Status, WebSerialTransport, isDs2Error, type ExchangeBehavior, type TraceEntry } from '@tsunagi/ds2-core';
import { KombiGateError, KombiLink, silenceOf } from '@/lib/kombi/kombiLink';
import { GAUGE_IDS, KOMBI_VARIANTS, lampBits, wordToByteAddress, type KombiVariant } from '@/lib/kombi/protocol';
import {
  PRACTICE_DIFFERING_WORD,
  practiceKombiOptions,
  simulatedKombiPort,
  type SimulatedKombiOptions,
} from '@/lib/kombi/simulatedKombi';
import { lateImage } from './support/lateImage';

/**
 * The REAL WebSerialTransport and Ds2Link, driven through KombiLink, against a simulated cluster
 * (tsunagi-m-link section 24). Assertions are on what reached the device - its own trace - as
 * well as on what the link reports.
 */

const FAST = { responseTimeoutMs: 120, retryDelayMs: 1, resyncSettleMs: 0, breakSettleMs: 1 };

const opened: KombiLink[] = [];
afterEach(async () => {
  for (const l of opened) await l.disconnect().catch(() => {});
  opened.length = 0;
});

function chip(): Uint8Array {
  return lateImage({ codedVin: 'CD67890', km: 123_456 });
}

async function bench(options: Partial<SimulatedKombiOptions> & { variant: KombiVariant }, script: ExchangeBehavior[] = []) {
  const sim = simulatedKombiPort({ chip: chip(), ...options }, script);
  const link = new KombiLink(new WebSerialTransport({ requestPort: sim.requestPort }), { timings: FAST });
  opened.push(link);
  const identity = await link.connect();
  return { ...sim, link, identity };
}

const controlsOf = (trace: TraceEntry[]) => trace.map((t) => t.request.controlOrStatus);

/** Every frame the device received was approved by mayRun, in the order approved (a retry re-sends the same one). */
function assertEveryWireFrameWasApproved(trace: TraceEntry[], link: KombiLink) {
  const approved = link.sent.map((s) => Array.from(s.frame).join(','));
  let i = 0;
  for (const t of trace) {
    const bytes = Array.from(t.bytes).join(',');
    while (i < approved.length && approved[i] !== bytes) i++;
    expect(i, `wire frame ${bytes} was never approved`).toBeLessThan(approved.length);
  }
}

describe.each(KOMBI_VARIANTS)('%s on the bench', (variant) => {
  it('connects, names its variant from IDENT, and reads', async () => {
    const { link, identity, kombi } = await bench({ variant });
    expect(identity.variant).toBe(variant);
    expect(identity.ident).toMatchObject({ ok: true, value: { partNumber: '6999999' } });

    expect(await link.readVin()).toEqual({ ok: true, value: 'CD67890' });
    expect(await link.readOdometer()).toEqual({ ok: true, value: 123_456 });
    expect(await link.readFaults()).toEqual({ ok: true, value: new Uint8Array(0) });
    const inputs = await link.readInputs();
    expect(inputs.ok && inputs.value).toHaveLength(7);

    // The EEPROM read answers from the chip, under the assumed word mapping.
    const words = await link.readEepromWords(0x3d, 20);
    const image = chip();
    expect(words).toEqual({ ok: true, value: image.slice(wordToByteAddress(0x3d), wordToByteAddress(0x3d + 20)) });
    expect(kombi.events.filter((e) => e.kind === 'not-implemented')).toEqual([]);
  });

  it('drives nothing before the reader confirms the bench - not one byte reaches the cluster', async () => {
    const { link, port } = await bench({ variant });
    const before = port.trace.length;
    await expect(link.setNeedle('rpm', 10)).rejects.toMatchObject({ reason: 'bench-unconfirmed' });
    await expect(link.lampsOff()).rejects.toBeInstanceOf(KombiGateError);
    await expect(link.soundGong()).rejects.toBeInstanceOf(KombiGateError);
    expect(port.trace.length).toBe(before);
  });

  it('sweeps a needle up and down in steps, and refuses a jump', async () => {
    const { link, kombi, port } = await bench({ variant });
    link.setBenchConfirmed(true);
    for (const d of [10, 20, 30, 40, 50, 60, 70, 80, 90]) await link.setNeedle('rpm', d);
    expect(kombi.needles.rpm).toBe(90);

    const before = port.trace.length;
    await expect(link.setNeedle('rpm', 70)).rejects.toMatchObject({ reason: 'step-too-large' });
    expect(port.trace.length).toBe(before);
    expect(link.needleSpan('rpm')).toEqual({ lo: 90, hi: 90 });

    for (const d of [80, 70, 60, 50, 40, 30, 20, 10]) await link.setNeedle('rpm', d);
    expect(kombi.events.filter((e) => e.kind === 'needle').map((e) => (e as { degrees: number }).degrees)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 80, 70, 60, 50, 40, 30, 20, 10,
    ]);
  });

  it('lights each lamp alone, then all off', async () => {
    const { link, kombi } = await bench({ variant });
    link.setBenchConfirmed(true);
    for (const { byte, bit } of lampBits(variant)) {
      await link.showLamp(byte, bit);
      expect(kombi.lamps?.reduce((n, b) => n + popcount(b), 0)).toBe(1);
      expect(((kombi.lamps?.[byte - 1] ?? 0) >> bit) & 1).toBe(1);
    }
    await link.lampsOff();
    expect(kombi.lamps?.every((b) => b === 0)).toBe(true);
  });

  it('STOP sends 9F, and the cluster takes everything back', async () => {
    const { link, kombi, port } = await bench({ variant });
    link.setBenchConfirmed(true);
    await link.setNeedle('fuel', 10);
    await link.showLamp(2, 0);
    expect(await link.stop()).toBe(true);

    expect(controlsOf(port.trace).at(-1)).toBe(0x9f);
    expect(kombi.needles.fuel).toBeNull();
    expect(kombi.lamps).toBeNull();
    expect(kombi.events.at(-1)).toEqual({ kind: 'session-ended' });
    // After the session, a needle starts from the rest angle again.
    for (const g of GAUGE_IDS) expect(link.needleSpan(g)).toBeNull();
    await expect(link.setNeedle('fuel', 20)).rejects.toMatchObject({ reason: 'step-too-large' });
  });

  it('every frame on the wire went through mayRun', async () => {
    const { link, port } = await bench({ variant });
    link.setBenchConfirmed(true);
    await link.readVin();
    await link.readInputs();
    await link.readEepromWords(0, 40);
    for (const d of [10, 20, 30]) await link.setNeedle('coolant', d);
    await link.showLamp(1, 0);
    await link.soundGong();
    await link.soundPiezo();
    await link.keepAlive();
    await expect(link.setNeedle('coolant', 90)).rejects.toBeInstanceOf(KombiGateError);
    await link.stop();

    expect(port.trace.length).toBeGreaterThan(10);
    assertEveryWireFrameWasApproved(port.trace, link);
    expect(link.sent.every((s) => s.outcome.kind === 'acknowledged')).toBe(true);
  });
});

describe('failures', () => {
  it('rings the gong once: an event is never re-sent after a lost reply', async () => {
    // IDENT answers; the gong's reply never comes (the echo does).
    const { link, port, kombi } = await bench({ variant: 'KOMBI46' }, [{ kind: 'respond' }, { kind: 'silent' }]);
    link.setBenchConfirmed(true);
    await expect(link.soundGong()).rejects.toSatisfy((e: unknown) => isDs2Error(e) && e.code === 'READ_TIMEOUT');
    expect(controlsOf(port.trace).filter((c) => c === 0x0c)).toHaveLength(1);
    expect(link.sent.at(-1)?.outcome).toMatchObject({ kind: 'failed', code: 'READ_TIMEOUT' });
    // 'silent' means the device did not act on it either, so no chime in its log.
    expect(kombi.events.filter((e) => e.kind === 'gong')).toHaveLength(0);
  });

  it('re-sends a needle that sets a state, and remembers it may be at either end', async () => {
    const { link, port } = await bench({ variant: 'KOMBI46' }, [
      { kind: 'respond' }, // IDENT
      { kind: 'respond' }, // rpm 10
      { kind: 'silent' },
      { kind: 'silent' },
      { kind: 'silent' }, // rpm 20, three attempts, no reply
    ]);
    link.setBenchConfirmed(true);
    await link.setNeedle('rpm', 10);
    await expect(link.setNeedle('rpm', 20)).rejects.toBeDefined();
    expect(controlsOf(port.trace).filter((c) => c === 0x0c)).toHaveLength(4);
    expect(link.needleSpan('rpm')).toEqual({ lo: 10, hi: 20 });
    // From there, only moves within one step of BOTH ends.
    await expect(link.setNeedle('rpm', 25)).rejects.toMatchObject({ reason: 'step-too-large' });
    await expect(link.setNeedle('rpm', 15)).resolves.toBeUndefined();
    expect(link.needleSpan('rpm')).toEqual({ lo: 15, hi: 15 });
  });

  it('a negative reply is recorded with its number and never re-sent; the needle has not moved', async () => {
    const { link, port } = await bench({ variant: 'KOMBI46R' }, [
      { kind: 'respond' },
      { kind: 'respond', status: Ds2Status.PARAMETER_ERROR },
    ]);
    link.setBenchConfirmed(true);
    await expect(link.setNeedle('speed', 10)).rejects.toSatisfy(
      (e: unknown) => isDs2Error(e) && e.code === 'NEGATIVE_RESPONSE' && e.detail.status === 0xb0,
    );
    expect(controlsOf(port.trace).filter((c) => c === 0x0c)).toHaveLength(1);
    expect(link.needleSpan('speed')).toBeNull();
    expect(link.sent.at(-1)?.outcome).toMatchObject({ kind: 'rejected', status: 0xb0 });
  });

  it('after a failure, the same STOP still ends the session', async () => {
    const { link, port } = await bench({ variant: 'KOMBI46' }, [{ kind: 'respond' }, { kind: 'silent' }]);
    link.setBenchConfirmed(true);
    await expect(link.soundPiezo()).rejects.toBeDefined();
    expect(await link.stop()).toBe(true);
    expect(controlsOf(port.trace).at(-1)).toBe(0x9f);
    expect(link.sent.map((s) => [s.kind, s.outcome.kind])).toEqual([
      ['ident', 'acknowledged'],
      ['piezo', 'failed'],
      ['end-session', 'acknowledged'],
    ]);
  });

  it('a click that meets the heartbeat waits for the gate instead of failing', async () => {
    const { link, port } = await bench({ variant: 'KOMBI46' });
    const beat = link.keepAlive();
    const vin = link.readVin();
    expect(await beat).toBe(true);
    expect(await vin).toEqual({ ok: true, value: 'CD67890' });
    expect(controlsOf(port.trace).slice(-2)).toEqual([0x9e, 0x02]);
  });

  it('the heartbeat skips while an operation holds the line, and never throws', async () => {
    const { link } = await bench({ variant: 'KOMBI46' });
    const read = link.readEepromWords(0, 32);
    expect(await link.keepAlive()).toBe(false);
    await read;
    await link.disconnect();
    expect(await link.keepAlive()).toBe(false);
  });

  it('a cluster that never answers IDENT is not connected', async () => {
    const sim = simulatedKombiPort({ variant: 'KOMBI46', chip: chip() }, [{ kind: 'dead' }, { kind: 'dead' }, { kind: 'dead' }]);
    const link = new KombiLink(new WebSerialTransport({ requestPort: sim.requestPort }), { timings: FAST });
    await expect(link.connect()).rejects.toBeDefined();
    expect(link.isConnected).toBe(false);
    await expect(link.readVin()).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('says where IDENT went quiet: no echo at all is the cable, an echo and then nothing is the cluster', async () => {
    const quiet = async (kind: 'dead' | 'silent') => {
      const sim = simulatedKombiPort({ variant: 'KOMBI46', chip: chip() }, [{ kind }, { kind }, { kind }]);
      const link = new KombiLink(new WebSerialTransport({ requestPort: sim.requestPort }), { timings: FAST });
      await expect(link.connect()).rejects.toMatchObject({ code: 'READ_TIMEOUT' });
      return { silence: link.lastSilence, outcome: link.sent.at(-1)?.outcome };
    };
    // Nothing back, not even the echo: the cable never drove the line.
    expect(await quiet('dead')).toMatchObject({ silence: 'no-echo', outcome: { kind: 'failed', code: 'READ_TIMEOUT', silence: 'no-echo' } });
    // The echo whole, then silence: the telegram was on the line and the cluster did not answer.
    expect(await quiet('silent')).toMatchObject({ silence: 'no-answer', outcome: { kind: 'failed', silence: 'no-answer' } });
  });

  it('classifies a timeout by what the exchange had seen, and nothing else', () => {
    const timeout = (received: number) =>
      new Ds2Error('READ_TIMEOUT', `Timed out waiting for 4 byte(s) (received ${received})`, {
        kind: 'timeout',
        detail: { expected: 4, received, timeoutMs: 120 },
      });
    const before = { echoed: false, heardAfterEcho: false };
    const after = { echoed: true, heardAfterEcho: false };
    expect(silenceOf(timeout(0), before)).toBe('no-echo');
    expect(silenceOf(timeout(2), before)).toBe('partial-echo');
    expect(silenceOf(timeout(0), after)).toBe('no-answer');
    expect(silenceOf(timeout(1), after)).toBe('cut-short');
    expect(silenceOf(timeout(0), { echoed: true, heardAfterEcho: true })).toBe('cut-short');
    // Not a timeout: an echo that came back wrong classifies itself in ds2-core.
    expect(silenceOf(new Ds2Error('ECHO_MISMATCH', 'x', { kind: 'electrical' }), before)).toBeNull();
    expect(silenceOf(new Error('x'), after)).toBeNull();
  });

  it('an index outside both ranges leaves the variant unknown: shared reads only', async () => {
    const { link, identity, port } = await bench({ variant: 'KOMBI46', diagIndex: 0x99 });
    expect(identity.variant).toBeNull();
    expect(await link.readVin()).toMatchObject({ ok: true });
    const before = port.trace.length;
    await expect(link.readInputs()).rejects.toMatchObject({ reason: 'variant-unknown' });
    await expect(link.readEeprom(0, 1)).rejects.toMatchObject({ reason: 'variant-unknown' });
    link.setBenchConfirmed(true);
    await expect(link.soundGong()).rejects.toMatchObject({ reason: 'variant-unknown' });
    expect(port.trace.length).toBe(before);
  });
});

describe('PRACTICE cluster', () => {
  it('is the practice chip with one word different, and reports the coded VIN', async () => {
    const image = chip();
    const sim = simulatedKombiPort(practiceKombiOptions('KOMBI46R', image));
    const link = new KombiLink(new WebSerialTransport({ requestPort: sim.requestPort }), { timings: FAST });
    opened.push(link);
    await link.connect();
    const read = await link.readEepromWords(0, 0x40);
    expect(read.ok).toBe(true);
    const got = read.ok ? read.value : new Uint8Array();
    const differing: number[] = [];
    for (let a = 0; a < got.length; a++) if (got[a] !== image[a]) differing.push(a);
    const at = wordToByteAddress(PRACTICE_DIFFERING_WORD);
    expect(differing).toEqual([at, at + 1]);
    expect(await link.readVin()).toEqual({ ok: true, value: 'CD67890' });
  });
});

function popcount(b: number): number {
  let n = 0;
  for (let x = b; x; x >>= 1) n += x & 1;
  return n;
}
