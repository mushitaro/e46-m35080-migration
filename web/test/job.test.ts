import { describe, expect, it } from 'vitest';
import { NOTE_LIMIT, jobNote, planJob, summarize, writesSomething, type JobInput, type JobPlan } from '@/lib/domain/job';
import { applyPlanPreview } from '@/lib/domain/operations';
import { decodeOdometer, encodeOdometer, slotsToBytes } from '@/lib/domain/odometer';
import { detectLayout, recomputeChecksums } from '@/lib/domain/layout';
import { readVins } from '@/lib/domain/vin';
import { IMAGE_SIZE, secureOf } from '@/lib/domain/image';
import { chooseDefinition, rowsFor } from '@/lib/ncs/decode';
import { WebSerialM35080Link } from '@/lib/link/m35080Link';
import { M35080Simulator, ScriptedTransport, TEST_TIMING } from './support/m35080Simulator';
import { codingFixture, P } from './support/codingDoc';

/**
 * One job, one plan: the source (the chip, or a dump), the VIN, the coding and the odometer
 * together - on synthetic images and the synthetic definition only.
 */

const keep = { odometer: { kind: 'keep' as const }, vin: { kind: 'keep' as const }, coding: null };

function blankChip(): Uint8Array {
  const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
  img.fill(0x00, 0, 0x20);
  return img;
}

function ok(p: ReturnType<typeof planJob>): JobPlan {
  if (!p.ok) throw new Error(`refused: ${p.part} ${p.refusal.code}`);
  return p;
}

async function writeThrough(chip: Uint8Array, plan: JobPlan): Promise<Uint8Array> {
  const sim = new M35080Simulator({ image: chip });
  const link = new WebSerialM35080Link({} as never, TEST_TIMING);
  (link as unknown as { transport: ScriptedTransport }).transport = new ScriptedTransport(sim);
  await link.connect();
  for (const op of plan.secureOps) await link.writeSecure(op.address, op.to);
  for (const w of plan.byteWrites) await link.writeAndVerify(w.address, w.data);
  return link.readImage();
}

describe('a job on the chip as it is', () => {
  it('writes nothing when nothing is asked', () => {
    const { image } = codingFixture();
    const plan = ok(planJob({ chip: image, source: { kind: 'chip' }, ...keep }));
    expect(writesSomething(plan)).toBe(false);
    expect(plan.target).toEqual(image);
  });

  it('raises the odometer by WRINC only, and refuses to lower it - naming the part', () => {
    const { image } = codingFixture();
    const plan = ok(planJob({ chip: image, source: { kind: 'chip' }, ...keep, odometer: { kind: 'set', km: 160_000 } }));
    expect(plan.secureOps.length).toBeGreaterThan(0);
    expect(plan.byteWrites).toEqual([]);
    expect(decodeOdometer(secureOf(plan.target))).toMatchObject({ ok: true, km: 160_000 });
    expect(planJob({ chip: image, source: { kind: 'chip' }, ...keep, odometer: { kind: 'set', km: 1000 } })).toMatchObject({
      ok: false,
      part: 'odometer',
      refusal: { code: 'cannot-lower' },
    });
  });

  it('plans the VIN, the coding and the odometer as one: every byte once, the checksums sealed once', async () => {
    const { image, doc } = codingFixture();
    const input: JobInput = {
      chip: image,
      source: { kind: 'chip' },
      odometer: { kind: 'set', km: 170_000 },
      vin: { kind: 'write', vin: 'ZX54321' },
      coding: { doc, changes: [{ param: P.mode, option: 103 }, { param: P.upper, option: 172 }] },
    };
    const plan = ok(planJob(input));
    expect(plan.vinWrites.length).toBeGreaterThan(0);
    expect(plan.coding?.changes.map((c) => c.keyword)).toEqual(['DEMO_MODE', 'DEMO_UPPER']);
    const layout = detectLayout(plan.target);
    expect(layout.kind === 'late' && layout.consistent).toBe(true);
    expect(readVins(plan.target).coded?.text).toBe('ZX54321');
    // What runWrite checks the chip against is exactly the target.
    expect(applyPlanPreview(image, plan.byteWrites, plan.secureOps)).toEqual(plan.target);

    const after = await writeThrough(image, plan);
    expect(after).toEqual(plan.target);
    const rows = rowsFor(after, doc.definitions['DEMO.C01']!);
    expect([rows[P.mode]!.option?.keyword, rows[P.upper]!.option?.keyword]).toEqual(['m_c', 'u_b']);
    expect(decodeOdometer(secureOf(after))).toMatchObject({ ok: true, km: 170_000 });
  });

  it('names the coding part when a coding change is refused', () => {
    const { image, doc } = codingFixture();
    expect(planJob({ chip: image, source: { kind: 'chip' }, ...keep, coding: { doc, changes: [{ param: P.guarded, option: 142 }] } })).toMatchObject({
      ok: false,
      part: 'coding',
      refusal: { code: 'not-codable' },
    });
  });
});

describe('a job from a dump', () => {
  it('puts the dump on a blank chip byte for byte, keeps the chip at 0 km, and codes it on the way', async () => {
    const { image: dump, doc } = codingFixture();
    const chip = blankChip();
    const plan = ok(
      planJob({ chip, source: { kind: 'dump', name: 'donor.bin', image: dump }, ...keep, coding: { doc, changes: [{ param: P.level, option: 162 }] } }),
    );
    expect(plan.sourceChecksums).toBe('ok');
    expect(plan.secureOps).toEqual([]);
    expect(secureOf(plan.target)).toEqual(secureOf(chip)); // the dump's odometer is never copied
    // The coding was chosen from the dump, not from the blank chip.
    expect(plan.coding?.file).toBe('DEMO.C01');
    const layout = detectLayout(plan.target);
    expect(layout.kind === 'late' && layout.consistent).toBe(true);

    const after = await writeThrough(chip, plan);
    expect(after).toEqual(plan.target);
    expect(chooseDefinition(after, doc)).toMatchObject({ kind: 'chosen', file: 'DEMO.C01' });
  });

  it('on a chip that already holds data, writes only the bytes that differ', () => {
    const { image: dump } = codingFixture();
    const chip = Uint8Array.from(dump);
    chip[0x200] ^= 0xff; // a byte the chip lost
    chip[0x0b1] ^= 0x0f;
    chip.set(recomputeChecksums(chip).image);
    const plan = ok(planJob({ chip, source: { kind: 'dump', name: 'donor.bin', image: dump }, ...keep }));
    const written = plan.byteWrites.flatMap((w) => Array.from(w.data, (_, i) => w.address + i));
    expect(written).toEqual(expect.arrayContaining([0x0b1, 0x200]));
    expect(written.every((a) => chip[a] !== dump[a])).toBe(true);
    expect(plan.target.subarray(0x20)).toEqual(dump.subarray(0x20));
  });

  it('refuses a dump that is not a cluster, or a late dump whose checksums fail - naming the source', () => {
    const chip = blankChip();
    const uniform = new Uint8Array(IMAGE_SIZE).fill(0xa5);
    expect(planJob({ chip, source: { kind: 'dump', name: 'x.bin', image: uniform }, ...keep })).toMatchObject({
      ok: false,
      part: 'source',
      refusal: { code: 'backup-no-data' },
    });
    const { image } = codingFixture();
    const broken = Uint8Array.from(image);
    broken[0x16e] ^= 0x01;
    expect(planJob({ chip, source: { kind: 'dump', name: 'x.bin', image: broken }, ...keep })).toMatchObject({
      ok: false,
      part: 'source',
      refusal: { code: 'backup-checksum-broken' },
    });
    expect(planJob({ chip, source: { kind: 'dump', name: 'x.bin', image: new Uint8Array(512) }, ...keep })).toMatchObject({
      ok: false,
      part: 'source',
      refusal: { code: 'backup-size' },
    });
  });

  it('is planned before any chip is read: the coding and the VIN, never the odometer, and nothing to write', () => {
    const { image: dump, doc } = codingFixture();
    const plan = ok(
      planJob({
        chip: null,
        source: { kind: 'dump', name: 'donor.bin', image: dump },
        odometer: { kind: 'set', km: 999_999 },
        vin: { kind: 'write', vin: 'ZX54321' },
        coding: { doc, changes: [{ param: P.mode, option: 103 }] },
      }),
    );
    expect(plan.byteWrites).toEqual([]);
    expect(plan.secureOps).toEqual([]);
    expect(plan.targetKm).toBeNull();
    expect(secureOf(plan.target)).toEqual(secureOf(dump));
    expect(readVins(plan.target).coded?.text).toBe('ZX54321');
    expect(plan.coding?.changes).toHaveLength(1);
    expect(planJob({ chip: null, source: { kind: 'chip' }, ...keep })).toMatchObject({ ok: false, part: 'source', refusal: { code: 'no-chip' } });
  });
});

describe('the odometer is the chip', () => {
  it('raises a blank chip that takes a dump to the target, never copying the dump', () => {
    const { image: dump } = codingFixture();
    const chip = blankChip();
    const plan = ok(planJob({ chip, source: { kind: 'dump', name: 'donor.bin', image: dump }, ...keep, odometer: { kind: 'set', km: 42_000 } }));
    expect(decodeOdometer(secureOf(plan.target))).toMatchObject({ ok: true, km: 42_000 });
    expect(secureOf(plan.target)).toEqual(slotsToBytes(encodeOdometer(42_000)));
  });
});

describe('what a job tells', () => {
  it('summarizes only what the plan writes, and keeps the source, odometer, VIN and coding in the note', () => {
    const { image: dump, doc } = codingFixture();
    const chip = blankChip();
    const input: JobInput = {
      chip,
      source: { kind: 'dump', name: 'donor.bin', image: dump },
      odometer: { kind: 'set', km: 42_000 },
      vin: { kind: 'write', vin: 'ZX54321' },
      coding: { doc, changes: [{ param: P.mode, option: 103 }] },
    };
    const plan = ok(planJob(input));
    const sum = summarize(plan, input);
    expect(sum.source?.name).toBe('donor.bin');
    expect(sum.odometer).toMatchObject({ to: 42_000 });
    expect(sum.vin).toEqual({ kind: 'write', vin: 'ZX54321' });
    expect(sum.coding).toBe(1);
    expect(jobNote(plan, input, 'ab'.repeat(32)).split('\n')).toEqual([
      'SOURCE donor.bin',
      'ODOMETER 0 -> 42000 km',
      'VIN -> ZX54321',
      `CODING DEMO.C01 ref sha256:${'ab'.repeat(32)}`,
      'DEMO_MODE: m_a -> m_c',
    ]);
    const long = { ...plan, coding: { ...plan.coding!, changes: Array.from({ length: 200 }, () => plan.coding!.changes[0]!) } };
    const note = jobNote(long, input, null);
    expect(note.length).toBeLessThanOrEqual(NOTE_LIMIT);
    expect(note).toMatch(/\(\+\d+ more\)$/);
  });

  it('says nothing about the odometer or the VIN when they are kept', () => {
    const { image, doc } = codingFixture();
    const input: JobInput = { chip: image, source: { kind: 'chip' }, ...keep, coding: { doc, changes: [{ param: P.upper, option: 172 }] } };
    const plan = ok(planJob(input));
    expect(summarize(plan, input)).toMatchObject({ odometer: null, source: null, vin: null, coding: 1 });
    expect(jobNote(plan, input, null).split('\n')).toEqual(['CODING DEMO.C01', 'DEMO_UPPER: u_a -> u_b']);
  });
});
