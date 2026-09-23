/**
 * planCoding - the bytes a set of coding changes writes, or why it will not.
 *
 * Nothing is written here; the plan goes to the one write path (useM35080Link.runWrite), which
 * writes, reads back and records, as every other write does. What this decides is whether a
 * change may be written at all - every gate below must pass, and any one failing refuses the
 * whole plan (docs/CODING.md):
 *
 *   - the image is the late layout and both its checksums hold BEFORE the change (a broken one is
 *     never "repaired" on the way past - INSPECT's FIX CHECKSUMS is the explicit way)
 *   - the definition is the one the chip was coded with (chooseDefinition: complete fit, and its
 *     index is the chip's), organised MSB-first, with the known block layout
 *   - every changed parameter is CODABLE: a scalar with two or more options, its current value
 *     one of them, wholly inside 0x070-0x16D or 0x310-0x3CC, clear of every protected range
 *   - the new value is one of the parameter's own options
 *
 * Only the mask's bits change; every other bit of a byte a parameter shares is carried over. The
 * checksums are then recomputed from the changed image, and those bytes join the plan, so the
 * reader sees 0x16E (and 0x3CD with its mirror 0x3DF) change before anything is sent.
 */

import { detectLayout, recomputeChecksums, type ChecksumWrite } from '@/lib/domain/layout';
import type { ByteWrite } from '@/lib/domain/operations';
import type { CodingDoc, CodingOption } from '@/lib/refdata/types';
import { be, chooseDefinition, ctz, definitionRefusal, optionValue, rowsFor } from './decode';

export type CodingChange = {
  /** Index into the definition's parameters (ParamRow.index). */
  param: number;
  /** The option to set, by its id. */
  option: number;
};

export type CodingRefusalCode =
  | 'not-late-layout'
  | 'checksum-broken'
  | 'no-definition'
  | 'memory-organisation'
  | 'block-layout'
  | 'not-codable'
  | 'unknown-option'
  | 'no-change';

export type CodingRefusal = { ok: false; code: CodingRefusalCode; param?: number };

export type ParamChange = {
  param: number;
  keyword: string;
  from: CodingOption;
  to: CodingOption;
  bytes: { address: number; before: number; after: number }[];
};

export type CodingPlan = {
  ok: true;
  /** The definition the plan was made with. */
  file: string;
  changes: ParamChange[];
  checksums: ChecksumWrite[];
  /** Every byte that changes, parameters first, checksums last - what runWrite sends. */
  byteWrites: ByteWrite[];
  /** The image as it will be. */
  after: Uint8Array;
};

const hex = (n: number, w = 2) => n.toString(16).toUpperCase().padStart(w, '0');
const refuse = (code: CodingRefusalCode, param?: number): CodingRefusal => ({ ok: false, code, param });

export function planCoding(image: Uint8Array, doc: CodingDoc, changes: readonly CodingChange[]): CodingPlan | CodingRefusal {
  const layout = detectLayout(image);
  if (layout.kind !== 'late') return refuse('not-late-layout');
  if (!layout.consistent) return refuse('checksum-broken');
  const choice = chooseDefinition(image, doc);
  if (choice.kind !== 'chosen') return refuse('no-definition');
  const gate = definitionRefusal(choice.def);
  if (gate) return refuse(gate);

  const rows = rowsFor(image, choice.def);
  const after = Uint8Array.from(image);
  const planned: ParamChange[] = [];

  for (const c of changes) {
    const row = rows[c.param];
    if (!row || row.status !== 'codable' || row.param.kind !== 'fsw' || !row.option) return refuse('not-codable', c.param);
    const p = row.param;
    const to = p.options.find((o) => o.id === c.option);
    if (!to) return refuse('unknown-option', c.param);
    if (optionValue(to) === optionValue(row.option)) continue;

    const mask = be(p.mask);
    const current = be(after.subarray(p.address, p.address + p.length));
    const next = ((current & ~mask) | ((optionValue(to) << ctz(mask)) & mask)) >>> 0;
    const bytes: ParamChange['bytes'] = [];
    for (let i = 0; i < p.length; i++) {
      const address = p.address + i;
      const shift = 8 * (p.length - 1 - i);
      const value = Math.floor(next / 2 ** shift) % 256;
      if (after[address] !== value) {
        bytes.push({ address, before: after[address]!, after: value });
        after[address] = value;
      }
    }
    planned.push({ param: c.param, keyword: p.keyword, from: row.option, to, bytes });
  }
  if (planned.length === 0) return refuse('no-change');

  const { image: sealed, writes: checksums } = recomputeChecksums(after);

  const byteWrites: ByteWrite[] = [
    ...planned.flatMap((ch) =>
      ch.bytes.map((b) => ({
        address: b.address,
        data: Uint8Array.of(b.after),
        label: `0x${hex(b.address, 3)}  0x${hex(b.before)} -> 0x${hex(b.after)}  ${ch.keyword}: ${ch.from.keyword} -> ${ch.to.keyword}`,
      })),
    ),
    ...checksums.map((w) => ({
      address: w.address,
      data: Uint8Array.of(w.after),
      label: `0x${hex(w.address, 3)}  0x${hex(w.before)} -> 0x${hex(w.after)}  checksum`,
    })),
  ];
  return { ok: true, file: choice.file, changes: planned, checksums, byteWrites, after: sealed };
}
