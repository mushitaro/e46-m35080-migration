/**
 * Reading a chip image with a coding definition: what each parameter holds, how well a definition
 * fits the chip, and which definition - if any - the chip was coded with.
 *
 * THE RULES, MEASURED (docs/CODING.md)
 *
 *   value      A parameter's bytes, read big-endian, masked, shifted down by the mask's trailing
 *              zeros: (BE(bytes) & mask) >> ctz(mask). An option's data is that shifted value,
 *              big-endian (all 5996 scalar options in the twelve E46 definitions have the mask's
 *              width and fit it).
 *   arrays     A parameter longer than its mask is an array of mask-sized elements - a curve. Its
 *              options are whole arrays. It is read as bytes and never coded here.
 *   informative A scalar parameter whose options set at least two different values, and do NOT
 *              cover every value its mask can hold. Only these can tell one definition from
 *              another: a parameter whose options cover everything always "matches", and one with
 *              a single value was not chosen by anyone.
 *   fit        On two real late-layout chips, the definition they were coded with matches every
 *              informative parameter (14/14, 15/15). So does its family's other late definition -
 *              their informative parameters are identical - and the coding index the chip itself
 *              carries breaks that tie. The other family's late definitions miss two or three;
 *              definitions with another block layout match two to six.
 *
 * Addresses are the chip's byte addresses (the definitions' WORTADR), which holds for the late
 * layout only - chooseDefinition refuses any other.
 */

import { CODABLE_RANGES, PROTECTED_RANGES, detectLayout } from '@/lib/domain/layout';
import type { CodingDefinition, CodingDoc, CodingOption, CodingParameter, FswParameter } from '@/lib/refdata/types';
import { blockLayoutMatches, codingIndexOf, isWordMsb } from './definition';

/** Big-endian integer of up to six bytes (the widest scalar mask is two). */
export function be(bytes: readonly number[] | Uint8Array): number {
  let v = 0;
  for (const b of bytes) v = v * 256 + b;
  return v;
}

export function ctz(mask: number): number {
  if (mask === 0) return 0;
  let n = 0;
  while (Math.floor(mask / 2 ** n) % 2 === 0) n++;
  return n;
}

function popcount(mask: number): number {
  let n = 0;
  for (let m = mask; m > 0; m = Math.floor(m / 2)) n += m % 2;
  return n;
}

export const isScalar = (p: CodingParameter): boolean => p.mask.length === p.length;

/** The shifted value a scalar parameter holds in `image`. */
export function readScalar(image: Uint8Array, p: CodingParameter): number {
  const mask = be(p.mask);
  const raw = be(image.subarray(p.address, p.address + p.length));
  // & on up to 16-bit values stays inside the 32-bit range of JS bit operators.
  return (raw & mask) >>> ctz(mask);
}

export const optionValue = (o: CodingOption): number => be(o.data);

export function currentOption(image: Uint8Array, p: FswParameter): CodingOption | null {
  const v = readScalar(image, p);
  return p.options.find((o) => optionValue(o) === v) ?? null;
}

/**
 * How many different values the options set. Not the number of options: a definition can list
 * two options that write the same value, and that is one choice, not two - counting it as two
 * made a parameter no chip is coded by count against the fit (measured: 14/15 where 14/14 holds).
 */
export const distinctValues = (p: FswParameter): number => new Set(p.options.map(optionValue)).size;

/** Options cover every value the mask can hold: the parameter always "matches". */
export function isTautological(p: FswParameter): boolean {
  return distinctValues(p) >= 2 ** popcount(be(p.mask));
}

export function isInformative(p: CodingParameter): p is FswParameter {
  return p.kind === 'fsw' && isScalar(p) && distinctValues(p) >= 2 && !isTautological(p);
}

export type Fit = {
  /** Informative parameters, and how many hold one of their options. */
  informative: number;
  matched: number;
  /** Counted and shown, never scored. */
  tautological: number;
  singleOption: number;
  arrays: number;
};

export function fitOf(image: Uint8Array, def: CodingDefinition): Fit {
  const fit: Fit = { informative: 0, matched: 0, tautological: 0, singleOption: 0, arrays: 0 };
  for (const p of def.parameters) {
    if (p.kind !== 'fsw') continue;
    if (!isScalar(p)) fit.arrays++;
    else if (distinctValues(p) < 2) fit.singleOption++;
    else if (isTautological(p)) fit.tautological++;
    else {
      fit.informative++;
      if (currentOption(image, p)) fit.matched++;
    }
  }
  return fit;
}

/** The coding index the chip carries, read where this definition says it is. */
export function chipCodingIndex(image: Uint8Array, def: CodingDefinition): number | null {
  const p = def.parameters.find((x) => x.kind === 'dir' && x.keyword === 'CODIERINDEX' && isScalar(x));
  return p ? readScalar(image, p) : null;
}

export type DefinitionMatch = {
  file: string;
  fit: Fit;
  /** The definition's own index, and the one the chip carries at its address. */
  index: number | null;
  chipIndex: number | null;
  /** Every informative parameter matches. */
  complete: boolean;
};

export function matchDefinitions(image: Uint8Array, doc: CodingDoc): DefinitionMatch[] {
  return Object.entries(doc.definitions)
    .map(([file, def]) => {
      const fit = fitOf(image, def);
      return {
        file,
        fit,
        index: codingIndexOf(def),
        chipIndex: chipCodingIndex(image, def),
        complete: fit.informative > 0 && fit.matched === fit.informative,
      };
    })
    .sort((a, b) => b.fit.matched / (b.fit.informative || 1) - a.fit.matched / (a.fit.informative || 1));
}

export type Choice =
  | { kind: 'chosen'; file: string; def: CodingDefinition; match: DefinitionMatch }
  | {
      kind: 'none';
      reason: 'not-late-layout' | 'no-fit' | 'ambiguous';
      /** The closest, so the reader sees how close. */
      best: DefinitionMatch | null;
    };

/**
 * The definition this chip was coded with: it fits completely AND its index is the chip's own.
 * Anything short of exactly one such definition is a refusal, with the closest shown.
 */
export function chooseDefinition(image: Uint8Array, doc: CodingDoc): Choice {
  const matches = matchDefinitions(image, doc);
  const best = matches[0] ?? null;
  if (detectLayout(image).kind !== 'late') return { kind: 'none', reason: 'not-late-layout', best };
  const chosen = matches.filter((m) => m.complete && m.index !== null && m.index === m.chipIndex);
  if (chosen.length === 0) return { kind: 'none', reason: 'no-fit', best };
  if (chosen.length > 1) return { kind: 'none', reason: 'ambiguous', best };
  const m = chosen[0]!;
  return { kind: 'chosen', file: m.file, def: doc.definitions[m.file]!, match: m };
}

/* ------------------------------------------------------------------------ rows */

export type RowStatus = 'codable' | 'protected' | 'value' | 'unknown';

/** Why a row is not codable - shown in the row, in words (copy/coding.ts). */
export type RowReason =
  | 'protected-range'
  | 'outside-codable'
  | 'direct-value'
  | 'curve'
  | 'single-option'
  | 'not-an-option';

export type ParamRow = {
  /** Index into the definition's parameters: the stable key for a change. */
  index: number;
  param: CodingParameter;
  status: RowStatus;
  reason: RowReason | null;
  /** Scalar value, or null for a curve. */
  value: number | null;
  option: CodingOption | null;
  bytes: number[];
};

const overlaps = (from: number, to: number, ranges: readonly [number, number][]) =>
  ranges.some(([lo, hi]) => !(to < lo || from > hi));
const inside = (from: number, to: number, ranges: readonly [number, number][]) =>
  ranges.some(([lo, hi]) => from >= lo && to <= hi);

/** Every parameter of the definition, read from `image`, with what may be done to it. */
export function rowsFor(image: Uint8Array, def: CodingDefinition): ParamRow[] {
  return def.parameters.map((p, index) => {
    const from = p.address;
    const to = p.address + p.length - 1;
    const bytes = Array.from(image.subarray(from, to + 1));
    const value = isScalar(p) ? readScalar(image, p) : null;
    const option = p.kind === 'fsw' && isScalar(p) ? currentOption(image, p) : null;
    const row = (status: RowStatus, reason: RowReason | null): ParamRow => ({ index, param: p, status, reason, value, option, bytes });
    if (overlaps(from, to, PROTECTED_RANGES)) return row('protected', 'protected-range');
    if (p.kind === 'dir') return row('value', 'direct-value');
    if (!isScalar(p)) return row('value', 'curve');
    if (distinctValues(p) < 2) return row('value', 'single-option');
    if (!option) return row('unknown', 'not-an-option');
    if (!inside(from, to, CODABLE_RANGES)) return row('value', 'outside-codable');
    return row('codable', null);
  });
}

/** The gates on the definition itself, before any row is codable. */
export function definitionRefusal(def: CodingDefinition): 'memory-organisation' | 'block-layout' | null {
  if (!isWordMsb(def)) return 'memory-organisation';
  if (!blockLayoutMatches(def)) return 'block-layout';
  return null;
}
