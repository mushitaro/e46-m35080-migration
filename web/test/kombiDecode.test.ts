import { describe, expect, it } from 'vitest';
import {
  bcd,
  decodeEeprom,
  decodeIdent,
  decodeInputs,
  decodeOdometer,
  decodeVin,
  IDENT_MIN_PAYLOAD,
} from '@/lib/kombi/decode';
import { variantOf, VARIANT_RANGES } from '@/lib/kombi/variant';
import { CODED_VIN_AT, readCodedVin } from '@/lib/domain/layout';
import { lateImage } from './support/lateImage';

const bytes = (...b: number[]) => Uint8Array.from(b);

describe('IDENT', () => {
  // Made-up values in the SGBD's positions: part number (4 BCD), hardware, coding index,
  // diagnosis index, bus index, week, year, supplier, software, CAN index, change index.
  const reply = bytes(0x06, 0x91, 0x23, 0x45, 0x0a, 0x21, 0x36, 0x02, 0x47, 0x01, 0x14, 0x33, 0x05, 0x07);

  it('reads every field from its own byte', () => {
    const r = decodeIdent(reply);
    expect(r).toEqual({
      ok: true,
      value: {
        partNumber: '6912345',
        hardware: 0x0a,
        codingIndex: 0x21,
        diagIndex: 0x36,
        busIndex: 0x02,
        week: 47,
        year: 1,
        supplier: 0x14,
        software: 0x33,
        canIndex: 0x05,
        changeIndex: 0x07,
      },
    });
  });

  it('names a reply too short for the fields it decodes, instead of decoding dashes', () => {
    expect(decodeIdent(reply.subarray(0, IDENT_MIN_PAYLOAD - 1))).toEqual({ ok: false, reason: 'short', got: 11 });
    // The optional trailing fields may be missing.
    const r = decodeIdent(reply.subarray(0, IDENT_MIN_PAYLOAD));
    expect(r.ok && r.value.canIndex).toBeNull();
  });

  it('refuses a part number that is not BCD, and keeps a non-BCD date as unknown', () => {
    expect(decodeIdent(bytes(0x06, 0x9a, 0x23, 0x45, ...reply.subarray(4)))).toMatchObject({ ok: false, reason: 'not-bcd' });
    const odd = Uint8Array.from(reply);
    odd[8] = 0x4f;
    const r = decodeIdent(odd);
    expect(r.ok && r.value.week).toBeNull();
  });
});

describe('the variant, by D_0080.grp\'s ranges', () => {
  it('KOMBI46 0x30-0x35, KOMBI46R 0x36-0x40, closed at both ends', () => {
    expect(variantOf(0x2f)).toBeNull();
    expect(variantOf(0x30)).toBe('KOMBI46');
    expect(variantOf(0x35)).toBe('KOMBI46');
    expect(variantOf(0x36)).toBe('KOMBI46R');
    expect(variantOf(0x40)).toBe('KOMBI46R');
    expect(variantOf(0x41)).toBeNull();
    // Other cars' clusters share the group file; this tool knows neither.
    expect(variantOf(0x29)).toBeNull();
    expect(variantOf(0x50)).toBeNull();
  });

  it('has exactly the two E46 ranges', () => {
    expect(VARIANT_RANGES.map((r) => r.variant)).toEqual(['KOMBI46', 'KOMBI46R']);
  });
});

describe('VIN and odometer', () => {
  it('unpacks the VIN reply exactly as the chip\'s coded field is unpacked', () => {
    const image = lateImage({ codedVin: 'CD67890' });
    const field = image.subarray(CODED_VIN_AT, CODED_VIN_AT + 5);
    expect(decodeVin(bytes(0x00, ...field))).toEqual({ ok: true, value: 'CD67890' });
    expect(readCodedVin(image)).toMatchObject({ ok: true, text: 'CD67890' });
  });

  it('refuses a VIN reply that is not that shape', () => {
    expect(decodeVin(bytes(0x00, 0x43, 0x44, 0x6a, 0x89, 0x05))).toMatchObject({ ok: false, reason: 'not-vin-shaped' });
    expect(decodeVin(bytes(0x00, 0x2d, 0x44, 0x67, 0x89, 0x05))).toMatchObject({ ok: false, reason: 'not-vin-shaped' });
    expect(decodeVin(bytes(0x00, 0x43, 0x44))).toMatchObject({ ok: false, reason: 'short' });
  });

  it('reads six BCD digits of odometer', () => {
    expect(decodeOdometer(bytes(0x00, 0x15, 0x59, 0x40))).toEqual({ ok: true, value: 155_940 });
    expect(decodeOdometer(bytes(0x00, 0x00, 0x00, 0x00))).toEqual({ ok: true, value: 0 });
    expect(decodeOdometer(bytes(0x00, 0x15, 0x5f, 0x40))).toMatchObject({ ok: false, reason: 'not-bcd' });
    expect(decodeOdometer(bytes(0x00, 0x15))).toMatchObject({ ok: false, reason: 'short' });
  });

  it('bcd: two digits or nothing', () => {
    expect(bcd(0x47)).toBe('47');
    expect(bcd(0x4a)).toBeNull();
    expect(bcd(0xa4)).toBeNull();
  });
});

describe('EEPROM and inputs', () => {
  it('an EEPROM reply is exactly two bytes a word', () => {
    expect(decodeEeprom(bytes(1, 2, 3, 4), 2)).toEqual({ ok: true, value: bytes(1, 2, 3, 4) });
    expect(decodeEeprom(bytes(1, 2, 3), 2)).toMatchObject({ ok: false, reason: 'length-mismatch', got: 3 });
  });

  it('inputs: seven ports from one reply on a KOMBI46, one per reply on a 46R', () => {
    const r46 = decodeInputs('KOMBI46', [bytes(0x81, 0, 0x04, 0, 0x80, 0x03, 0)]);
    expect(r46.ok && r46.value.map((p) => p.port)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(r46.ok && r46.value[0]).toEqual({ port: 0, value: 0x81 });

    const r46r = decodeInputs('KOMBI46R', [0x01, 0x02, 0x80, 0x10, 0x20, 0x08, 0x02].map((v) => bytes(v)));
    expect(r46r.ok && r46r.value.map((p) => p.port)).toEqual([0x00, 0x03, 0x05, 0x06, 0x09, 0x0d, 0x0e]);
    expect(r46r.ok && r46r.value[2]).toEqual({ port: 0x05, value: 0x80 });

    expect(decodeInputs('KOMBI46', [bytes(0, 0, 0)])).toMatchObject({ ok: false, reason: 'short' });
    expect(decodeInputs('KOMBI46R', [bytes(1)])).toMatchObject({ ok: false, reason: 'length-mismatch' });
  });
});
