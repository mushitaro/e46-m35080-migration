/**
 * The "late" KOMBI layout of the 1 KB array: where its checksums sit, how they are computed, and
 * where the cluster keeps its coded VIN.
 *
 * WHAT IS ESTABLISHED, AND HOW
 *
 * structure.ts used to say no map of this array survived contact with the dumps, and for the
 * array as a whole that is still true: the older cluster generation puts nothing where this one
 * does. But for one generation the layout is now measured, not guessed (docs/CODING.md):
 *
 *   - The cluster's coding definitions (read on the operator's machine, never committed) place
 *     every coding block inside 0x000-0x3FF, and their last block ends exactly at 0x400. Decoding
 *     two real chips from two different cars against the matching definition, every informative
 *     parameter lands on a defined option (14/14 and 15/15); against the wrong one, 12/15 and
 *     13/14; the two older-generation chips, 2/15 and 3/15.
 *   - Two bytes in that layout are checksums, and on both chips they hold:
 *         0x16E = XOR of 0x070..0x16D
 *         0x3CD = XOR of 0x310..0x3CC, and 0x3DF holds the same value
 *     The cluster's own diagnostic job that moves the odometer offset updates a checksum by XOR
 *     delta, which is the same rule seen from the other side.
 *   - The coded VIN is five bytes at 0x07A: two characters as ASCII, then five digits as BCD
 *     nibbles, the last in the high nibble of 0x07E. The cluster's diagnostic VIN reply uses the
 *     same shape.
 *
 * Only numbers and addresses live here. The names the definitions give these regions are BMW's
 * and stay out of this public repository (THIRD-PARTY-NOTICES.md 3.3).
 *
 * HOW A LAYOUT IS RECOGNISED
 *
 * By its checksums, never by an address holding something plausible - that is how 0x2E8 once
 * became "the VIN" (vin.ts). An image is `late` when at least one checksum region carries real
 * data (not one value repeated) AND that region's checksum holds. One region, not both, so an
 * image whose other checksum was broken by an edit is still recognised - and then reported as
 * broken rather than as "unknown", which is the whole point of checking it.
 */

import { IMAGE_SIZE } from './image';

export type ChecksumRegionId = 'coding' | 'maker';

export type ChecksumRegion = {
  id: ChecksumRegionId;
  /** First and last byte covered, inclusive. */
  from: number;
  to: number;
  /** Where the checksum byte sits. */
  at: number;
  /** Other addresses that must hold the same value. */
  mirrors: readonly number[];
};

export const CHECKSUM_REGIONS: readonly ChecksumRegion[] = [
  { id: 'coding', from: 0x070, to: 0x16d, at: 0x16e, mirrors: [] },
  { id: 'maker', from: 0x310, to: 0x3cc, at: 0x3cd, mirrors: [0x3df] },
];

/** XOR of every byte in [from, to]. */
export function xorOf(image: Uint8Array, from: number, to: number): number {
  let x = 0;
  for (let a = from; a <= to; a++) x ^= image[a] ?? 0;
  return x;
}

/** One value repeated across the region: a blank chip, a floating line, a synthetic fill. */
export function isDegenerate(image: Uint8Array, from: number, to: number): boolean {
  const first = image[from];
  for (let a = from + 1; a <= to; a++) if (image[a] !== first) return false;
  return true;
}

export type ChecksumState = {
  id: ChecksumRegionId;
  at: number;
  /** What the rule computes from the region. */
  computed: number;
  /** What the image holds at `at`. */
  stored: number;
  /** Stored values at each mirror address. */
  mirrors: { at: number; stored: number }[];
  /** The checksum and every mirror equal the computed value. */
  ok: boolean;
  /** The region is one repeated value, so a matching checksum proves nothing. */
  degenerate: boolean;
};

export function checksumStatus(image: Uint8Array): ChecksumState[] {
  assertImage(image);
  return CHECKSUM_REGIONS.map((r) => {
    const computed = xorOf(image, r.from, r.to);
    const stored = image[r.at] ?? 0;
    const mirrors = r.mirrors.map((at) => ({ at, stored: image[at] ?? 0 }));
    return {
      id: r.id,
      at: r.at,
      computed,
      stored,
      mirrors,
      ok: stored === computed && mirrors.every((m) => m.stored === computed),
      degenerate: isDegenerate(image, r.from, r.to),
    };
  });
}

export type Layout =
  | { kind: 'late'; checksums: ChecksumState[]; /** Every checksum holds. */ consistent: boolean }
  | { kind: 'unknown'; checksums: ChecksumState[] };

export function detectLayout(image: Uint8Array): Layout {
  const checksums = checksumStatus(image);
  const anchored = checksums.some((c) => c.ok && !c.degenerate);
  if (!anchored) return { kind: 'unknown', checksums };
  return { kind: 'late', checksums, consistent: checksums.every((c) => c.ok) };
}

export type ChecksumWrite = { address: number; before: number; after: number };

/**
 * The image with every checksum (and mirror) set to what the rule computes.
 *
 * Returns only the bytes that change, so a caller can show "0x16E 0x01 -> 0x5A" and write
 * nothing when the checksums already hold. Order matters and is fixed here: a region's checksum
 * is computed from bytes that are all outside every checksum address, so recomputing one never
 * invalidates another.
 */
export function recomputeChecksums(image: Uint8Array): { image: Uint8Array; writes: ChecksumWrite[] } {
  assertImage(image);
  const out = Uint8Array.from(image);
  const writes: ChecksumWrite[] = [];
  for (const r of CHECKSUM_REGIONS) {
    const value = xorOf(out, r.from, r.to);
    for (const at of [r.at, ...r.mirrors]) {
      const before = out[at] ?? 0;
      if (before !== value) {
        writes.push({ address: at, before, after: value });
        out[at] = value;
      }
    }
  }
  return { image: out, writes };
}

/** Which checksum region, if any, covers an address. */
export function checksumRegionOf(address: number): ChecksumRegion | null {
  return CHECKSUM_REGIONS.find((r) => address >= r.from && address <= r.to) ?? null;
}

/** Every address that holds a checksum or a mirror of one. */
export const CHECKSUM_ADDRESSES: readonly number[] = CHECKSUM_REGIONS.flatMap((r) => [r.at, ...r.mirrors]);

/* ------------------------------ coded VIN ------------------------------- */

/** Where the coded VIN starts: two ASCII characters, then five BCD digits. */
export const CODED_VIN_AT = 0x07a;
/** Bytes the field spans, 0x07A-0x07E. The low nibble of the last byte is NOT part of it. */
export const CODED_VIN_BYTES = 5;
/** Characters the field holds: VIN positions 11-17. */
export const CODED_VIN_LENGTH = 7;

const isVinChar = (b: number) => (b >= 0x41 && b <= 0x5a) || (b >= 0x30 && b <= 0x39);

export type CodedVinRead =
  | { ok: true; text: string; offset: number }
  | { ok: false; reason: 'not-late-layout' | 'not-vin-shaped' };

/**
 * Read the coded VIN. Only in a late-layout image: in any other, 0x07A is not known to mean
 * anything, and naming it would be inventing it.
 */
export function readCodedVin(image: Uint8Array): CodedVinRead {
  if (detectLayout(image).kind !== 'late') return { ok: false, reason: 'not-late-layout' };
  const text = unpackCodedVin(image.subarray(CODED_VIN_AT, CODED_VIN_AT + CODED_VIN_BYTES));
  return text === null ? { ok: false, reason: 'not-vin-shaped' } : { ok: true, text, offset: CODED_VIN_AT };
}

/**
 * The seven characters packed into five bytes - two ASCII, then five BCD digits, the low nibble
 * of the fifth byte not included - or null when the bytes are not that shape.
 *
 * One rule for two places: the coded field at 0x07A, and the cluster's own VIN reply over DS2
 * (lib/kombi/decode.ts), which the SGBD unpacks the same way.
 */
export function unpackCodedVin(b: Uint8Array): string | null {
  if (b.length < CODED_VIN_BYTES) return null;
  const c11 = b[0] ?? 0;
  const c12 = b[1] ?? 0;
  if (!isVinChar(c11) || !isVinChar(c12)) return null;
  const nibbles = [(b[2] ?? 0) >> 4, (b[2] ?? 0) & 0xf, (b[3] ?? 0) >> 4, (b[3] ?? 0) & 0xf, (b[4] ?? 0) >> 4];
  if (nibbles.some((n) => n > 9)) return null;
  return String.fromCharCode(c11, c12) + nibbles.join('');
}

/** Whether a 7-character VIN can be stored in the coded field (the last five must be digits). */
export function fitsCodedVin(text: string): boolean {
  const v = text.trim().toUpperCase();
  return (
    v.length === CODED_VIN_LENGTH &&
    isVinChar(v.charCodeAt(0)) &&
    isVinChar(v.charCodeAt(1)) &&
    /^[0-9]{5}$/.test(v.slice(2))
  );
}

/**
 * The five bytes a coded-VIN write puts at 0x07A, given the image they go into.
 *
 * The low nibble of 0x07E belongs to whatever follows the field, so it is carried over from the
 * image, never overwritten.
 */
export function encodeCodedVin(image: Uint8Array, text: string): Uint8Array {
  const v = text.trim().toUpperCase();
  if (!fitsCodedVin(v)) {
    throw new RangeError(`coded VIN must be two letters or digits then five digits, got "${text}"`);
  }
  const d = Array.from(v.slice(2), (ch) => ch.charCodeAt(0) - 0x30);
  const lowNibble = (image[CODED_VIN_AT + 4] ?? 0) & 0x0f;
  return Uint8Array.from([
    v.charCodeAt(0),
    v.charCodeAt(1),
    ((d[0] ?? 0) << 4) | (d[1] ?? 0),
    ((d[2] ?? 0) << 4) | (d[3] ?? 0),
    ((d[4] ?? 0) << 4) | lowNibble,
  ]);
}

/* ---------------------------- coding limits ----------------------------- */

/**
 * Where a coding change may land: the two checksummed regions, and nothing else. Everything below
 * 0x070 carries no known checksum, so a change there could not be made consistent.
 */
export const CODABLE_RANGES: readonly [number, number][] = [
  [0x070, 0x16d],
  [0x310, 0x3cc],
];

/**
 * Never written by a coding change, even where a definition offers an option:
 *   0x000-0x01F  the increment-only odometer counters
 *   0x07A-0x087  the coded VIN, the odometer offset and the speed/tachometer calibration constants -
 *                identity and mileage, which REWRITE owns and states in its own words
 *   0x16E-0x16F  a checksum and the byte after it
 *   0x3CD, 0x3DF a checksum and its mirror
 * The checksums are RECOMPUTED by the planner after a change; they are protected from being
 * chosen as an option, not from being corrected.
 */
export const PROTECTED_RANGES: readonly [number, number][] = [
  [0x000, 0x01f],
  [0x07a, 0x087],
  [0x16e, 0x16f],
  [0x3cd, 0x3cd],
  [0x3df, 0x3df],
];

export function inRanges(address: number, ranges: readonly [number, number][]): boolean {
  return ranges.some(([from, to]) => address >= from && address <= to);
}

function assertImage(image: Uint8Array): void {
  if (image.length !== IMAGE_SIZE) {
    throw new RangeError(`expected a ${IMAGE_SIZE}-byte image, got ${image.length}`);
  }
}
