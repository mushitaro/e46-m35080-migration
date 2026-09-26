import { describe, expect, it } from 'vitest';
import { WebSerialTransport } from '@tsunagi/ds2-core';
import * as drives from '@/lib/kombi/actuations';
import * as reads from '@/lib/kombi/reads';
import { checksFor } from '@/lib/kombi/checks';
import { KombiLink } from '@/lib/kombi/kombiLink';
import { gaugesFor, lampBits, type KombiRequest } from '@/lib/kombi/protocol';
import { mayRun, type GateContext } from '@/lib/kombi/runGate';
import { simulatedKombiPort } from '@/lib/kombi/simulatedKombi';
import { variantOf } from '@/lib/kombi/variant';
import { lateImage } from './support/lateImage';

/**
 * KOMBIR40: what D_0080.grp names diagnosis index 0x50-0x54, and what the first cluster on the
 * bench answered as (0x54). Each telegram is held to the bytes the KOMBIR40 SGBD sent when its job
 * ran in EDIABAS simulation - address, length and checksum aside, which are the link's.
 */

const bytes = (r: KombiRequest) => [r.control, ...r.payload];

describe('KOMBIR40', () => {
  it('is what D_0080.grp names 0x50-0x54, the bench cluster 0x54 among them', () => {
    expect(variantOf(0x50)).toBe('KOMBIR40');
    expect(variantOf(0x54)).toBe('KOMBIR40');
    expect(variantOf(0x4f)).toBeNull();
    expect(variantOf(0x55)).toBeNull();
  });

  it('sends what its SGBD sends', () => {
    // Needles: speed 10 and 50, rpm 50, fuel 50, coolant 90.
    expect(bytes(drives.setNeedle('KOMBIR40', 'speed', 10))).toEqual([0x0c, 0x0a, 0x01, 0x40]);
    expect(bytes(drives.setNeedle('KOMBIR40', 'speed', 50))).toEqual([0x0c, 0x0a, 0x06, 0x40]);
    expect(bytes(drives.setNeedle('KOMBIR40', 'rpm', 50))).toEqual([0x0c, 0x0b, 0x06, 0x40]);
    expect(bytes(drives.setNeedle('KOMBIR40', 'fuel', 50))).toEqual([0x0c, 0x0c, 0x06, 0x40]);
    expect(bytes(drives.setNeedle('KOMBIR40', 'coolant', 90))).toEqual([0x0c, 0x0d, 0x0b, 0x40]);
    // Lamps: the first bit of the first byte, the top bit of the last, all off.
    expect(bytes(drives.oneLamp('KOMBIR40', 1, 0))).toEqual([0x0c, 0x09, 0x01, 0, 0, 0, 0, 0, 0]);
    expect(bytes(drives.oneLamp('KOMBIR40', 7, 7))).toEqual([0x0c, 0x09, 0, 0, 0, 0, 0, 0, 0x80]);
    expect(bytes(drives.lampsOff('KOMBIR40'))).toEqual([0x0c, 0x09, 0, 0, 0, 0, 0, 0, 0]);
    // The EEPROM from word 0x10, four words; the inputs.
    expect(bytes(reads.readEeprom('KOMBIR40', 0x10, 4))).toEqual([0x06, 0x03, 0x00, 0x00, 0x10, 0x04]);
    expect(reads.readInputs('KOMBIR40').map(bytes)).toEqual([[0x0b, 0x14, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06]]);
  });

  it('lets through the drives its SGBD has, on the bench, and nothing it has no job for', () => {
    const ctx: GateContext = {
      variant: 'KOMBIR40',
      benchConfirmed: true,
      needles: { speed: null, rpm: null, fuel: null, coolant: null, consumption: null },
    };
    expect(mayRun(drives.setNeedle('KOMBIR40', 'speed', 10), ctx).ok).toBe(true);
    expect(mayRun(drives.oneLamp('KOMBIR40', 7, 6), ctx).ok).toBe(true);
    expect(mayRun(reads.readEeprom('KOMBIR40', 0xf0, 16), ctx).ok).toBe(true);
    expect(mayRun(reads.readEeprom('KOMBIR40', 0xf8, 16), ctx)).toMatchObject({ ok: false, reason: 'out-of-range' });
    expect(mayRun(drives.setNeedle('KOMBIR40', 'consumption', 10), ctx)).toMatchObject({ reason: 'not-on-this-variant' });
    expect(mayRun(drives.soundGong(), ctx)).toMatchObject({ reason: 'not-on-this-variant' });
    expect(mayRun(drives.soundPiezo(), ctx)).toMatchObject({ reason: 'not-on-this-variant' });
    expect(mayRun(drives.setOutputs(0x01), ctx)).toMatchObject({ reason: 'not-on-this-variant' });
    // A bit its SGBD marks open is not a lamp.
    expect(mayRun(drives.oneLamp('KOMBIR40', 4, 0), ctx)).toMatchObject({ reason: 'out-of-range' });
    expect(mayRun(drives.oneLamp('KOMBIR40', 1, 3), ctx)).toMatchObject({ reason: 'out-of-range' });
  });

  it('lists four needles, 21 lamps, and no gong, piezo or output port', () => {
    expect(gaugesFor('KOMBIR40').map((g) => g.id)).toEqual(['speed', 'rpm', 'fuel', 'coolant']);
    expect(lampBits('KOMBIR40')).toHaveLength(21);
    expect(checksFor('KOMBIR40')).toEqual(['vin', 'odometer', 'faults', 'inputs', 'eeprom', 'needles', 'lamps', 'release']);
  });

  it('is named at CONNECT from an IDENT like the bench cluster sent, and reads its EEPROM', async () => {
    const chip = lateImage();
    const { kombi, requestPort } = simulatedKombiPort({ variant: 'KOMBIR40', chip, diagIndex: 0x54 });
    const link = new KombiLink(new WebSerialTransport({ requestPort }));
    const identity = await link.connect();
    expect(identity.variant).toBe('KOMBIR40');
    const read = await link.readEepromWords(0, 0x20);
    expect(read.ok && Array.from(read.value)).toEqual(Array.from(chip.subarray(0, 0x40)));
    link.setBenchConfirmed(true);
    await link.setNeedle('speed', 10);
    expect(kombi.events.at(-1)).toEqual({ kind: 'needle', gauge: 'speed', degrees: 10 });
    await link.disconnect();
  });
});
