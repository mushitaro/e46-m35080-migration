/**
 * Which address holds which number - for the two things that are actually
 * known, and nothing else.
 *
 * The tool does two jobs now: change the odometer and change the VIN. Both
 * have a location that can be stated exactly, and they got there by different
 * routes:
 *
 *   ODOMETER  0x000-0x01F. Fixed by the PART, not by BMW. The M35080's secure
 *             area is sixteen 16-bit increment-only registers at a fixed
 *             address - that is the chip's own datasheet, so it is true of
 *             every M35080 in every car.
 *
 *   VIN       Wherever the scan finds it, seven characters (VIN positions
 *             11-17). NOT fixed: the V6 on this bench has it at 0x184-0x18A,
 *             and the other cluster generation does not put it there at all.
 *             See vin.ts for how a constant - and then a run length - went
 *             wrong.
 *
 * Everything else in the 1 KB stays unexplained on purpose. Four real chips
 * were compared byte for byte and, outside 0xFF, not one address held the same
 * value on all four - so there is no map to write down. structure.ts reports
 * the SHAPE of those bytes; this file refuses to name them.
 */

import {
  KM_PER_STEP,
  SECURE_SLOTS,
  decodeOdometer,
  readSecureSlots,
} from './odometer';
import { secureOf } from './image';
import { readVin } from './vin';

/** One of the sixteen odometer registers, with where it lives. */
export type OdoSlot = {
  index: number;
  /** First byte. The register is big-endian across `from` and `from + 1`. */
  from: number;
  to: number;
  value: number;
  /**
   * `base`   - holds the base count
   * `bumped` - holds base + 1, i.e. it contributes one km to the remainder
   * `odd`    - neither, which means the reading cannot be decoded
   */
  role: 'base' | 'bumped' | 'odd';
};

export function odometerSlots(image: Uint8Array): OdoSlot[] {
  const secure = secureOf(image);
  const values = readSecureSlots(secure);
  const decoded = decodeOdometer(secure);
  const base = decoded.ok ? decoded.base : null;
  return values.map((value, index) => ({
    index,
    from: index * 2,
    to: index * 2 + 1,
    value,
    role:
      base === null
        ? 'odd'
        : value === base
          ? 'base'
          : value === base + 1
            ? 'bumped'
            : 'odd',
  }));
}

/** The arithmetic, with the numbers filled in, so the reader can check it. */
export type OdoArithmetic =
  | {
      ok: true;
      base: number;
      /** How many registers hold base + 1. */
      bumped: number;
      km: number;
      /** e.g. "9746 x 16 + 4 = 155,940" */
      expression: string;
    }
  | { ok: false; reason: string };

export function odometerArithmetic(image: Uint8Array): OdoArithmetic {
  const decoded = decodeOdometer(secureOf(image));
  if (!decoded.ok) return { ok: false, reason: decoded.reason };
  return {
    ok: true,
    base: decoded.base,
    bumped: decoded.remainder,
    km: decoded.km,
    expression:
      `${decoded.base.toLocaleString()} x ${KM_PER_STEP} + ${decoded.remainder}` +
      ` = ${decoded.km.toLocaleString()}`,
  };
}

/* ------------------------------ per address ------------------------------- */

export type AddressMeaning =
  | {
      kind: 'odometer';
      slot: number;
      /** Which half of the 16-bit register this byte is. */
      half: 'high' | 'low';
      value: number;
      role: OdoSlot['role'];
    }
  | { kind: 'vin'; from: number; to: number; text: string; charIndex: number }
  /** Inside the standard array, and honestly not identified. */
  | { kind: 'unidentified' };

/**
 * What one byte is.
 *
 * Returns `unidentified` for most of the chip, and that is the point: a tool
 * that names every address is a tool that is guessing at most of them.
 */
export function explainAddress(image: Uint8Array, address: number): AddressMeaning {
  if (address < SECURE_SLOTS * 2) {
    const slot = odometerSlots(image)[address >> 1];
    return {
      kind: 'odometer',
      slot: slot.index,
      half: address % 2 === 0 ? 'high' : 'low',
      value: slot.value,
      role: slot.role,
    };
  }
  const found = readVin(image).found;
  if (found && address >= found.offset && address < found.offset + found.bytes.length) {
    return {
      kind: 'vin',
      from: found.offset,
      to: found.offset + found.bytes.length - 1,
      text: found.text,
      charIndex: address - found.offset,
    };
  }
  return { kind: 'unidentified' };
}

/** The VIN's byte range in this image, for tinting the hex view. */
export function vinRange(image: Uint8Array | null): { from: number; to: number } | null {
  if (!image) return null;
  const found = readVin(image).found;
  return found ? { from: found.offset, to: found.offset + found.bytes.length - 1 } : null;
}
