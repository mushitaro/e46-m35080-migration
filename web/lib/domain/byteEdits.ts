/**
 * The bytes a job changes by hand - REWRITE's BYTES part (lib/domain/job.ts), typed into the HEX
 * view's edit bar.
 *
 * WHAT AN EDIT IS
 *
 * An edit is made on the job's SOURCE - the chip as read, or a file - and carries what the byte
 * was as well as what it becomes. The edits are a stack in the order they were made, so the last
 * one can be taken back and all of them can. They belong to the source they were made on, and
 * that is compared by CONTENT (sameImage), not by which array holds it: reading the same chip again
 * keeps them, and a chip that now holds something else - once the job was written - does not.
 *
 * WHICH BYTES (byteLock)
 *
 * Only a byte no other part of the job owns. Not the odometer: ODOMETER raises it by WRINC, and
 * that is the only way the tool changes it. Not a VIN field: VIN writes every field the source has
 * at once, and a field changed by hand stops being found as one - a VIN written after it would
 * land in one field and not the other. And on the late layout, not its protected ranges - the
 * odometer offset and the calibration constants beside the coded VIN (a hand edit there would be a
 * way around WRINC), and the checksums, which the job computes. On an image of no recognised
 * layout no address is given a meaning it has not earned (lib/domain/layout.ts), so only the
 * odometer and the VIN the scan finds are held back.
 *
 * Nothing here writes anything. planJob applies the edits, checks them again with the same
 * byteLock, and seals the checksums; the one write path writes what it planned.
 */

import { IMAGE_SIZE, STANDARD_START, diff } from './image';
import { CHECKSUM_ADDRESSES, PROTECTED_RANGES, detectLayout, inRanges } from './layout';
import { readVins } from './vin';

/** One byte, changed. `before` is what makes it reversible, and what planJob checks it against. */
export type ByteEdit = { address: number; before: number; after: number };

export type ByteEdits = {
  /** A copy of the source the edits were made on. Compared by content, never mutated. */
  source: Uint8Array;
  /** In the order they were made, so the last can be taken back. */
  edits: ByteEdit[];
  /**
   * FIX CHECKSUMS: recompute the checksums of a FILE whose checksums do not hold. Explicit, and
   * a file's only: a chip's broken checksum is evidence to read again, not to paper over.
   */
  reseal: boolean;
};

export function startEdits(source: Uint8Array): ByteEdits {
  return { source: Uint8Array.from(source), edits: [], reseal: false };
}

/** Whether two images hold the same bytes. */
export function sameImage(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The source with the edits applied, in order. The source itself is not touched. */
export function applyBytes(source: Uint8Array, edits: readonly ByteEdit[]): Uint8Array {
  const out = Uint8Array.from(source);
  for (const e of edits) out[e.address] = e.after;
  return out;
}

/**
 * Why a byte cannot be changed by hand, or null when it can.
 *
 *   outside    not an address of the chip
 *   odometer   0x000-0x01F: ODOMETER, by WRINC
 *   vin        a VIN field this source has: VIN
 *   checksum   a checksum of the late layout: the job computes it
 *   protected  the rest of the late layout's protected ranges (0x07A-0x087, 0x16F)
 */
export type ByteLock = 'outside' | 'odometer' | 'vin' | 'checksum' | 'protected';

export function byteLock(source: Uint8Array, address: number): ByteLock | null {
  if (!Number.isInteger(address) || address < 0 || address >= IMAGE_SIZE) return 'outside';
  if (address < STANDARD_START) return 'odometer';
  const v = readVins(source);
  if (v.coded && address >= v.coded.from && address <= v.coded.to) return 'vin';
  if (v.ascii && address >= v.ascii.offset && address < v.ascii.offset + v.ascii.bytes.length) return 'vin';
  if (detectLayout(source).kind === 'late') {
    if (CHECKSUM_ADDRESSES.includes(address)) return 'checksum';
    if (inRanges(address, PROTECTED_RANGES)) return 'protected';
  }
  return null;
}

export type EditResult =
  | { ok: true; edits: ByteEdits }
  | { ok: false; reason: 'not-a-byte' | 'no-change' | ByteLock };

/**
 * Set one byte.
 *
 * Refuses a no-op rather than recording it: an undo stack that fills with entries that changed
 * nothing makes UNDO stop meaning anything - it is pressed and no byte moves.
 */
export function editByte(e: ByteEdits, address: number, value: number): EditResult {
  const lock = byteLock(e.source, address);
  if (lock) return { ok: false, reason: lock };
  if (!Number.isInteger(value) || value < 0 || value > 0xff) return { ok: false, reason: 'not-a-byte' };
  const before = applyBytes(e.source, e.edits)[address]!;
  if (before === value) return { ok: false, reason: 'no-change' };
  return { ok: true, edits: { ...e, edits: [...e.edits, { address, before, after: value }] } };
}

/** Take back the most recent edit. */
export function undoLast(e: ByteEdits): ByteEdits {
  return e.edits.length === 0 ? e : { ...e, edits: e.edits.slice(0, -1) };
}

/** Back to the source as it is: every edit taken back. FIX CHECKSUMS is its own switch. */
export function revertAll(e: ByteEdits): ByteEdits {
  return { ...e, edits: [] };
}

/** Addresses where the edits leave the source different - an edit and its reversal cancel out. */
export function changedAddresses(e: ByteEdits): number[] {
  return diff(e.source, applyBytes(e.source, e.edits));
}
