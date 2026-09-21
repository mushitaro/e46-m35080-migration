import { describe, it, expect } from 'vitest';
import {
  SECURE_BYTES,
  SECURE_SLOTS,
  KM_PER_STEP,
  MAX_KM,
  readSecureSlots,
  slotsToBytes,
  groupSlots,
  decodeOdometer,
  encodeOdometer,
  planSlotWrites,
  planOdometerWrite,
  minimumReachableKm,
  isSecureBlank,
} from '@/lib/domain/odometer';

/** Build a 32-byte secure area from sixteen register values. */
const secure = (slots: number[]) => slotsToBytes(slots);

/** The reference README's worked example: 0x2613 x4 then 0x2612 x12. */
const README_SLOTS = [
  ...Array(4).fill(0x2613),
  ...Array(12).fill(0x2612),
];

describe('readSecureSlots / slotsToBytes', () => {
  it('reads sixteen big-endian u16 registers', () => {
    const bytes = new Uint8Array(SECURE_BYTES);
    bytes[0] = 0x26;
    bytes[1] = 0x13;
    expect(readSecureSlots(bytes)[0]).toBe(0x2613);
  });

  it('round-trips slots through bytes', () => {
    expect(readSecureSlots(slotsToBytes(README_SLOTS))).toEqual(README_SLOTS);
  });

  it('rejects a short secure area rather than reading garbage', () => {
    expect(() => readSecureSlots(new Uint8Array(8))).toThrow(RangeError);
  });
});

describe('decodeOdometer', () => {
  it("decodes the README example to 155,940 km", () => {
    const d = decodeOdometer(secure(README_SLOTS));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.km).toBe(155_940);
    expect(d.base).toBe(0x2612);
    expect(d.remainder).toBe(4);
    expect(d.canonical).toBe(true);
    // 0x2612 * 16 = 155,936, plus the 4 bumped registers
    expect(d.base * KM_PER_STEP + d.remainder).toBe(155_940);
  });

  it('decodes an all-equal area as an exact multiple of 16', () => {
    const d = decodeOdometer(secure(Array(16).fill(1000)));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.km).toBe(16_000);
    expect(d.remainder).toBe(0);
    expect(d.groups).toHaveLength(1);
  });

  it('reads a blank chip as 0 km', () => {
    const d = decodeOdometer(new Uint8Array(SECURE_BYTES));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.km).toBe(0);
  });

  it('flags a two-run area whose runs are not adjacent as non-canonical', () => {
    // 0x2620 is not 0x2612 + 1, so this is not a state the encoder produces.
    const d = decodeOdometer(secure([...Array(4).fill(0x2620), ...Array(12).fill(0x2612)]));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.canonical).toBe(false);
  });

  it('refuses to invent a number when there are three or more runs', () => {
    const d = decodeOdometer(secure([1, 1, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]));
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.groups.length).toBe(3);
    expect(d.reason).toMatch(/3 distinct runs/);
  });
});

describe('encodeOdometer', () => {
  it('reproduces the README example from its km value', () => {
    expect(encodeOdometer(155_940)).toEqual(README_SLOTS);
  });

  it('puts the remainder in the leading slots', () => {
    const slots = encodeOdometer(16 * 100 + 5);
    expect(slots.slice(0, 5)).toEqual(Array(5).fill(101));
    expect(slots.slice(5)).toEqual(Array(11).fill(100));
  });

  it('round-trips every remainder', () => {
    for (let r = 0; r < KM_PER_STEP; r++) {
      const km = 12_345 * KM_PER_STEP + r;
      const d = decodeOdometer(slotsToBytes(encodeOdometer(km)));
      expect(d.ok).toBe(true);
      if (!d.ok) return;
      expect(d.km).toBe(km);
    }
  });

  it('round-trips a spread of realistic odometer values', () => {
    for (const km of [0, 1, 15, 16, 17, 99_999, 155_940, 250_001, 999_999]) {
      const d = decodeOdometer(slotsToBytes(encodeOdometer(km)));
      expect(d.ok && d.km).toBe(km);
    }
  });

  it('always produces sixteen registers', () => {
    expect(encodeOdometer(123_456)).toHaveLength(SECURE_SLOTS);
  });

  it('rejects negative and non-integer km', () => {
    expect(() => encodeOdometer(-1)).toThrow(RangeError);
    expect(() => encodeOdometer(1.5)).toThrow(RangeError);
  });

  it('accepts the maximum and rejects one past it', () => {
    expect(() => encodeOdometer(MAX_KM)).not.toThrow();
    expect(() => encodeOdometer(MAX_KM + 1)).toThrow(RangeError);
  });
});

describe('planSlotWrites - the monotonic guard', () => {
  it('emits one WRINC per increased register, at address slot<<1', () => {
    const plan = planSlotWrites(Array(16).fill(100), encodeOdometer(16 * 100 + 3));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ops).toHaveLength(3); // only the three bumped slots
    expect(plan.ops.map((o) => o.address)).toEqual([0x00, 0x02, 0x04]);
    expect(plan.ops.every((o) => o.to === o.from + 1)).toBe(true);
  });

  it('writes nothing when the target equals the current value', () => {
    const slots = encodeOdometer(155_940);
    const plan = planSlotWrites(slots, slots);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ops).toHaveLength(0);
  });

  it('REFUSES the whole plan if any register would decrease', () => {
    const plan = planSlotWrites(encodeOdometer(200_000), encodeOdometer(100_000));
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.violations.length).toBeGreaterThan(0);
    expect(plan.reason).toMatch(/only count up/);
  });

  it('refuses even when only the remainder would go down', () => {
    // Same base, fewer bumped slots -> slot 3 must decrease. Hardware refuses.
    const plan = planSlotWrites(encodeOdometer(16_004), encodeOdometer(16_002));
    expect(plan.ok).toBe(false);
  });

  it('planOdometerWrite refuses a rollback from a real image', () => {
    const current = slotsToBytes(README_SLOTS); // 155,940 km
    expect(planOdometerWrite(current, 100_000).ok).toBe(false);
    expect(planOdometerWrite(current, 155_940).ok).toBe(true);
    expect(planOdometerWrite(current, 200_000).ok).toBe(true);
  });
});

describe('blank / floor helpers', () => {
  it('isSecureBlank only for an all-zero area', () => {
    expect(isSecureBlank(new Uint8Array(SECURE_BYTES))).toBe(true);
    expect(isSecureBlank(slotsToBytes(README_SLOTS))).toBe(false);
  });

  it('minimumReachableKm is the current reading on a canonical image', () => {
    expect(minimumReachableKm(slotsToBytes(README_SLOTS))).toBe(155_940);
  });

  it('a blank chip can still go to 0 km', () => {
    expect(minimumReachableKm(new Uint8Array(SECURE_BYTES))).toBe(0);
  });
});
