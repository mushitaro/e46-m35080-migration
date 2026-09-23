import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  BENCH_ELECTRICAL,
  BENCH_PINOUT,
  BENCH_WIRES,
  CLUSTER_PINS,
  OBD_PINS,
  endLabel,
  type BenchEnd,
} from '@/lib/domain/clusterBench';
import { BENCH_STEPS } from '@/components/ClusterBenchGuide';
import { BENCH_PARTS, SETUP_PARTS, resolvedParts } from '@/lib/domain/partsData';
import { benchPartName, benchPartNote } from '@/lib/copy/bench';
import { setLangForTest, getLang } from '@/lib/i18n';

const ends = (e: BenchEnd) => BENCH_WIRES.filter((w) => w.from === e || w.to === e);

describe('the bench wiring', () => {
  it('puts the fuse in front of everything positive', () => {
    // The only wire from PSU + is the feed, and it lands on the fused block.
    expect(ends('psu+').map((w) => [w.id, w.to])).toEqual([['feed', 'fused']]);
    // The switched block is fed from the fused block and nothing else.
    const into = BENCH_WIRES.filter((w) => w.to === 'switched');
    expect(into.map((w) => w.from)).toEqual(['fused']);
    // Every supply-carrying wire to a connector starts behind the fuse.
    for (const w of BENCH_WIRES.filter((x) => x.kind === 'supply' || x.kind === 'switched')) {
      if (w.id === 'feed') continue;
      expect(['fused', 'switched'], w.id).toContain(w.from);
    }
  });

  it('wires every cluster pin it names exactly once, from the right source', () => {
    const source: Record<string, BenchEnd> = { GND: 'ground', KL30: 'fused', KL15: 'switched', 'KL R': 'switched', TXD: 'obd:7' };
    for (const p of CLUSTER_PINS) {
      const at = ends(`x11175:${p.pin}`);
      expect(at, `cluster pin ${p.pin}`).toHaveLength(1);
      expect(at[0]!.from, `cluster pin ${p.pin} (${p.signal})`).toBe(source[p.signal]);
    }
  });

  it('gives the cable what J1962 says it needs: 16 fused +, 4 and 5 ground, 7 to the cluster', () => {
    for (const p of OBD_PINS) expect(ends(`obd:${p.pin}`), `OBD ${p.pin}`).toHaveLength(1);
    expect(ends('obd:16')[0]!.from).toBe('fused');
    expect(ends('obd:4')[0]!.from).toBe('ground');
    expect(ends('obd:5')[0]!.from).toBe('ground');
    const k = ends('obd:7')[0]!;
    expect([k.kind, k.to]).toEqual(['k-line', 'x11175:25']);
  });

  it('never has an UNO end, and never a wire from + straight to ground', () => {
    for (const w of BENCH_WIRES) {
      expect(`${w.from} ${w.to}`).not.toMatch(/uno|d1[0-3]|5v/i);
      const pair = [w.from, w.to].sort().join(' ');
      expect(pair).not.toMatch(/fused.*ground|ground.*fused|psu\+.*psu-/);
    }
  });

  it('keeps the pinout marked UNVERIFIED until someone checks it on a cluster', () => {
    // Flipping this is a deliberate act: check the X11175 pins on a real cluster, then change
    // clusterBench.ts AND this line (tsunagi-m-release section 2.3, a pinned literal).
    expect(BENCH_PINOUT).toEqual({ connector: 'X11175', source: 'bmwgm5', verified: false });
  });

  it('states the fuse, the supply and the serial settings the procedure relies on', () => {
    expect(BENCH_ELECTRICAL.fuseAmps).toBe(1);
    expect(BENCH_ELECTRICAL.supplyMinAmps).toBeGreaterThanOrEqual(BENCH_ELECTRICAL.fuseAmps);
    expect(BENCH_ELECTRICAL.serial).toBe('9600 8E1');
  });

  it('gives every wire its own id, and every guide step only wires that exist', () => {
    const ids = BENCH_WIRES.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of BENCH_STEPS) for (const id of s.highlight ?? []) expect(ids).toContain(id);
    // Every wire is lit by some step, so no wire is only ever shown dimmed.
    const lit = new Set(BENCH_STEPS.flatMap((s) => s.highlight ?? []));
    for (const id of ids) expect(lit.has(id), id).toBe(true);
  });
});

/**
 * The same connections are written twice: in clusterBench.ts and in the wiring table of
 * docs/BENCH.md. Two copies of one fact is how one of them goes stale, so the document is parsed
 * and compared, as test/hardware.test.ts does for the chip bench.
 */
describe('parity with docs/BENCH.md', () => {
  const doc = fs.readFileSync(path.join(process.cwd(), '..', 'docs', 'BENCH.md'), 'utf8');
  const wiring = doc.slice(doc.indexOf('## Wiring'), doc.indexOf('## Procedure'));
  const rows = wiring
    .split('\n')
    .map((l) => l.trim())
    // Body rows only: a lower-case wire id in the first cell - not the header, not the |---| rule.
    .filter((l) => /^\|\s*[a-z][a-z0-9-]*\s*\|/.test(l))
    .map((l) => l.split('|').map((c) => c.trim()))
    .map((c) => ({ id: c[1], from: c[2], to: c[3] }));

  it('found the table', () => {
    expect(rows).toHaveLength(BENCH_WIRES.length);
  });

  it('agrees on every wire, both ends, in order', () => {
    expect(rows).toEqual(BENCH_WIRES.map((w) => ({ id: w.id, from: endLabel(w.from), to: endLabel(w.to) })));
  });

  it('has the same eight steps as the guide', () => {
    const procedure = doc.slice(doc.indexOf('## Procedure'), doc.indexOf('## Cautions'));
    const steps = procedure.split('\n').filter((l) => /^\d+\.\s+\*\*/.test(l));
    expect(steps).toHaveLength(BENCH_STEPS.length);
  });
});

describe('the bench parts', () => {
  it('names every part and every note, in both languages', () => {
    const orig = getLang();
    for (const lang of ['ja', 'en'] as const) {
      setLangForTest(lang);
      for (const p of BENCH_PARTS.parts) {
        expect(benchPartName(p.id), `${lang} ${p.id}`).not.toBe(p.id);
        if (p.note) expect(benchPartNote(p.note), `${lang} note ${p.note}`).not.toBeNull();
      }
    }
    setLangForTest(orig);
  });

  it('is its own list: no id shared with the chip bench, and each resolves to a link', () => {
    const setupIds = new Set(SETUP_PARTS.parts.map((p) => p.id));
    for (const p of BENCH_PARTS.parts) expect(setupIds.has(p.id), p.id).toBe(false);
    const resolved = resolvedParts(BENCH_PARTS);
    expect(resolved.map((p) => p.id)).toEqual(BENCH_PARTS.parts.map((p) => p.id));
    for (const p of resolved) expect(p.href).toMatch(/^https:\/\//);
  });

  it('includes the fuse, the plug and the cable the procedure uses', () => {
    const ids = BENCH_PARTS.parts.map((p) => p.id);
    for (const id of ['bench-psu-12v', 'fuse-holder-1a', 'toggle-switch', 'obd2-female-socket', 'cluster-plug-x11175', 'kdcan-cable']) {
      expect(ids).toContain(id);
    }
  });
});
