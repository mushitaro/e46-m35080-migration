/**
 * A synthetic coding definition, built around a synthetic late-layout image.
 *
 * Nothing here is BMW's: the keywords are invented (DEMO_*), the options are whatever the
 * synthetic image happens to hold plus made-up alternatives, and the one real thing - the late
 * coding-block layout - is numbers this repository already states (lib/ncs/definition.ts). What
 * it reproduces is the SHAPE the rules were measured on: informative, tautological,
 * single-option and array parameters; one inside a protected range; one below 0x070; the coding
 * index the chip carries.
 */

import { LATE_CODING_BLOCKS } from '@/lib/ncs/definition';
import type { CodingDefinition, CodingDoc, CodingParameter, FswParameter } from '@/lib/refdata/types';
import { lateImage } from './lateImage';

const opt = (keyword: string, id: number, value: number, width = 1) => ({
  keyword,
  id,
  data: Array.from({ length: width }, (_, i) => (value >> (8 * (width - 1 - i))) & 0xff),
});

function fsw(keyword: string, address: number, mask: number[], options: FswParameter['options'], length = mask.length): FswParameter {
  return { kind: 'fsw', keyword, id: 0, block: null, address, length, index: null, mask, unit: null, individual: null, options };
}

/** A value different from `v` inside a field `bits` wide. */
const other = (v: number, bits: number) => (v + 1) % 2 ** bits;

export function codingFixture(seed = 7) {
  const image = lateImage({ seed, codedVin: 'CD67890' });
  const field = (a: number, mask: number, shift: number) => (image[a]! & mask) >> shift;

  const a0 = field(0x0a0, 0x30, 4);
  const b320 = field(0x320, 0xc0, 6);
  const p080 = image[0x080]!;
  const p030 = field(0x030, 0x0f, 0);
  const p0a3 = field(0x0a3, 0x0f, 0);

  const parameters: CodingParameter[] = [
    // 0: codable, informative - two bits at 0x0A0 (three options of four values)
    fsw('DEMO_MODE', 0x0a0, [0x30], [opt('m_a', 101, a0), opt('m_b', 102, other(a0, 2)), opt('m_c', 103, other(other(a0, 2), 2))]),
    // 1: tautological - one bit, both values defined
    fsw('DEMO_FLAG', 0x0a1, [0x01], [opt('off', 111, 0), opt('on', 112, 1)]),
    // 2: single option
    fsw('DEMO_FIXED', 0x0a2, [0xff], [opt('only', 121, image[0x0a2]!)]),
    // 3: a curve: four bytes, two-byte mask
    fsw('DEMO_CURVE', 0x0b0, [0xff, 0xff], [{ keyword: 'curve_1', id: 131, data: Array.from(image.subarray(0x0b0, 0x0b4)) }], 4),
    // 4: informative, but inside the protected 0x07A-0x087
    fsw('DEMO_GUARDED', 0x080, [0xff], [opt('g_a', 141, p080), opt('g_b', 142, other(p080, 8))]),
    // 5: informative, but below 0x070 where no checksum covers it
    fsw('DEMO_LOW', 0x030, [0x0f], [opt('l_a', 151, p030), opt('l_b', 152, other(p030, 4))]),
    // 6: informative, codable (the reader can break its fit by changing the image here)
    fsw('DEMO_LEVEL', 0x0a3, [0x0f], [opt('v_a', 161, p0a3), opt('v_b', 162, other(p0a3, 4))]),
    // 7: codable, in the second checksummed region
    fsw('DEMO_UPPER', 0x320, [0xc0], [opt('u_a', 171, b320), opt('u_b', 172, other(b320, 2))]),
    // 8, 9: direct values - the coded VIN field, and the index the chip carries
    { kind: 'dir', keyword: 'DEMO_VIN[1]', id: 0, block: null, address: 0x07a, length: 1, index: null, mask: [0xff], operations: [], unit: 0 },
    { kind: 'dir', keyword: 'CODIERINDEX', id: 0, block: null, address: 0x317, length: 1, index: null, mask: [0xff], operations: [], unit: 0 },
  ];

  const definition = (index: number, over: Partial<CodingDefinition> = {}): CodingDefinition => ({
    memory: { structure: 'WORDMSB', type: 'DEMO' },
    codingIndex: { WERT: index, WERT2: [] },
    blocks: LATE_CODING_BLOCKS.map(([address, length], i) => ({ kind: 'coding' as const, block: i, address, length, name: `Demo_${i}` })),
    parameters,
    unused: [],
    ...over,
  });

  const chipIndex = image[0x317]!;
  const doc: CodingDoc = {
    schema: 1,
    kind: 'kombi-coding',
    generator: 'test',
    generatedAt: '2026-09-24T00:00:00Z',
    sources: {},
    terms: {},
    coverage: {},
    definitions: {
      // The chip's own: complete fit, and its index.
      'DEMO.C01': definition(chipIndex),
      // A sibling with the same parameters and another index: fits, but is not the chip's.
      'DEMO.C02': definition((chipIndex + 1) % 256),
    },
    names: { fsw: {}, dir: {}, psw: {}, block: {} },
  };
  return { image, doc, definition, parameters, chipIndex };
}

/** The parameter indexes the tests name. */
export const P = {
  mode: 0,
  flag: 1,
  fixed: 2,
  curve: 3,
  guarded: 4,
  low: 5,
  level: 6,
  upper: 7,
  vin: 8,
  index: 9,
} as const;
