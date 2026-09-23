/**
 * What TEST checks, and how each result is judged.
 *
 * TEST REPORTS; it does not pass or fail a cluster. A comparison is EQUAL, DIFFERENT or NOT
 * COMPARED, always with where each side came from - the cluster over DS2, the chip image and the
 * address in it - because the first bench session is itself what settles which chip field the
 * cluster reports as its VIN (docs/BENCH.md). A drive is SENT or not, and then the reader says
 * whether they saw it; nothing here claims to know what a lamp looked like.
 *
 * The comparisons and the sweep plan are pure. The procedures that drive the cluster take the
 * KombiLink, go through its gate like everything else, and check for cancellation between steps:
 * STOP has to end a sweep at the next step, not after the sweep.
 */

import { decodeOdometer } from '@/lib/domain/odometer';
import { secureOf } from '@/lib/domain/image';
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
    'gong',
    'piezo',
    'release',
  ];
}

/* ------------------------------- the reference ------------------------------ */

/** The chip image TEST compares the cluster against, and where it came from. */
export type Reference = {
  image: Uint8Array;
  source: 'chip-read' | 'record';
  /** 'CHIP READ', or the record's file name. */
  label: string;
  /** When it was read or recorded, ms since the epoch; null for a read that is still in memory. */
  at: number | null;
};

/**
 * The image in this session's chip read if there is one, else the newest record of the same kind
 * of session - a PRACTICE test against a practice record, a real test against a real one, never
 * across. Null when there is neither, and then every comparison is NOT COMPARED and says why.
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

/* ------------------------------- comparisons ------------------------------- */

export type Compare = 'equal' | 'different' | 'not-compared';

/** Why a comparison could not be made. */
export type NotCompared = 'no-reference' | 'no-field' | 'unreadable';

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

function judge(cluster: string | null, chip: string | null, ref: Reference | null): Pick<FieldCheck, 'result' | 'why'> {
  if (!ref) return { result: 'not-compared', why: 'no-reference' };
  if (chip === null) return { result: 'not-compared', why: 'no-field' };
  if (cluster === null) return { result: 'not-compared', why: 'unreadable' };
  return { result: cluster === chip ? 'equal' : 'different', why: null };
}

/**
 * The cluster's VIN against BOTH chip fields: the coded one at 0x07A and the ASCII one the scan
 * finds. Which of the two the cluster reports is exactly what a bench session settles, so neither
 * is preferred here.
 */
export function compareVin(cluster: Decoded<string>, ref: Reference | null): FieldCheck[] {
  const reported = cluster.ok ? cluster.value : null;
  const vins = ref ? readVins(ref.image) : null;
  const coded = vins?.coded ?? null;
  const ascii = vins?.ascii ?? null;
  return [
    {
      field: 'vin-coded',
      cluster: reported,
      chip: coded?.text ?? null,
      at: coded ? span(coded.from, coded.to) : null,
      ...judge(reported, coded?.text ?? null, ref),
    },
    {
      field: 'vin-ascii',
      cluster: reported,
      chip: ascii?.text ?? null,
      at: ascii ? span(ascii.offset, ascii.offset + ascii.text.length - 1) : null,
      ...judge(reported, ascii?.text ?? null, ref),
    },
  ];
}

/** The cluster's odometer against the chip's counter at 0x000-0x01F. */
export function compareOdometer(cluster: Decoded<number>, ref: Reference | null): FieldCheck {
  const reported = cluster.ok ? String(cluster.value) : null;
  const decoded = ref ? decodeOdometer(secureOf(ref.image)) : null;
  const chip = decoded?.ok ? String(decoded.km) : null;
  return { field: 'odometer', cluster: reported, chip, at: ref ? span(0x000, 0x01f) : null, ...judge(reported, chip, ref) };
}

/** The words TEST reads back: the whole chip, as far as the variant can address it. */
export function eepromReadRange(variant: KombiVariant): { from: number; count: number } {
  // Under the working mapping the chip's 1024 bytes are words 000-1FF; a KOMBI46 addresses only
  // 00-FF of them.
  return { from: 0, count: Math.min(EEPROM_WORD_LIMIT[variant], 0x200) };
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

export function compareEeprom(read: Uint8Array | null, fromWord: number, words: number, ref: Reference | null): EepromCheck {
  const base = { fromWord, words, mapping: WORD_MAPPING_HYPOTHESIS, differing: [] as number[] };
  if (!ref) return { ...base, result: 'not-compared', why: 'no-reference' };
  if (!read) return { ...base, result: 'not-compared', why: 'unreadable' };
  const start = wordToByteAddress(fromWord);
  const differing: number[] = [];
  for (let i = 0; i < read.length; i++) {
    const at = start + i;
    if (at >= ref.image.length) break;
    if (read[i] !== ref.image[at]) differing.push(at);
  }
  return { ...base, differing, result: differing.length === 0 ? 'equal' : 'different', why: null };
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
