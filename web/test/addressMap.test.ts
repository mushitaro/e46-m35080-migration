import { describe, it, expect } from 'vitest';
import {
  explainAddress,
  odometerArithmetic,
  odometerSlots,
  vinRanges,
} from '@/lib/domain/addressMap';
import { lateImage } from './support/lateImage';
import { IMAGE_SIZE } from '@/lib/domain/image';
import { encodeOdometer, slotsToBytes } from '@/lib/domain/odometer';

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** The bench chip: 155,940 km, 0x4C at 0x183, AB12345 at 0x184, NUL at 0x18B. */
function chip(km = 155_940): Uint8Array {
  const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
  img.set(slotsToBytes(encodeOdometer(km)), 0);
  img[0x183] = 0x4c;
  img.set(ascii('AB12345'), 0x184);
  img[0x18b] = 0x00;
  return img;
}

describe('odometer slots - the address of every register', () => {
  it('lays sixteen big-endian registers over 0x000-0x01F', () => {
    const s = odometerSlots(chip());
    expect(s).toHaveLength(16);
    expect(s[0]).toMatchObject({ from: 0x00, to: 0x01 });
    expect(s[15]).toMatchObject({ from: 0x1e, to: 0x1f });
  });

  it('marks exactly the registers that carry the 1 km remainder', () => {
    // 155,940 = 9746 * 16 + 4, so four registers hold base + 1.
    const s = odometerSlots(chip(155_940));
    expect(s.filter((x) => x.role === 'bumped')).toHaveLength(4);
    expect(s.filter((x) => x.role === 'base')).toHaveLength(12);
    expect(s.filter((x) => x.role === 'odd')).toHaveLength(0);
  });

  it('shows the arithmetic with the real numbers in it', () => {
    const m = odometerArithmetic(chip(155_940));
    expect(m).toMatchObject({ ok: true, base: 9746, bumped: 4, km: 155_940 });
    if (m.ok) expect(m.expression).toBe('9,746 x 16 + 4 = 155,940');
  });

  it('says it cannot decode rather than inventing a reading', () => {
    const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
    img.set([0x00, 0x01, 0x00, 0x09, 0x00, 0x20], 0); // three unrelated runs
    const m = odometerArithmetic(img);
    expect(m.ok).toBe(false);
  });
});

describe('explainAddress - named only where naming is earned', () => {
  it('names both halves of an odometer register', () => {
    const img = chip();
    expect(explainAddress(img, 0x00)).toMatchObject({ kind: 'odometer', slot: 0, half: 'high' });
    expect(explainAddress(img, 0x01)).toMatchObject({ kind: 'odometer', slot: 0, half: 'low' });
    expect(explainAddress(img, 0x1f)).toMatchObject({ kind: 'odometer', slot: 15, half: 'low' });
  });

  it('names the VIN where the scan found it, with the character index', () => {
    const e = explainAddress(chip(), 0x186);
    expect(e).toMatchObject({ kind: 'vin', field: 'ascii', from: 0x184, to: 0x18a, charIndex: 2 });
  });

  it('does not call the letter in front of the VIN part of it', () => {
    expect(explainAddress(chip(), 0x183)).toEqual({ kind: 'unidentified' });
  });

  it('refuses to name 0x2E8', () => {
    /* The address this project spent weeks calling "the VIN". It is inside the
       standard array and nothing establishes what it holds, so the only honest
       answer is that we do not know. */
    expect(explainAddress(chip(), 0x2e8)).toEqual({ kind: 'unidentified' });
  });

  it('leaves the bulk of the chip unidentified', () => {
    const img = chip();
    let unknown = 0;
    for (let a = 0; a < IMAGE_SIZE; a++) {
      if (explainAddress(img, a).kind === 'unidentified') unknown++;
    }
    // 1024 - 32 odometer bytes - 7 VIN bytes
    expect(unknown).toBe(IMAGE_SIZE - 32 - 7);
  });
});

describe('vinRanges - what the hex view tints', () => {
  it('reports the found ASCII range, not a constant', () => {
    expect(vinRanges(chip())).toEqual([{ from: 0x184, to: 0x18a, field: 'ascii' }]);
  });

  it('reports the coded field too, first, on a late-layout image', () => {
    expect(vinRanges(lateImage({ asciiVin: 'CD67890' }))).toEqual([
      { from: 0x07a, to: 0x07e, field: 'coded' },
      { from: 0x184, to: 0x18a, field: 'ascii' },
    ]);
  });

  it('is empty when there is no VIN, so nothing is tinted', () => {
    expect(vinRanges(new Uint8Array(IMAGE_SIZE).fill(0xff))).toEqual([]);
    expect(vinRanges(null)).toEqual([]);
  });
});

describe('explainAddress on the coded VIN', () => {
  it('names each byte of 0x07A-0x07E and the first character it holds', () => {
    const img = lateImage({ codedVin: 'CD67890' });
    expect([0x07a, 0x07b, 0x07c, 0x07d, 0x07e].map((a) => explainAddress(img, a))).toEqual([
      { kind: 'vin', field: 'coded', from: 0x07a, to: 0x07e, text: 'CD67890', charIndex: 0 },
      { kind: 'vin', field: 'coded', from: 0x07a, to: 0x07e, text: 'CD67890', charIndex: 1 },
      { kind: 'vin', field: 'coded', from: 0x07a, to: 0x07e, text: 'CD67890', charIndex: 2 },
      { kind: 'vin', field: 'coded', from: 0x07a, to: 0x07e, text: 'CD67890', charIndex: 4 },
      { kind: 'vin', field: 'coded', from: 0x07a, to: 0x07e, text: 'CD67890', charIndex: 6 },
    ]);
  });

  it('does not name 0x07A on an image that is not a late layout', () => {
    const img = chip();
    img.set([0x41, 0x42, 0x12, 0x34, 0x50], 0x07a);
    expect(explainAddress(img, 0x07a)).toEqual({ kind: 'unidentified' });
  });
});
