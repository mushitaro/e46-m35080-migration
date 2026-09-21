import { describe, it, expect } from 'vitest';
import {
  VIN_MIN_LENGTH,
  encodeVin,
  findVinCandidates,
  isWritableVin,
  readVin,
  vinTarget,
} from '@/lib/domain/vin';
import { IMAGE_SIZE } from '@/lib/domain/image';

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/**
 * The V6 chip on this bench, in shape.
 *
 * The characters are a stand-in for the real ones, which identify a specific
 * car. The substitution is deliberate and costs these tests nothing: the
 * length, the three-letter prefix, the offset and the NUL terminator are what
 * they assert, and all four are preserved.
 *
 *   0x180  64 06 60 41 42 43 31 32 33 34 35 00 FF FF FF FF
 *                   A  B  C  1  2  3  4  5  NUL
 */
function v6Image(): Uint8Array {
  const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
  img.set([0x64, 0x06, 0x60], 0x180);
  img.set(ascii('ABC12345'), 0x183);
  img[0x18b] = 0x00;
  return img;
}

describe('VIN - found, not indexed', () => {
  it('reads the chip: an 8-character ASCII run at 0x183', () => {
    const r = readVin(v6Image());
    expect(r.found).toMatchObject({ offset: 0x183, text: 'ABC12345' });
    expect(r.blank).toBe(false);
  });

  it('does NOT look at 0x2E8', () => {
    /* The old code read seven bytes at 0x2E8 on the strength of a README
       example. On the two real chips that use that part of the array it holds
       00 62 03 F5 02 58 02 .. - near-identical on two DIFFERENT cars, which is
       the one thing a VIN cannot be. Here that data is present AND a real VIN
       sits elsewhere; the reader must return the VIN, not the 0x2E8 bytes. */
    const img = v6Image();
    img.set([0x00, 0x62, 0x03, 0xf5, 0x02, 0x58, 0x02, 0x1a], 0x2e8);
    expect(readVin(img).found).toMatchObject({ offset: 0x183, text: 'ABC12345' });
  });

  it('accepts a VIN the old 2-letters-5-digits rule rejected', () => {
    /* The bench VIN is three letters and eight characters. A pattern fitted to
       the README's KT17727 threw away the actual VIN of the car in front of
       us - it only accepted two letters and five digits. */
    expect(findVinCandidates(v6Image()).map((c) => c.text)).toEqual(['ABC12345']);
    expect(isWritableVin('ABC12345')).toBe(true);
    expect(isWritableVin('KT17727')).toBe(true);
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
    img.set(ascii('ABCD1234'), 0x20);
    expect(findVinCandidates(img)[0]).toMatchObject({ offset: 0x20 });
  });

  it('calls an image with no identifier blank rather than unreadable', () => {
    const r = readVin(new Uint8Array(IMAGE_SIZE).fill(0xff));
    expect(r.blank).toBe(true);
    expect(r.found).toBeNull();
  });

  it('reports every candidate instead of silently picking among them', () => {
    const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
    img.set(ascii('ABC12345'), 0x183);
    img.set(ascii('AW72288'), 0x300);
    const r = readVin(img);
    expect(r.candidates).toHaveLength(2);
    expect(r.found?.offset).toBe(0x183);
  });

  it('holds the length floor at 7', () => {
    const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
    img.set(ascii('ABC123'), 0x200); // six
    expect(findVinCandidates(img)).toEqual([]);
    img.set(ascii('ABC1234'), 0x200); // seven
    expect(findVinCandidates(img)).toHaveLength(1);
    expect(VIN_MIN_LENGTH).toBe(7);
  });
});

describe('encodeVin', () => {
  it('writes the characters as ASCII', () => {
    expect(Array.from(encodeVin('ABC12345'))).toEqual([...ascii('ABC12345')]);
  });

  it('upper-cases and trims what the user typed', () => {
    expect(Array.from(encodeVin('  abc12345 '))).toEqual([...ascii('ABC12345')]);
  });

  it('refuses anything that is not uppercase alphanumeric', () => {
    for (const bad of ['', 'SHORT', 'LEX-2114', 'LEX 2114', 'A'.repeat(18)]) {
      expect(() => encodeVin(bad)).toThrow(RangeError);
      expect(isWritableVin(bad)).toBe(false);
    }
  });
});

describe('vinTarget - a VIN can only replace one that is there', () => {
  it('aims at the offset the scan found, never a constant', () => {
    const t = vinTarget(v6Image(), 'ABC12346');
    expect(t).toMatchObject({ ok: true, offset: 0x183, sameLength: true });
  });

  it('refuses a chip with no VIN, because there is no address to use', () => {
    /* Not a limitation to work around. A new chip is meant to go in with no
       VIN; the VIN is coded over OBD once the car is connected. Inventing an
       offset here is exactly how 0x2E8 got into this codebase. */
    const t = vinTarget(new Uint8Array(IMAGE_SIZE).fill(0xff), 'ABC12345');
    expect(t).toEqual({ ok: false, reason: 'no-vin-on-chip' });
  });

  it('notices a length change, which would run past the field', () => {
    expect(vinTarget(v6Image(), 'KT17727')).toMatchObject({ ok: true, sameLength: false });
  });
});
