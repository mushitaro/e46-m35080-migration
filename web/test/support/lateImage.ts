/**
 * A synthetic late-layout image, built in code from made-up values.
 *
 * No real chip image is committed (THIRD-PARTY-NOTICES.md 3.1), so tests that need "a chip whose
 * checksums hold" build one: pseudo-random data in both checksummed regions (seeded, so every run
 * is the same image), a coded VIN, and checksums computed by the rule under test's OWN inputs -
 * a fixture that computed them with layout.ts would prove only that layout.ts agrees with itself,
 * so the XOR is spelled out again here.
 */

import { IMAGE_SIZE } from '@/lib/domain/image';
import { encodeVin } from '@/lib/domain/vin';
import { slotsToBytes, encodeOdometer } from '@/lib/domain/odometer';

export type LateImageOptions = {
  seed?: number;
  km?: number;
  /** Written into the coded field at 0x07A: two characters, then five digits. */
  codedVin?: string;
  /** Written as the ASCII run at 0x184, like the one V6 chip that carries it. Omit for none. */
  asciiVin?: string | null;
  /** The value the low nibble of 0x07E carries (not part of the VIN). */
  lowNibble07E?: number;
};

export function lateImage(opts: LateImageOptions = {}): Uint8Array {
  const { seed = 7, km = 155_940, codedVin = 'AB12345', asciiVin = null, lowNibble07E = 0x5 } = opts;
  const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
  img.set(slotsToBytes(encodeOdometer(km)), 0);

  let x = seed >>> 0;
  const next = () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x >>> 24;
  };
  for (let a = 0x020; a <= 0x16d; a++) img[a] = next();
  for (let a = 0x310; a <= 0x3cc; a++) img[a] = next();

  // Coded VIN at 0x07A: ASCII, ASCII, then BCD nibbles; 0x07E keeps its own low nibble.
  const d = Array.from(codedVin.slice(2), (c) => c.charCodeAt(0) - 0x30);
  img[0x07a] = codedVin.charCodeAt(0);
  img[0x07b] = codedVin.charCodeAt(1);
  img[0x07c] = (d[0]! << 4) | d[1]!;
  img[0x07d] = (d[2]! << 4) | d[3]!;
  img[0x07e] = (d[4]! << 4) | (lowNibble07E & 0x0f);

  if (asciiVin) {
    img[0x183] = 0x4c; // the byte in front that is NOT part of it (vin.ts)
    img.set(encodeVin(asciiVin), 0x184);
    img[0x18b] = 0x00;
  }

  let c1 = 0;
  for (let a = 0x070; a <= 0x16d; a++) c1 ^= img[a]!;
  img[0x16e] = c1;
  let c2 = 0;
  for (let a = 0x310; a <= 0x3cc; a++) c2 ^= img[a]!;
  img[0x3cd] = c2;
  img[0x3df] = c2;
  return img;
}
