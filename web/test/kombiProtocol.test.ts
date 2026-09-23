import { describe, expect, it } from 'vitest';
import { buildDs2Frame, toHex } from '@tsunagi/ds2-core';
import * as reads from '@/lib/kombi/reads';
import * as drives from '@/lib/kombi/actuations';
import {
  GAUGE_IDS,
  INPUT_PORTS_46R,
  KOMBI_ADDRESS,
  KOMBI_VARIANTS,
  lampBits,
  type KombiRequest,
} from '@/lib/kombi/protocol';

/**
 * Golden frames. Each expected string is a telegram the SGBD itself builds, checksum included, as
 * read out of KOMBI46.prg / KOMBI46R.prg - so these compare the builders with BMW's tester, not
 * with themselves. Where the SGBD's own example exists (the needle at 45 degrees, the lamp
 * all-off frames, the coding reads) that is the one used.
 */

const wire = (r: KombiRequest) => toHex(buildDs2Frame(KOMBI_ADDRESS, r.control, r.payload)).toUpperCase();

describe('KOMBI telegrams, byte for byte', () => {
  it('reads both variants share', () => {
    expect(wire(reads.readIdent())).toBe('80 04 00 84');
    expect(wire(reads.readVin())).toBe('80 05 02 02 85');
    expect(wire(reads.readOdometer())).toBe('80 05 02 01 86');
    expect(wire(reads.readFaults())).toBe('80 05 04 01 80');
  });

  it('the session frames', () => {
    expect(wire(reads.keepAlive())).toBe('80 04 9E 1A');
    expect(wire(reads.endSession())).toBe('80 04 9F 1B');
  });

  it('inputs: one telegram on a KOMBI46, one per port on a 46R', () => {
    expect(reads.readInputs('KOMBI46').map(wire)).toEqual(['80 0C 0B 14 00 01 02 03 04 05 06 94']);
    // The SGBD's own checksums for its seven port reads: 98 9B 9D 9E 91 95 96.
    expect(reads.readInputs('KOMBI46R').map(wire)).toEqual([
      '80 07 0B 14 00 00 98',
      '80 07 0B 14 03 00 9B',
      '80 07 0B 14 05 00 9D',
      '80 07 0B 14 06 00 9E',
      '80 07 0B 14 09 00 91',
      '80 07 0B 14 0D 00 95',
      '80 07 0B 14 0E 00 96',
    ]);
    expect(INPUT_PORTS_46R).toHaveLength(7);
  });

  it('EEPROM reads, as the SGBD sends them for the coding data and the odometer offset', () => {
    expect(wire(reads.readEeprom('KOMBI46', 0x1f, 8))).toBe('80 09 06 03 00 00 1F 08 9B');
    expect(wire(reads.readEeprom('KOMBI46', 0x23, 1))).toBe('80 09 06 03 00 00 23 01 AE');
    expect(wire(reads.readEeprom('KOMBI46R', 0xb7, 1))).toBe('80 09 06 03 00 00 B7 01 3A');
    expect(wire(reads.readEeprom('KOMBI46R', 0x38, 5))).toBe('80 09 06 03 00 00 38 05 B1');
    // A 46R word above 0xFF uses the second address byte.
    expect(wire(reads.readEeprom('KOMBI46R', 0x1f0, 16))).toBe('80 09 06 03 00 01 F0 10 6D');
  });

  it('a needle at 45 degrees: x32 on a KOMBI46, x10 on a 46R', () => {
    expect(wire(drives.setNeedle('KOMBI46', 'speed', 45))).toBe('80 07 0C 0A 05 A0 24');
    expect(wire(drives.setNeedle('KOMBI46R', 'speed', 45))).toBe('80 07 0C 0A 01 C2 42');
    expect(wire(drives.setNeedle('KOMBI46', 'rpm', 10))).toBe('80 07 0C 0B 01 40 C1');
  });

  it('lamps: four bytes on a KOMBI46, a fixed 00 and six on a 46R', () => {
    expect(wire(drives.lampsOff('KOMBI46'))).toBe('80 09 0C 09 00 00 00 00 8C');
    expect(wire(drives.lampsOff('KOMBI46R'))).toBe('80 0C 0C 09 00 00 00 00 00 00 00 89');
    expect(wire(drives.oneLamp('KOMBI46', 2, 5))).toBe('80 09 0C 09 00 20 00 00 AC');
    expect(wire(drives.oneLamp('KOMBI46R', 6, 7))).toBe('80 0C 0C 09 00 00 00 00 00 00 80 09');
  });

  it('gong, piezo, and the KOMBI46 output port', () => {
    expect(wire(drives.soundGong())).toBe('80 05 0C 11 98');
    expect(wire(drives.soundPiezo())).toBe('80 05 0C 10 99');
    expect(wire(drives.setOutputs(0))).toBe('80 07 0C 14 06 00 99');
  });

  it('builders refuse arguments they cannot encode at all', () => {
    expect(() => drives.setLamps('KOMBI46', [0, 0, 0])).toThrow(RangeError);
    expect(() => drives.setLamps('KOMBI46R', [0, 0, 0, 0])).toThrow(RangeError);
    expect(() => drives.setNeedle('KOMBI46', 'rpm', 45.5)).not.toThrow(); // 45.5 x 32 is whole: the gate decides
    expect(() => drives.setNeedle('KOMBI46R', 'rpm', 45.55)).toThrow(RangeError);
    expect(() => drives.setOutputs(0x100)).toThrow(RangeError);
    expect(() => reads.readEeprom('KOMBI46R', 0x10000, 1)).toThrow(RangeError);
  });

  it('knows every lamp bit the SGBDs name, and no free one', () => {
    expect(lampBits('KOMBI46')).toHaveLength(6 + 8 + 8 + 7);
    expect(lampBits('KOMBI46R')).toHaveLength(5 + 8 + 6 + 7 + 7 + 7);
    expect(lampBits('KOMBI46')).not.toContainEqual({ byte: 1, bit: 6 });
    expect(lampBits('KOMBI46R')).not.toContainEqual({ byte: 1, bit: 1 });
  });
});

describe('what is never built', () => {
  /** Every telegram every builder can produce, for both variants. */
  function everything(): KombiRequest[] {
    const out: KombiRequest[] = [
      reads.readIdent(),
      reads.readVin(),
      reads.readOdometer(),
      reads.readFaults(),
      reads.keepAlive(),
      reads.endSession(),
      drives.soundGong(),
      drives.soundPiezo(),
      drives.setOutputs(0x0f),
    ];
    for (const v of KOMBI_VARIANTS) {
      out.push(...reads.readInputs(v), reads.readEeprom(v, 0, 16), drives.lampsOff(v));
      for (const g of GAUGE_IDS) out.push(drives.setNeedle(v, g, 50));
      for (const { byte, bit } of lampBits(v)) out.push(drives.oneLamp(v, byte, bit));
    }
    return out;
  }

  it('no builder emits a clear, a write, a reset or anything else off the list', () => {
    const controls = new Set(everything().map((r) => r.control));
    expect([...controls].sort((a, b) => a - b)).toEqual([0x00, 0x02, 0x04, 0x06, 0x0b, 0x0c, 0x9e, 0x9f]);
    for (const never of [0x05, 0x07, 0x0f, 0x12, 0x30, 0x9b, 0x9d]) expect(controls.has(never)).toBe(false);
    // Nor the destructive sub-functions of DRIVE: service-interval reset (12), speed signal (08).
    const driveSubs = new Set(everything().filter((r) => r.control === 0x0c).map((r) => r.payload[0]));
    expect(driveSubs.has(0x12)).toBe(false);
    expect(driveSubs.has(0x08)).toBe(false);
  });

  it('the builder modules export builders and nothing that takes raw bytes', () => {
    expect(Object.keys(reads).sort()).toEqual(
      ['endSession', 'keepAlive', 'readEeprom', 'readFaults', 'readIdent', 'readInputs', 'readOdometer', 'readVin'].sort(),
    );
    expect(Object.keys(drives).sort()).toEqual(
      ['lampsOff', 'oneLamp', 'setLamps', 'setNeedle', 'setOutputs', 'soundGong', 'soundPiezo'].sort(),
    );
  });
});
