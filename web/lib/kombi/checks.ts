/**
 * What TEST checks, and how each result is judged.
 *
 * TEST REPORTS; it does not pass or fail a cluster. A read's result is what the cluster answered,
 * and it needs nothing else: no chip image, no record. When there IS a chip image, the reads are
 * also compared with it - EQUAL, DIFFERENT or NOT COMPARED, with where each side came from, the
 * cluster over DS2 and the chip image and the address in it - because the first bench session is
 * itself what settles which chip field the cluster reports as its VIN (docs/BENCH.md). The
 * comparison is derived from the reads whenever it is shown; the session keeps only the reads.
 * A drive is SENT or not, and then the reader says whether they saw it; nothing here claims to
 * know what a lamp looked like.
 *
 * The comparisons and the sweep plan are pure. The procedures that drive the cluster take the
 * KombiLink, go through its gate like everything else, and check for cancellation between steps:
 * STOP has to end a sweep at the next step, not after the sweep.
 */

import { decodeOdometer } from '@/lib/domain/odometer';
import { parseImageFile, secureOf, verdictFor } from '@/lib/domain/image';
import { readVins } from '@/lib/domain/vin';
import { recordFilename, type DeviceRecord } from '@/lib/domain/records';
import type { Decoded } from './decode';
import type { KombiLink } from './kombiLink';
import {
  EEPROM_WORD_LIMIT,
  NEEDLE_MAX_DEG,
  NEEDLE_MAX_STEP_DEG,
  NEEDLE_MIN_DEG,
  NEEDLE_REST_DEG,
  WORD_MAPPING_HYPOTHESIS,
  wordToByteAddress,
  type GaugeId,
  type KombiVariant,
} from './protocol';
import type { NeedleSpan } from './runGate';

/* --------------------------------- the list -------------------------------- */

export type CheckId =
  | 'vin'
  | 'odometer'
  | 'faults'
  | 'inputs'
  | 'eeprom'
  | 'needles'
  | 'lamps'
  | 'outputs'
  | 'gong'
  | 'piezo'
  | 'release';

/** Checks that make the cluster do something. They wait for the bench confirmation. */
export const DRIVE_CHECKS: ReadonlySet<CheckId> = new Set<CheckId>(['needles', 'lamps', 'outputs', 'gong', 'piezo']);

/**
 * The checks, in the order a bench session runs them: reads first (they change nothing), then
 * the drives, then the session end and what the cluster did after it. The output port exists on a
 * KOMBI46 only.
 */
export function checksFor(variant: KombiVariant | null): CheckId[] {
  return [
    'vin',
    'odometer',
    'faults',
    'inputs',
    'eeprom',
    'needles',
    'lamps',
    ...(variant === 'KOMBI46' ? (['outputs'] as const) : []),
    // A KOMBIR40 has no gong or piezo this tool may sound (runGate.ts).
    ...(variant === 'KOMBIR40' ? [] : (['gong', 'piezo'] as const)),
    'release',
  ];
}

/* ------------------------------- the reference ------------------------------ */

/** The chip image TEST compares the cluster against, and where it came from. */
export type Reference = {
  image: Uint8Array;
  /** A dump the reader opened in CHECKS, this session's chip read, or the newest record. */
  source: 'file' | 'chip-read' | 'record';
  /** The file's name, 'CHIP READ', or the record's file name. */
  label: string;
  /** When it was read or recorded, ms since the epoch; null for a file, or a read still in memory. */
  at: number | null;
};

/** Why a file cannot be held against the reads: the same two refusals REWRITE's SOURCE makes. */
export type ReferenceFileRefusal = { kind: 'size'; size: number } | { kind: 'not-a-chip'; value: number };

/**
 * A dump the reader opened in CHECKS, as the image the reads are held against - it comes before
 * any chip read or record, because the reader chose it. Exactly one M35080 image, and not a
 * floating bus's 1024 copies of one byte. It is held in memory only; nothing sends it anywhere.
 */
export function referenceFromFile(
  name: string,
  buffer: ArrayBuffer,
): { ok: true; reference: Reference } | { ok: false; refusal: ReferenceFileRefusal } {
  const parsed = parseImageFile(buffer);
  if (!parsed.ok) return { ok: false, refusal: { kind: 'size', size: parsed.size } };
  const verdict = verdictFor(parsed.image);
  if (verdict.uniform) return { ok: false, refusal: { kind: 'not-a-chip', value: verdict.uniformValue ?? 0 } };
  return { ok: true, reference: { image: parsed.image, source: 'file', label: name, at: null } };
}

/**
 * When the reader has opened no dump: the image in this session's chip read if there is one, else
 * the newest record of the same kind
 * of session - a PRACTICE test against a practice record, a real test against a real one, never
 * across. Null when there is neither, and then nothing is compared: every read still runs, and
 * shows what the cluster answered.
 *
 * Records keep the image as it was re-read after each write, so the newest one is the chip as it
 * was last seen - which, once the chip is back in the cluster, is what the cluster should hold.
 */
export function pickReference(
  chipRead: { image: Uint8Array; practice: boolean } | null,
  records: readonly DeviceRecord[],
  practice: boolean,
): Reference | null {
  if (chipRead && chipRead.practice === practice) {
    return { image: chipRead.image, source: 'chip-read', label: 'CHIP READ', at: null };
  }
  const newest = records
    .filter((r) => r.practice === practice)
    .reduce<DeviceRecord | null>((best, r) => (!best || r.createdAt > best.createdAt ? r : best), null);
  if (!newest) return null;
  return {
    image: newest.bytes,
    source: 'record',
    label: recordFilename(newest.kind, newest.vin, newest.km, new Date(newest.createdAt), newest.practice),
    at: newest.createdAt,
  };
}

/* --------------------------------- the reads -------------------------------- */

/** The words TEST reads back: the whole chip, as far as the variant can address it. */
export function eepromReadRange(variant: KombiVariant): { from: number; count: number } {
  // Under the working mapping the chip's 1024 bytes are words 000-1FF; a KOMBI46 addresses only
  // 00-FF of them.
  return { from: 0, count: Math.min(EEPROM_WORD_LIMIT[variant], 0x200) };
}

/**
 * What the EEPROM read got: the words asked for, and their bytes as the cluster sent them - two
 * per word, in the order they came - or why the reply would not decode. This is the check's
 * result; a chip image, when there is one, is held against it, never the other way round.
 */
export type EepromRead = { fromWord: number; words: number; bytes: Decoded<Uint8Array> };

/** The reads a chip image can be held against, each null until it has been made. */
export type ComparableReads = {
  vin: Decoded<string> | null;
  odometer: Decoded<number> | null;
  eeprom: EepromRead | null;
};

/* ------------------------------- comparisons ------------------------------- */

export type Compare = 'equal' | 'different' | 'not-compared';

/** Why a read could not be compared with the chip image it was held against. */
export type NotCompared = 'no-field' | 'unreadable';

export type FieldCheck = {
  field: 'vin-coded' | 'vin-ascii' | 'odometer';
  /** What the cluster reported, or null when its reply did not decode. */
  cluster: string | null;
  /** The chip's value, or null. */
  chip: string | null;
  /** Where in the chip the value was read, e.g. 0x07A-0x07E. */
  at: string | null;
  result: Compare;
  why: NotCompared | null;
};

const hex3 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(3, '0')}`;
const span = (from: number, to: number) => (from === to ? hex3(from) : `${hex3(from)}-${hex3(to)}`);

function judge(cluster: string | null, chip: string | null): Pick<FieldCheck, 'result' | 'why'> {
  if (chip === null) return { result: 'not-compared', why: 'no-field' };
  if (cluster === null) return { result: 'not-compared', why: 'unreadable' };
  return { result: cluster === chip ? 'equal' : 'different', why: null };
}

/**
 * The cluster's VIN against BOTH chip fields: the coded one at 0x07A and the ASCII one the scan
 * finds. Which of the two the cluster reports is exactly what a bench session settles, so neither
 * is preferred here.
 */
export function compareVin(cluster: Decoded<string>, ref: Reference): FieldCheck[] {
  const reported = cluster.ok ? cluster.value : null;
  const { coded, ascii } = readVins(ref.image);
  return [
    {
      field: 'vin-coded',
      cluster: reported,
      chip: coded?.text ?? null,
      at: coded ? span(coded.from, coded.to) : null,
      ...judge(reported, coded?.text ?? null),
    },
    {
      field: 'vin-ascii',
      cluster: reported,
      chip: ascii?.text ?? null,
      at: ascii ? span(ascii.offset, ascii.offset + ascii.text.length - 1) : null,
      ...judge(reported, ascii?.text ?? null),
    },
  ];
}

/** The cluster's odometer against the chip's counter at 0x000-0x01F. */
export function compareOdometer(cluster: Decoded<number>, ref: Reference): FieldCheck {
  const reported = cluster.ok ? String(cluster.value) : null;
  const decoded = decodeOdometer(secureOf(ref.image));
  const chip = decoded.ok ? String(decoded.km) : null;
  return { field: 'odometer', cluster: reported, chip, at: span(0x000, 0x01f), ...judge(reported, chip) };
}

export type EepromCheck = {
  fromWord: number;
  words: number;
  /** The mapping this comparison assumed - stated, because it has not been measured. */
  mapping: string;
  result: Compare;
  why: NotCompared | null;
  /** Chip byte addresses that differ, under the mapping. */
  differing: number[];
};

export function compareEeprom(read: EepromRead, ref: Reference): EepromCheck {
  const base = { fromWord: read.fromWord, words: read.words, mapping: WORD_MAPPING_HYPOTHESIS, differing: [] as number[] };
  if (!read.bytes.ok) return { ...base, result: 'not-compared', why: 'unreadable' };
  const bytes = read.bytes.value;
  const start = wordToByteAddress(read.fromWord);
  const differing: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const at = start + i;
    if (at >= ref.image.length) break;
    if (bytes[i] !== ref.image[at]) differing.push(at);
  }
  return { ...base, differing, result: differing.length === 0 ? 'equal' : 'different', why: null };
}

/** Every read made so far held against the chip image. A read not yet made compares as null. */
export type Comparison = { vin: FieldCheck[] | null; odometer: FieldCheck | null; eeprom: EepromCheck | null };

export function compareReads(reads: ComparableReads, ref: Reference): Comparison {
  return {
    vin: reads.vin ? compareVin(reads.vin, ref) : null,
    odometer: reads.odometer ? compareOdometer(reads.odometer, ref) : null,
    eeprom: reads.eeprom ? compareEeprom(reads.eeprom, ref) : null,
  };
}

/* ---------------------------------- needles --------------------------------- */

/**
 * The angles a sweep sends, from wherever the gate says the needle may be: down to the rest angle
 * first, then up to the top and back, one step at a time. Every angle is one the gate would
 * accept at that point in the sequence - the test proves it by running the plan through mayRun.
 */
export function sweepPlan(from: NeedleSpan): number[] {
  const out: number[] = [];
  let lo = from?.lo ?? null;
  let hi = from?.hi ?? null;
  const step = (d: number) => {
    out.push(d);
    lo = d;
    hi = d;
  };
  if (lo === null || hi === null) {
    step(NEEDLE_REST_DEG);
  } else {
    // Down to rest, each step within reach of both ends of the span.
    while (!(lo === NEEDLE_REST_DEG && hi === NEEDLE_REST_DEG)) {
      step(Math.max(NEEDLE_MIN_DEG, Math.min(hi - NEEDLE_MAX_STEP_DEG, lo + NEEDLE_MAX_STEP_DEG)));
    }
  }
  for (let d = NEEDLE_REST_DEG + NEEDLE_MAX_STEP_DEG; d <= NEEDLE_MAX_DEG; d += NEEDLE_MAX_STEP_DEG) step(d);
  for (let d = NEEDLE_MAX_DEG - NEEDLE_MAX_STEP_DEG; d >= NEEDLE_REST_DEG; d -= NEEDLE_MAX_STEP_DEG) step(d);
  return out;
}

export type Cancelled = () => boolean;

/** How long a needle holds each stage of a sweep, so the eye can follow it. */
export const SWEEP_DWELL_MS = 350;

/**
 * Sweeps one needle through its plan, holding each stage. Stops at the next step when cancelled;
 * a failure throws, and the gate's idea of where the needle is stays honest either way.
 */
export async function sweepNeedle(
  link: KombiLink,
  gauge: GaugeId,
  opts: { cancelled: Cancelled; dwellMs?: number; onStep?: (degrees: number) => void },
): Promise<'done' | 'cancelled'> {
  for (const degrees of sweepPlan(link.needleSpan(gauge))) {
    if (opts.cancelled()) return 'cancelled';
    await link.setNeedle(gauge, degrees);
    opts.onStep?.(degrees);
    await new Promise((r) => setTimeout(r, opts.dwellMs ?? SWEEP_DWELL_MS));
  }
  return 'done';
}

/* ----------------------------------- items ---------------------------------- */

/** One thing the reader is asked about: a needle, a lamp bit, an output bit, a sound. */
export type Observation = 'seen' | 'not-seen';

export type ItemResult = {
  /** `rpm`, `B2.b5`, `P6.b0`, `gong` - the same key the report uses. */
  item: string;
  /** Whether the cluster acknowledged the command. */
  sent: 'acknowledged' | 'failed';
  error: string | null;
  observed: Observation | null;
};

export const lampKey = (byte: number, bit: number) => `B${byte}.b${bit}`;
export const outputKey = (bit: number) => `P6.b${bit}`;
