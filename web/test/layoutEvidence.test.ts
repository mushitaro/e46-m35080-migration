import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectLayout, readCodedVin } from '@/lib/domain/layout';
import { readVin } from '@/lib/domain/vin';

/**
 * The layout rules, replayed against REAL chip images - local only.
 *
 * Real images identify cars and are never committed, so this suite runs only when the operator
 * points it at some: M35080_DUMPS is a list of .bin paths separated by `;`. CI has none and
 * reports the suite as skipped, which is what it is.
 *
 * It asserts aggregates and shapes, never values: a failing run must not print a VIN.
 *
 *   $env:M35080_DUMPS = "C:\...\a.bin;C:\...\b.bin"; npx vitest run test/layoutEvidence.test.ts
 */

const paths = (process.env.M35080_DUMPS ?? '')
  .split(';')
  .map((p) => p.trim())
  .filter(Boolean);

describe.runIf(paths.length > 0)('layout evidence on real chips (M35080_DUMPS)', () => {
  const images = paths.map((p) => ({ p, img: new Uint8Array(readFileSync(p)) }));

  it('reads only 1024-byte images', () => {
    for (const { img } of images) expect(img.length).toBe(1024);
  });

  it('every late-layout chip has BOTH checksums holding and a VIN-shaped coded field', () => {
    const late = images.filter(({ img }) => detectLayout(img).kind === 'late');
    expect(late.length).toBeGreaterThan(0);
    for (const { img } of late) {
      const l = detectLayout(img);
      expect(l.kind === 'late' && l.consistent).toBe(true);
      expect(readCodedVin(img).ok).toBe(true);
    }
  });

  it('reports, without printing them, whether the coded and ASCII VINs agree', () => {
    // Recorded as counts only. On the one bench chip that carries an ASCII run they differ,
    // which is why the app shows both fields instead of choosing one (vin.ts).
    const tally = { both: 0, differ: 0, codedOnly: 0, asciiOnly: 0, neither: 0 };
    for (const { img } of images) {
      const coded = readCodedVin(img);
      const ascii = readVin(img).found;
      if (coded.ok && ascii) {
        tally.both++;
        if (coded.text !== ascii.text) tally.differ++;
      } else if (coded.ok) tally.codedOnly++;
      else if (ascii) tally.asciiOnly++;
      else tally.neither++;
    }
    console.log(`coded/ASCII VIN tally over ${images.length} image(s):`, tally);
    expect(tally.both + tally.codedOnly + tally.asciiOnly + tally.neither).toBe(images.length);
  });
});
