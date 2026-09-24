import { describe, it, expect } from 'vitest';
import {
  applyBytes,
  byteLock,
  changedAddresses,
  editByte,
  revertAll,
  sameImage,
  startEdits,
  undoLast,
  type ByteEdits,
} from '@/lib/domain/byteEdits';
import { editedFilename } from '@/lib/domain/records';
import { lateImage } from './support/lateImage';
import { IMAGE_SIZE } from '@/lib/domain/image';
import { encodeOdometer, slotsToBytes } from '@/lib/domain/odometer';

/**
 * REWRITE's BYTES - the hand edits on a job's source (lib/domain/byteEdits.ts): a stack that can
 * be taken back, on the bytes no other part of the job owns. On synthetic images only.
 */

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Not a recognised layout: an odometer, an ASCII VIN at 0x184, varied bytes - and no checksum that holds. */
function unknownLayout(): Uint8Array {
  const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
  img.set(slotsToBytes(encodeOdometer(155_940)), 0);
  img[0x183] = 0x4c;
  img.set(ascii('AB12345'), 0x184);
  for (let i = 0x40; i < 0x80; i++) img[i] = (i * 7 + 13) & 0xff;
  return img;
}

function edit(e: ByteEdits, address: number, value: number): ByteEdits {
  const r = editByte(e, address, value);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r.edits;
}

describe('the stack - edits on a source, which stays as it was', () => {
  it('never mutates the bytes it was started on', () => {
    const src = unknownLayout();
    const e = edit(startEdits(src), 0x200, 0x42);
    expect(applyBytes(e.source, e.edits)[0x200]).toBe(0x42);
    expect(e.source[0x200]).toBe(0xff);
    expect(src[0x200]).toBe(0xff); // and the caller's array is untouched too
  });

  it('marks exactly what differs from the source - an edit and its reversal cancel out', () => {
    let e = startEdits(unknownLayout());
    e = edit(e, 0x100, 1);
    e = edit(e, 0x201, 2);
    e = edit(e, 0x201, 0xff); // back to what the source holds
    expect(changedAddresses(e)).toEqual([0x100]);
    expect(e.edits).toHaveLength(3);
  });

  it('refuses an edit that changes nothing, so UNDO keeps meaning something', () => {
    const e = startEdits(unknownLayout());
    expect(editByte(e, 0x200, 0xff)).toEqual({ ok: false, reason: 'no-change' });
  });

  it('refuses a value that is not a byte', () => {
    const e = startEdits(unknownLayout());
    expect(editByte(e, 0x200, 256)).toEqual({ ok: false, reason: 'not-a-byte' });
    expect(editByte(e, 0x200, -1)).toEqual({ ok: false, reason: 'not-a-byte' });
  });

  it('takes back one edit at a time, and all of them at once, restoring what was there', () => {
    const src = unknownLayout();
    let e = startEdits(src);
    for (const [a, v] of [[0x050, 1], [0x101, 2], [0x102, 3]] as const) e = edit(e, a, v);
    e = undoLast(e);
    expect(changedAddresses(e)).toEqual([0x050, 0x101]);
    expect(applyBytes(e.source, undoLast(undoLast(e)).edits)[0x050]).toBe(src[0x050]);
    expect(revertAll(e).edits).toHaveLength(0);
    expect(undoLast(startEdits(src)).edits).toHaveLength(0); // nothing to undo is not an error
  });

  it('keeps FIX CHECKSUMS apart from the edits: REVERT takes back the bytes, not the fix', () => {
    const e = { ...edit(startEdits(unknownLayout()), 0x200, 1), reseal: true };
    expect(revertAll(e)).toMatchObject({ edits: [], reseal: true });
  });

  it('compares sources by what they hold, not by which array holds them', () => {
    const a = unknownLayout();
    expect(sameImage(a, Uint8Array.from(a))).toBe(true);
    const b = Uint8Array.from(a);
    b[0x300] ^= 1;
    expect(sameImage(a, b)).toBe(false);
    expect(sameImage(a, null)).toBe(false);
  });
});

describe('byteLock - the bytes another part of the job owns', () => {
  it('keeps the odometer for ODOMETER, and refuses what is not an address', () => {
    const src = lateImage();
    for (const a of [0x00, 0x1f]) expect(byteLock(src, a)).toBe('odometer');
    for (const a of [-1, IMAGE_SIZE, 1.5]) expect(byteLock(src, a)).toBe('outside');
    expect(editByte(startEdits(src), 0x10, 0)).toEqual({ ok: false, reason: 'odometer' });
  });

  it('keeps both VIN fields for VIN', () => {
    const src = lateImage({ asciiVin: 'ZX54321' });
    for (const a of [0x07a, 0x07e, 0x184, 0x18a]) expect(byteLock(src, a)).toBe('vin');
    expect(byteLock(src, 0x183)).toBeNull(); // the byte in front of the ASCII field is not part of it
  });

  it("keeps the late layout's checksums for the job, and its other protected bytes from hand edits", () => {
    const src = lateImage();
    for (const a of [0x16e, 0x3cd, 0x3df]) expect(byteLock(src, a)).toBe('checksum');
    for (const a of [0x07f, 0x087, 0x16f]) expect(byteLock(src, a)).toBe('protected');
    for (const a of [0x020, 0x100, 0x200, 0x320]) expect(byteLock(src, a)).toBeNull();
  });

  it('gives an image of no recognised layout no meaning it has not earned', () => {
    const src = unknownLayout();
    expect(byteLock(src, 0x10)).toBe('odometer');
    expect(byteLock(src, 0x184)).toBe('vin'); // found by the scan, not by the layout
    for (const a of [0x07a, 0x080, 0x16e, 0x3cd]) expect(byteLock(src, a)).toBeNull();
  });
});

describe("SAVE EDITED's file name", () => {
  it('is named like every file the tool saves, by what it holds, and says PRACTICE', () => {
    const when = new Date(2026, 8, 24, 13, 5);
    expect(editedFilename('AB12345', 155_940, when)).toBe('Edited_AB12345_155940km_20260924-1305.bin');
    expect(editedFilename(null, null, when, true)).toBe('PRACTICE_Edited_noVIN_noKM_20260924-1305.bin');
  });
});
