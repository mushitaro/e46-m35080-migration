import { afterEach, describe, expect, it } from 'vitest';
import { WebSerialTransport } from '@tsunagi/ds2-core';
import {
  checksFor,
  compareEeprom,
  compareOdometer,
  compareReads,
  compareVin,
  eepromReadRange,
  pickReference,
  referenceFromFile,
  sweepNeedle,
  sweepPlan,
  type Reference,
} from '@/lib/kombi/checks';
import { KombiLink } from '@/lib/kombi/kombiLink';
import * as drives from '@/lib/kombi/actuations';
import { clusterHeldNeedles, mayRun, nextNeedleSpan, type NeedleSpan } from '@/lib/kombi/runGate';
import { simulatedKombiPort } from '@/lib/kombi/simulatedKombi';
import { WORD_MAPPING_HYPOTHESIS } from '@/lib/kombi/protocol';
import type { DeviceRecord } from '@/lib/domain/records';
import { lateImage } from './support/lateImage';

const ok = <T,>(value: T) => ({ ok: true as const, value });
const words = (fromWord: number, bytes: Uint8Array) => ({ fromWord, words: bytes.length / 2, bytes: ok(bytes) });
const ref = (image: Uint8Array): Reference => ({ image, source: 'chip-read', label: 'CHIP READ', at: null });

describe('the check list', () => {
  it('reads first, then drives, then what happened after STOP; the output port on a KOMBI46 only', () => {
    expect(checksFor('KOMBI46')).toEqual([
      'vin', 'odometer', 'faults', 'inputs', 'eeprom', 'needles', 'lamps', 'outputs', 'gong', 'piezo', 'release',
    ]);
    expect(checksFor('KOMBI46R')).not.toContain('outputs');
    expect(checksFor(null)).not.toContain('outputs');
    expect(checksFor(null).at(-1)).toBe('release');
  });
});

describe('a dump opened in CHECKS, as what the reads are held against', () => {
  it('takes exactly one M35080 image, named by its file', () => {
    const image = lateImage();
    const r = referenceFromFile('Backup_CD67890.bin', image.slice().buffer);
    expect(r).toMatchObject({ ok: true, reference: { source: 'file', label: 'Backup_CD67890.bin', at: null } });
    expect(r.ok && Array.from(r.reference.image)).toEqual(Array.from(image));
  });

  it("refuses what REWRITE's SOURCE refuses: the wrong size, and a bus's 1024 copies of one byte", () => {
    expect(referenceFromFile('half.bin', new ArrayBuffer(512))).toEqual({ ok: false, refusal: { kind: 'size', size: 512 } });
    expect(referenceFromFile('ff.bin', new Uint8Array(1024).fill(0xff).buffer)).toEqual({
      ok: false,
      refusal: { kind: 'not-a-chip', value: 0xff },
    });
  });
});

describe('what TEST compares against', () => {
  const rec = (over: Partial<DeviceRecord>): DeviceRecord => ({
    id: String(Math.random()),
    createdAt: 0,
    kind: 'backup',
    bytes: new Uint8Array(1024),
    hash: 'h',
    vin: null,
    km: null,
    practice: false,
    ...over,
  });

  it("prefers this session's chip read, when it is the same kind of session", () => {
    const image = lateImage();
    expect(pickReference({ image, practice: false }, [rec({ createdAt: 9 })], false)).toMatchObject({ source: 'chip-read', image });
  });

  it('else the newest record of the same kind - never a practice record for a real test, or back', () => {
    const records = [
      rec({ createdAt: 1, kind: 'backup', vin: 'AB12345', km: 10 }),
      rec({ createdAt: 3, kind: 'rewrite', vin: 'AB12345', km: 20 }),
      rec({ createdAt: 5, kind: 'restore', practice: true }),
    ];
    const real = pickReference({ image: lateImage(), practice: true }, records, false);
    expect(real).toMatchObject({ source: 'record', at: 3 });
    expect(real?.label).toMatch(/^Rewrite_AB12345_20km_/);
    expect(pickReference(null, records, true)).toMatchObject({ source: 'record', at: 5 });
    expect(pickReference(null, [], false)).toBeNull();
    expect(pickReference(null, [rec({ practice: true })], false)).toBeNull();
  });
});

describe('comparisons, when there is a chip image: EQUAL, DIFFERENT, or NOT COMPARED and why', () => {
  const image = lateImage({ codedVin: 'CD67890', asciiVin: 'AB12345', km: 123_456 });

  it('compares the VIN with both chip fields, neither preferred', () => {
    const [coded, ascii] = compareVin(ok('CD67890'), ref(image));
    expect(coded).toMatchObject({ field: 'vin-coded', cluster: 'CD67890', chip: 'CD67890', at: '0x07A-0x07E', result: 'equal' });
    expect(ascii).toMatchObject({ field: 'vin-ascii', chip: 'AB12345', result: 'different', why: null });
  });

  it('says why it could not compare', () => {
    expect(compareVin({ ok: false, reason: 'not-vin-shaped', got: 6 }, ref(image))[0]).toMatchObject({
      result: 'not-compared',
      why: 'unreadable',
    });
    const noAscii = lateImage({ codedVin: 'CD67890', asciiVin: null });
    expect(compareVin(ok('CD67890'), ref(noAscii))[1]).toMatchObject({ result: 'not-compared', why: 'no-field' });
  });

  it("compares the odometer with the chip's counter", () => {
    expect(compareOdometer(ok(123_456), ref(image))).toMatchObject({ chip: '123456', at: '0x000-0x01F', result: 'equal' });
    expect(compareOdometer(ok(123_457), ref(image))).toMatchObject({ result: 'different' });
  });

  it('compares the EEPROM under the stated word mapping, and names every differing byte', () => {
    const read = image.slice(0, 64);
    expect(compareEeprom(words(0, read), ref(image))).toMatchObject({ result: 'equal', differing: [], mapping: WORD_MAPPING_HYPOTHESIS });
    read[0x30] ^= 1;
    read[0x31] ^= 1;
    expect(compareEeprom(words(0, read), ref(image))).toMatchObject({ result: 'different', differing: [0x30, 0x31] });
    // From word 0x10 the read starts at chip byte 0x20.
    expect(compareEeprom(words(0x10, image.slice(0x20, 0x40)), ref(image)).result).toBe('equal');
    const garbled = { fromWord: 0, words: 16, bytes: { ok: false as const, reason: 'length-mismatch' as const, got: 5 } };
    expect(compareEeprom(garbled, ref(image))).toMatchObject({ result: 'not-compared', why: 'unreadable', words: 16 });
  });

  it('holds only the reads made so far against the image', () => {
    const none = { vin: null, odometer: null, eeprom: null };
    expect(compareReads(none, ref(image))).toEqual({ vin: null, odometer: null, eeprom: null });
    const some = compareReads({ ...none, odometer: ok(123_456) }, ref(image));
    expect(some.vin).toBeNull();
    expect(some.odometer).toMatchObject({ result: 'equal' });
  });

  it('reads the whole chip where the variant can address it', () => {
    expect(eepromReadRange('KOMBI46')).toEqual({ from: 0, count: 0x100 });
    expect(eepromReadRange('KOMBI46R')).toEqual({ from: 0, count: 0x200 });
  });
});

describe('the needle sweep', () => {
  /** Runs a plan through the gate the way the link would, span by span. */
  function gateAccepts(plan: number[], start: NeedleSpan): boolean {
    let span = start;
    for (const d of plan) {
      const v = mayRun(drives.setNeedle('KOMBI46', 'rpm', d), {
        variant: 'KOMBI46',
        benchConfirmed: true,
        needles: { ...clusterHeldNeedles(), rpm: span },
      });
      if (!v.ok) return false;
      span = nextNeedleSpan(span, d, true);
    }
    return true;
  }

  it('from a needle the cluster holds: rest, up to the top, back to rest', () => {
    expect(sweepPlan(null)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 80, 70, 60, 50, 40, 30, 20, 10]);
    expect(gateAccepts(sweepPlan(null), null)).toBe(true);
  });

  it('from anywhere the gate allows, every step is one the gate accepts', () => {
    for (const start of [{ lo: 30, hi: 40 }, { lo: 90, hi: 90 }, { lo: 15, hi: 15 }, { lo: 10, hi: 20 }, { lo: 80, hi: 90 }]) {
      const plan = sweepPlan(start);
      expect(gateAccepts(plan, start), JSON.stringify(start)).toBe(true);
      expect(plan.at(-1)).toBe(10);
      expect(Math.max(...plan)).toBe(90);
    }
  });

  const opened: KombiLink[] = [];
  afterEach(async () => {
    for (const l of opened) await l.disconnect().catch(() => {});
    opened.length = 0;
  });

  async function benchLink() {
    const sim = simulatedKombiPort({ variant: 'KOMBI46R', chip: lateImage() });
    const link = new KombiLink(new WebSerialTransport({ requestPort: sim.requestPort }), {
      timings: { responseTimeoutMs: 120, retryDelayMs: 1, resyncSettleMs: 0, breakSettleMs: 1 },
    });
    opened.push(link);
    await link.connect();
    link.setBenchConfirmed(true);
    return { link, kombi: sim.kombi };
  }

  it('drives the simulated cluster through exactly the plan', async () => {
    const { link, kombi } = await benchLink();
    expect(await sweepNeedle(link, 'fuel', { cancelled: () => false, dwellMs: 0 })).toBe('done');
    const moved = kombi.events.filter((e) => e.kind === 'needle').map((e) => (e as { degrees: number }).degrees);
    expect(moved).toEqual(sweepPlan(null));
  });

  it('stops at the next step when cancelled', async () => {
    const { link, kombi } = await benchLink();
    let steps = 0;
    const r = await sweepNeedle(link, 'rpm', { cancelled: () => steps >= 3, dwellMs: 0, onStep: () => steps++ });
    expect(r).toBe('cancelled');
    expect(kombi.events.filter((e) => e.kind === 'needle')).toHaveLength(3);
  });
});
