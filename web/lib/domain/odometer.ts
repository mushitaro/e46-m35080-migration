/**
 * Odometer codec for the M35080 secure/incremental area (0x00-0x1F).
 *
 * Ported from `print_odometer()` / `write_odometer()` in
 * gerchanovsky/m35080_odometer_fix (m35080_odometer_fix.ino).
 *
 * Encoding: the secure area is sixteen big-endian 16-bit registers. Each holds
 * a base counter of `km / 16`; the 0-15 km remainder is encoded as *how many*
 * of the sixteen registers have been bumped to `base + 1`. Every km therefore
 * costs exactly one increment somewhere, which is what lets the hardware's
 * increment-only rule carry a 1 km resolution.
 *
 *   km = base * 16 + (number of slots holding base + 1)
 *
 * Verified against the reference README: registers reading 0x2613 x4 then
 * 0x2612 x12 decode to 0x2612 * 16 + 4 = 155,940 km.
 *
 * THE HARDWARE RULE: a WRINC that would not increase a register is refused by
 * the chip (it sets the INC status bit). Mileage can be raised, never lowered.
 */

/** Bytes occupied by the secure/incremental area: 0x00-0x1F. */
export const SECURE_BYTES = 0x20;
/** The area is sixteen 16-bit registers. */
export const SECURE_SLOTS = 16;
/** Each base-counter step is worth this many km. */
export const KM_PER_STEP = 16;
/** Largest register value; the counter is 16-bit. */
export const MAX_SLOT_VALUE = 0xffff;
/** Highest km the encoding can represent (remainder 0, every slot at max). */
export const MAX_KM = MAX_SLOT_VALUE * KM_PER_STEP;

export type OdometerGroup = { value: number; count: number };

export type OdometerDecode =
  | {
      ok: true;
      km: number;
      base: number;
      remainder: number;
      groups: OdometerGroup[];
      /** True when the pattern is exactly the one `encodeOdometer` produces. */
      canonical: boolean;
    }
  | { ok: false; reason: string; groups: OdometerGroup[] };

/** Read the sixteen big-endian u16 registers out of the 32-byte secure area. */
export function readSecureSlots(secure: Uint8Array): number[] {
  if (secure.length < SECURE_BYTES) {
    throw new RangeError(
      `secure area must be ${SECURE_BYTES} bytes, got ${secure.length}`,
    );
  }
  const slots: number[] = [];
  for (let i = 0; i < SECURE_SLOTS; i++) {
    slots.push((secure[i << 1] << 8) | secure[(i << 1) + 1]);
  }
  return slots;
}

/** Serialize sixteen registers back to the 32-byte big-endian secure area. */
export function slotsToBytes(slots: readonly number[]): Uint8Array {
  const out = new Uint8Array(SECURE_BYTES);
  for (let i = 0; i < SECURE_SLOTS; i++) {
    const v = slots[i] ?? 0;
    out[i << 1] = (v >> 8) & 0xff;
    out[(i << 1) + 1] = v & 0xff;
  }
  return out;
}

/** Group consecutive equal registers, preserving order (port of the sketch). */
export function groupSlots(slots: readonly number[]): OdometerGroup[] {
  const groups: OdometerGroup[] = [];
  for (const value of slots) {
    const last = groups[groups.length - 1];
    if (last && last.value === value) last.count++;
    else groups.push({ value, count: 1 });
  }
  return groups;
}

/**
 * Decode km from the secure area.
 *
 * One group  -> every register equal, remainder 0:  km = value * 16
 * Two groups -> the leading group is the bumped one: km = lower * 16 + count
 * Anything else is not a state this encoding produces; report it rather than
 * inventing a number (the sketch prints "error" here, and so do we).
 */
export function decodeOdometer(secure: Uint8Array): OdometerDecode {
  const groups = groupSlots(readSecureSlots(secure));

  if (groups.length === 1) {
    const base = groups[0].value;
    return {
      ok: true,
      km: base * KM_PER_STEP,
      base,
      remainder: 0,
      groups,
      canonical: true,
    };
  }

  if (groups.length === 2) {
    const [high, low] = groups;
    const base = low.value;
    const remainder = high.count;
    // The canonical pattern is `base+1` repeated `remainder` times, then `base`.
    const canonical = high.value === base + 1;
    return {
      ok: true,
      km: base * KM_PER_STEP + remainder,
      base,
      remainder,
      groups,
      canonical,
    };
  }

  return {
    ok: false,
    reason:
      groups.length === 0
        ? 'secure area is empty'
        : `secure area holds ${groups.length} distinct runs; expected 1 or 2`,
    groups,
  };
}

/** Build the sixteen registers that represent `km`. */
export function encodeOdometer(km: number): number[] {
  if (!Number.isInteger(km) || km < 0) {
    throw new RangeError(`km must be a non-negative integer, got ${km}`);
  }
  const base = Math.floor(km / KM_PER_STEP);
  const remainder = km % KM_PER_STEP;
  if (base + (remainder > 0 ? 1 : 0) > MAX_SLOT_VALUE) {
    throw new RangeError(`km ${km} exceeds the encodable maximum ${MAX_KM}`);
  }
  const slots: number[] = [];
  for (let i = 0; i < SECURE_SLOTS; i++) {
    slots.push(i < remainder ? base + 1 : base);
  }
  return slots;
}

export type WriteOp = {
  slot: number;
  /** Byte address the WRINC targets: slot << 1. */
  address: number;
  from: number;
  to: number;
};

export type Violation = { slot: number; current: number; target: number };

export type WritePlan =
  | { ok: true; ops: WriteOp[] }
  | { ok: false; reason: string; violations: Violation[] };

/**
 * Work out which WRINC writes turn `current` into `target`.
 *
 * Refuses the whole plan if ANY register would have to decrease - the chip
 * would reject it and set INC, and a partially-applied odometer is worse than
 * a refused one. This is the guard that must run BEFORE we touch the device.
 */
export function planSlotWrites(
  current: readonly number[],
  target: readonly number[],
): WritePlan {
  const violations: Violation[] = [];
  const ops: WriteOp[] = [];

  for (let slot = 0; slot < SECURE_SLOTS; slot++) {
    const from = current[slot] ?? 0;
    const to = target[slot] ?? 0;
    if (to < from) {
      violations.push({ slot, current: from, target: to });
    } else if (to > from) {
      ops.push({ slot, address: slot << 1, from, to });
    }
    // equal: nothing to write, and writing it would be refused anyway
  }

  if (violations.length > 0) {
    return {
      ok: false,
      reason:
        'the secure area can only count up; these registers would have to decrease',
      violations,
    };
  }
  return { ok: true, ops };
}

/** Convenience: plan the writes that move the chip's current image to `targetKm`. */
export function planOdometerWrite(
  currentSecure: Uint8Array,
  targetKm: number,
): WritePlan {
  return planSlotWrites(readSecureSlots(currentSecure), encodeOdometer(targetKm));
}

/**
 * The lowest km reachable from the chip's current state.
 *
 * Because every register must be >= its current value, the floor is the km of
 * the highest register - you can never present less mileage than that.
 */
export function minimumReachableKm(currentSecure: Uint8Array): number {
  const slots = readSecureSlots(currentSecure);
  const decoded = decodeOdometer(currentSecure);
  if (decoded.ok) return decoded.km;
  // Non-canonical image: the floor is still bounded by the largest register.
  return Math.max(...slots) * KM_PER_STEP;
}

/** True when every register is zero - a virgin chip reads 0 km. */
export function isSecureBlank(secure: Uint8Array): boolean {
  return readSecureSlots(secure).every((v) => v === 0);
}
