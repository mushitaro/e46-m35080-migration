/**
 * What REWRITE's coding shows, derived from a definition, an image and the reader's own choices -
 * names in the reader's language, search, the tally, a value as hex and bits, and a dump's
 * differences from the chip.
 *
 * Pure, so the screen only draws and the tests read the same answers. Nothing here decides what
 * may be written: that is planCoding's (encode.ts), and a row the screen offers a choice on is
 * still refused there if a gate says so.
 */

import type { CodingDefinition, CodingDoc, CodingOption, CodingParameter, Named, NameSource } from '@/lib/refdata/types';
import type { CodingChange } from './encode';
import { be, isScalar, optionValue, readScalar, type ParamRow, type RowStatus } from './decode';

type Lang = 'ja' | 'en';

/* ------------------------------------------------------------------ names */

/**
 * A name for the reader, and where it came from. With no name, the keyword itself stands in and
 * says so (`raw`): the keyword is the only honest name then, and the row still shows it as data.
 */
export type Shown = { text: string; source: NameSource };

function shown(named: Named | undefined, fallback: string, lang: Lang): Shown {
  const text = named ? (lang === 'ja' ? named.ja : named.en) : null;
  return text ? { text, source: named!.source } : { text: fallback, source: 'raw' };
}

export const paramName = (doc: CodingDoc, p: CodingParameter, lang: Lang): Shown =>
  shown((p.kind === 'fsw' ? doc.names.fsw : doc.names.dir)[p.keyword], p.keyword, lang);

export const optionName = (doc: CodingDoc, o: CodingOption, lang: Lang): Shown => shown(doc.names.psw[o.keyword], o.keyword, lang);

/* ----------------------------------------------------------------- values */

const hex = (n: number, width: number) => n.toString(16).toUpperCase().padStart(width, '0');

function popcount(mask: number): number {
  let n = 0;
  for (let m = mask; m > 0; m = Math.floor(m / 2)) n += m % 2;
  return n;
}

/** A scalar's shifted value as hex (two digits per mask byte) and as its bits, mask-wide. */
export function formatValue(p: CodingParameter, value: number): { hex: string; bits: string } {
  return { hex: hex(value, 2 * p.mask.length), bits: value.toString(2).padStart(popcount(be(p.mask)), '0') };
}

/** The raw bytes a parameter covers, spaced. */
export const formatBytes = (bytes: readonly number[]): string => bytes.map((b) => hex(b, 2)).join(' ');

/** Each mask byte as eight bits, most significant first: the diagram under a selected row. */
export function maskBits(p: CodingParameter): { address: number; bits: boolean[] }[] {
  // A curve repeats its element mask; show the element once, at the parameter's address.
  return p.mask.map((m, i) => ({ address: p.address + i, bits: Array.from({ length: 8 }, (_, b) => ((m >> (7 - b)) & 1) === 1) }));
}

/** An option's value under the mask it writes into - hex and bits, as the rows show values. */
export const formatOption = (p: CodingParameter, o: CodingOption) => formatValue(p, optionValue(o));

/* ---------------------------------------------------------------- changes */

/** The reader's picks: parameter index -> option id. */
export type Staged = ReadonlyMap<number, number>;

/** The picks that change something, in parameter order - what planCoding is asked for. */
export function effectiveChanges(rows: readonly ParamRow[], staged: Staged): CodingChange[] {
  const out: CodingChange[] = [];
  for (const [param, option] of [...staged].sort((a, b) => a[0] - b[0])) {
    const row = rows[param];
    if (!row || row.param.kind !== 'fsw') continue;
    const to = row.param.options.find((o) => o.id === option);
    if (to && (!row.option || optionValue(to) !== optionValue(row.option))) out.push({ param, option });
  }
  return out;
}

/**
 * Parameters a donor chip holds differently, read with the same definition. Only meaningful when
 * the donor is the same layout - the caller checks that before offering DIFF.
 */
export function differingFrom(def: CodingDefinition, image: Uint8Array, donor: Uint8Array): Set<number> {
  const out = new Set<number>();
  def.parameters.forEach((p, i) => {
    const same = isScalar(p)
      ? readScalar(image, p) === readScalar(donor, p)
      : image.subarray(p.address, p.address + p.length).every((b, k) => (b & p.mask[k % p.mask.length]!) === (donor[p.address + k]! & p.mask[k % p.mask.length]!));
    if (!same) out.add(i);
  });
  return out;
}

/* ------------------------------------------------------ the list, search */

/** The list's filters: every function, the ones picked to change, the ones that can, a dump's differences. */
export type ListFilter = 'all' | 'changed' | 'codable' | 'diff';
export const LIST_FILTERS: readonly ListFilter[] = ['all', 'changed', 'codable', 'diff'];

export function inFilter(row: ParamRow, f: ListFilter, changed: ReadonlySet<number>, differing: ReadonlySet<number> | null): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'changed':
      return changed.has(row.index);
    case 'codable':
      return row.status === 'codable';
    case 'diff':
      return differing?.has(row.index) ?? false;
  }
}

/**
 * The list NCS Dummy shows: the switchable functions (FSW) in the definition's own order, then the
 * direct values apart from them.
 */
export function listOrder(rows: readonly ParamRow[]): { functions: ParamRow[]; values: ParamRow[] } {
  return { functions: rows.filter((r) => r.param.kind === 'fsw'), values: rows.filter((r) => r.param.kind === 'dir') };
}

/**
 * Whether a row answers a search, in any of the ways a reader might type it: the Japanese name,
 * the English name, the keyword, or the address (`0A0`, `0x0a0`). Case-insensitive; a blank query
 * matches everything.
 */
export function matches(doc: CodingDoc, row: ParamRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const p = row.param;
  const named = (p.kind === 'fsw' ? doc.names.fsw : doc.names.dir)[p.keyword];
  const hay = [p.keyword, named?.ja ?? '', named?.en ?? '', hex(p.address, 3), `0x${hex(p.address, 3)}`];
  return hay.some((h) => h.toLowerCase().includes(q));
}

/* ------------------------------------------------------------------ tally */

export type Tally = Record<RowStatus | 'all', number>;

export function tally(rows: readonly ParamRow[]): Tally {
  const t: Tally = { all: rows.length, codable: 0, protected: 0, value: 0, unknown: 0 };
  for (const r of rows) t[r.status]++;
  return t;
}
