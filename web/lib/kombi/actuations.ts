/**
 * Telegrams that make the cluster DO something: move a needle, light a lamp, sound the gong.
 *
 * Kept apart from reads.ts so the difference is visible at the import: a module that never
 * imports this file cannot drive the cluster. Every telegram built here is still asked of
 * runGate.ts before it is sent, and the gate refuses all of them until the variant is known and
 * the reader has confirmed the cluster is on the bench.
 *
 * Like the read builders, these only encode. A needle angle outside 10-90 builds a telegram that
 * the gate then refuses; the rule lives in one place.
 */

import {
  Drive,
  KombiControl,
  LAMP_MASKS,
  NEEDLE_SCALE,
  OUTPUT_PORT,
  gaugeSelect,
  request,
  type GaugeId,
  type KombiRequest,
  type KombiVariant,
} from './protocol';

/** Holds one needle at `degrees`. */
export function setNeedle(variant: KombiVariant, gauge: GaugeId, degrees: number): KombiRequest {
  const raw = degrees * NEEDLE_SCALE[variant];
  if (!Number.isInteger(raw) || raw < 0 || raw > 0xffff) {
    throw new RangeError(`needle value ${degrees} degrees does not encode on a ${variant}`);
  }
  return request(KombiControl.DRIVE, [gaugeSelect(gauge), (raw >> 8) & 0xff, raw & 0xff]);
}

/**
 * Sets every lamp at once: `bytes` are the variant's lamp bytes in order, B1 first (four on a
 * KOMBI46, six on a 46R). A lamp not set here is off - this telegram has no "leave as it is".
 */
export function setLamps(variant: KombiVariant, bytes: readonly number[]): KombiRequest {
  const n = LAMP_MASKS[variant].length;
  if (bytes.length !== n || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 0xff)) {
    throw new RangeError(`a ${variant} lamp telegram takes ${n} bytes, got [${bytes.join(', ')}]`);
  }
  return variant === 'KOMBI46'
    ? request(KombiControl.DRIVE, [Drive.LAMPS, ...bytes])
    : request(KombiControl.DRIVE, [Drive.LAMPS, 0x00, ...bytes]);
}

/** One lamp on, every other lamp off. `byte` counts from 1, as the SGBDs number them. */
export function oneLamp(variant: KombiVariant, byte: number, bit: number): KombiRequest {
  const bytes = LAMP_MASKS[variant].map((_, i) => (i === byte - 1 ? 1 << bit : 0));
  return setLamps(variant, bytes);
}

export function lampsOff(variant: KombiVariant): KombiRequest {
  return setLamps(variant, LAMP_MASKS[variant].map(() => 0));
}

/**
 * Drives the output port: indicators, high beam, rear fog. A KOMBI46 has this telegram; a 46R does
 * not, and the gate refuses it there.
 */
export function setOutputs(bits: number): KombiRequest {
  if (!Number.isInteger(bits) || bits < 0 || bits > 0xff) throw new RangeError(`output bits ${bits}`);
  return request(KombiControl.DRIVE, [Drive.PORT, OUTPUT_PORT, bits]);
}

export function soundGong(): KombiRequest {
  return request(KombiControl.DRIVE, [Drive.GONG]);
}

export function soundPiezo(): KombiRequest {
  return request(KombiControl.DRIVE, [Drive.PIEZO]);
}
