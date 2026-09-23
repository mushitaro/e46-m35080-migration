import { describe, expect, it } from 'vitest';
import * as reads from '@/lib/kombi/reads';
import * as drives from '@/lib/kombi/actuations';
import { GAUGE_IDS, KOMBI_VARIANTS, lampBits, request, type KombiRequest, type KombiVariant } from '@/lib/kombi/protocol';
import { clusterHeldNeedles, mayRun, nextNeedleSpan, type GateContext, type NeedleSpan } from '@/lib/kombi/runGate';

const ALLOWED_CONTROLS = new Set([0x00, 0x02, 0x04, 0x06, 0x0b, 0x0c, 0x9e, 0x9f]);

function ctx(over: Partial<GateContext> = {}): GateContext {
  return { variant: 'KOMBI46', benchConfirmed: true, needles: clusterHeldNeedles(), ...over };
}

function at(gauge: string, span: NeedleSpan): GateContext['needles'] {
  return { ...clusterHeldNeedles(), [gauge]: span };
}

const verdictOf = (r: KombiRequest, c: GateContext) => mayRun(r, c);

describe('mayRun: the list', () => {
  it('refuses every control byte not on the list, whatever follows it', () => {
    for (let control = 0; control < 256; control++) {
      if (ALLOWED_CONTROLS.has(control)) continue;
      for (let len = 0; len <= 9; len++) {
        for (const fill of [0x00, 0x01, 0x03, 0x09, 0x14, 0xff]) {
          for (const variant of [null, ...KOMBI_VARIANTS] as const) {
            const v = mayRun(request(control, Array(len).fill(fill)), ctx({ variant }));
            expect(v, `control ${control.toString(16)} len ${len}`).toEqual({ ok: false, kind: null, reason: 'not-allowed' });
          }
        }
      }
    }
  });

  it('on the controls that are on it, lets through only the exact shapes, and nothing a sweep can stumble on', () => {
    // Every payload of up to three bytes on an allowed control, against the most permissive context.
    const passed: string[] = [];
    for (const variant of KOMBI_VARIANTS) {
      for (const control of ALLOWED_CONTROLS) {
        const payloads: number[][] = [[]];
        for (const a of [0x00, 0x01, 0x02, 0x03, 0x06, 0x09, 0x0a, 0x10, 0x11, 0x12, 0x14]) {
          payloads.push([a]);
          for (const b of [0x00, 0x06]) {
            payloads.push([a, b]);
            payloads.push([a, b, 0x00]);
          }
        }
        for (const p of payloads) {
          if (mayRun(request(control, p), ctx({ variant })).ok) {
            passed.push(`${variant} ${control.toString(16).padStart(2, '0')} ${p.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
          }
        }
      }
    }
    expect(passed.sort()).toEqual(
      [
        // both variants: IDENT, VIN, odometer, faults, gong, piezo, 9E, 9F
        ...KOMBI_VARIANTS.flatMap((v) => [`${v} 00 `, `${v} 02 02`, `${v} 02 01`, `${v} 04 01`, `${v} 0c 11`, `${v} 0c 10`, `${v} 9e `, `${v} 9f `]),
        // KOMBI46: the output port, all off; 46R: the two input-port reads this alphabet spells (00, 06)
        'KOMBI46 0c 14 06 00',
        'KOMBI46R 0b 14 00 00',
        'KOMBI46R 0b 14 06 00',
      ].sort(),
    );
  });

  it('refuses the SGBD telegrams that clear, write, reset or sleep - handed over as bytes', () => {
    const destructive: [string, KombiRequest][] = [
      ['clear fault memory', request(0x05)],
      ['write EEPROM (odometer offset)', request(0x07, [0x03, 0x00, 0x00, 0x23, 0x01, 0x00, 0x00])],
      ['write vehicle order', request(0x07, [0x08, 0x00, 0x00, 0x10, 0x20, ...Array(32).fill(0)])],
      ['software reset', request(0x12)],
      ['service interval reset', request(0x0c, [0x12, 0x01])],
      ['speed signal output', request(0x0c, [0x08, 0x07, 0x16])],
      ['self test', request(0x30)],
      ['sleep', request(0x9d)],
      ['timed sleep', request(0x9b, [0x04])],
    ];
    for (const [what, r] of destructive) {
      for (const variant of [null, ...KOMBI_VARIANTS] as const) {
        expect(mayRun(r, ctx({ variant })).ok, what).toBe(false);
      }
    }
  });

  it('refuses every allowed telegram with a byte added or taken away', () => {
    for (const variant of KOMBI_VARIANTS) {
      const c = ctx({ variant, needles: at('rpm', { lo: 40, hi: 40 }) });
      const good = [
        reads.readIdent(),
        reads.readVin(),
        reads.readFaults(),
        ...reads.readInputs(variant),
        reads.readEeprom(variant, 0x10, 4),
        drives.setNeedle(variant, 'rpm', 45),
        drives.lampsOff(variant),
        drives.soundGong(),
      ];
      for (const r of good) {
        expect(mayRun(r, c).ok).toBe(true);
        const longer = request(r.control, [...r.payload, 0x00]);
        const shorter = request(r.control, [...r.payload].slice(0, -1));
        expect(mayRun(longer, c).ok).toBe(false);
        if (r.payload.length > 0) expect(mayRun(shorter, c).ok).toBe(false);
      }
    }
  });
});

describe('mayRun: before the variant is known', () => {
  const unknown = ctx({ variant: null });

  it('allows the session frames and the reads both variants share', () => {
    for (const r of [reads.readIdent(), reads.readVin(), reads.readOdometer(), reads.readFaults(), reads.keepAlive(), reads.endSession()]) {
      expect(mayRun(r, unknown)).toMatchObject({ ok: true });
    }
  });

  it('refuses everything whose shape depends on the variant, and every drive', () => {
    const refused = [
      ...reads.readInputs('KOMBI46'),
      ...reads.readInputs('KOMBI46R'),
      reads.readEeprom('KOMBI46', 0, 1),
      drives.setNeedle('KOMBI46', 'rpm', 10),
      drives.lampsOff('KOMBI46'),
      drives.setOutputs(0),
      drives.soundGong(),
      drives.soundPiezo(),
    ];
    for (const r of refused) expect(mayRun(r, unknown)).toMatchObject({ ok: false, reason: 'variant-unknown' });
  });
});

describe('mayRun: the bench', () => {
  it('refuses every drive until the reader has confirmed the bench, and no read', () => {
    for (const variant of KOMBI_VARIANTS) {
      const off = ctx({ variant, benchConfirmed: false });
      for (const r of [drives.setNeedle(variant, 'fuel', 10), drives.lampsOff(variant), drives.soundGong(), drives.soundPiezo()]) {
        expect(mayRun(r, off)).toMatchObject({ ok: false, reason: 'bench-unconfirmed' });
        expect(mayRun(r, { ...off, benchConfirmed: true }).ok).toBe(true);
      }
      for (const r of [reads.readVin(), ...reads.readInputs(variant), reads.readEeprom(variant, 0, 16)]) {
        expect(mayRun(r, off).ok).toBe(true);
      }
    }
  });
});

describe('mayRun: needles', () => {
  it('only the rest angle while the cluster holds the needle', () => {
    for (const variant of KOMBI_VARIANTS) {
      for (const g of GAUGE_IDS) {
        expect(mayRun(drives.setNeedle(variant, g, 10), ctx({ variant })).ok).toBe(true);
        expect(mayRun(drives.setNeedle(variant, g, 20), ctx({ variant }))).toMatchObject({ ok: false, reason: 'step-too-large' });
      }
    }
  });

  it('10-90 degrees, whole degrees, one step of 10 at most', () => {
    const c = ctx({ needles: at('rpm', { lo: 50, hi: 50 }) });
    for (let d = 40; d <= 60; d++) expect(mayRun(drives.setNeedle('KOMBI46', 'rpm', d), c).ok).toBe(true);
    expect(mayRun(drives.setNeedle('KOMBI46', 'rpm', 39), c)).toMatchObject({ reason: 'step-too-large' });
    expect(mayRun(drives.setNeedle('KOMBI46', 'rpm', 61), c)).toMatchObject({ reason: 'step-too-large' });
    expect(mayRun(drives.setNeedle('KOMBI46', 'rpm', 45.5), c)).toMatchObject({ reason: 'out-of-range' });

    const low = ctx({ needles: at('rpm', { lo: 10, hi: 10 }) });
    expect(mayRun(drives.setNeedle('KOMBI46', 'rpm', 9), low)).toMatchObject({ reason: 'out-of-range' });
    const high = ctx({ variant: 'KOMBI46R', needles: at('coolant', { lo: 90, hi: 90 }) });
    expect(mayRun(drives.setNeedle('KOMBI46R', 'coolant', 91), high)).toMatchObject({ reason: 'out-of-range' });
    expect(mayRun(drives.setNeedle('KOMBI46R', 'coolant', 80), high).ok).toBe(true);
  });

  it('a value scaled for the other variant is refused, not reinterpreted', () => {
    // 45 degrees for a 46R is 450 = 14.06 degrees on a KOMBI46: not a whole angle.
    const c = ctx({ variant: 'KOMBI46', needles: at('speed', { lo: 10, hi: 10 }) });
    expect(mayRun(drives.setNeedle('KOMBI46R', 'speed', 45), c)).toMatchObject({ ok: false, reason: 'out-of-range' });
  });

  it('after a command that may not have landed, the next move has to suit both ends', () => {
    const span = nextNeedleSpan({ lo: 30, hi: 30 }, 40, false);
    expect(span).toEqual({ lo: 30, hi: 40 });
    const c = ctx({ needles: at('rpm', span) });
    for (let d = 30; d <= 40; d++) expect(mayRun(drives.setNeedle('KOMBI46', 'rpm', d), c).ok).toBe(true);
    expect(mayRun(drives.setNeedle('KOMBI46', 'rpm', 41), c).ok).toBe(false);
    expect(mayRun(drives.setNeedle('KOMBI46', 'rpm', 29), c).ok).toBe(false);
    expect(nextNeedleSpan(span, 35, true)).toEqual({ lo: 35, hi: 35 });
    expect(nextNeedleSpan(null, 10, false)).toBeNull();
  });
});

describe('mayRun: arguments', () => {
  it('lamps: only bits that exist, and the 46R fixed byte', () => {
    for (const variant of KOMBI_VARIANTS) {
      for (const { byte, bit } of lampBits(variant)) {
        expect(mayRun(drives.oneLamp(variant, byte, bit), ctx({ variant })).ok).toBe(true);
      }
    }
    expect(mayRun(drives.oneLamp('KOMBI46', 1, 6), ctx())).toMatchObject({ reason: 'out-of-range' });
    expect(mayRun(drives.oneLamp('KOMBI46', 4, 7), ctx())).toMatchObject({ reason: 'out-of-range' });
    expect(mayRun(drives.oneLamp('KOMBI46R', 1, 1), ctx({ variant: 'KOMBI46R' }))).toMatchObject({ reason: 'out-of-range' });
    expect(mayRun(request(0x0c, [0x09, 0x01, 0, 0, 0, 0, 0, 0]), ctx({ variant: 'KOMBI46R' }))).toMatchObject({
      reason: 'out-of-range',
    });
  });

  it('the output port exists on a KOMBI46 only, with four bits', () => {
    expect(mayRun(drives.setOutputs(0x0f), ctx()).ok).toBe(true);
    expect(mayRun(drives.setOutputs(0x10), ctx())).toMatchObject({ reason: 'out-of-range' });
    expect(mayRun(drives.setOutputs(0x01), ctx({ variant: 'KOMBI46R' }))).toMatchObject({ reason: 'not-on-this-variant' });
    expect(mayRun(request(0x0c, [0x14, 0x05, 0x01]), ctx())).toMatchObject({ reason: 'not-allowed' });
  });

  it('inputs: the ports the SGBD reads, and no other', () => {
    expect(mayRun(request(0x0b, [0x14, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x07]), ctx())).toMatchObject({ reason: 'out-of-range' });
    expect(mayRun(request(0x0b, [0x14, 0x01, 0x00]), ctx({ variant: 'KOMBI46R' }))).toMatchObject({ reason: 'out-of-range' });
    expect(mayRun(request(0x0b, [0x14, 0x03, 0x01]), ctx({ variant: 'KOMBI46R' }))).toMatchObject({ reason: 'out-of-range' });
  });

  it('EEPROM: 1-16 words, inside the variant\'s address space', () => {
    const check = (v: KombiVariant, word: number, count: number) => mayRun(reads.readEeprom(v, word, count), ctx({ variant: v })).ok;
    expect(check('KOMBI46', 0xf0, 16)).toBe(true);
    expect(check('KOMBI46', 0xf1, 16)).toBe(false);
    expect(check('KOMBI46', 0x00, 0)).toBe(false);
    expect(check('KOMBI46', 0x00, 17)).toBe(false);
    expect(check('KOMBI46R', 0x3f0, 16)).toBe(true);
    expect(check('KOMBI46R', 0x3f1, 16)).toBe(false);
    // A KOMBI46 read with a high address byte is not the SGBD's telegram.
    expect(mayRun(request(0x06, [0x03, 0x00, 0x01, 0x00, 0x01]), ctx())).toMatchObject({ reason: 'out-of-range' });
    // Only segment 03: RAM, ROM and the CAN buffers are not on the list.
    for (const seg of [0x01, 0x04, 0x05, 0x08, 0x0a]) {
      expect(mayRun(request(0x06, [seg, 0x00, 0x00, 0x00, 0x01]), ctx())).toMatchObject({ reason: 'not-allowed' });
    }
  });

  it('is a pure function of its inputs', () => {
    const c = ctx({ needles: at('rpm', { lo: 20, hi: 20 }) });
    const r = drives.setNeedle('KOMBI46', 'rpm', 30);
    expect(verdictOf(r, c)).toEqual(verdictOf(r, c));
    expect(c.needles.rpm).toEqual({ lo: 20, hi: 20 });
  });
});
