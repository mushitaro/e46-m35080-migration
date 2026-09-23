import { describe, expect, it } from 'vitest';
import { chooseDefinition, rowsFor, type ParamRow } from '@/lib/ncs/decode';
import {
  differingFrom,
  effectiveChanges,
  formatValue,
  maskBits,
  matches,
  optionName,
  paramName,
  inFilter,
  listOrder,
  tally,
} from '@/lib/ncs/view';
import { recordFilename } from '@/lib/domain/records';
import { recomputeChecksums } from '@/lib/domain/layout';
import { MockM35080Link } from '@/lib/link/mockLink';
import type { CodingDoc } from '@/lib/refdata/types';
import { codingFixture, P } from './support/codingDoc';

/**
 * What REWRITE's coding is built from: names in the reader's language with their source, the
 * list in NCS Dummy's order (functions, then the direct values), the filters and the search, a
 * dump's differences from the chip, and the picks that become the job's coding - on the synthetic
 * definition only. The hub and the
 * record's note are the job's (bridgeHub.test.ts, job.test.ts).
 */

function setup() {
  const f = codingFixture();
  const def = f.doc.definitions['DEMO.C01']!;
  const rows = rowsFor(f.image, def);
  return { ...f, def, rows };
}

function withNames(doc: CodingDoc): CodingDoc {
  return {
    ...doc,
    names: {
      fsw: {
        DEMO_MODE: { ja: 'モード', en: 'Mode', source: 'authored' },
        DEMO_LEVEL: { ja: '段階', en: 'Level', source: 'heuristic' },
      },
      dir: {},
      psw: { m_a: { ja: '甲', en: 'A', source: 'authored' } },
      block: { Demo_5: { ja: '本体', en: 'Body', source: 'authored' } },
    },
  };
}

describe('names', () => {
  it("shows the reader's language and says where the name came from", () => {
    const { doc, rows } = setup();
    const named = withNames(doc);
    expect(paramName(named, rows[P.mode]!.param, 'ja')).toEqual({ text: 'モード', source: 'authored' });
    expect(paramName(named, rows[P.mode]!.param, 'en')).toEqual({ text: 'Mode', source: 'authored' });
    expect(paramName(named, rows[P.level]!.param, 'en')).toEqual({ text: 'Level', source: 'heuristic' });
  });

  it('lets the keyword stand in, marked RAW, where nobody named it', () => {
    const { doc, rows } = setup();
    expect(paramName(doc, rows[P.upper]!.param, 'ja')).toEqual({ text: 'DEMO_UPPER', source: 'raw' });
    const mode = rows[P.mode]!.param;
    if (mode.kind !== 'fsw') throw new Error('DEMO_MODE is a switch');
    expect(optionName(doc, mode.options[1]!, 'en')).toEqual({ text: 'm_b', source: 'raw' });
  });
});

describe('the list: order, filters, search', () => {
  it("lists the functions as NCS Dummy does - in the definition's order - and the direct values apart", () => {
    const { rows } = setup();
    const { functions, values } = listOrder(rows);
    expect(functions.map((r) => r.index)).toEqual([P.mode, P.flag, P.fixed, P.curve, P.guarded, P.low, P.level, P.upper]);
    expect(values.map((r) => r.index)).toEqual([P.vin, P.index]);
  });

  it('filters by status, by change and by donor, and counts what each would show', () => {
    const { rows } = setup();
    const changed = new Set([P.mode]);
    const differing = new Set([P.level, P.upper]);
    const by = (f: Parameters<typeof inFilter>[1], d: ReadonlySet<number> | null = differing) =>
      rows.filter((r) => inFilter(r, f, changed, d)).map((r) => r.index);
    expect(by('all')).toHaveLength(rows.length);
    // DEMO_FLAG sets both values its one bit can hold: it tells no definition apart, but it is codable.
    expect(by('codable')).toEqual([P.mode, P.flag, P.level, P.upper]);
    expect(by('changed')).toEqual([P.mode]);
    expect(by('diff')).toEqual([P.level, P.upper]);
    expect(by('diff', null)).toEqual([]);
    expect(tally(rows)).toEqual({ all: 10, codable: 4, protected: 2, value: 4, unknown: 0 });
  });

  it('finds a row by either name, the keyword, or the address', () => {
    const { doc, rows } = setup();
    const named = withNames(doc);
    const hits = (q: string) => rows.filter((r: ParamRow) => matches(named, r, q)).map((r) => r.index);
    expect(hits('モード')).toEqual([P.mode]);
    expect(hits('mode')).toEqual([P.mode]); // the English name and the keyword both hold it
    expect(hits('level')).toEqual([P.level]);
    expect(hits('0a3')).toEqual([P.level]);
    expect(hits('0x320')).toEqual([P.upper]);
    expect(hits('  ')).toHaveLength(rows.length);
  });
});

describe('values', () => {
  it('writes a value as hex, a digit pair per mask byte, and as its bits, mask-wide', () => {
    const { rows } = setup();
    expect(formatValue(rows[P.mode]!.param, 2)).toEqual({ hex: '02', bits: '10' });
    expect(formatValue(rows[P.level]!.param, 5)).toEqual({ hex: '05', bits: '0101' });
    expect(maskBits(rows[P.upper]!.param)).toEqual([{ address: 0x320, bits: [true, true, false, false, false, false, false, false] }]);
  });

  it('names the rows a donor holds differently, read with the same definition', () => {
    const { image, def } = setup();
    const donor = Uint8Array.from(image);
    donor[0x0a3] = (donor[0x0a3]! & 0xf0) | ((donor[0x0a3]! + 1) & 0x0f); // DEMO_LEVEL
    donor[0x0b1] ^= 0xff; // inside the curve
    donor[0x200] ^= 0xff; // no parameter here
    expect([...differingFrom(def, image, recomputeChecksums(donor).image)].sort((a, b) => a - b)).toEqual([P.curve, P.level]);
  });
});

describe('picks, the plan and the record', () => {
  it('asks the planner only for picks that change something', () => {
    const { rows } = setup();
    const current = rows[P.mode]!.option!.id;
    const staged = new Map([
      [P.mode, current],
      [P.level, 162],
      [P.fixed, 121],
    ]);
    expect(effectiveChanges(rows, staged)).toEqual([{ param: P.level, option: 162 }]);
  });

  it('names a coding record as what it is', () => {
    const when = new Date(2026, 8, 24, 1, 2);
    expect(recordFilename('coding', 'AB12345', 1000, when)).toBe('Coding_AB12345_1000km_20260924-0102.bin');
    expect(recordFilename('coding', null, null, when, true)).toBe('PRACTICE_Coding_noVIN_noKM_20260924-0102.bin');
  });
});

describe('a file as the PRACTICE chip', () => {
  it('is what the simulated chip reads - a copy, which the practice run never writes back to', async () => {
    const { image, doc } = setup();
    const file = Uint8Array.from(image);
    const link = new MockM35080Link({ name: 'demo.bin', image: file });
    await link.connect();
    const read = await link.readImage();
    expect(read).toEqual(image);
    expect(chooseDefinition(read, doc)).toMatchObject({ kind: 'chosen', file: 'DEMO.C01' });
    await link.writeAndVerify(0x320, Uint8Array.of(read[0x320]! ^ 0xc0));
    expect(file).toEqual(image);
  });

  it('refuses a file that is not a chip image', () => {
    expect(() => new MockM35080Link({ name: 'short.bin', image: new Uint8Array(512) })).toThrow(/1024 bytes/);
  });
});
