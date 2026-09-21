/**
 * The VIN, FOUND rather than indexed.
 *
 * WHAT WENT WRONG THE FIRST TIME
 *
 * This file used to declare `VIN_OFFSET = 0x2E8` and read seven ASCII bytes
 * there, on the strength of an example in the reference README. Both halves of
 * that were wrong, and each wrong half hid the other:
 *
 *   - 0x2E8 is not the VIN. On the two chips that use that part of the array
 *     it holds `00 62 03 F5 02 58 02 ..` - and near-identical bytes on two
 *     DIFFERENT cars, which is the one thing a VIN can never be. On the other
 *     two chips, including the one on this bench, it is plain 0xFF.
 *   - The shape `[A-Z]{2}[0-9]{5}` was generalised from the README's single
 *     example, `KT17727`. The chip on this bench carries THREE letters and
 *     EIGHT characters. The pattern rejected the actual VIN while the offset
 *     pointed at empty space, so the read returned nothing and the nothing
 *     looked like confirmation.
 *
 * The only file that ever "confirmed" 0x2E8 was an export this app made in
 * PRACTICE mode, writing its own assumption and reading it back.
 *
 * WHAT IS ACTUALLY TRUE
 *
 * On the V6 chip, three separate dumps agree on the SHAPE below. The
 * characters here are a stand-in - `ABC12345` - because the real ones
 * identify a specific car and do not belong in a repository that may one
 * day be copied to a public branch. Everything that matters to this module
 * survives the substitution: the offset, the terminator, the length, and
 * the three-letter prefix that the old pattern threw away.
 *
 *     0x180  64 06 60 41 42 43 31 32 33 34 35 00 FF FF FF FF
 *                    A  B  C  1  2  3  4  5  NUL
 *
 * Plain ASCII at 0x183, NUL-terminated. And the offset is NOT fixed: the other
 * cluster generation does not put it there at all. So this module SCANS, which
 * is what the reference's own `find_vin()` does and for the same reason.
 *
 * The scan rule is "uppercase letters and digits, at least 7 of them". On the
 * real dumps that is exact: one hit on the V6 and zero on every other chip. Everything that looks like text but is not - `lNFEx`, `aEXU6`,
 * `Y4SM6`, `--JR` - fails on case or on length.
 */

import { STANDARD_START } from './image';

/**
 * The scan starts after the secure area.
 *
 * 0x000-0x01F is sixteen increment-only counters; it cannot hold a VIN, and
 * letting the scan reach in there was a real hazard rather than a tidiness
 * issue. A VIN-shaped run of counter bytes would have produced a plan whose
 * byte write targets the secure area - and assertWritableRange only rejects
 * that inside writeAndVerify, i.e. AFTER the irreversible WRINCs for the same
 * job had already been committed.
 */
export const VIN_SCAN_START = STANDARD_START;

/** Shortest run taken seriously. Below this, real dumps produce noise. */
export const VIN_MIN_LENGTH = 7;
/** A full VIN is 17; nothing longer is a VIN. */
export const VIN_MAX_LENGTH = 17;

/** A VIN-shaped string found in the image. */
export type VinFind = {
  /** Where it starts. There is no constant here on purpose. */
  offset: number;
  /** The characters exactly as stored - not truncated to a guessed length. */
  text: string;
  bytes: Uint8Array;
};

export type VinRead = {
  /** The best candidate, or null when the image carries none. */
  found: VinFind | null;
  /** Every candidate, so an unusual image still shows what it has. */
  candidates: VinFind[];
  /**
   * No VIN, and nothing written where one could be: a blank or VIN-cleared
   * chip. Distinct from "we could not read it".
   */
  blank: boolean;
};

function isVinChar(b: number): boolean {
  return (b >= 0x41 && b <= 0x5a) || (b >= 0x30 && b <= 0x39);
}

/**
 * Every run of uppercase alphanumerics long enough to be a VIN.
 *
 * Deliberately imposes no letter/digit pattern. `KT17727` is 2+5 and
 * the chip here is 3+5; a rule fitted to either one rejects the other, and this
 * project has already shipped that mistake once.
 */
export function findVinCandidates(image: Uint8Array): VinFind[] {
  const out: VinFind[] = [];
  let start = -1;
  for (let i = VIN_SCAN_START; i <= image.length; i++) {
    const ok = i < image.length && isVinChar(image[i]);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      const len = i - start;
      if (len >= VIN_MIN_LENGTH && len <= VIN_MAX_LENGTH) {
        out.push({
          offset: start,
          text: Array.from(image.subarray(start, i), (b) => String.fromCharCode(b)).join(''),
          bytes: image.slice(start, i),
        });
      }
      start = -1;
    }
  }
  return out;
}

/**
 * Read the VIN out of an image.
 *
 * When several candidates exist the FIRST is taken, and the rest are still
 * reported. A tool that silently picks among several identifiers is a tool
 * that will one day write the wrong one.
 */
export function readVin(image: Uint8Array): VinRead {
  const candidates = findVinCandidates(image);
  const blank = candidates.length === 0;
  return { found: candidates[0] ?? null, candidates, blank };
}

/** What a VIN write puts on the chip: the characters, as ASCII. */
export function encodeVin(text: string): Uint8Array {
  const v = text.trim().toUpperCase();
  if (v.length < VIN_MIN_LENGTH || v.length > VIN_MAX_LENGTH) {
    throw new RangeError(
      `VIN must be ${VIN_MIN_LENGTH}-${VIN_MAX_LENGTH} characters, got ${v.length}`,
    );
  }
  if (!Array.from(v).every((c) => isVinChar(c.charCodeAt(0)))) {
    throw new RangeError(`VIN must be uppercase letters and digits only, got "${text}"`);
  }
  return Uint8Array.from(v, (c) => c.charCodeAt(0));
}

/** Whether a string could be written as a VIN, without throwing to find out. */
export function isWritableVin(text: string): boolean {
  try {
    encodeVin(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where a VIN write would go, and whether it can go anywhere at all.
 *
 * A VIN can only be written over one that is already there, because the
 * address is not knowable otherwise. On a blank chip there is no target - and
 * that is not a gap in this tool, it is the workflow: a new chip gets 0 km and
 * no VIN, and the VIN is coded in afterwards over OBD with the car connected.
 */
export type VinTarget =
  | { ok: true; offset: number; existing: VinFind; sameLength: boolean }
  | { ok: false; reason: 'no-vin-on-chip' };

export function vinTarget(image: Uint8Array, text: string): VinTarget {
  const { found } = readVin(image);
  if (!found) return { ok: false, reason: 'no-vin-on-chip' };
  return {
    ok: true,
    offset: found.offset,
    existing: found,
    sameLength: found.text.length === text.trim().length,
  };
}
