/**
 * What the cluster's replies say. Pure: every function takes the reply's payload - the bytes after
 * the status byte, before the checksum - and never a port.
 *
 * Each decoder is checked against the bytes it actually reads (tsunagi-m-link section 9), and a
 * reply too short for them is named as such rather than decoded into a row of dashes. A value that
 * is not the shape the SGBD reads it as - a BCD nibble above 9, a VIN character that is not a
 * letter or digit - is refused the same way: shown as what it is, never as a guess.
 *
 * Positions are the SGBDs' (response byte n is payload[n - 3]).
 */

import { unpackCodedVin } from '@/lib/domain/layout';
import { INPUT_PORTS_46, INPUT_PORTS_46R, type KombiVariant } from './protocol';

export type DecodeFailure = 'short' | 'not-bcd' | 'not-vin-shaped' | 'length-mismatch';

export type Decoded<T> = { ok: true; value: T } | { ok: false; reason: DecodeFailure; got: number };

function fail<T>(reason: DecodeFailure, payload: Uint8Array): Decoded<T> {
  return { ok: false, reason, got: payload.length };
}

/** A byte's two BCD digits, or null when either nibble is not a digit. */
export function bcd(byte: number): string | null {
  const hi = (byte >> 4) & 0xf;
  const lo = byte & 0xf;
  return hi > 9 || lo > 9 ? null : `${hi}${lo}`;
}

/* ---------------------------------- IDENT --------------------------------- */

export type Ident = {
  /**
   * The BMW part number: the first eight BCD digits with the leading one dropped, as the SGBD does -
   * or null when those bytes are not BCD. The screen then shows the reply's bytes, never a guess.
   */
  partNumber: string | null;
  hardware: number;
  codingIndex: number;
  /** The byte variant.ts decides the variant from. */
  diagIndex: number;
  /** From here on, each is null when the reply stops before it (or, for the date, is not BCD). */
  busIndex: number | null;
  week: number | null;
  year: number | null;
  /** The supplier's code. Its name is reference data, not committed. */
  supplier: number | null;
  software: number | null;
  canIndex: number | null;
  changeIndex: number | null;
};

/**
 * Through the diagnosis index: the one field the variant - and with it every drive the gate lets
 * through - depends on. The first real cluster answered IDENT and got nothing done, because this
 * decoder asked for all twelve bytes and a BCD part number before it would name the variant.
 */
export const IDENT_MIN_PAYLOAD = 7;

export function decodeIdent(payload: Uint8Array): Decoded<Ident> {
  if (payload.length < IDENT_MIN_PAYLOAD) return fail('short', payload);
  const digits = [0, 1, 2, 3].map((i) => bcd(payload[i] ?? 0));
  const at = (i: number) => (payload.length > i ? (payload[i] ?? null) : null);
  const num = (i: number) => {
    const d = payload.length > i ? bcd(payload[i] ?? 0) : null;
    return d === null ? null : Number(d);
  };
  return {
    ok: true,
    value: {
      partNumber: digits.some((d) => d === null) ? null : digits.join('').slice(1),
      hardware: payload[4] ?? 0,
      codingIndex: payload[5] ?? 0,
      diagIndex: payload[6] ?? 0,
      busIndex: at(7),
      week: num(8),
      year: num(9),
      supplier: at(10),
      software: at(11),
      canIndex: at(12),
      changeIndex: at(13),
    },
  };
}

/* ----------------------------------- VIN ---------------------------------- */

/** Two letters or digits, then five BCD digits, in bytes 1-5: the packing of the chip's coded field. */
export function decodeVin(payload: Uint8Array): Decoded<string> {
  if (payload.length < 6) return fail('short', payload);
  const text = unpackCodedVin(payload.subarray(1, 6));
  return text === null ? fail('not-vin-shaped', payload) : { ok: true, value: text };
}

/* -------------------------------- odometer -------------------------------- */

/** Six BCD digits in bytes 1-3, in km as the SGBD reports it. */
export function decodeOdometer(payload: Uint8Array): Decoded<number> {
  if (payload.length < 4) return fail('short', payload);
  const digits = [1, 2, 3].map((i) => bcd(payload[i] ?? 0));
  if (digits.some((d) => d === null)) return fail('not-bcd', payload);
  return { ok: true, value: Number(digits.join('')) };
}

/* --------------------------------- EEPROM --------------------------------- */

/** The words asked for, two bytes each - exactly that many, or the reply is not the read it answers. */
export function decodeEeprom(payload: Uint8Array, words: number): Decoded<Uint8Array> {
  return payload.length === words * 2 ? { ok: true, value: Uint8Array.from(payload) } : fail('length-mismatch', payload);
}

/* --------------------------------- inputs --------------------------------- */

export type PortValue = { port: number; value: number };

/**
 * The input ports as raw bytes. Which bit is which input is reference data (lib/refdata); without
 * it a bit is shown as `P2.b4`.
 *
 * `replies` are the payloads in the order reads.ts sent them: one on a KOMBI46, one per port on a
 * KOMBI46R.
 */
export function decodeInputs(variant: KombiVariant, replies: readonly Uint8Array[]): Decoded<PortValue[]> {
  if (variant === 'KOMBI46') {
    const p = replies[0] ?? new Uint8Array(0);
    if (replies.length !== 1 || p.length < INPUT_PORTS_46.length) return fail('short', p);
    return { ok: true, value: INPUT_PORTS_46.map((port, i) => ({ port, value: p[i] ?? 0 })) };
  }
  if (replies.length !== INPUT_PORTS_46R.length) return fail('length-mismatch', new Uint8Array(replies.length));
  const short = replies.find((r) => r.length < 1);
  if (short) return fail('short', short);
  return { ok: true, value: INPUT_PORTS_46R.map((port, i) => ({ port, value: replies[i]?.[0] ?? 0 })) };
}

/* --------------------------------- faults --------------------------------- */

/**
 * The fault memory, as the bytes the cluster sent. How the SGBD splits them into entries has not
 * been extracted yet, and this tool will not guess at it: an empty reply says "no bytes", not
 * "no faults".
 */
export function decodeFaults(payload: Uint8Array): Decoded<Uint8Array> {
  return { ok: true, value: Uint8Array.from(payload) };
}
