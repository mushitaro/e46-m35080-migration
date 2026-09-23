import { describe, expect, it } from 'vitest';
import { be, chooseDefinition, ctz, fitOf, readScalar, rowsFor } from '@/lib/ncs/decode';
import { blockLayoutMatches, LATE_CODING_BLOCKS } from '@/lib/ncs/definition';
import { planCoding, type CodingPlan } from '@/lib/ncs/encode';
import { CODABLE_RANGES, PROTECTED_RANGES, detectLayout, xorOf } from '@/lib/domain/layout';
import { codingFixture, P } from './support/codingDoc';

const inRanges = (a: number, ranges: readonly [number, number][]) => ranges.some(([lo, hi]) => a >= lo && a <= hi);
const CHECKSUM_BYTES = new Set([0x16e, 0x3cd, 0x3df]);

function apply(image: Uint8Array, plan: CodingPlan): Uint8Array {
  const out = Uint8Array.from(image);
  for (const w of plan.byteWrites) out.set(w.data, w.address);
  return out;
}

describe('reading a parameter', () => {
  it('reads big-endian, masks, and shifts by the mask', () => {
    expect(be([0x12, 0x34])).toBe(0x1234);
    expect(ctz(0x30)).toBe(4);
    expect(ctz(0x0100)).toBe(8);
    const image = new Uint8Array(1024);
    image[0x100] = 0b1011_0110;
    expect(readScalar(image, { kind: 'fsw', address: 0x100, length: 1, mask: [0x30] } as never)).toBe(0b11);
    image[0x101] = 0x5a;
    expect(readScalar(image, { kind: 'fsw', address: 0x100, length: 2, mask: [0x0f, 0xf0] } as never)).toBe(0x65);
  });
});

describe('fit: which definition the chip was coded with', () => {
  it('scores only the informative parameters, and counts the rest apart', () => {
    const { image, doc } = codingFixture();
    expect(fitOf(image, doc.definitions['DEMO.C01']!)).toEqual({
      informative: 5,
      matched: 5,
      tautological: 1,
      singleOption: 1,
      arrays: 1,
    });
  });

  it('chooses the definition that fits completely AND carries the chip index; a sibling that only fits is not it', () => {
    const { image, doc } = codingFixture();
    const c = chooseDefinition(image, doc);
    expect(c.kind).toBe('chosen');
    expect(c.kind === 'chosen' && c.file).toBe('DEMO.C01');
  });

  it('refuses when two definitions both claim the chip', () => {
    const { image, doc, definition, chipIndex } = codingFixture();
    doc.definitions['DEMO.C03'] = definition(chipIndex);
    expect(chooseDefinition(image, doc)).toMatchObject({ kind: 'none', reason: 'ambiguous' });
  });

  it('refuses when an informative parameter holds no option of the definition, and shows the closest', () => {
    const { image, doc } = codingFixture();
    const broken = Uint8Array.from(image);
    // DEMO_LEVEL's low nibble to a value neither of its two options has.
    const current = broken[0x0a3]! & 0x0f;
    broken[0x0a3] = (broken[0x0a3]! & 0xf0) | ((current + 2) % 16);
    const c = chooseDefinition(broken, doc);
    expect(c).toMatchObject({ kind: 'none', reason: 'no-fit' });
    expect(c.kind === 'none' && c.best?.fit).toMatchObject({ informative: 5, matched: 4 });
  });

  it('refuses any image that is not the late layout', () => {
    const { doc } = codingFixture();
    expect(chooseDefinition(new Uint8Array(1024).fill(0xff), doc)).toMatchObject({ kind: 'none', reason: 'not-late-layout' });
  });
});

describe('rows: what may be done to each parameter', () => {
  it('names every row codable, protected, a value or unknown - with the reason', () => {
    const { image, doc } = codingFixture();
    const rows = rowsFor(image, doc.definitions['DEMO.C01']!);
    const by = (i: number) => [rows[i]!.status, rows[i]!.reason];
    expect(by(P.mode)).toEqual(['codable', null]);
    expect(by(P.flag)).toEqual(['codable', null]); // tautological, but coding it is fine
    expect(by(P.fixed)).toEqual(['value', 'single-option']);
    expect(by(P.curve)).toEqual(['value', 'curve']);
    expect(by(P.guarded)).toEqual(['protected', 'protected-range']);
    expect(by(P.low)).toEqual(['value', 'outside-codable']);
    expect(by(P.upper)).toEqual(['codable', null]);
    expect(by(P.vin)).toEqual(['protected', 'protected-range']);
    expect(by(P.index)).toEqual(['value', 'direct-value']);
    expect(rows[P.mode]!.option?.keyword).toBe('m_a');
  });

  it('marks a value that is not one of the options as unknown', () => {
    const { image, doc } = codingFixture();
    const odd = Uint8Array.from(image);
    odd[0x0a3] = (odd[0x0a3]! & 0xf0) | (((odd[0x0a3]! & 0x0f) + 2) % 16);
    const row = rowsFor(odd, doc.definitions['DEMO.C01']!)[P.level]!;
    expect([row.status, row.reason, row.option]).toEqual(['unknown', 'not-an-option', null]);
  });
});

describe('planCoding', () => {
  it('changes only the bits of the mask, then seals both checksums', () => {
    const { image, doc } = codingFixture();
    const plan = planCoding(image, doc, [
      { param: P.mode, option: 102 },
      { param: P.upper, option: 172 },
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.file).toBe('DEMO.C01');
    const mode = plan.changes.find((c) => c.keyword === 'DEMO_MODE')!;
    expect(mode.bytes).toHaveLength(1);
    expect(mode.bytes[0]!.address).toBe(0x0a0);
    expect((mode.bytes[0]!.before ^ mode.bytes[0]!.after) & ~0x30).toBe(0); // no bit outside the mask moved
    expect(plan.checksums.map((c) => c.address).sort((a, b) => a - b)).toEqual([0x16e, 0x3cd, 0x3df]);

    const after = apply(image, plan);
    expect(after).toEqual(plan.after);
    const layout = detectLayout(after);
    expect(layout.kind === 'late' && layout.consistent).toBe(true);
    expect(after[0x16e]).toBe(xorOf(after, 0x070, 0x16d));
    const rows = rowsFor(after, doc.definitions['DEMO.C01']!);
    expect(rows[P.mode]!.option?.keyword).toBe('m_b');
    expect(rows[P.upper]!.option?.keyword).toBe('u_b');
    // The chip still identifies as the same definition after the write.
    expect(chooseDefinition(after, doc)).toMatchObject({ kind: 'chosen', file: 'DEMO.C01' });
  });

  it('writes nothing outside the codable ranges and nothing protected, whatever is chosen', () => {
    const { image, doc, parameters } = codingFixture();
    for (const [i, p] of parameters.entries()) {
      if (p.kind !== 'fsw') continue;
      for (const o of p.options) {
        const plan = planCoding(image, doc, [{ param: i, option: o.id }]);
        if (!plan.ok) continue;
        for (const w of plan.byteWrites) {
          if (CHECKSUM_BYTES.has(w.address)) continue;
          expect(inRanges(w.address, CODABLE_RANGES), `0x${w.address.toString(16)}`).toBe(true);
          expect(inRanges(w.address, PROTECTED_RANGES), `0x${w.address.toString(16)}`).toBe(false);
        }
      }
    }
  });

  it('refuses a parameter that is not codable, and an option that is not its own', () => {
    const { image, doc } = codingFixture();
    for (const param of [P.fixed, P.curve, P.guarded, P.low, P.vin, P.index]) {
      expect(planCoding(image, doc, [{ param, option: 1 }]), `param ${param}`).toMatchObject({ ok: false, code: 'not-codable', param });
    }
    expect(planCoding(image, doc, [{ param: P.mode, option: 172 }])).toMatchObject({ ok: false, code: 'unknown-option' });
    expect(planCoding(image, doc, [{ param: P.mode, option: 101 }])).toMatchObject({ ok: false, code: 'no-change' });
  });

  it('refuses unless the checksums hold first - it never repairs one on the way past', () => {
    const { image, doc } = codingFixture();
    const broken = Uint8Array.from(image);
    broken[0x16e] ^= 0xff;
    expect(planCoding(broken, doc, [{ param: P.mode, option: 102 }])).toMatchObject({ ok: false, code: 'checksum-broken' });
  });

  it('refuses without the chip own definition, a non-MSB memory, or an unknown block layout', () => {
    const { image, doc, definition, chipIndex } = codingFixture();
    const change = [{ param: P.mode, option: 102 }];
    expect(planCoding(image, { ...doc, definitions: { 'DEMO.C02': doc.definitions['DEMO.C02']! } }, change)).toMatchObject({
      ok: false,
      code: 'no-definition',
    });
    const lsb = { ...doc, definitions: { X: definition(chipIndex, { memory: { structure: 'WORDLSB', type: 'DEMO' } }) } };
    expect(planCoding(image, lsb, change)).toMatchObject({ ok: false, code: 'memory-organisation' });
    const moved = definition(chipIndex, { blocks: [{ kind: 'coding', block: 0, address: 0x070, length: 0x100, name: 'x' }] });
    expect(blockLayoutMatches(moved)).toBe(false);
    expect(planCoding(image, { ...doc, definitions: { X: moved } }, change)).toMatchObject({ ok: false, code: 'block-layout' });
    expect(planCoding(new Uint8Array(1024).fill(0xff), doc, change)).toMatchObject({ ok: false, code: 'not-late-layout' });
  });

  it('states the late block layout as numbers, and matches it', () => {
    const { doc } = codingFixture();
    expect(LATE_CODING_BLOCKS).toHaveLength(8);
    expect(blockLayoutMatches(doc.definitions['DEMO.C01']!)).toBe(true);
  });
});
