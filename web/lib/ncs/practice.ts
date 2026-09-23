/**
 * PRACTICE's chip, made to fit a coding definition - so CODING can be rehearsed the way it is done
 * on a real chip: CONNECT, READ, REWRITE, pick, WRITE CHIP, with nothing opened from disk.
 *
 * The preset practice chip is made-up filler (lib/link/mockLink.ts, `late`), and no real
 * definition fits made-up values. This takes that chip and, for one definition the reader's
 * reference data holds, sets every switchable parameter the filler left on no option to the
 * definition's first option, and the coding index to the definition's own - then reseals the
 * checksums and keeps the result only if chooseDefinition picks that definition. The odometer
 * area is never touched, and the coded VIN is put back as it was.
 *
 * Nothing BMW is in this file: it reads whatever definitions the reference data holds, at run
 * time, and the chip it makes lives in memory for the practice session only. The values are the
 * definition's options, so the chip is a plausible one - still not any car's.
 */

import { CODED_VIN_AT, CODED_VIN_BYTES, recomputeChecksums } from '@/lib/domain/layout';
import { STANDARD_START } from '@/lib/domain/image';
import type { CodingDoc, CodingParameter } from '@/lib/refdata/types';
import { be, chooseDefinition, ctz, currentOption, definitionRefusal, isScalar, optionValue } from './decode';
import { codingIndexOf } from './definition';

/** Put `value` under a scalar parameter's mask, keeping every other bit of its bytes. */
function writeScalar(image: Uint8Array, p: CodingParameter, value: number): void {
  const mask = be(p.mask);
  const current = be(image.subarray(p.address, p.address + p.length));
  const next = ((current & ~mask) | ((value << ctz(mask)) & mask)) >>> 0;
  for (let i = 0; i < p.length; i++) image[p.address + i] = Math.floor(next / 2 ** (8 * (p.length - 1 - i))) % 256;
}

/**
 * A copy of `base` that one of `doc`'s definitions fits - the newest usable one first - with the
 * definition's file, or null when none can be made to fit.
 */
export function codedPracticeChip(base: Uint8Array, doc: CodingDoc): { image: Uint8Array; file: string } | null {
  const files = Object.keys(doc.definitions)
    .filter((f) => definitionRefusal(doc.definitions[f]!) === null && codingIndexOf(doc.definitions[f]!) !== null)
    .sort()
    .reverse();
  for (const file of files) {
    const def = doc.definitions[file]!;
    const image = Uint8Array.from(base);
    for (const p of def.parameters) {
      // Never the odometer; a parameter the filler already set to one of its options is left as it is.
      if (p.address < STANDARD_START || !isScalar(p)) continue;
      if (p.kind === 'fsw' && p.options.length > 0 && !currentOption(image, p)) writeScalar(image, p, optionValue(p.options[0]!));
      if (p.kind === 'dir' && p.keyword === 'CODIERINDEX') writeScalar(image, p, codingIndexOf(def)!);
    }
    image.set(base.subarray(CODED_VIN_AT, CODED_VIN_AT + CODED_VIN_BYTES), CODED_VIN_AT);
    const sealed = recomputeChecksums(image).image;
    const choice = chooseDefinition(sealed, doc);
    if (choice.kind === 'chosen' && choice.file === file) return { image: sealed, file };
  }
  return null;
}
