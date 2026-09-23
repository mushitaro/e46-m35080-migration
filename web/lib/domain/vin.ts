/**
 * The VIN, FOUND rather than indexed - and exactly seven characters of it.
 *
 * WHAT THE CLUSTER STORES
 *
 * BMW's short VIN: positions 11-17 of the 17-character VIN (plant letter plus
 * serial), the same seven characters coding tools call the FG number. On the
 * V6 chip, five dumps agree on this layout. The characters below are a
 * stand-in - `AB12345` - because the real ones identify a specific car and do
 * not belong in a repository that may one day be copied to a public branch.
 * Everything that matters to this module survives the substitution: the
 * offsets, the terminator, the length, and the byte in front.
 *
 *     0x180  64 06 60 4C 41 42 31 32 33 34 35 00 FF FF FF FF
 *                    ^^ A  B  1  2  3  4  5  NUL
 *                    0x183: NOT the VIN
 *
 * Seven characters at 0x184-0x18A, NUL at 0x18B. The 0x4C at 0x183 is an
 * uppercase `L`, so it joins the run - but the car's registration VIN settles
 * it: its 10th character is not an `L`, and its last seven are exactly
 * 0x184-0x18A. The byte in front belongs to whatever precedes the VIN field.
 *
 * WHAT WENT WRONG, TWICE
 *
 *   1. This file used to declare `VIN_OFFSET = 0x2E8`, on the strength of an
 *      example in the reference README. On the two chips that use that part
 *      of the array it holds `00 62 03 F5 02 58 02 ..` - near-identical bytes
 *      on two DIFFERENT cars, which a VIN can never be. The only file that
 *      ever "confirmed" it was an export this app made in PRACTICE mode,
 *      writing its own assumption and reading it back.
 *   2. The fix for that took the whole run - eight characters, "three letters
 *      and five digits" - and read the neighbouring 0x4C as part of the VIN.
 *      A VIN write then had to be eight characters and overwrote 0x183 with
 *      the first of them. The field is seven; the run is not the field.
 *
 * So: SCAN for a run, because the offset is not fixed - the other cluster
 * generation does not put the VIN here at all, and the reference's own
 * `find_vin()` scans for the same reason - then take the run's LAST seven
 * characters, right-aligned against the terminator.
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

/** The short VIN: positions 11-17 of the full VIN. What the chip holds. */
export const VIN_LENGTH = 7;
/**
 * The longest run the scan considers. A full VIN is 17; a longer run of
 * uppercase text is not a VIN field.
 */
export const VIN_RUN_MAX = 17;

/** A VIN found in the image. */
export type VinFind = {
  /** Where the seven characters start. There is no constant here on purpose. */
  offset: number;
  /** The seven characters exactly as stored. */
  text: string;
  bytes: Uint8Array;
  /**
   * VIN-shaped bytes directly in front of it that are NOT the VIN - on the V6,
   * the 0x4C at 0x183. Reported so the address view can say what they are
   * not. Never read as VIN, never written.
   */
  lead: { offset: number; text: string } | null;
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

const ascii = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

/**
 * Every run of uppercase alphanumerics long enough to hold a VIN, reduced to
 * the seven characters that are one.
 *
 * Deliberately imposes no letter/digit pattern inside the seven. `KT17727`
 * (the upstream README's example) and the V6's are both two letters and five digits, but two
 * examples are not a rule, and a pattern fitted to too few of them has
 * already rejected a real VIN in this project once.
 */
export function findVinCandidates(image: Uint8Array): VinFind[] {
  const out: VinFind[] = [];
  let start = -1;
  for (let i = VIN_SCAN_START; i <= image.length; i++) {
    const ok = i < image.length && isVinChar(image[i]);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      const len = i - start;
      if (len >= VIN_LENGTH && len <= VIN_RUN_MAX) {
        const offset = i - VIN_LENGTH;
        const bytes = image.slice(offset, i);
        out.push({
          offset,
          text: ascii(bytes),
          bytes,
          lead: offset > start ? { offset: start, text: ascii(image.subarray(start, offset)) } : null,
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

/** What a VIN write puts on the chip: seven characters, as ASCII. */
export function encodeVin(text: string): Uint8Array {
  const v = text.trim().toUpperCase();
  if (v.length !== VIN_LENGTH) {
    throw new RangeError(`VIN must be ${VIN_LENGTH} characters (positions 11-17), got ${v.length}`);
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
 *
 * Both sides are seven characters by construction, so the write covers
 * exactly the old VIN and nothing either side of it.
 */
export type VinTarget =
  | { ok: true; offset: number; existing: VinFind }
  | { ok: false; reason: 'no-vin-on-chip' };

export function vinTarget(image: Uint8Array): VinTarget {
  const { found } = readVin(image);
  if (!found) return { ok: false, reason: 'no-vin-on-chip' };
  return { ok: true, offset: found.offset, existing: found };
}
