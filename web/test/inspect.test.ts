import { describe, it, expect } from 'vitest';
import {
  changedAddresses,
  editByte,
  editedFilename,
  isDirty,
  openWorkspace,
  revertAll,
  undoLast,
  verdictFor,
  fixChecksums,
} from '@/lib/domain/inspect';
import { detectLayout } from '@/lib/domain/layout';
import { lateImage } from './support/lateImage';
import { IMAGE_SIZE, SPI_DUMMY } from '@/lib/domain/image';
import { encodeOdometer, slotsToBytes } from '@/lib/domain/odometer';

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

function realish(): Uint8Array {
  const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
  img.set(slotsToBytes(encodeOdometer(155_940)), 0);
  img[0x183] = 0x4c;
  img.set(ascii('AB12345'), 0x184);
  for (let i = 0x40; i < 0x80; i++) img[i] = (i * 7 + 13) & 0xff;
  return img;
}

describe('the workspace - a file, kept apart from the chip', () => {
  it('never mutates the bytes it was opened with', () => {
    const src = realish();
    const ws = openWorkspace('d.bin', src);
    const r = editByte(ws, 0x200, 0x42);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workspace.current[0x200]).toBe(0x42);
    expect(r.workspace.original[0x200]).toBe(0xff);
    // and the caller's array is untouched too
    expect(src[0x200]).toBe(0xff);
  });

  it('marks exactly what differs from the file', () => {
    let ws = openWorkspace('d.bin', realish());
    expect(isDirty(ws)).toBe(false);
    for (const [a, v] of [[0x100, 1], [0x201, 2]] as const) {
      const r = editByte(ws, a, v);
      if (r.ok) ws = r.workspace;
    }
    expect(changedAddresses(ws)).toEqual([0x100, 0x201]);
    expect(isDirty(ws)).toBe(true);
  });

  it('refuses an edit that changes nothing, so undo keeps meaning something', () => {
    /* An undo stack full of no-ops is an undo button that does not move the
       bytes when pressed. */
    const ws = openWorkspace('d.bin', realish());
    expect(editByte(ws, 0x200, 0xff)).toEqual({ ok: false, reason: 'no-change' });
    expect(ws.edits).toHaveLength(0);
  });

  it('refuses an address or a value that is not one', () => {
    const ws = openWorkspace('d.bin', realish());
    expect(editByte(ws, IMAGE_SIZE, 1)).toEqual({ ok: false, reason: 'out-of-range' });
    expect(editByte(ws, -1, 1)).toEqual({ ok: false, reason: 'out-of-range' });
    expect(editByte(ws, 0x200, 256)).toEqual({ ok: false, reason: 'not-a-byte' });
    expect(editByte(ws, 0x200, -1)).toEqual({ ok: false, reason: 'not-a-byte' });
  });

  it('takes back one edit at a time, and all of them at once', () => {
    let ws = openWorkspace('d.bin', realish());
    for (const [a, v] of [[0x100, 1], [0x101, 2], [0x102, 3]] as const) {
      const r = editByte(ws, a, v);
      if (r.ok) ws = r.workspace;
    }
    ws = undoLast(ws);
    expect(changedAddresses(ws)).toEqual([0x100, 0x101]);
    expect(revertAll(ws).edits).toHaveLength(0);
    expect(isDirty(revertAll(ws))).toBe(false);
  });

  it('restores the byte that was there, not a zero', () => {
    let ws = openWorkspace('d.bin', realish());
    const was = ws.current[0x50];
    const r = editByte(ws, 0x50, (was + 1) & 0xff);
    if (r.ok) ws = r.workspace;
    expect(undoLast(ws).current[0x50]).toBe(was);
  });

  it('undoing with nothing to undo is not an error', () => {
    const ws = openWorkspace('d.bin', realish());
    expect(undoLast(ws)).toEqual(ws);
  });
});

describe('editedFilename - a save never lands on its source', () => {
  it('builds a new name from the old stem', () => {
    const at = new Date('2026-09-23T10:20:30Z');
    expect(editedFilename('M35080 V6.BIN', at)).toBe('M35080 V6_edited_20260923102030.bin');
  });

  it('never returns the name it was given', () => {
    /* These files are often the only record of a chip that has since been
       written over. Overwriting one with an experiment is unrecoverable. */
    const at = new Date('2026-09-23T10:20:30Z');
    for (const n of ['a.bin', 'a', 'a.b.bin', 'UPPER.BIN']) {
      expect(editedFilename(n, at)).not.toBe(n);
      expect(editedFilename(n, at).endsWith('.bin')).toBe(true);
    }
  });
});

describe('verdictFor - is this file a chip read at all?', () => {
  it('names a loopback dump for what it is', () => {
    /* 1024 bytes of 0xA5 is D11 shorted to D12 - the dummy byte coming back.
       An odometer decoded from it would be a confident number about nothing. */
    const v = verdictFor(new Uint8Array(IMAGE_SIZE).fill(SPI_DUMMY));
    expect(v).toMatchObject({ uniform: true, uniformValue: SPI_DUMMY, distinct: 1 });
  });

  it('names a floating line, at either rail', () => {
    for (const fill of [0x00, 0xff]) {
      expect(verdictFor(new Uint8Array(IMAGE_SIZE).fill(fill))).toMatchObject({
        uniform: true,
        uniformValue: fill,
      });
    }
  });

  it('does not call a real image uniform', () => {
    const v = verdictFor(realish());
    expect(v.uniform).toBe(false);
    expect(v.uniformValue).toBeNull();
    expect(v.distinct).toBeGreaterThan(50);
  });

  it('separates a blank chip from a dead bus', () => {
    /* A virgin M35080 is 0x00 in the counters and 0xFF in the array - two
       values, not one. Calling that "no response" would reject every new chip. */
    const blank = new Uint8Array(IMAGE_SIZE).fill(0xff);
    blank.fill(0x00, 0, 0x20);
    const v = verdictFor(blank);
    expect(v.uniform).toBe(false);
    expect(v.distinct).toBe(2);
    expect(v.secureBlank).toBe(true);
    expect(v.standardErased).toBe(true);
  });

  it('reports a used chip as neither blank nor erased', () => {
    const v = verdictFor(realish());
    expect(v.secureBlank).toBe(false);
    expect(v.standardErased).toBe(false);
  });
});

describe('fixChecksums - the explicit repair', () => {
  it('puts a broken checksum right as an ordinary, undoable edit', () => {
    const img = lateImage();
    const good = img[0x16e]!;
    let ws = openWorkspace('x.bin', img);
    const e = editByte(ws, 0x080, img[0x080]! ^ 0x04);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    ws = e.workspace;
    expect(detectLayout(ws.current)).toMatchObject({ kind: 'late', consistent: false });

    const f = fixChecksums(ws);
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(detectLayout(f.workspace.current)).toMatchObject({ kind: 'late', consistent: true });
    expect(f.workspace.edits.at(-1)).toEqual({ address: 0x16e, before: good, after: good ^ 0x04 });
    // Undo takes the fix back and the checksum is broken again: nothing happened behind the reader.
    expect(detectLayout(undoLast(f.workspace).current)).toMatchObject({ consistent: false });
  });

  it('does nothing to a consistent image and refuses an unrecognised one', () => {
    expect(fixChecksums(openWorkspace('x.bin', lateImage()))).toEqual({ ok: false, reason: 'no-change' });
    expect(fixChecksums(openWorkspace('x.bin', new Uint8Array(1024).fill(0x11)))).toEqual({
      ok: false,
      reason: 'not-late-layout',
    });
  });
});
