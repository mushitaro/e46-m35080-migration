/**
 * A cluster that answers DS2, for PRACTICE and for the tests.
 *
 * It is the DEVICE that is simulated, not the link (tsunagi-m-link section 24): the real
 * WebSerialTransport and Ds2Link run against it through ds2-core's simulated port, so the echo,
 * the framing and the retries are the ones a real cable gets. And it keeps STATE rather than a
 * script - a needle it was told to hold stays there until the session ends, a lamp stays lit until
 * the next lamp telegram - so what the reader sees in PRACTICE is what the tool did.
 *
 * Its content comes from a chip image, the way a real cluster's comes from its chip: the EEPROM
 * read answers from the image (under the word mapping this tool assumes), the VIN from the coded
 * field at 0x07A, the odometer from the counter at 0x000. Where a real cluster's behaviour is not
 * known - what it answers to a telegram it does not have - this one says PARAMETER ERROR, and says
 * so here rather than pretending to know.
 *
 * What it cannot rehearse: the K-line's electrical faults, the cable, timing.
 */

import { Ds2Status, simulatedPort, type Ds2Frame, type ExchangeBehavior } from '@tsunagi/ds2-core';
import { CODED_VIN_AT, CODED_VIN_BYTES } from '@/lib/domain/layout';
import { decodeOdometer, SECURE_BYTES } from '@/lib/domain/odometer';
import {
  AIF_ODOMETER,
  AIF_VIN,
  Drive,
  EEPROM_WORD_LIMIT,
  FAULTS_ALL,
  GAUGE_IDS,
  INPUT_PORTS,
  INPUT_PORTS_46,
  INPUT_PORTS_46R,
  KOMBI_ADDRESS,
  KombiControl,
  LAMP_MASKS,
  NEEDLE_SCALE,
  OUTPUT_PORT,
  SEGMENT_EEPROM,
  gaugeOf,
  wordToByteAddress,
  type GaugeId,
  type KombiVariant,
} from './protocol';
import { VARIANT_RANGES } from './variant';

export type SimulatedKombiOptions = {
  variant: KombiVariant;
  /** The chip inside it: 1024 bytes, the image the reads answer from. */
  chip: Uint8Array;
  /** IDENT's diagnosis index. Defaults to the bottom of the variant's range. */
  diagIndex?: number;
  /** The raw fault-memory reply. Defaults to none. */
  faults?: Uint8Array;
  /** Input port values by port number. Ports not given read 0. */
  inputs?: Readonly<Record<number, number>>;
};

/** Everything it was made to do, in order - what a test asserts on, besides the telegram trace. */
export type KombiEvent =
  | { kind: 'needle'; gauge: GaugeId; degrees: number }
  | { kind: 'lamps'; bytes: number[] }
  | { kind: 'outputs'; bits: number }
  | { kind: 'gong' }
  | { kind: 'piezo' }
  | { kind: 'session-ended' }
  | { kind: 'not-implemented'; control: number; payload: number[] };

type Reply = { status?: number; payload?: Uint8Array } | null;

const ACK: Reply = null;
const NOT_IMPLEMENTED: Reply = { status: Ds2Status.PARAMETER_ERROR };

/** Made-up IDENT fields: plainly not a real part. */
const IDENT_PART = [0x06, 0x99, 0x99, 0x99];

export class SimulatedKombi {
  readonly variant: KombiVariant;
  readonly events: KombiEvent[] = [];
  /** What each needle shows: a held angle, or null while the cluster shows its own input. */
  readonly needles: Record<GaugeId, number | null>;
  /** The lamp bytes being held, or null while the cluster drives its own lamps. */
  lamps: number[] | null = null;
  outputs: number | null = null;
  private readonly chip: Uint8Array;
  private readonly diagIndex: number;
  private readonly faults: Uint8Array;
  private readonly inputs: Readonly<Record<number, number>>;

  constructor(options: SimulatedKombiOptions) {
    this.variant = options.variant;
    this.chip = Uint8Array.from(options.chip);
    this.diagIndex = options.diagIndex ?? VARIANT_RANGES.find((r) => r.variant === options.variant)!.lo;
    this.faults = options.faults ?? new Uint8Array(0);
    this.inputs = options.inputs ?? {};
    this.needles = Object.fromEntries(GAUGE_IDS.map((id) => [id, null])) as Record<GaugeId, number | null>;
  }

  /** The answer to one request. Passed to ds2-core's simulated device as its `respond`. */
  readonly respond = (req: Ds2Frame): Reply => {
    const p = req.payload;
    switch (req.controlOrStatus) {
      case KombiControl.KEEP_ALIVE:
        return ACK;
      case KombiControl.END_SESSION:
        this.release();
        return ACK;
      case KombiControl.IDENT:
        return p.length === 0 ? { payload: this.identPayload() } : this.notImplemented(req);
      case KombiControl.READ_AIF:
        if (p.length === 1 && p[0] === AIF_VIN) return { payload: this.vinPayload() };
        if (p.length === 1 && p[0] === AIF_ODOMETER) return { payload: this.odometerPayload() };
        return this.notImplemented(req);
      case KombiControl.READ_FAULTS:
        return p.length === 1 && p[0] === FAULTS_ALL ? { payload: this.faults } : this.notImplemented(req);
      case KombiControl.READ_INPUTS:
        return this.readInputs(req);
      case KombiControl.READ_MEMORY:
        return this.readEeprom(req);
      case KombiControl.DRIVE:
        return this.drive(req);
      default:
        return this.notImplemented(req);
    }
  };

  private notImplemented(req: Ds2Frame): Reply {
    this.events.push({ kind: 'not-implemented', control: req.controlOrStatus, payload: Array.from(req.payload) });
    return NOT_IMPLEMENTED;
  }

  /** Session over: the cluster takes back everything it was holding. */
  private release(): void {
    for (const id of GAUGE_IDS) this.needles[id] = null;
    this.lamps = null;
    this.outputs = null;
    this.events.push({ kind: 'session-ended' });
  }

  private identPayload(): Uint8Array {
    // part number (4 BCD), hardware, coding index, diagnosis index, bus index, week, year,
    // supplier, software, CAN index, change index
    return Uint8Array.from([...IDENT_PART, 0x01, 0x05, this.diagIndex, 0x01, 0x12, 0x01, 0x00, 0x10, 0x00, 0x00]);
  }

  /** Byte 0 is not read by the SGBD; then the five bytes of the coded field, whatever they hold. */
  private vinPayload(): Uint8Array {
    return Uint8Array.from([0x00, ...this.chip.subarray(CODED_VIN_AT, CODED_VIN_AT + CODED_VIN_BYTES)]);
  }

  private odometerPayload(): Uint8Array {
    const odo = decodeOdometer(this.chip.subarray(0, SECURE_BYTES));
    const km = odo.ok ? Math.min(odo.km, 999_999) : 0;
    const digits = km.toString().padStart(6, '0');
    const bcd = [0, 2, 4].map((i) => (Number(digits[i]) << 4) | Number(digits[i + 1]));
    return Uint8Array.from([0x00, ...bcd]);
  }

  private readInputs(req: Ds2Frame): Reply {
    const p = req.payload;
    if (p[0] !== INPUT_PORTS) return this.notImplemented(req);
    if (this.variant !== 'KOMBI46R') {
      const all = INPUT_PORTS_46.every((port, i) => p[1 + i] === port) && p.length === 1 + INPUT_PORTS_46.length;
      return all ? { payload: Uint8Array.from(INPUT_PORTS_46.map((port) => this.inputs[port] ?? 0)) } : this.notImplemented(req);
    }
    const port = p[1] ?? -1;
    const known = p.length === 3 && (INPUT_PORTS_46R as readonly number[]).includes(port);
    return known ? { payload: Uint8Array.from([this.inputs[port] ?? 0]) } : this.notImplemented(req);
  }

  private readEeprom(req: Ds2Frame): Reply {
    const p = req.payload;
    if (p.length !== 5 || p[0] !== SEGMENT_EEPROM) return this.notImplemented(req);
    const word = this.variant !== 'KOMBI46R' ? (p[3] ?? 0) : (((p[2] ?? 0) << 8) | (p[3] ?? 0));
    const count = p[4] ?? 0;
    const from = wordToByteAddress(word);
    const to = wordToByteAddress(word + count);
    if (count < 1 || word + count > EEPROM_WORD_LIMIT[this.variant] || to > this.chip.length) {
      return this.notImplemented(req);
    }
    return { payload: this.chip.slice(from, to) };
  }

  private drive(req: Ds2Frame): Reply {
    const p = req.payload;
    const sub = p[0];
    const gauge = gaugeOf(sub ?? -1);
    if (gauge && p.length === 3) {
      const degrees = (((p[1] ?? 0) << 8) | (p[2] ?? 0)) / NEEDLE_SCALE[this.variant];
      this.needles[gauge] = degrees;
      this.events.push({ kind: 'needle', gauge, degrees });
      return ACK;
    }
    if (sub === Drive.LAMPS) {
      const n = LAMP_MASKS[this.variant].length;
      const bytes = this.variant !== 'KOMBI46R' ? p.slice(1) : p[1] === 0x00 ? p.slice(2) : null;
      if (!bytes || bytes.length !== n) return this.notImplemented(req);
      this.lamps = Array.from(bytes);
      this.events.push({ kind: 'lamps', bytes: Array.from(bytes) });
      return ACK;
    }
    if (sub === Drive.PORT && this.variant === 'KOMBI46' && p.length === 3 && p[1] === OUTPUT_PORT) {
      this.outputs = p[2] ?? 0;
      this.events.push({ kind: 'outputs', bits: this.outputs });
      return ACK;
    }
    if (sub === Drive.GONG && p.length === 1) {
      this.events.push({ kind: 'gong' });
      return ACK;
    }
    if (sub === Drive.PIEZO && p.length === 1) {
      this.events.push({ kind: 'piezo' });
      return ACK;
    }
    return this.notImplemented(req);
  }
}

/** A simulated cluster behind a simulated serial port, ready for a WebSerialTransport. */
export function simulatedKombiPort(options: SimulatedKombiOptions, script: ExchangeBehavior[] = []) {
  const kombi = new SimulatedKombi(options);
  const { port, requestPort } = simulatedPort({ address: KOMBI_ADDRESS, script, respond: kombi.respond });
  return { kombi, port, requestPort };
}

/* -------------------------------- PRACTICE -------------------------------- */

/**
 * The word PRACTICE's cluster holds differently from the chip image it was given - outside the
 * odometer, the VIN fields and both checksummed regions, and inside what both variants can read.
 * A cluster writes its own EEPROM while it runs, so a read-back that differs somewhere is a real
 * outcome, and PRACTICE should show what it looks like.
 */
export const PRACTICE_DIFFERING_WORD = 0x18;

/**
 * PRACTICE's cluster, from the practice chip: the same content, one word different. Its VIN reply
 * is the chip's coded field, so a practice run shows EQUAL against that field and DIFFERENT
 * against the ASCII one - both outcomes, from one made-up chip.
 */
export function practiceKombiOptions(variant: KombiVariant, chip: Uint8Array): SimulatedKombiOptions {
  const changed = Uint8Array.from(chip);
  const at = wordToByteAddress(PRACTICE_DIFFERING_WORD);
  changed[at] = (changed[at] ?? 0) ^ 0x5a;
  changed[at + 1] = (changed[at + 1] ?? 0) ^ 0xa5;
  return { variant, chip: changed };
}
