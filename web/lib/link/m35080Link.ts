/**
 * The link: exchanges, retries, the command gate, and high-level chip
 * operations. Knows the codec and the transport; knows nothing about React.
 */

import {
  SOF,
  Cmd,
  Status,
  type CmdCode,
  type BridgeInfo,
  buildFrame,
  parseResponseHeader,
  verifyResponseCrc,
  parsePing,
  parseIdentify,
  readRequest,
  writeRequest,
  wrincRequest,
  splitWriteChunks,
  assertWritableRange,
  describeStatus,
  isRetriable,
  RESPONSE_HEADER_SIZE,
  IMAGE_SIZE,
  MAX_READ_CHUNK,
  MAX_WRITE_CHUNK,
  hex,
} from '@/lib/codec/bridgeProtocol';
import {
  LinkError,
  WebSerialTransport,
  delay,
  type SerialPortLike,
} from '@/lib/transport/webSerialTransport';
import { decodeStatus, type StatusBits } from '@/lib/domain/status';

/**
 * A failure the DEVICE reported after receiving our request. Semantically
 * distinct from a LinkError (which means the exchange never completed).
 * `retriable` decides whether re-sending the same bytes is honest.
 */
export class BridgeError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
  get retriable(): boolean {
    return isRetriable(this.status as never);
  }
}

/** The port opened, but the firmware handshake did not complete. */
export class BridgeConnectionError extends LinkError {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), cause);
    this.name = 'BridgeConnectionError';
  }
}

export type Progress = (done: number, total: number) => void;

export interface M35080Link {
  readonly kind: 'serial' | 'mock';
  readonly connected: boolean;
  getInfo(): BridgeInfo | null;
  connect(): Promise<BridgeInfo>;
  disconnect(): Promise<void>;
  readStatus(): Promise<StatusBits>;
  identify(): Promise<{ status: StatusBits; secure: Uint8Array }>;
  readImage(onProgress?: Progress): Promise<Uint8Array>;
  writeBytes(address: number, data: Uint8Array, onProgress?: Progress): Promise<void>;
  writeSecure(address: number, value: number): Promise<void>;
  /** Write, then read the same range back and compare. */
  writeAndVerify(address: number, data: Uint8Array, onProgress?: Progress): Promise<void>;
}

/**
 * Timing policy.
 *
 * The defaults ARE the shipping values. They are settable only so the offline
 * simulator suite can run in milliseconds instead of minutes; nothing in the
 * UI exposes them. A knob that invites a sweep is a knob that costs a trip to
 * the bench.
 */
export type LinkTiming = {
  exchangeTimeoutMs: number;
  writeTimeoutMs: number;
  attempts: number;
  backoffBaseMs: number;
  settleMs: number;
};

/**
 * How many stray bytes may be stepped over while hunting for SOF.
 *
 * Bounded by the largest frame a bridge can send, so exactly one stale or
 * truncated response can be skipped - while a line that is simply babbling
 * fails fast, with the bytes in hand, instead of spinning until the deadline.
 */
const MAX_RESYNC_SKIP = 256;

export const DEFAULT_TIMING: LinkTiming = {
  exchangeTimeoutMs: 1500,
  writeTimeoutMs: 3000,
  attempts: 3,
  backoffBaseMs: 150,
  settleMs: 30,
};

export class WebSerialM35080Link implements M35080Link {
  readonly kind = 'serial' as const;
  private transport = new WebSerialTransport();
  private info: BridgeInfo | null = null;
  private gateHeld = false;
  private readonly timing: LinkTiming;

  constructor(
    private readonly port: SerialPortLike,
    timing: Partial<LinkTiming> = {},
  ) {
    this.timing = { ...DEFAULT_TIMING, ...timing };
  }

  get connected(): boolean {
    return this.transport.connected && this.info !== null;
  }

  getInfo(): BridgeInfo | null {
    return this.info;
  }

  /* ----------------------------- the gate ------------------------------- */

  /**
   * One transport, one frame in flight. Every PUBLIC operation takes it; the
   * bodies live in private `...Inner` methods so internal composition (e.g.
   * writeAndVerify calling both write and read) cannot deadlock on its own gate.
   */
  private async withGate<T>(fn: () => Promise<T>): Promise<T> {
    if (this.gateHeld) {
      throw new LinkError('Another device operation is already in progress');
    }
    this.gateHeld = true;
    try {
      return await fn();
    } finally {
      this.gateHeld = false;
    }
  }

  /* ---------------------------- exchanges ------------------------------- */

  /**
   * Read a response header, stepping over stray bytes until SOF.
   *
   * docs/PROTOCOL.md: "the SOF byte exists so a desynced stream can be
   * re-hunted, and the CRC is what confirms the hunt landed." The FIRMWARE has
   * always done this (m35080_bridge.ino, loop()); the host did not, so a single
   * noise byte - which a USB-serial adapter routinely emits around the UNO's
   * DTR auto-reset - failed the whole connection with "expected SOF, got 0x00".
   *
   * This is NOT the mid-exchange purge that `exchangeOnce` deliberately avoids.
   * Nothing latched is cleared and no buffered reply is thrown away: bytes are
   * consumed one at a time only until a frame starts, and that frame is still
   * CRC-checked and command-matched. What was skipped is reported when the hunt
   * fails, so a genuinely wrong device stays diagnosable instead of being
   * silently tolerated.
   */
  private async readHeaderResync(timeoutMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs;
    const left = () => Math.max(1, deadline - Date.now());
    const skipped: number[] = [];

    for (;;) {
      const [b] = await this.transport.readExact(1, left());
      if (b === SOF) break;
      skipped.push(b);
      if (skipped.length > MAX_RESYNC_SKIP) {
        throw new LinkError(
          `out of frame: ${skipped.length} bytes with no SOF (0x7E). ` +
            `Saw ${hex(Uint8Array.from(skipped))} — is the bridge firmware running on this port?`,
        );
      }
    }

    const rest = await this.transport.readExact(RESPONSE_HEADER_SIZE - 1, left());
    const head = new Uint8Array(RESPONSE_HEADER_SIZE);
    head[0] = SOF;
    head.set(rest, 1);
    return head;
  }

  /**
   * ONE attempt. Deliberately does not resync: in a write sequence that would
   * silently clear a latch mid-operation and let a retry re-issue a
   * destructive command after what may have been a device reset. Retry policy
   * belongs to the wrapper, not the primitive.
   */
  private async exchangeOnce(
    frame: Uint8Array,
    expectCmd: CmdCode,
    timeoutMs: number,
  ): Promise<Uint8Array> {
    await this.transport.write(frame);

    const head = await this.readHeaderResync(timeoutMs);
    const header = parseResponseHeader(head); // validates SOF and the length
    const payload =
      header.length > 0 ? await this.transport.readExact(header.length, timeoutMs) : new Uint8Array(0);
    const crcBytes = await this.transport.readExact(2, timeoutMs);

    if (!verifyResponseCrc(head, payload, crcBytes)) {
      throw new LinkError(`Bad response checksum (header ${hex(head)})`);
    }
    if (header.cmd !== expectCmd) {
      throw new LinkError(
        `Out of step: asked for command 0x${expectCmd.toString(16)}, got 0x${header.cmd.toString(16)}`,
      );
    }
    if (header.status !== Status.OK) {
      throw new BridgeError(header.status, describeStatus(header.status));
    }
    this.transport.noteHealthy();
    return payload;
  }

  /**
   * Retry wrapper.
   *
   * Retries transport faults and the bridge statuses that mean "the exchange
   * did not land". A semantic refusal (INC_REFUSED, RANGE, LENGTH) throws
   * straight out - re-sending it would paper over a real refusal and report
   * success.
   */
  private async exchange(
    frame: Uint8Array,
    expectCmd: CmdCode,
    timeoutMs = this.timing.exchangeTimeoutMs,
  ): Promise<Uint8Array> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.timing.attempts; attempt++) {
      try {
        await this.transport.resync();
        await delay(this.timing.settleMs); // never transmit straight after a purge
        return await this.exchangeOnce(frame, expectCmd, timeoutMs);
      } catch (e) {
        if (e instanceof BridgeError && !e.retriable) throw e; // semantic: stop now
        lastError = e;
        // Skip the backoff after the final attempt - there is nothing left to
        // settle for, and paying it delays the user's error by up to a second.
        if (attempt < this.timing.attempts) await delay(this.timing.backoffBaseMs * attempt);
      }
    }
    // Leave the transport usable for whatever runs next, guarded so a failed
    // cleanup cannot overwrite the error we are about to report.
    try {
      await this.transport.resync();
    } catch {
      /* report the original failure, not the cleanup's */
    }
    throw lastError instanceof Error
      ? lastError
      : new LinkError(String(lastError ?? 'exchange failed'));
  }

  /* --------------------------- connection ------------------------------- */

  async connect(): Promise<BridgeInfo> {
    let handshakeStarted = false;
    try {
      await this.transport.open(this.port);
      handshakeStarted = true;
      const payload = await this.exchange(buildFrame(Cmd.PING), Cmd.PING);
      this.info = parsePing(payload);
      return this.info;
    } catch (error) {
      // The UI only retains a link after connect succeeds. Leaving its port
      // open here would orphan the reader and block every subsequent attempt.
      this.info = null;
      try {
        await this.transport.close();
      } catch {
        // Preserve the connection failure even if cleanup also fails.
      }
      if (handshakeStarted) throw new BridgeConnectionError(error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.info = null;
    await this.transport.close();
  }

  /* ------------------------- chip operations ---------------------------- */

  private async readStatusInner(): Promise<StatusBits> {
    const p = await this.exchange(buildFrame(Cmd.RDSR), Cmd.RDSR);
    if (p.length < 1) throw new LinkError('RDSR reply carried no status byte');
    return decodeStatus(p[0]);
  }

  readStatus(): Promise<StatusBits> {
    return this.withGate(() => this.readStatusInner());
  }

  identify(): Promise<{ status: StatusBits; secure: Uint8Array }> {
    return this.withGate(async () => {
      const p = await this.exchange(buildFrame(Cmd.IDENTIFY), Cmd.IDENTIFY);
      const r = parseIdentify(p);
      return { status: decodeStatus(r.status), secure: r.secure };
    });
  }

  private get readChunk(): number {
    return Math.min(this.info?.maxReadChunk ?? MAX_READ_CHUNK, MAX_READ_CHUNK);
  }

  private get writeChunk(): number {
    // The bridge publishes its own ceiling; we never exceed our own either.
    return Math.min(this.info?.maxWriteChunk ?? MAX_WRITE_CHUNK, MAX_WRITE_CHUNK);
  }

  private async readRangeInner(
    start: number,
    length: number,
    onProgress?: Progress,
  ): Promise<Uint8Array> {
    const out = new Uint8Array(length);
    let done = 0;
    while (done < length) {
      const n = Math.min(this.readChunk, length - done);
      const payload = await this.exchange(readRequest(start + done, n), Cmd.READ);
      if (payload.length !== n) {
        throw new LinkError(`Short read at 0x${(start + done).toString(16)}: wanted ${n}, got ${payload.length}`);
      }
      out.set(payload, done);
      done += n;
      onProgress?.(done, length);
    }
    return out;
  }

  readImage(onProgress?: Progress): Promise<Uint8Array> {
    return this.withGate(() =>
      this.readRangeInner(0, this.info?.imageSize ?? IMAGE_SIZE, onProgress),
    );
  }

  private async writeBytesInner(
    address: number,
    data: Uint8Array,
    onProgress?: Progress,
  ): Promise<void> {
    // The whole range, checked before the first chunk is sent.
    assertWritableRange(address, data.length);
    const chunks = splitWriteChunks(address, data, this.writeChunk);
    let done = 0;
    for (const chunk of chunks) {
      await this.exchange(
        writeRequest(chunk.address, chunk.data),
        Cmd.WRITE,
        this.timing.writeTimeoutMs,
      );
      done += chunk.data.length;
      onProgress?.(done, data.length);
    }
  }

  writeBytes(address: number, data: Uint8Array, onProgress?: Progress): Promise<void> {
    return this.withGate(() => this.writeBytesInner(address, data, onProgress));
  }

  writeSecure(address: number, value: number): Promise<void> {
    return this.withGate(async () => {
      await this.exchange(wrincRequest(address, value), Cmd.WRINC, this.timing.writeTimeoutMs);
    });
  }

  /**
   * Write then read back and compare.
   *
   * The comparison runs ONCE, outside the retry, on data that round-tripped.
   * A mismatch means the chip took the bytes and did not store them - that is
   * a semantic failure and must never be retried into a false success.
   */
  writeAndVerify(address: number, data: Uint8Array, onProgress?: Progress): Promise<void> {
    return this.withGate(async () => {
      await this.writeBytesInner(address, data, onProgress);
      // A settle before verifying: a premature read does not fail, it succeeds
      // and returns the OLD values, so there is nothing to poll for.
      await delay(20);
      const back = await this.readRangeInner(address, data.length);
      for (let i = 0; i < data.length; i++) {
        if (back[i] !== data[i]) {
          throw new BridgeError(
            Status.ERR_INC_REFUSED,
            `Verify failed at 0x${(address + i).toString(16).toUpperCase()}: wrote 0x${data[i]
              .toString(16)
              .padStart(2, '0')}, read back 0x${back[i].toString(16).padStart(2, '0')}`,
          );
        }
      }
    });
  }
}
