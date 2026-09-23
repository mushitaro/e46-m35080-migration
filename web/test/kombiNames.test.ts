import { describe, expect, it } from 'vitest';
import { bitName, namesFor } from '@/lib/kombi/names';
import { validateRef } from '@/lib/refdata/validate';
import type { NamesDoc, VariantNames } from '@/lib/refdata/types';

/**
 * TEST's names beside a bit, on a synthetic names document (invented names only): the variant the
 * cluster answered as picks the set, the reader's language picks the text, and anything unnamed
 * - no data, no variant, no entry, no text - leaves the position alone.
 */

const empty = (): VariantNames => ({ lamps: {}, outputs: {}, inputs: {}, faults: {} });

function doc(): NamesDoc {
  const k46 = empty();
  k46.lamps['B2.b5'] = { ja: 'デモ灯', en: 'Demo lamp', source: 'authored', sgbd: 'demo lamp' };
  k46.lamps['B1.b0'] = { ja: null, en: null, source: 'raw', sgbd: 'unnamed' };
  k46.inputs['P2.b4'] = { ja: 'デモ入力', en: 'Demo input', source: 'heuristic', sgbd: 'demo input' };
  k46.outputs['P6.b1'] = { ja: 'デモ出力', en: 'Demo output', source: 'authored', sgbd: 'demo output' };
  const k46r = empty();
  k46r.lamps['B2.b5'] = { ja: '別の灯', en: 'Another lamp', source: 'authored', sgbd: 'another' };
  return {
    schema: 1,
    kind: 'kombi-names',
    generator: 'test',
    generatedAt: '2026-09-24T00:00:00Z',
    sources: {},
    terms: {},
    coverage: {},
    variants: { KOMBI46: k46, KOMBI46R: k46r },
  };
}

describe("TEST's bit names", () => {
  it('is a names document the app reads', () => {
    expect(validateRef('kombi-names', doc())).toBeNull();
  });

  it('takes the names of the variant the cluster answered as, and none before it has', () => {
    expect(namesFor(doc(), 'KOMBI46')?.lamps['B2.b5']?.en).toBe('Demo lamp');
    expect(namesFor(doc(), 'KOMBI46R')?.lamps['B2.b5']?.en).toBe('Another lamp');
    expect(namesFor(doc(), null)).toBeNull();
    expect(namesFor(null, 'KOMBI46')).toBeNull();
  });

  it("names a bit in the reader's language, with its source", () => {
    const n = namesFor(doc(), 'KOMBI46');
    expect(bitName(n, 'lamps', 'B2.b5', 'ja')).toEqual({ text: 'デモ灯', source: 'authored' });
    expect(bitName(n, 'lamps', 'B2.b5', 'en')).toEqual({ text: 'Demo lamp', source: 'authored' });
    expect(bitName(n, 'inputs', 'P2.b4', 'en')).toEqual({ text: 'Demo input', source: 'heuristic' });
    expect(bitName(n, 'outputs', 'P6.b1', 'ja')).toEqual({ text: 'デモ出力', source: 'authored' });
  });

  it('leaves the position alone where there is no name to put beside it', () => {
    const n = namesFor(doc(), 'KOMBI46');
    expect(bitName(n, 'lamps', 'B1.b0', 'en')).toBeNull(); // an entry with no text
    expect(bitName(n, 'lamps', 'B4.b7', 'en')).toBeNull(); // no entry
    expect(bitName(n, 'inputs', 'B2.b5', 'en')).toBeNull(); // another group's key
    expect(bitName(null, 'lamps', 'B2.b5', 'en')).toBeNull(); // no data
  });
});
