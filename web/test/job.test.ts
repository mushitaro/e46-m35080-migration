import { describe, expect, it } from 'vitest';
import { NOTE_LIMIT, NO_BYTES, jobDetails, jobNote, planJob, savedImage, summarize, writesSomething, type JobBytes, type JobInput, type JobPlan } from '@/lib/domain/job';
import { applyPlanPreview } from '@/lib/domain/operations';
import { decodeOdometer, encodeOdometer, slotsToBytes } from '@/lib/domain/odometer';
import { detectLayout, recomputeChecksums } from '@/lib/domain/layout';
import { readVins } from '@/lib/domain/vin';
import { IMAGE_SIZE, secureOf } from '@/lib/domain/image';
import { chooseDefinition, rowsFor } from '@/lib/ncs/decode';
import { WebSerialM35080Link } from '@/lib/link/m35080Link';
import { M35080Simulator, ScriptedTransport, TEST_TIMING } from './support/m35080Simulator';
import { codingFixture, P } from './support/codingDoc';
import { lateImage } from './support/lateImage';

/**
 * One job, one plan: the source (the chip, or a dump), the VIN, the coding and the odometer
 * together - on synthetic images and the synthetic definition only.
 */

const keep = { bytes: NO_BYTES, odometer: { kind: 'keep' as const }, vin: { kind: 'keep' as const }, coding: null };

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
      bytes: NO_BYTES,
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
        bytes: NO_BYTES,
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
      bytes: NO_BYTES,
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

/** Hand edits on `image`, each made once on the byte the image holds. */
const bytesOf = (image: Uint8Array, changes: [number, number][], reseal = false): JobBytes => ({
  edits: changes.map(([address, after]) => ({ address, before: image[address]!, after })),
  reseal,
});

describe('BYTES - hand edits on the source', () => {
  it('seals the checksums again after an edit - with a chip, and on a file with none', () => {
    const img = lateImage();
    const b = bytesOf(img, [[0x100, img[0x100]! ^ 0x5a], [0x200, 0x42]]);
    const onChip = ok(planJob({ chip: img, source: { kind: 'chip' }, ...keep, bytes: b }));
    expect(onChip.handEdits).toEqual([0x100, 0x200]);
    expect(onChip.target[0x100]).toBe(img[0x100]! ^ 0x5a);
    expect(detectLayout(onChip.target)).toMatchObject({ kind: 'late', consistent: true });
    expect(onChip.checksums.map((c) => c.address)).toEqual([0x16e]);
    // Without a chip the reseal is still said - against the file - and nothing is to be written.
    const noChip = ok(planJob({ chip: null, source: { kind: 'dump', name: 'f.bin', image: img }, ...keep, bytes: b }));
    expect(noChip.target).toEqual(onChip.target);
    expect(noChip.checksums.map((c) => c.address)).toEqual([0x16e]);
    expect(noChip.byteWrites).toEqual([]);
  });

  it("leaves a chip's broken checksums as read: outside them an edit passes, inside it is refused, the odometer still rises", () => {
    const img = lateImage();
    img[0x3cd] ^= 0xff;
    expect(detectLayout(img)).toMatchObject({ kind: 'late', consistent: false });
    const chip = { chip: img, source: { kind: 'chip' as const }, ...keep };
    const outside = ok(planJob({ ...chip, bytes: bytesOf(img, [[0x200, img[0x200]! ^ 1]]) }));
    expect(outside.target[0x3cd]).toBe(img[0x3cd]); // not recomputed over whatever broke it
    const inside = bytesOf(img, [[0x100, img[0x100]! ^ 1]]);
    expect(planJob({ ...chip, bytes: inside })).toMatchObject({ ok: false, part: 'bytes', refusal: { code: 'bytes-checksum-broken', address: 0x100 } });
    // FIX CHECKSUMS is a file's: on a chip it changes nothing.
    expect(planJob({ ...chip, bytes: { ...inside, reseal: true } })).toMatchObject({ ok: false, part: 'bytes' });
    expect(ok(planJob({ ...chip, odometer: { kind: 'set', km: 160_000 } })).secureOps.length).toBeGreaterThan(0);
  });

  it('refuses a file whose checksums fail until FIX CHECKSUMS - then writes it, resealed, and says so', () => {
    const file = lateImage();
    file[0x100] ^= 0x01;
    const input = { chip: blankChip(), source: { kind: 'dump' as const, name: 'broken.bin', image: file }, ...keep };
    expect(planJob(input)).toMatchObject({ ok: false, part: 'source', refusal: { code: 'backup-checksum-broken' } });
    const fixedInput = { ...input, bytes: { edits: [], reseal: true } };
    const fixed = ok(planJob(fixedInput));
    expect(fixed.fixed).toBe(true);
    expect(fixed.sourceChecksums).toBe('ok');
    expect(detectLayout(fixed.target)).toMatchObject({ consistent: true });
    expect(fixed.byteWrites.length).toBeGreaterThan(0);
    expect(summarize(fixed, fixedInput).fixed).toBe(true);
    expect(jobDetails(fixed, fixedInput)).toContain("FIX CHECKSUMS: the file's checksums recomputed");
  });

  it('refuses a hand edit on a byte another part owns, outside the chip, or made on other bytes', () => {
    const img = lateImage({ asciiVin: 'ZX54321' });
    const chip = { chip: img, source: { kind: 'chip' as const }, ...keep };
    for (const address of [0x010, 0x07a, 0x080, 0x16e, 0x184]) {
      expect(planJob({ ...chip, bytes: bytesOf(img, [[address, img[address]! ^ 1]]) })).toMatchObject({
        ok: false,
        part: 'bytes',
        refusal: { code: 'bytes-protected', address },
      });
    }
    expect(planJob({ ...chip, bytes: { edits: [{ address: 0x400, before: 0, after: 1 }], reseal: false } })).toMatchObject({
      refusal: { code: 'bytes-outside' },
    });
    expect(planJob({ ...chip, bytes: { edits: [{ address: 0x200, before: img[0x200]! ^ 1, after: 0x42 }], reseal: false } })).toMatchObject({
      refusal: { code: 'bytes-stale', address: 0x200 },
    });
  });

  it('is what the coding is read from - and the coding still sets the bits under its mask', () => {
    const { image, doc } = codingFixture();
    const def = doc.definitions['DEMO.C01']!;
    // DEMO_LEVEL is the low nibble of 0x0A3: changed by hand, the coding reads the new value.
    const level = (image[0x0a3]! & 0xf0) | ((image[0x0a3]! + 1) & 0x0f);
    const pre = ok(planJob({ chip: image, source: { kind: 'chip' }, ...keep, bytes: bytesOf(image, [[0x0a3, level]]) }));
    expect(rowsFor(pre.target, def)[P.level]!.option?.id).toBe(162);
    // DEMO_MODE is bits 0x30 of 0x0A0: a hand edit of the byte's other bits and a coding change compose.
    const low = (image[0x0a0]! & 0xf0) | ((image[0x0a0]! + 1) & 0x0f);
    const plan = ok(
      planJob({ chip: image, source: { kind: 'chip' }, ...keep, bytes: bytesOf(image, [[0x0a0, low]]), coding: { doc, changes: [{ param: P.mode, option: 103 }] } }),
    );
    const a0 = (image[0x0a0]! & 0x30) >> 4;
    expect(plan.target[0x0a0]! & 0x0f).toBe(low & 0x0f);
    expect((plan.target[0x0a0]! & 0x30) >> 4).toBe((((a0 + 1) % 4) + 1) % 4);
  });

  it('writes the hand edits through the one write path, with the reseal, and keeps them in the note', async () => {
    const img = lateImage();
    const input = { chip: img, source: { kind: 'chip' as const }, ...keep, bytes: bytesOf(img, [[0x100, img[0x100]! ^ 0x5a]]) };
    const plan = ok(planJob(input));
    const after = await writeThrough(img, plan);
    expect(after).toEqual(plan.target);
    expect(detectLayout(after)).toMatchObject({ consistent: true });
    expect(summarize(plan, input)).toMatchObject({ edits: 1, checksums: 1 });
    expect(jobNote(plan, input, null)).toContain('BYTE 0x100');
  });
});

describe("SAVE EDITED's image", () => {
  it("is the same for a file whether a chip is read or not, with the file's own odometer and no WRINC", () => {
    const file = lateImage({ seed: 3 });
    const chip = lateImage({ seed: 9, km: 200_000 });
    const source = { kind: 'dump' as const, name: 'f.bin', image: file };
    const bytes = bytesOf(file, [[0x200, 0x42]]);
    const withChip = savedImage({ chip, source, ...keep, bytes, odometer: { kind: 'set', km: 250_000 } });
    const without = savedImage({ chip: null, source, ...keep, bytes });
    expect(withChip).not.toBeNull();
    expect(withChip).toEqual(without);
    expect(secureOf(withChip!)).toEqual(secureOf(file));
  });

  it("keeps a chip's own odometer, and is nothing when nothing changed", () => {
    const chip = lateImage();
    const saved = savedImage({ chip, source: { kind: 'chip' }, ...keep, bytes: bytesOf(chip, [[0x200, 0x42]]), odometer: { kind: 'set', km: 200_000 } });
    expect(saved).not.toBeNull();
    expect(secureOf(saved!)).toEqual(secureOf(chip));
    expect(savedImage({ chip, source: { kind: 'chip' }, ...keep })).toBeNull();
    expect(savedImage({ chip: null, source: { kind: 'chip' }, ...keep })).toBeNull();
  });
});
