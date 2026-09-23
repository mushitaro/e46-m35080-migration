import { describe, it, expect } from 'vitest';
import {
  VIN_LENGTH,
  encodeVin,
  findVinCandidates,
  isWritableVin,
  readVin,
  vinTarget,
} from '@/lib/domain/vin';
import { readVins, recordVin } from '@/lib/domain/vin';
import { lateImage } from './support/lateImage';
import { IMAGE_SIZE } from '@/lib/domain/image';

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/**
 * The V6 chip on this bench, in shape.
 *
 * The characters are a stand-in for the real ones, which identify a specific
 * car. The substitution costs these tests nothing: the offsets, the length,
 * the NUL terminator and the 0x4C in front are what they assert, and all four
 * are preserved.
 *
 *   0x180  64 06 60 4C 41 42 31 32 33 34 35 00 FF FF FF FF
 *                  ^^ A  B  1  2  3  4  5  NUL
 *                  0x183: an uppercase L, NOT the VIN
 */
function v6Image(): Uint8Array {
  const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
  img.set([0x64, 0x06, 0x60, 0x4c], 0x180);
  img.set(ascii('AB12345'), 0x184);
  img[0x18b] = 0x00;
  return img;
}

describe('VIN - found, not indexed', () => {
  it('reads the chip: seven characters at 0x184, positions 11-17 of the VIN', () => {
    const r = readVin(v6Image());
    expect(r.found).toMatchObject({ offset: 0x184, text: 'AB12345' });
    expect(r.found?.bytes).toHaveLength(VIN_LENGTH);
    expect(r.blank).toBe(false);
  });

  it('does not take the uppercase byte in front as part of the VIN', () => {
    /* The run is eight characters long, because 0x183 holds 0x4C. The car's
       registration VIN shows that is not its 10th character: the chip holds
       the last seven. The app used to read all eight and write eight. */
    const r = readVin(v6Image());
    expect(r.found?.text).toHaveLength(7);
    expect(r.found?.lead).toEqual({ offset: 0x183, text: 'L' });
    expect(findVinCandidates(v6Image()).map((c) => c.text)).toEqual(['AB12345']);
  });

  it('reports no lead when the run is exactly the VIN', () => {
    const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
    img.set(ascii('KT17727'), 0x200);
    expect(readVin(img).found).toMatchObject({ offset: 0x200, text: 'KT17727', lead: null });
  });

  it('takes positions 11-17 out of a full 17-character VIN', () => {
    const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
    img.set(ascii('WBSXX00000AB12345'), 0x200);
    expect(readVin(img).found).toMatchObject({
      offset: 0x20a,
      text: 'AB12345',
      lead: { offset: 0x200, text: 'WBSXX00000' },
    });
  });

  it('does NOT look at 0x2E8', () => {
    /* The old code read seven bytes at 0x2E8 on the strength of a README
       example. On the two real chips that use that part of the array it holds
       00 62 03 F5 02 58 02 .. - near-identical on two DIFFERENT cars, which is
       the one thing a VIN cannot be. Here that data is present AND a real VIN
       sits elsewhere; the reader must return the VIN, not the 0x2E8 bytes. */
    const img = v6Image();
    img.set([0x00, 0x62, 0x03, 0xf5, 0x02, 0x58, 0x02, 0x1a], 0x2e8);
    expect(readVin(img).found).toMatchObject({ offset: 0x184, text: 'AB12345' });
  });

  it('ignores the noise a looser scan would surface', () => {
    /* Real dumps produce "lNFEx", "aEXU6", "Y4SM6", "--JR". Uppercase-only
       kills the first two, the length floor kills the rest. On the four real
       chips this rule yields exactly one hit in total - the V6's VIN. */
    const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
    img.set(ascii('lNFEx'), 0x100);
    img.set(ascii('Y4SM6'), 0x120); // uppercase but only 5 long
    img.set(ascii('--JR'), 0x140);
    expect(findVinCandidates(img)).toEqual([]);
  });

  it('ignores a run longer than a full VIN', () => {
    const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
    img.set(ascii('A'.repeat(18)), 0x200);
    expect(findVinCandidates(img)).toEqual([]);
  });

  it('never returns a candidate inside the secure area', () => {
    /* The odometer counters can hold any byte pattern, including one that
       reads as uppercase ASCII. A hit there would build a plan whose byte
       write targets 0x000-0x01F - and assertWritableRange only rejects that
       inside writeAndVerify, i.e. AFTER the irreversible WRINCs of the same
       job have been committed. The scan must not produce the candidate at
       all. */
    const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
    img.set(ascii('ABCD1234'), 0x08); // squarely inside the secure area
    expect(findVinCandidates(img)).toEqual([]);
    expect(readVin(img).found).toBeNull();
  });

  it('accepts a candidate that starts on the first writable byte', () => {
    const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
    img.set(ascii('ABC1234'), 0x20);
    expect(findVinCandidates(img)[0]).toMatchObject({ offset: 0x20, lead: null });
  });

  it('calls an image with no identifier blank rather than unreadable', () => {
    const r = readVin(new Uint8Array(IMAGE_SIZE).fill(0xff));
    expect(r.blank).toBe(true);
    expect(r.found).toBeNull();
  });

  it('reports every candidate instead of silently picking among them', () => {
    const img = v6Image();
    img.set(ascii('AW72288'), 0x300);
    const r = readVin(img);
    expect(r.candidates).toHaveLength(2);
    expect(r.found?.offset).toBe(0x184);
  });

  it('holds the length at 7', () => {
    const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
    img.set(ascii('ABC123'), 0x200); // six
    expect(findVinCandidates(img)).toEqual([]);
    img.set(ascii('ABC1234'), 0x200); // seven
    expect(findVinCandidates(img)).toHaveLength(1);
    expect(VIN_LENGTH).toBe(7);
  });
});

describe('encodeVin', () => {
  it('writes the seven characters as ASCII', () => {
    expect(Array.from(encodeVin('AB12345'))).toEqual([...ascii('AB12345')]);
  });

  it('upper-cases and trims what the user typed', () => {
    expect(Array.from(encodeVin('  ab12345 '))).toEqual([...ascii('AB12345')]);
  });

  it('accepts no letter/digit pattern of its own', () => {
    /* Two real examples, both two letters and five digits. That is not
       enough to make a rule of, and a rule fitted to one example has already
       rejected a real VIN in this project. */
    expect(isWritableVin('KT17727')).toBe(true);
    expect(isWritableVin('1234567')).toBe(true);
  });

  it('refuses anything that is not seven uppercase alphanumerics', () => {
    for (const bad of [
      '',
      'SHORT',
      'AB-1234',
      'AB 1234',
      'LAB12345', // the eight the app used to read
      'WBSXX00000AB12345', // a full VIN: the chip holds only its last seven
      'A'.repeat(18),
    ]) {
      expect(() => encodeVin(bad)).toThrow(RangeError);
      expect(isWritableVin(bad)).toBe(false);
    }
  });
});

describe('vinTarget - a VIN can only replace one that is there', () => {
  it('aims at the offset the scan found, never a constant - and not at the byte in front', () => {
    expect(vinTarget(v6Image())).toMatchObject({ ok: true, offset: 0x184 });
  });

  it('refuses a chip with no VIN, because there is no address to use', () => {
    /* Not a limitation to work around. A new chip is meant to go in with no
       VIN; the VIN is coded over OBD once the car is connected. Inventing an
       offset here is exactly how 0x2E8 got into this codebase. */
    const t = vinTarget(new Uint8Array(IMAGE_SIZE).fill(0xff));
    expect(t).toEqual({ ok: false, reason: 'no-vin-on-chip' });
  });
});

describe('readVins - the two fields', () => {
  it('reads the coded field and the ASCII field separately and says when they differ', () => {
    const v = readVins(lateImage({ codedVin: 'AB12345', asciiVin: 'CD67890' }));
    expect(v.coded).toEqual({ text: 'AB12345', from: 0x07a, to: 0x07e });
    expect(v.ascii?.text).toBe('CD67890');
    expect(v.ascii?.offset).toBe(0x184);
    expect(v.differ).toBe(true);
    expect(v.none).toBe(false);
  });

  it('does not report DIFFER when the two fields agree', () => {
    expect(readVins(lateImage({ codedVin: 'AB12345', asciiVin: 'AB12345' })).differ).toBe(false);
  });

  it('reads no coded field outside a late layout, however VIN-shaped 0x07A looks', () => {
    const img = new Uint8Array(1024).fill(0x00);
    img.set([0x41, 0x42, 0x12, 0x34, 0x50], 0x07a);
    const v = readVins(img);
    expect(v.coded).toBeNull();
    expect(v.none).toBe(true);
  });

  it('names a record by the ASCII field, then the coded field, then nothing', () => {
    expect(recordVin(lateImage({ codedVin: 'AB12345', asciiVin: 'CD67890' }))).toBe('CD67890');
    expect(recordVin(lateImage({ codedVin: 'AB12345' }))).toBe('AB12345');
    expect(recordVin(new Uint8Array(1024).fill(0xff))).toBeNull();
  });
});
