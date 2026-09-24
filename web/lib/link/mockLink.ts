/**
 * PRACTICE mock link.
 *
 * Selected by an explicit opt-in, never as a silent fallback. It exists so the
 * whole workflow - including the destructive parts - can be rehearsed without
 * hardware, and so UI work does not need a cluster on the bench.
 *
 * It MODELS state rather than scripting it: the simulated chip really enforces
 * the increment-only rule and really keeps what you wrote, so reading twice
 * shows what the device would show.
 *
 * What it cannot rehearse: real serial failure modes, cable faults, or timing.
 * Its delays are fixed, so its speed says nothing about the real link.
 */

import { BridgeError, type M35080Link, type Progress } from './m35080Link';
import {
  Status,
  IMAGE_SIZE,
  PAGE_SIZE,
  MAX_READ_CHUNK,
  MAX_WRITE_CHUNK,
  PROTOCOL_VERSION,
  BRIDGE_MAGIC,
  assertWritableRange,
  assertSecureRegisterWrite,
  describeStatus,
  type BridgeInfo,
} from '@/lib/codec/bridgeProtocol';
import { delay, LinkError } from '@/lib/transport/webSerialTransport';
import { decodeStatus, STATUS_UV, STATUS_INC, type StatusBits } from '@/lib/domain/status';
import { slotsToBytes, encodeOdometer, SECURE_BYTES } from '@/lib/domain/odometer';
import { encodeVin } from '@/lib/domain/vin';
import { CODED_VIN_AT, encodeCodedVin, recomputeChecksums } from '@/lib/domain/layout';

/**
 * `used`   a donor chip with only the ASCII VIN field, and no layout the app can recognise
 * `late`   a late-layout chip: both checksums hold, a coded VIN at 0x07A AND an ASCII VIN at
 *          0x184 that disagree - the shape of the V6 chip on the bench, with made-up values -
 *          so PRACTICE shows both fields, DIFFER, and a VIN rewrite that recomputes 0x16E
 * `blank`  a new chip
 */
export type MockChipPreset = 'used' | 'late' | 'blank';

/**
 * What PRACTICE reads: one of the presets, a file the reader chose on READ (PRACTICE CHIP), or -
 * `coded` - the late preset made to fit a coding definition (lib/ncs/practice.ts, the
 * name is the definition's), so coding is rehearsed with nothing opened. In memory only, and a
 * copy: the simulated chip never writes back to what it was made from.
 */
export type PracticeChip = MockChipPreset | { name: string; image: Uint8Array; coded?: boolean };

/** Made-up, and deliberately different from MOCK_VIN: the two fields of one chip can disagree. */
export const MOCK_CODED_VIN = 'CD67890';

/**
 * Deterministic filler for the two checksummed regions. Practice data, not a test oracle: the
 * tests build their own late image and compute its checksums independently of layout.ts.
 */
function fillLateLayout(memory: Uint8Array): void {
  let x = 0x2468ace1;
  const next = () => {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return (x >>> 16) & 0xff;
  };
  for (let a = 0x020; a <= 0x16d; a++) memory[a] = next();
  for (let a = 0x310; a <= 0x3cc; a++) memory[a] = next();
  memory.set(encodeCodedVin(memory, MOCK_CODED_VIN), CODED_VIN_AT);
  memory.set(recomputeChecksums(memory).image);
}

/**
 * The bytes a practice chip starts with. Pure, so PRACTICE's cluster (lib/kombi/simulatedKombi.ts)
 * can be built around the same made-up chip the practice bridge reads.
 */
export function presetImage(preset: MockChipPreset): Uint8Array {
  const memory = new Uint8Array(IMAGE_SIZE);
  if (preset === 'blank') {
    memory.fill(0xff);
    memory.fill(0x00, 0, SECURE_BYTES); // virgin counter reads zero
    return memory;
  }
  memory.fill(preset === 'late' ? 0xff : 0x00);
  if (preset === 'late') fillLateLayout(memory);
  // A plausible donor cluster: 155,940 km and a VIN in the E46 location.
  memory.set(slotsToBytes(encodeOdometer(155_940)), 0);
  // The V6 layout, byte for byte: a VIN-shaped neighbour, seven VIN
  // characters, NUL. PRACTICE has to exercise the SCAN - including the
  // letter in front that is not part of the VIN - not a constant.
  memory[MOCK_VIN_OFFSET - 1] = MOCK_VIN_LEAD;
  memory.set(encodeVin(MOCK_VIN), MOCK_VIN_OFFSET);
  memory[MOCK_VIN_OFFSET + MOCK_VIN.length] = 0x00; // NUL terminator
  return memory;
}

/** A simulated M35080 with the behaviour that actually matters. */
class SimulatedChip {
  readonly memory: Uint8Array;
  private incFailed = false;
  private erased: boolean;

  constructor(preset: PracticeChip) {
    this.erased = preset === 'blank';
    if (typeof preset === 'string') this.memory = presetImage(preset);
    else if (preset.image.length === IMAGE_SIZE) this.memory = Uint8Array.from(preset.image);
    else throw new RangeError(`a practice chip is ${IMAGE_SIZE} bytes, not ${preset.image.length}`);
  }

  status(): number {
    let s = 0;
    if (this.erased) s |= STATUS_UV;
    if (this.incFailed) s |= STATUS_INC;
    return s;
  }

  read(address: number, length: number): Uint8Array {
    return this.memory.slice(address, address + length);
  }

  write(address: number, data: Uint8Array): void {
    if (address <= 0x1f) {
      throw new BridgeError(Status.ERR_RANGE, describeStatus(Status.ERR_RANGE));
    }
    if (Math.floor(address / PAGE_SIZE) !== Math.floor((address + data.length - 1) / PAGE_SIZE)) {
      throw new BridgeError(Status.ERR_RANGE, 'write crosses a page boundary');
    }
    this.memory.set(data, address);
    this.erased = false;
  }

  /** The whole point of the mock: the chip refuses a non-increasing value. */
  writeSecure(address: number, value: number): void {
    if (address > 0x1f || address % 2 !== 0) {
      throw new BridgeError(Status.ERR_RANGE, describeStatus(Status.ERR_RANGE));
    }
    const current = (this.memory[address] << 8) | this.memory[address + 1];
    if (value <= current) {
      this.incFailed = true;
      throw new BridgeError(Status.ERR_INC_REFUSED, describeStatus(Status.ERR_INC_REFUSED));
    }
    this.incFailed = false;
    this.memory[address] = (value >> 8) & 0xff;
    this.memory[address + 1] = value & 0xff;
    this.erased = false;
  }
}

const MOCK_INFO: BridgeInfo = {
  magic: BRIDGE_MAGIC,
  protocol: PROTOCOL_VERSION,
  firmware: 'mock',
  maxReadChunk: MAX_READ_CHUNK,
  maxWriteChunk: MAX_WRITE_CHUNK,
  pageSize: PAGE_SIZE,
  imageSize: IMAGE_SIZE,
};

/**
 * Where the mock puts its VIN.
 *
 * 0x184-0x18A, NUL at 0x18B, and 0x4C at 0x183 - the V6 chip on this bench,
 * byte for byte. The characters are a stand-in; the offsets and the byte in
 * front are real. The mock used to write an invented VIN to an invented
 * offset, and an export from that run was then read back as if it were
 * evidence for the offset. A mock that agrees with the code rather than with a
 * chip proves only that the code is self-consistent.
 */
export const MOCK_VIN_OFFSET = 0x184;
export const MOCK_VIN = 'AB12345';
/** The V6's 0x183: an uppercase `L` that is not part of the VIN. */
export const MOCK_VIN_LEAD = 0x4c;

export class MockM35080Link implements M35080Link {
  readonly kind = 'mock' as const;
  private chip: SimulatedChip;
  private open = false;
  private gateHeld = false;

  constructor(preset: PracticeChip = 'used') {
    this.chip = new SimulatedChip(preset);
  }

  /** Swap the simulated part, as if a different chip were seated. */
  setPreset(preset: PracticeChip): void {
    this.chip = new SimulatedChip(preset);
  }

  get connected(): boolean {
    return this.open;
  }

  getInfo(): BridgeInfo | null {
    return this.open ? MOCK_INFO : null;
  }

  private async withGate<T>(fn: () => Promise<T>): Promise<T> {
    if (this.gateHeld) throw new LinkError('Another device operation is already in progress');
    this.gateHeld = true;
    try {
      return await fn();
    } finally {
      this.gateHeld = false;
    }
  }

  private requireOpen(): void {
    if (!this.open) throw new LinkError('Not connected');
  }

  async connect(): Promise<BridgeInfo> {
    await delay(300);
    this.open = true;
    return MOCK_INFO;
  }

  async disconnect(): Promise<void> {
    this.open = false;
  }

  readStatus(): Promise<StatusBits> {
    return this.withGate(async () => {
      this.requireOpen();
      await delay(20);
      return decodeStatus(this.chip.status());
    });
  }

  identify(): Promise<{ status: StatusBits; secure: Uint8Array }> {
    return this.withGate(async () => {
      this.requireOpen();
      await delay(60);
      return {
        status: decodeStatus(this.chip.status()),
        secure: this.chip.read(0, SECURE_BYTES),
      };
    });
  }

  readImage(onProgress?: Progress): Promise<Uint8Array> {
    return this.withGate(async () => {
      this.requireOpen();
      const total = IMAGE_SIZE;
      const out = new Uint8Array(total);
      for (let done = 0; done < total; done += MAX_READ_CHUNK) {
        const n = Math.min(MAX_READ_CHUNK, total - done);
        await delay(25);
        out.set(this.chip.read(done, n), done);
        onProgress?.(done + n, total);
      }
      return out;
    });
  }

  private async writeBytesInner(
    address: number,
    data: Uint8Array,
    onProgress?: Progress,
  ): Promise<void> {
    // Same up-front guard as the real link: PRACTICE must rehearse the real
    // refusal, not a different one.
    assertWritableRange(address, data.length);
    let done = 0;
    while (done < data.length) {
      const addr = address + done;
      const toPageEnd = PAGE_SIZE - (addr % PAGE_SIZE);
      const n = Math.min(MAX_WRITE_CHUNK, toPageEnd, data.length - done);
      await delay(30);
      this.chip.write(addr, data.subarray(done, done + n));
      done += n;
      onProgress?.(done, data.length);
    }
  }

  writeBytes(address: number, data: Uint8Array, onProgress?: Progress): Promise<void> {
    return this.withGate(async () => {
      this.requireOpen();
      await this.writeBytesInner(address, data, onProgress);
    });
  }

  writeSecure(address: number, value: number): Promise<void> {
    return this.withGate(async () => {
      this.requireOpen();
      // The SAME guard the hardware path runs, so PRACTICE refuses an illegal
      // register write with the same words rather than a generic range error.
      assertSecureRegisterWrite(address, value);
      await delay(40);
      this.chip.writeSecure(address, value);
    });
  }

  writeAndVerify(address: number, data: Uint8Array, onProgress?: Progress): Promise<void> {
    return this.withGate(async () => {
      this.requireOpen();
      await this.writeBytesInner(address, data, onProgress);
      await delay(20);
      const back = this.chip.read(address, data.length);
      for (let i = 0; i < data.length; i++) {
        if (back[i] !== data[i]) {
          throw new BridgeError(
            Status.ERR_INC_REFUSED,
            `Verify failed at 0x${(address + i).toString(16).toUpperCase()}`,
          );
        }
      }
    });
  }
}
