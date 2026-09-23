/**
 * A simulated M35080 + bridge, and a scripted transport to reach it.
 *
 * This is NOT a mock of our own link - it is a stand-in for the DEVICE, so the
 * real `WebSerialM35080Link` (real codec, real retry policy, real gate) is what
 * gets exercised. That is the only way to test a destructive path
 * (link-measurement-and-safety.md -> "Prove it against a simulator").
 *
 * The simulator mirrors `firmware/m35080_bridge/m35080_bridge.ino`: same frame
 * layout, same guards, same status codes. If the two drift, the tests stop
 * meaning anything, so keep them in step.
 */

import {
  SOF,
  Cmd,
  Status,
  crc16,
  PAGE_SIZE,
  MAX_READ_CHUNK,
  MAX_WRITE_CHUNK,
  MAX_PAYLOAD,
  IMAGE_SIZE,
  BRIDGE_MAGIC,
  PROTOCOL_VERSION,
} from '@/lib/codec/bridgeProtocol';
import { STATUS_UV, STATUS_INC } from '@/lib/domain/status';
import { slotsToBytes, encodeOdometer, SECURE_BYTES } from '@/lib/domain/odometer';
import { encodeVin } from '@/lib/domain/vin';

const SECURE_END = 0x1f;

export class M35080Simulator {
  readonly memory = new Uint8Array(IMAGE_SIZE);
  private incFailed = false;
  private erased: boolean;
  /** Set to make the chip accept a write but not store it (verify-failure). */
  swallowWrites = false;

  constructor(opts: { blank?: boolean; km?: number; vin?: string; image?: Uint8Array } = {}) {
    this.erased = opts.blank ?? false;
    if (opts.image) {
      // A whole image, as built by test/support/lateImage.ts - never a real chip's.
      this.memory.set(opts.image);
    } else if (opts.blank) {
      this.memory.fill(0xff);
      this.memory.fill(0x00, 0, SECURE_BYTES); // virgin counter is zero
    } else {
      this.memory.fill(0x00);
      this.memory.set(slotsToBytes(encodeOdometer(opts.km ?? 155_940)), 0);
      this.memory[0x183] = 0x4c; // the V6's non-VIN byte in front
      this.memory.set(encodeVin(opts.vin ?? 'AB12345'), 0x184);
    }
  }

  status(): number {
    return (this.erased ? STATUS_UV : 0) | (this.incFailed ? STATUS_INC : 0);
  }

  /** Dispatch one decoded request. Mirrors the firmware's command handlers. */
  private handle(cmd: number, payload: Uint8Array): { status: number; payload: Uint8Array } {
    const u16 = (i: number) => payload[i] | (payload[i + 1] << 8);

    switch (cmd) {
      case Cmd.PING: {
        const p = new Uint8Array(19);
        p.set(Uint8Array.from(Array.from(BRIDGE_MAGIC, (c) => c.charCodeAt(0))), 0);
        p[8] = PROTOCOL_VERSION;
        p[9] = 1;
        p[10] = 0;
        const put = (i: number, v: number) => {
          p[i] = v & 0xff;
          p[i + 1] = (v >> 8) & 0xff;
        };
        put(11, MAX_READ_CHUNK);
        put(13, MAX_WRITE_CHUNK);
        put(15, PAGE_SIZE);
        put(17, IMAGE_SIZE);
        return { status: Status.OK, payload: p };
      }

      case Cmd.RDSR:
        return { status: Status.OK, payload: Uint8Array.from([this.status()]) };

      case Cmd.IDENTIFY: {
        const p = new Uint8Array(33);
        p[0] = this.status();
        p.set(this.memory.subarray(0, SECURE_BYTES), 1);
        return { status: Status.OK, payload: p };
      }

      case Cmd.READ: {
        if (payload.length !== 4) return { status: Status.ERR_LENGTH, payload: new Uint8Array(0) };
        const address = u16(0);
        const count = u16(2);
        if (count === 0 || count > MAX_READ_CHUNK || address + count > IMAGE_SIZE) {
          return { status: Status.ERR_RANGE, payload: new Uint8Array(0) };
        }
        return { status: Status.OK, payload: this.memory.slice(address, address + count) };
      }

      case Cmd.WRITE: {
        if (payload.length < 3) return { status: Status.ERR_LENGTH, payload: new Uint8Array(0) };
        const address = u16(0);
        const data = payload.subarray(2);
        if (data.length > MAX_WRITE_CHUNK) {
          return { status: Status.ERR_LENGTH, payload: new Uint8Array(0) };
        }
        if (address + data.length > IMAGE_SIZE) {
          return { status: Status.ERR_RANGE, payload: new Uint8Array(0) };
        }
        if (address <= SECURE_END) {
          return { status: Status.ERR_RANGE, payload: new Uint8Array(0) };
        }
        if (
          Math.floor(address / PAGE_SIZE) !==
          Math.floor((address + data.length - 1) / PAGE_SIZE)
        ) {
          return { status: Status.ERR_RANGE, payload: new Uint8Array(0) };
        }
        if (!this.swallowWrites) this.memory.set(data, address);
        this.erased = false;
        return { status: Status.OK, payload: Uint8Array.from([this.status()]) };
      }

      case Cmd.WRINC: {
        if (payload.length !== 4) return { status: Status.ERR_LENGTH, payload: new Uint8Array(0) };
        const address = u16(0);
        const value = u16(2);
        if (address > SECURE_END || address % 2 !== 0) {
          return { status: Status.ERR_RANGE, payload: new Uint8Array(0) };
        }
        const current = (this.memory[address] << 8) | this.memory[address + 1];
        // THE hardware rule: a value that does not increase is refused.
        if (value <= current) {
          this.incFailed = true;
          return { status: Status.ERR_INC_REFUSED, payload: Uint8Array.from([this.status()]) };
        }
        this.incFailed = false;
        this.memory[address] = (value >> 8) & 0xff;
        this.memory[address + 1] = value & 0xff;
        this.erased = false;
        return { status: Status.OK, payload: Uint8Array.from([this.status()]) };
      }

      case Cmd.WREN:
      case Cmd.WRDI:
        return { status: Status.OK, payload: Uint8Array.from([this.status()]) };

      default:
        return { status: Status.ERR_UNKNOWN_CMD, payload: new Uint8Array(0) };
    }
  }

  /** Parse a request frame and produce the response frame, as the bridge does. */
  respond(frame: Uint8Array): Uint8Array {
    if (frame[0] !== SOF) throw new Error('simulator got a frame without SOF');
    const cmd = frame[1];
    const len = frame[2] | (frame[3] << 8);
    if (len > MAX_PAYLOAD) return this.buildResponse(cmd, Status.ERR_LENGTH, new Uint8Array(0));
    const payload = frame.subarray(4, 4 + len);
    const crcGot = frame[4 + len] | (frame[5 + len] << 8);
    if (crc16(frame.subarray(1, 4 + len)) !== crcGot) {
      return this.buildResponse(cmd, Status.ERR_CRC, new Uint8Array(0));
    }
    const r = this.handle(cmd, payload);
    return this.buildResponse(cmd, r.status, r.payload);
  }

  private buildResponse(cmd: number, status: number, payload: Uint8Array): Uint8Array {
    const body = new Uint8Array(4 + payload.length);
    body[0] = cmd;
    body[1] = status;
    body[2] = payload.length & 0xff;
    body[3] = (payload.length >> 8) & 0xff;
    body.set(payload, 4);
    const c = crc16(body);
    const frame = new Uint8Array(1 + body.length + 2);
    frame[0] = SOF;
    frame.set(body, 1);
    frame[frame.length - 2] = c & 0xff;
    frame[frame.length - 1] = (c >> 8) & 0xff;
    return frame;
  }
}

export type Fault =
  | { kind: 'timeout' }
  | { kind: 'badcrc' }
  | { kind: 'truncate'; keep: number }
  /** Stray bytes BEFORE an otherwise valid reply: a desynced line, not a broken one. */
  | { kind: 'prefix'; bytes: number[] };

/**
 * Stands in for WebSerialTransport. Records a telegram trace so tests can
 * assert on the SEQUENCE and the COUNT of exchanges - which is what proves the
 * write path used the write-chunk constant and not the read one.
 */
export class ScriptedTransport {
  readonly trace: { cmd: number; payload: Uint8Array }[] = [];
  connected = true;
  private rx: number[] = [];
  private faults: Fault[] = [];

  constructor(private readonly sim: M35080Simulator) {}

  /** Queue a fault to be applied to the NEXT exchange, then the one after, ... */
  queueFault(...faults: Fault[]): void {
    this.faults.push(...faults);
  }

  async open(): Promise<void> {
    /* no port to open */
  }
  noteHealthy(): void {
    /* nothing to reset */
  }

  async write(data: Uint8Array): Promise<void> {
    const len = data[2] | (data[3] << 8);
    this.trace.push({ cmd: data[1], payload: data.slice(4, 4 + len) });

    const fault = this.faults.shift();
    if (fault?.kind === 'timeout') return; // device says nothing at all

    let response = this.sim.respond(data);
    if (fault?.kind === 'badcrc') {
      response = response.slice();
      response[response.length - 1] ^= 0xff;
    } else if (fault?.kind === 'truncate') {
      response = response.slice(0, fault.keep);
    } else if (fault?.kind === 'prefix') {
      // Noise AHEAD of a good frame - what the line carries around a DTR reset.
      for (const b of fault.bytes) this.rx.push(b);
    }
    for (const b of response) this.rx.push(b);
  }

  async readExact(length: number, timeoutMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs;
    while (this.rx.length < length) {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ${length} byte(s) (got ${this.rx.length})`);
      }
      await new Promise((r) => setTimeout(r, 1));
    }
    return Uint8Array.from(this.rx.splice(0, length));
  }

  purge(): void {
    this.rx.length = 0;
  }
  peekReadError(): Error | null {
    return null;
  }
  async resync(): Promise<void> {
    this.purge();
  }
  async close(): Promise<void> {
    this.connected = false;
  }

  /** Commands seen, in order - the telegram trace. */
  cmds(): number[] {
    return this.trace.map((t) => t.cmd);
  }
  countOf(cmd: number): number {
    return this.trace.filter((t) => t.cmd === cmd).length;
  }
  clearTrace(): void {
    this.trace.length = 0;
  }
}

/** Fast timings so the suite runs in milliseconds. */
export const TEST_TIMING = {
  exchangeTimeoutMs: 60,
  writeTimeoutMs: 60,
  attempts: 3,
  backoffBaseMs: 5,
  settleMs: 1,
};
