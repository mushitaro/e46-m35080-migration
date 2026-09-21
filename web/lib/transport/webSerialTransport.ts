/**
 * Web Serial transport: owns the port, a read buffer, and `readExact`.
 *
 * It must not know the protocol - no frames, no CRC, no commands. Those live
 * in the codec (datalog-link.md -> Layering).
 */

export class LinkError extends Error {
  constructor(
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'LinkError';
  }
}

export interface Transport {
  readonly connected: boolean;
  write(data: Uint8Array): Promise<void>;
  /** Resolve as soon as `length` bytes have arrived, or throw at the deadline. */
  readExact(length: number, timeoutMs: number): Promise<Uint8Array>;
  /** Drop buffered bytes. Cannot clear a latched pump error - see `resync`. */
  purge(): void;
  /** Read the latched pump error WITHOUT consuming it, for diagnostics. */
  peekReadError(): Error | null;
  /** Recover a latched reader if there is one, else just purge. */
  resync(): Promise<void>;
  close(): Promise<void>;
}

/* ---- Minimal Web Serial typings (not in lib.dom across TS versions) ------ */

interface SerialOptions {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
  flowControl?: 'none' | 'hardware';
}
interface SerialSignals {
  dataTerminalReady?: boolean;
  requestToSend?: boolean;
}
export interface SerialPortLike {
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  setSignals?(signals: SerialSignals): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}
interface SerialLike {
  requestPort(options?: { filters?: unknown[] }): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

export function getSerial(): SerialLike | null {
  const nav = globalThis.navigator as unknown as { serial?: SerialLike } | undefined;
  return nav?.serial ?? null;
}

export function isWebSerialSupported(): boolean {
  return getSerial() !== null;
}

/** requestPort() is Window-only and must run inside a user gesture. */
export async function requestPort(): Promise<SerialPortLike> {
  const serial = getSerial();
  if (!serial) {
    throw new LinkError(
      'This browser has no Web Serial API. Use Chrome or Edge on desktop, over HTTPS or localhost.',
    );
  }
  return serial.requestPort();
}

export const BAUD_RATE = 115200;

/**
 * An Arduino UNO auto-resets when the port opens (DTR), then sits in its
 * bootloader before the sketch runs. This is one of the few places a FIXED
 * wait is correct: there is nothing to poll for, because the board is not
 * listening yet and a premature frame is simply lost.
 */
export const BOOTLOADER_SETTLE_MS = 2000;

/** Escalating silences given to a latched line before giving up. */
const RECOVERY_SILENCES_MS = [400, 800, 1200];

export class WebSerialTransport implements Transport {
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private buffer: number[] = [];
  /** Latches on the first pump failure; the loop then exits permanently. */
  private pumpError: Error | null = null;
  private recoveryRound = 0;

  get connected(): boolean {
    return this.port !== null;
  }

  async open(port: SerialPortLike): Promise<void> {
    await port.open({ baudRate: BAUD_RATE, dataBits: 8, stopBits: 1, parity: 'none' });
    this.port = port;
    // Match what native tools do. Best-effort: an adapter that rejects this
    // must not fail the connection.
    try {
      await port.setSignals?.({ dataTerminalReady: false, requestToSend: false });
    } catch {
      /* adapter does not support control lines */
    }
    this.startPump();
    await delay(BOOTLOADER_SETTLE_MS);
    this.purge(); // discard anything the bootloader emitted
  }

  private startPump(): void {
    const readable = this.port?.readable;
    if (!readable) {
      this.pumpError = new Error('port has no readable stream');
      return;
    }
    this.pumpError = null;
    const reader = readable.getReader();
    this.reader = reader;
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) for (const b of value) this.buffer.push(b);
        }
      } catch (e) {
        // Latch. The loop cannot self-heal; cycling a fresh reader immediately
        // just re-latches the same fault, so recovery is explicit.
        this.pumpError = e instanceof Error ? e : new Error(String(e));
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* already released */
        }
      }
    })();
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.port?.writable) throw new LinkError('port is not open for writing');
    if (!this.writer) this.writer = this.port.writable.getWriter();
    await this.writer.write(data);
  }

  async readExact(length: number, timeoutMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs;
    while (this.buffer.length < length) {
      if (this.pumpError) {
        throw new LinkError(`Serial read failed: ${this.pumpError.message}`, this.pumpError);
      }
      if (Date.now() >= deadline) {
        throw new LinkError(
          `Timed out waiting for ${length} byte(s) from the bridge (got ${this.buffer.length})`,
        );
      }
      // Poll granularity - how often we LOOK, not how long we wait. This
      // returns the instant the bytes land.
      await delay(2);
    }
    // splice, not "clear": surplus bytes are retained so two replies arriving
    // in one chunk can never desync us.
    return Uint8Array.from(this.buffer.splice(0, length));
  }

  purge(): void {
    this.buffer.length = 0;
  }

  peekReadError(): Error | null {
    return this.pumpError;
  }

  /**
   * The single recovery helper. Every recovery site calls THIS - a bare purge
   * cannot clear a latch, and one site that forgets poisons the whole session.
   */
  async resync(): Promise<void> {
    this.purge();
    if (!this.pumpError) return;

    const silence = RECOVERY_SILENCES_MS[Math.min(this.recoveryRound, RECOVERY_SILENCES_MS.length - 1)];
    this.recoveryRound++;
    if (this.recoveryRound > RECOVERY_SILENCES_MS.length) {
      throw new LinkError(
        `Serial link did not recover after ${RECOVERY_SILENCES_MS.length} attempts: ${this.pumpError.message}`,
        this.pumpError,
      );
    }
    // Give the line real silence before asking for a fresh reader.
    await delay(silence);
    try {
      this.reader?.releaseLock();
    } catch {
      /* not held */
    }
    this.reader = null;
    this.startPump();
    this.purge();
  }

  /** Called after a clean exchange: the line is healthy again. */
  noteHealthy(): void {
    this.recoveryRound = 0;
  }

  async close(): Promise<void> {
    try {
      await this.reader?.cancel();
    } catch {
      /* already gone */
    }
    try {
      this.reader?.releaseLock();
    } catch {
      /* not held */
    }
    try {
      await this.writer?.close();
    } catch {
      /* already gone */
    }
    try {
      this.writer?.releaseLock();
    } catch {
      /* not held */
    }
    try {
      await this.port?.close();
    } catch {
      /* already gone */
    }
    this.reader = null;
    this.writer = null;
    this.port = null;
    this.purge();
    this.pumpError = null;
    this.recoveryRound = 0;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
