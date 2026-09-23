/**
 * What the CODING screen shows, derived from a definition, a chip image and the reader's own
 * choices - names in the reader's language, blocks, filters, search, the tally, a value as hex
 * and bits, and a donor chip's differences.
 *
 * Pure, so the screen only draws and the tests read the same answers. Nothing here decides what
 * may be written: that is planCoding's (encode.ts), and a row the screen offers a choice on is
 * still refused there if a gate says so.
 */

import { CHECKSUM_REGIONS, PROTECTED_RANGES, type ChecksumRegion } from '@/lib/domain/layout';
import type { CodingBlock, CodingDefinition, CodingDoc, CodingOption, CodingParameter, Named, NameSource } from '@/lib/refdata/types';
import type { CodingChange, CodingPlan } from './encode';
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

export const blockName = (doc: CodingDoc, b: CodingBlock, lang: Lang): Shown => shown(doc.names.block[b.name], b.name, lang);

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

/* ----------------------------------------------------------------- blocks */

export type BlockGroup = {
  /** The block the rows sit in, or null for rows no block claims. */
  block: CodingBlock | null;
  /** The checksum that covers the block, if one does. */
  checksum: ChecksumRegion | null;
  rows: ParamRow[];
};

const covering = (from: number, to: number) => CHECKSUM_REGIONS.find((r) => from >= r.from && to <= r.to) ?? null;

/** Rows grouped by the block that holds them, in address order - blocks first, then any leftovers. */
export function groupByBlock(def: CodingDefinition, rows: readonly ParamRow[]): BlockGroup[] {
  const blocks = [...def.blocks].sort((a, b) => a.address - b.address);
  const holder = (p: CodingParameter) =>
    blocks.find((b) => p.address >= b.address && p.address + p.length <= b.address + b.length) ?? null;
  const byBlock = new Map<CodingBlock | null, ParamRow[]>();
  for (const r of rows) {
    const b = holder(r.param);
    byBlock.set(b, [...(byBlock.get(b) ?? []), r]);
  }
  const order = [...blocks, null].filter((b) => byBlock.has(b));
  return order.map((block) => ({
    block,
    checksum: block ? covering(block.address, block.address + block.length - 1) : null,
    rows: byBlock.get(block)!.sort((a, b) => a.param.address - b.param.address || a.param.keyword.localeCompare(b.param.keyword)),
  }));
}

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

/* ---------------------------------------------------------- filter, search */

export type CodingFilter = 'all' | 'codable' | 'changed' | 'unknown' | 'diff';
export const CODING_FILTERS: readonly CodingFilter[] = ['all', 'codable', 'changed', 'unknown', 'diff'];

export function passes(row: ParamRow, filter: CodingFilter, changed: ReadonlySet<number>, differing: ReadonlySet<number> | null): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'codable':
      return row.status === 'codable';
    case 'changed':
      return changed.has(row.index);
    case 'unknown':
      return row.status === 'unknown';
    case 'diff':
      return differing?.has(row.index) ?? false;
  }
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

/* ----------------------------------------------------------------- the map */

/** What a byte is to CODING - the MAP colours it by this. */
export type ByteRole = 'codable' | 'unknown' | 'value' | 'protected' | 'checksum' | null;

/**
 * The role of every byte a definition's parameters cover: a byte that belongs to a CODABLE row is
 * codable, and so on. Every protected range is protected and the checksum bytes are checksum,
 * whether or not a parameter names them - the odometer is protected on the MAP even where no
 * definition mentions it. A byte nothing names is null. Where roles meet, the more guarded wins.
 */
export function byteRoles(rows: readonly ParamRow[]): ByteRole[] {
  const rank: Record<Exclude<ByteRole, null>, number> = { codable: 1, value: 2, unknown: 3, protected: 4, checksum: 5 };
  const out: ByteRole[] = new Array(0x400).fill(null);
  const put = (a: number, role: Exclude<ByteRole, null>) => {
    const cur = out[a];
    if (a >= 0 && a < out.length && (cur === null || rank[role] > rank[cur!])) out[a] = role;
  };
  for (const r of rows) for (let a = r.param.address; a < r.param.address + r.param.length; a++) put(a, r.status);
  for (const [from, to] of PROTECTED_RANGES) for (let a = from; a <= to; a++) put(a, 'protected');
  for (const region of CHECKSUM_REGIONS) for (const a of [region.at, ...region.mirrors]) put(a, 'checksum');
  return out;
}

/** The bytes a parameter covers, for the MAP to ring. */
export const bytesOf = (p: CodingParameter): Set<number> => new Set(Array.from({ length: p.length }, (_, i) => p.address + i));

/* ---------------------------------------------------------------- the record */

/** What SYNC keeps of a note (functions/api/sessions: optText(note, 2000)). */
export const NOTE_LIMIT = 2000;

/**
 * What a coding record keeps beside the bytes: the definition, the sha256 of the reference data it
 * came from, and each change as `KEYWORD: from -> to` - what the bytes alone cannot say. Cut to
 * what SYNC keeps, saying how many changes did not fit rather than stopping mid-line.
 */
export function codingNote(plan: CodingPlan, sha256: string | null): string {
  const head = `CODING ${plan.file}${sha256 ? ` ref sha256:${sha256}` : ''}`;
  const lines = plan.changes.map((c) => `${c.keyword}: ${c.from.keyword} -> ${c.to.keyword}`);
  const out = [head];
  for (let i = 0; i < lines.length; i++) {
    const rest = lines.length - i - 1;
    const more = rest > 0 ? `\n(+${rest} more)` : '';
    if ([...out, lines[i]].join('\n').length + more.length > NOTE_LIMIT) {
      out.push(`(+${lines.length - i} more)`);
      break;
    }
    out.push(lines[i]!);
  }
  return out.join('\n');
}
