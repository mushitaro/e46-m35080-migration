import { describe, it, expect } from 'vitest';
import {
  CHECKSUM_REGIONS,
  PROTECTED_RANGES,
  CODABLE_RANGES,
  checksumStatus,
  detectLayout,
  recomputeChecksums,
  readCodedVin,
  encodeCodedVin,
  fitsCodedVin,
  inRanges,
  checksumRegionOf,
} from '@/lib/domain/layout';
import { IMAGE_SIZE } from '@/lib/domain/image';
import { lateImage } from './support/lateImage';

describe('checksums of the late layout', () => {
  it('hold on a consistent image, including the mirror at 0x3DF', () => {
    const s = checksumStatus(lateImage());
    expect(s.map((c) => [c.id, c.at, c.ok, c.degenerate])).toEqual([
      ['coding', 0x16e, true, false],
      ['maker', 0x3cd, true, false],
    ]);
    expect(s[1]!.mirrors).toEqual([{ at: 0x3df, stored: s[1]!.computed }]);
  });

  it('breaks the coding checksum when a byte inside 0x070-0x16D changes, and only that one', () => {
    const img = lateImage();
    img[0x071] ^= 0x02;
    const s = checksumStatus(img);
    expect(s[0]!.ok).toBe(false);
    expect(s[1]!.ok).toBe(true);
  });

  it('breaks the maker checksum when its mirror disagrees', () => {
    const img = lateImage();
    img[0x3df] ^= 0xff;
    expect(checksumStatus(img)[1]!.ok).toBe(false);
  });

  it('leaves both alone for a change outside every region (the ASCII VIN area)', () => {
    const img = lateImage({ asciiVin: 'CD67890' });
    img[0x185] = 0x5a;
    expect(checksumStatus(img).every((c) => c.ok)).toBe(true);
  });
});

describe('detectLayout', () => {
  it('recognises a late image by its checksums', () => {
    const l = detectLayout(lateImage());
    expect(l.kind).toBe('late');
    expect(l.kind === 'late' && l.consistent).toBe(true);
  });

  it('still recognises it - and reports it inconsistent - when one checksum was broken by an edit', () => {
    const img = lateImage();
    img[0x100] ^= 0x10;
    const l = detectLayout(img);
    expect(l.kind).toBe('late');
    expect(l.kind === 'late' && l.consistent).toBe(false);
  });

  it('does not call a blank chip, a zeroed image or a one-value fill late - a matching XOR of nothing proves nothing', () => {
    const blank = new Uint8Array(IMAGE_SIZE).fill(0xff);
    const zero = new Uint8Array(IMAGE_SIZE).fill(0x00); // XOR of zeros is zero: the checksum "holds"
    const a5 = new Uint8Array(IMAGE_SIZE).fill(0xa5);
    for (const img of [blank, zero, a5]) expect(detectLayout(img).kind).toBe('unknown');
  });

  it('does not call an image late when neither checksum holds', () => {
    const img = lateImage();
    img[0x16e] ^= 0x01;
    img[0x3cd] ^= 0x01;
    expect(detectLayout(img).kind).toBe('unknown');
  });
});

describe('recomputeChecksums', () => {
  it('writes nothing when the checksums already hold', () => {
    expect(recomputeChecksums(lateImage()).writes).toEqual([]);
  });

  it('fixes a broken coding checksum and names the one byte it changed', () => {
    const img = lateImage();
    const before = img[0x16e]!;
    img[0x090] ^= 0x33;
    const r = recomputeChecksums(img);
    expect(r.writes).toEqual([{ address: 0x16e, before, after: before ^ 0x33 }]);
    expect(checksumStatus(r.image).every((c) => c.ok)).toBe(true);
    expect(img[0x16e]).toBe(before); // the input is not mutated
  });

  it('restores the mirror too', () => {
    const img = lateImage();
    const good = img[0x3cd]!;
    img[0x3df] = good ^ 0x0f;
    expect(recomputeChecksums(img).writes).toEqual([{ address: 0x3df, before: good ^ 0x0f, after: good }]);
  });
});

describe('the coded VIN at 0x07A', () => {
  it('reads two characters and five BCD digits', () => {
    expect(readCodedVin(lateImage({ codedVin: 'CD67890' }))).toEqual({ ok: true, text: 'CD67890', offset: 0x07a });
  });

  it('is not read at all outside a late image', () => {
    const img = new Uint8Array(IMAGE_SIZE).fill(0x00);
    img.set([0x41, 0x42, 0x12, 0x34, 0x50], 0x07a);
    expect(readCodedVin(img)).toEqual({ ok: false, reason: 'not-late-layout' });
  });

  it('refuses bytes that are not VIN-shaped rather than inventing a VIN from them', () => {
    const img = lateImage();
    img[0x07c] = 0xa1; // a nibble above 9 cannot be a digit
    const fixed = recomputeChecksums(img).image; // keep the image late so the shape is what fails
    expect(readCodedVin(fixed)).toEqual({ ok: false, reason: 'not-vin-shaped' });
  });

  it('encodes the five bytes and keeps the low nibble of 0x07E', () => {
    const img = lateImage({ lowNibble07E: 0xc });
    expect(Array.from(encodeCodedVin(img, 'kz12345'))).toEqual([0x4b, 0x5a, 0x12, 0x34, 0x5c]);
  });

  it('only accepts VINs whose last five characters are digits', () => {
    expect(fitsCodedVin('AB12345')).toBe(true);
    expect(fitsCodedVin('A123456')).toBe(true);
    expect(fitsCodedVin('ABC1234')).toBe(false);
    expect(fitsCodedVin('AB1234')).toBe(false);
    expect(() => encodeCodedVin(lateImage(), 'ABC1234')).toThrow(RangeError);
  });

  it('round-trips through a write and a checksum recompute', () => {
    const img = lateImage({ codedVin: 'AB12345' });
    img.set(encodeCodedVin(img, 'GH24680'), 0x07a);
    const fixed = recomputeChecksums(img);
    expect(fixed.writes.map((w) => w.address)).toEqual([0x16e]);
    expect(readCodedVin(fixed.image)).toMatchObject({ ok: true, text: 'GH24680' });
  });
});

describe('coding limits', () => {
  it('keeps every checksum address and the VIN/offset/calibration bytes protected', () => {
    for (const r of CHECKSUM_REGIONS) {
      for (const at of [r.at, ...r.mirrors]) expect(inRanges(at, PROTECTED_RANGES)).toBe(true);
    }
    for (let a = 0x07a; a <= 0x087; a++) expect(inRanges(a, PROTECTED_RANGES)).toBe(true);
    for (let a = 0x000; a <= 0x01f; a++) expect(inRanges(a, PROTECTED_RANGES)).toBe(true);
  });

  it('allows coding only inside the two checksummed regions', () => {
    expect(CODABLE_RANGES).toEqual(CHECKSUM_REGIONS.map((r) => [r.from, r.to]));
    expect(inRanges(0x06f, CODABLE_RANGES)).toBe(false);
    expect(inRanges(0x200, CODABLE_RANGES)).toBe(false);
    expect(checksumRegionOf(0x071)?.id).toBe('coding');
    expect(checksumRegionOf(0x3cc)?.id).toBe('maker');
    expect(checksumRegionOf(0x3cd)).toBeNull();
  });
});
