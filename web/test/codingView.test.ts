import { describe, expect, it, vi } from 'vitest';
import { chooseDefinition, rowsFor, type ParamRow } from '@/lib/ncs/decode';
import { planCoding } from '@/lib/ncs/encode';
import {
  NOTE_LIMIT,
  byteRoles,
  codingNote,
  differingFrom,
  effectiveChanges,
  formatValue,
  groupByBlock,
  maskBits,
  matches,
  optionName,
  paramName,
  passes,
  tally,
} from '@/lib/ncs/view';
import { codingHubFor } from '@/lib/hub/codingHub';
import { bridgeHubFor, type BridgeHubState } from '@/lib/hub/bridgeHub';
import { recordFilename } from '@/lib/domain/records';
import { recomputeChecksums } from '@/lib/domain/layout';
import { MockM35080Link } from '@/lib/link/mockLink';
import { CHROME } from '@/lib/copy/chrome';
import type { CodingDoc } from '@/lib/refdata/types';
import { codingFixture, P } from './support/codingDoc';

/**
 * What the CODING screen is built from: names in the reader's language with their source, rows by
 * block, the filters and the search, the MAP's byte roles, a donor's differences, the picks that
 * become a plan, the record's note, and the hub - on the synthetic definition only.
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

describe('rows, blocks, filters', () => {
  it('groups every row under the block that holds it, in address order, with the checksum over it', () => {
    const { def, rows } = setup();
    const groups = groupByBlock(def, rows);
    expect(groups.flatMap((g) => g.rows).length).toBe(rows.length);
    for (const g of groups) {
      const addresses = g.rows.map((r) => r.param.address);
      expect(addresses).toEqual([...addresses].sort((a, b) => a - b));
      if (g.block) for (const r of g.rows) expect(r.param.address).toBeGreaterThanOrEqual(g.block.address);
    }
    const body = groups.find((g) => g.rows.some((r) => r.index === P.mode))!;
    expect(body.block).toMatchObject({ address: 0x088, length: 0xe6 });
    expect(body.checksum?.at).toBe(0x16e);
    const upper = groups.find((g) => g.rows.some((r) => r.index === P.upper))!;
    expect(upper.block).toBeNull(); // 0x320 is in no declared block of the demo layout
  });

  it('filters by status, by change and by donor, and counts what each would show', () => {
    const { rows } = setup();
    const changed = new Set([P.mode]);
    const differing = new Set([P.level, P.upper]);
    const by = (f: Parameters<typeof passes>[1], d: ReadonlySet<number> | null = differing) =>
      rows.filter((r) => passes(r, f, changed, d)).map((r) => r.index);
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

describe('values and the map', () => {
  it('writes a value as hex, a digit pair per mask byte, and as its bits, mask-wide', () => {
    const { rows } = setup();
    expect(formatValue(rows[P.mode]!.param, 2)).toEqual({ hex: '02', bits: '10' });
    expect(formatValue(rows[P.level]!.param, 5)).toEqual({ hex: '05', bits: '0101' });
    expect(maskBits(rows[P.upper]!.param)).toEqual([{ address: 0x320, bits: [true, true, false, false, false, false, false, false] }]);
  });

  it("gives every byte a parameter covers that parameter's role, every protected byte and checksum theirs", () => {
    const { rows } = setup();
    const roles = byteRoles(rows);
    expect(roles[0x0a0]).toBe('codable');
    expect(roles[0x080]).toBe('protected');
    expect(roles[0x010]).toBe('protected'); // the odometer, which no parameter names
    expect(roles[0x16f]).toBe('protected');
    expect(roles[0x0b2]).toBe('value'); // inside the curve
    expect(roles[0x16e]).toBe('checksum');
    expect(roles[0x3cd]).toBe('checksum');
    expect(roles[0x3df]).toBe('checksum');
    expect(roles[0x200]).toBeNull();
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

  it('keeps the definition, the data sha256 and each change in the note, cut to what SYNC keeps', () => {
    const { image, doc } = setup();
    const plan = planCoding(image, doc, [
      { param: P.mode, option: 103 },
      { param: P.level, option: 162 },
    ]);
    if (!plan.ok) throw new Error('plan refused');
    expect(codingNote(plan, 'ab'.repeat(32)).split('\n')).toEqual([
      `CODING DEMO.C01 ref sha256:${'ab'.repeat(32)}`,
      'DEMO_MODE: m_a -> m_c',
      'DEMO_LEVEL: v_a -> v_b',
    ]);
    const long = { ...plan, changes: Array.from({ length: 200 }, () => plan.changes[0]!) };
    const note = codingNote(long, null);
    expect(note.length).toBeLessThanOrEqual(NOTE_LIMIT);
    expect(note).toMatch(/\(\+\d+ more\)$/);
  });

  it('names a coding record as what it is', () => {
    const when = new Date(2026, 8, 24, 1, 2);
    expect(recordFilename('coding', 'AB12345', 1000, when)).toBe('Coding_AB12345_1000km_20260924-0102.bin');
    expect(recordFilename('coding', null, null, when, true)).toBe('PRACTICE_Coding_noVIN_noKM_20260924-0102.bin');
  });
});

describe('the hub on CODING', () => {
  const ask = vi.fn();
  const confirm = (n: number, bytes: number) => `coding ${n} (${bytes})`;

  it('says why the ring is idle: no definition, no change, a refused plan', () => {
    expect(codingHubFor({ ready: false, staged: 0, plan: null, note: '' }, confirm, ask)).toMatchObject({
      label: CHROME.hub.noDefinition,
      disabled: true,
    });
    expect(codingHubFor({ ready: true, staged: 0, plan: null, note: '' }, confirm, ask)).toMatchObject({
      label: CHROME.hub.noChanges,
      disabled: true,
    });
    const refused = { ok: false as const, code: 'not-codable' as const, param: P.guarded };
    expect(codingHubFor({ ready: true, staged: 1, plan: refused, note: '' }, confirm, ask)).toMatchObject({
      label: CHROME.hub.checkCoding,
      disabled: true,
    });
  });

  it('offers WRITE CODING for an accepted plan, and asks with the exact bytes, the note and the kind', () => {
    const { image, doc } = setup();
    const plan = planCoding(image, doc, [{ param: P.upper, option: 172 }]);
    if (!plan.ok) throw new Error('plan refused');
    const h = codingHubFor({ ready: true, staged: 1, plan, note: 'n' }, confirm, ask);
    expect(h).toMatchObject({ label: CHROME.hub.writeCoding, danger: true });
    h.onClick();
    expect(ask).toHaveBeenCalledWith(
      { kind: 'coding', byteWrites: plan.byteWrites, secureOps: [], note: 'n' },
      `coding 1 (${plan.byteWrites.length})`,
      [...plan.byteWrites.map((w) => w.label), 'odometer 0x00-0x1F, VIN 0x07A-0x087: not written'],
    );
    // One parameter byte, and the two checksum bytes of that region (0x3CD, its mirror 0x3DF).
    expect(plan.byteWrites.map((w) => w.address)).toEqual([0x320, 0x3cd, 0x3df]);
  });

  it('never skips the bridge tiers: no WRITE CODING before the chip is read and backed up', () => {
    const { image, doc } = setup();
    const plan = planCoding(image, doc, [{ param: P.upper, option: 172 }]);
    const state = (over: Partial<BridgeHubState>): BridgeHubState => ({
      busy: false,
      phase: 'connected',
      step: 'coding',
      hasImage: true,
      backedUp: true,
      chipBlank: false,
      hasBackupFile: false,
      rewritePlan: null,
      restorePlan: null,
      repairPlan: null,
      coding: { ready: true, staged: 1, plan, note: '' },
      copy: { confirmOdometer: () => '', confirmReset: '', confirmRepair: () => '', confirmCoding: confirm },
      act: { connect: vi.fn(), read: vi.fn(), backup: vi.fn(), ask: vi.fn() },
      ...over,
    });
    expect(bridgeHubFor(state({ phase: 'disconnected' })).label).toBe(CHROME.hub.connect);
    expect(bridgeHubFor(state({ hasImage: false })).label).toBe(CHROME.hub.read);
    expect(bridgeHubFor(state({ backedUp: false })).label).toBe(CHROME.hub.backup);
    expect(bridgeHubFor(state({})).label).toBe(CHROME.hub.writeCoding);
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
