/**
 * The cluster link: every telegram this tool sends a cluster goes through here, and through mayRun
 * first.
 *
 * It owns a ds2-core Ds2Link and never hands it out. A caller that held the Ds2Link could send any
 * bytes it liked and the gate would be a suggestion; holding it privately is what makes mayRun the
 * ONLY way to the wire. The heartbeat and the session end go through the gate too - they are on
 * its list, like everything else that is sent.
 *
 * Retries follow tsunagi-m-link section 19. A telegram that did not arrive is re-sent when sending
 * it twice changes nothing: a read, or a drive that SETS a state (this needle at 40 degrees, these
 * lamps). The gong and the piezo are events - a lost reply does not mean a lost chime - so they get
 * one attempt. A negative reply is never re-sent: the cluster heard it and said no.
 *
 * Ds2Link's gate does not queue; a second entrant is refused with GATE_HELD before anything is
 * sent. The only thing here that runs without a reader's click is the heartbeat, so a click that
 * lands during one waits for the gate instead of failing - safe to repeat, because a GATE_HELD
 * refusal means the bytes never left.
 *
 * Every approved telegram is logged with what came of it (`sent`): what was asked, next to what
 * happened (tsunagi-m-link section 15). The TEST report is built from that log, and the tests audit
 * the device's own trace against it.
 */

import {
  Ds2Error,
  Ds2Link,
  Ds2Status,
  buildDs2Frame,
  describeStatus,
  isDs2Error,
  type Ds2ByteTransport,
  type Ds2Frame,
  type Ds2Timings,
  type LinkTiming,
} from '@tsunagi/ds2-core';
import * as drives from './actuations';
import {
  decodeEeprom,
  decodeFaults,
  decodeIdent,
  decodeInputs,
  decodeOdometer,
  decodeVin,
  type Decoded,
  type Ident,
  type PortValue,
} from './decode';
import { EEPROM_MAX_WORDS, KOMBI_ADDRESS, type GaugeId, type KombiRequest, type KombiVariant } from './protocol';
import * as reads from './reads';
import {
  clusterHeldNeedles,
  mayRun,
  nextNeedleSpan,
  type GateContext,
  type GateRefusal,
  type NeedleSpan,
  type RequestClass,
  type RequestKind,
} from './runGate';
import { variantOf } from './variant';

/** Refused by mayRun. Nothing was sent. */
export class KombiGateError extends Error {
  constructor(
    readonly reason: GateRefusal,
    readonly kind: RequestKind | null,
    readonly request: KombiRequest,
  ) {
    super(`not sent: ${kind ?? 'a telegram not on the list'} refused by the gate (${reason})`);
    this.name = 'KombiGateError';
  }
}

export type SentOutcome =
  | { kind: 'pending' }
  | { kind: 'acknowledged' }
  /** The cluster answered with a negative status, recorded as its number. */
  | { kind: 'rejected'; status: number; description: string }
  /** No usable answer: the error's code, verbatim, and for a timeout where the line went quiet. */
  | { kind: 'failed'; code: string; message: string; silence?: LineSilence }
  /** The gate stayed held past the wait; the bytes never left. */
  | { kind: 'not-sent' };

/**
 * Where a telegram that timed out went quiet - carried as data (tsunagi-m-link section 6), because
 * the four need opposite checks and one READ_TIMEOUT hides which it was.
 *
 *   no-echo       not even our own telegram came back: the cable is not driving the K-line, so
 *                 nothing reached the cluster (the cable's power on OBD 16, its port, its mode)
 *   partial-echo  part of it came back: something pulled the line down while we sent
 *   no-answer     it went out and came back whole, and the cluster said nothing (the wire to it,
 *                 its pin, its supply)
 *   cut-short     the cluster began to answer and stopped
 */
export type LineSilence = 'no-echo' | 'partial-echo' | 'no-answer' | 'cut-short';

/** What one exchange got back, as the link reports it: the echo whole, and anything after it. */
export type LineSeen = { echoed: boolean; heardAfterEcho: boolean };

/**
 * The silence a timeout was, from what the exchange had seen. Null for anything that is not a
 * timeout - an echo that came back WRONG is ds2-core's ECHO_MISMATCH, which classifies itself.
 */
export function silenceOf(e: unknown, seen: LineSeen): LineSilence | null {
  if (!isDs2Error(e) || e.code !== 'READ_TIMEOUT') return null;
  const received = (e.detail as { received?: number } | undefined)?.received ?? 0;
  if (!seen.echoed) return received > 0 ? 'partial-echo' : 'no-echo';
  return seen.heardAfterEcho || received > 0 ? 'cut-short' : 'no-answer';
}

/**
 * Watches each exchange through ds2-core's timing hook. ds2-core is vendored and cannot be taught
 * to say which of its reads timed out; the hook already marks the one boundary that matters - the
 * echo read whole - and after it any byte, whether it arrived later or in the echo's own chunk, is
 * the cluster talking.
 */
class LineProbe implements LinkTiming {
  private seen: LineSeen = { echoed: false, heardAfterEcho: false };

  constructor(private readonly transport: Ds2ByteTransport) {}

  exchangeStart(): void {
    this.seen = { echoed: false, heardAfterEcho: false };
  }
  echoComplete(): void {
    this.seen = { echoed: true, heardAfterEcho: this.transport.bufferedLength() > 0 };
  }
  rx(): void {
    if (this.seen.echoed) this.seen = { ...this.seen, heardAfterEcho: true };
  }
  writeStart(): void {}
  writeEnd(): void {}
  parkStart(): void {}
  parkEnd(): void {}
  exchangeEnd(): void {}

  /** For the exchange that just failed. */
  silence(e: unknown): LineSilence | null {
    return silenceOf(e, this.seen);
  }
}

export type SentRecord = {
  kind: RequestKind;
  cls: RequestClass;
  /** The whole telegram as it goes on the wire, checksum included. */
  frame: Uint8Array;
  /** Wall-clock milliseconds, for the report. */
  at: number;
  outcome: SentOutcome;
};

export type Identity = {
  ident: Decoded<Ident>;
  variant: KombiVariant | null;
};

export type KombiLinkOptions = {
  timings?: Partial<Ds2Timings>;
};

/** How often a click that met a held gate looks again. */
const GATE_POLL_MS = 20;

export class KombiLink {
  private readonly ds2: Ds2Link;
  private readonly probe: LineProbe;
  private connected = false;
  private ctx: GateContext = { variant: null, benchConfirmed: false, needles: clusterHeldNeedles() };
  private identity: Identity | null = null;
  private readonly log: SentRecord[] = [];

  constructor(transport: Ds2ByteTransport, options: KombiLinkOptions = {}) {
    this.probe = new LineProbe(transport);
    this.ds2 = new Ds2Link(transport, { address: KOMBI_ADDRESS, timings: options.timings, timing: this.probe });
  }

  /** Where the last telegram went quiet, when it timed out: what a failed CONNECT tells the reader to check. */
  get lastSilence(): LineSilence | null {
    const outcome = this.log.at(-1)?.outcome;
    return outcome?.kind === 'failed' ? (outcome.silence ?? null) : null;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** An exchange is on the wire right now. */
  get isBusy(): boolean {
    return this.ds2.isBusy;
  }

  get variant(): KombiVariant | null {
    return this.ctx.variant;
  }

  get ident(): Identity | null {
    return this.identity;
  }

  get benchConfirmed(): boolean {
    return this.ctx.benchConfirmed;
  }

  /** The gate's view of this link, for a UI that has to say what the gate will say. */
  get gateContext(): GateContext {
    return this.ctx;
  }

  needleSpan(gauge: GaugeId): NeedleSpan {
    return this.ctx.needles[gauge];
  }

  /** Every telegram the gate approved, in the order it was handed to the wire, with what came of it. */
  get sent(): readonly SentRecord[] {
    return this.log;
  }

  /** The reader's statement that the cluster is out of the car. Drives wait for it. */
  setBenchConfirmed(on: boolean): void {
    this.ctx = { ...this.ctx, benchConfirmed: on };
  }

  /* ------------------------------- connection ------------------------------- */

  /**
   * Opens the port and asks the cluster who it is. A cluster that does not answer IDENT is not
   * connected: the port is closed again and the error is the caller's.
   */
  async connect(): Promise<Identity> {
    await this.ds2.connect();
    this.connected = true;
    try {
      return await this.identify();
    } catch (e) {
      this.connected = false;
      await this.ds2.disconnect().catch(() => {});
      throw e;
    }
  }

  /** IDENT, and the variant it names. Also the way to ask again after a reply that did not decode. */
  async identify(): Promise<Identity> {
    const frame = await this.send(reads.readIdent(), 3);
    const ident = decodeIdent(frame.payload);
    const variant = ident.ok ? variantOf(ident.value.diagIndex) : null;
    this.ctx = { ...this.ctx, variant };
    this.identity = { ident, variant };
    return this.identity;
  }

  /**
   * Ends the session, and with it every output this tool was holding: the cluster takes its
   * needles and lamps back. Best effort - true only when the cluster acknowledged it.
   *
   * Whether or not the reply came, no needle is where this tool left it for certain any more, so
   * every needle goes back to "held by the cluster" and the next move starts at the rest angle.
   */
  async stop(): Promise<boolean> {
    let ended = false;
    if (this.connected) {
      try {
        ended = (await this.send(reads.endSession(), 2)).controlOrStatus === Ds2Status.ACKNOWLEDGE;
      } catch {
        ended = false;
      }
    }
    this.ctx = { ...this.ctx, needles: clusterHeldNeedles() };
    return ended;
  }

  /** stop(), then close the port. The bench confirmation goes with the connection. */
  async disconnect(): Promise<void> {
    if (this.connected) await this.stop();
    this.connected = false;
    this.ctx = { variant: null, benchConfirmed: false, needles: clusterHeldNeedles() };
    await this.ds2.disconnect();
  }

  /**
   * Tester present, on the hook's timer. Never throws, never waits: when the gate is held the line
   * is busy anyway and the beat is skipped (tsunagi-m-link section 5). Nothing should branch on
   * the result.
   */
  async keepAlive(): Promise<boolean> {
    if (!this.connected || this.ds2.isBusy) return false;
    const req = reads.keepAlive();
    const verdict = mayRun(req, this.ctx);
    if (!verdict.ok) return false;
    const record = this.record(req, verdict.kind, verdict.cls);
    try {
      // No resync and no retry: a heartbeat that fails is simply a missed beat, and the next real
      // operation resyncs before it sends.
      const frame = await this.ds2.exchange(req.control, req.payload);
      record.outcome = outcomeOf(frame);
      return frame.controlOrStatus === Ds2Status.ACKNOWLEDGE;
    } catch (e) {
      record.outcome = failureOf(e, this.probe.silence(e));
      return false;
    }
  }

  /* ---------------------------------- reads --------------------------------- */

  async readVin(): Promise<Decoded<string>> {
    return decodeVin(this.positive(await this.send(reads.readVin(), 3), 'VIN read').payload);
  }

  async readOdometer(): Promise<Decoded<number>> {
    return decodeOdometer(this.positive(await this.send(reads.readOdometer(), 3), 'Odometer read').payload);
  }

  async readFaults(): Promise<Decoded<Uint8Array>> {
    return decodeFaults(this.positive(await this.send(reads.readFaults(), 3), 'Fault memory read').payload);
  }

  async readInputs(): Promise<Decoded<PortValue[]>> {
    const replies: Uint8Array[] = [];
    for (const req of reads.readInputs(this.buildVariant())) {
      replies.push(this.positive(await this.send(req, 3), 'Input read').payload);
    }
    // Refused before anything was sent while the variant is unknown, so the variant is known here.
    return decodeInputs(this.ctx.variant!, replies);
  }

  async readEeprom(word: number, count: number): Promise<Decoded<Uint8Array>> {
    const frame = this.positive(await this.send(reads.readEeprom(this.buildVariant(), word, count), 3), 'EEPROM read');
    return decodeEeprom(frame.payload, count);
  }

  /**
   * `count` words from `word`, as one byte array, read in the largest pieces the cluster takes.
   * Each piece is its own telegram and its own gate decision.
   */
  async readEepromWords(
    word: number,
    count: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Decoded<Uint8Array>> {
    const out = new Uint8Array(count * 2);
    for (let done = 0; done < count; ) {
      const n = Math.min(EEPROM_MAX_WORDS, count - done);
      const part = await this.readEeprom(word + done, n);
      if (!part.ok) return part;
      out.set(part.value, done * 2);
      done += n;
      onProgress?.(done, count);
    }
    return { ok: true, value: out };
  }

  /* --------------------------------- drives --------------------------------- */

  /**
   * Holds a needle at `degrees`, and keeps the gate's idea of where it is honest: acknowledged, it
   * is there; refused - by the gate or by the cluster - it has not moved; no answer, it may be at
   * either end, and the next move has to suit both.
   */
  async setNeedle(gauge: GaugeId, degrees: number): Promise<void> {
    const before = this.ctx.needles[gauge];
    let frame: Ds2Frame;
    try {
      frame = await this.send(drives.setNeedle(this.buildVariant(), gauge, degrees), 3);
    } catch (e) {
      if (mayHaveLanded(e)) this.moveNeedle(gauge, nextNeedleSpan(before, degrees, false));
      throw e;
    }
    if (frame.controlOrStatus === Ds2Status.ACKNOWLEDGE) this.moveNeedle(gauge, nextNeedleSpan(before, degrees, true));
    this.positive(frame, 'Needle');
  }

  private moveNeedle(gauge: GaugeId, span: NeedleSpan): void {
    this.ctx = { ...this.ctx, needles: { ...this.ctx.needles, [gauge]: span } };
  }

  async setLamps(bytes: readonly number[]): Promise<void> {
    this.positive(await this.send(drives.setLamps(this.buildVariant(), bytes), 3), 'Lamps');
  }

  /** One lamp on, every other lamp off. */
  async showLamp(byte: number, bit: number): Promise<void> {
    this.positive(await this.send(drives.oneLamp(this.buildVariant(), byte, bit), 3), 'Lamp');
  }

  async lampsOff(): Promise<void> {
    this.positive(await this.send(drives.lampsOff(this.buildVariant()), 3), 'Lamps off');
  }

  /** Indicators, high beam, rear fog - a KOMBI46 only. */
  async setOutputs(bits: number): Promise<void> {
    this.positive(await this.send(drives.setOutputs(bits), 3), 'Outputs');
  }

  async soundGong(): Promise<void> {
    this.positive(await this.send(drives.soundGong(), 1), 'Gong');
  }

  async soundPiezo(): Promise<void> {
    this.positive(await this.send(drives.soundPiezo(), 1), 'Piezo');
  }

  /* -------------------------------- the path -------------------------------- */

  /**
   * The variant a variant-shaped telegram is BUILT for. While IDENT has not named one, the
   * telegram is built for KOMBI46 only so there are bytes to ask about - and the gate, seeing no
   * variant in the context, refuses them before anything is sent. The link does not refuse on its
   * own: a second place deciding would be a second decider.
   */
  private buildVariant(): KombiVariant {
    return this.ctx.variant ?? 'KOMBI46';
  }

  private record(req: KombiRequest, kind: RequestKind, cls: RequestClass): SentRecord {
    const record: SentRecord = {
      kind,
      cls,
      frame: buildDs2Frame(KOMBI_ADDRESS, req.control, req.payload),
      at: Date.now(),
      outcome: { kind: 'pending' },
    };
    this.log.push(record);
    return record;
  }

  /**
   * The one way a telegram leaves: the gate, the log, then the wire. `attempts` is 1 for anything
   * that must not be sent twice.
   */
  private async send(req: KombiRequest, attempts: number): Promise<Ds2Frame> {
    if (!this.connected) {
      throw new Ds2Error('NOT_CONNECTED', 'The cluster link is not connected.', { kind: 'protocol' });
    }
    const verdict = mayRun(req, this.ctx);
    if (!verdict.ok) throw new KombiGateError(verdict.reason, verdict.kind, req);
    const record = this.record(req, verdict.kind, verdict.cls);
    try {
      const frame = await this.whenGateFree(() => this.ds2.exchangeWithRetry(req.control, req.payload, { attempts }));
      record.outcome = outcomeOf(frame);
      return frame;
    } catch (e) {
      // The retry throws its LAST attempt's error, and the probe has just watched that attempt.
      record.outcome = failureOf(e, this.probe.silence(e));
      throw e;
    }
  }

  /** Waits out a heartbeat. GATE_HELD is thrown before anything is sent, so trying again is safe. */
  private async whenGateFree<T>(fn: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + this.ds2.timings.responseTimeoutMs * 3;
    for (;;) {
      try {
        return await fn();
      } catch (e) {
        if (!(isDs2Error(e) && e.code === 'GATE_HELD') || Date.now() >= deadline) throw e;
        await new Promise((r) => setTimeout(r, GATE_POLL_MS));
      }
    }
  }

  /** A negative status is a fact about the cluster: raised, never retried. */
  private positive(frame: Ds2Frame, what: string): Ds2Frame {
    return this.ds2.assertPositive(frame, what);
  }
}

function outcomeOf(frame: Ds2Frame): SentOutcome {
  return frame.controlOrStatus === Ds2Status.ACKNOWLEDGE
    ? { kind: 'acknowledged' }
    : { kind: 'rejected', status: frame.controlOrStatus, description: describeStatus(frame.controlOrStatus) };
}

/** Whether bytes may have reached the cluster before this error: not when the gate or the link refused first. */
function mayHaveLanded(e: unknown): boolean {
  if (e instanceof KombiGateError) return false;
  return !(isDs2Error(e) && (e.code === 'GATE_HELD' || e.code === 'NOT_CONNECTED'));
}

function failureOf(e: unknown, silence: LineSilence | null = null): SentOutcome {
  if (isDs2Error(e) && e.code === 'GATE_HELD') return { kind: 'not-sent' };
  return {
    kind: 'failed',
    code: isDs2Error(e) ? e.code : e instanceof Error ? e.name : 'unknown',
    message: e instanceof Error ? e.message : String(e),
    ...(silence ? { silence } : {}),
  };
}
