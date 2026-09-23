/**
 * Is this document the reference data the app reads? Checked before anything reads it, whether it
 * was served or opened from disk - a file from somewhere else, or one written by an older
 * generator, is named as such rather than half-read.
 *
 * Structural, not exhaustive: every field the app computes with is checked for its type (the
 * addresses, lengths and masks CODING writes against especially), names are checked for shape.
 */

import { KOMBI_VARIANTS } from '@/lib/kombi/protocol';
import type { RefName } from './types';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, lo = 0, hi = Number.MAX_SAFE_INTEGER) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const isBytes = (v: unknown) => Array.isArray(v) && v.every((b) => isInt(b, 0, 0xff));
const isIntOrNull = (v: unknown) => v === null || isInt(v);
const isName = (v: unknown) =>
  isObj(v) &&
  (v.ja === null || typeof v.ja === 'string') &&
  (v.en === null || typeof v.en === 'string') &&
  ['authored', 'heuristic', 'raw'].includes(v.source as string);

function checkParameter(p: unknown, at: string): string | null {
  if (!isObj(p)) return `${at}: not an object`;
  if (p.kind !== 'fsw' && p.kind !== 'dir') return `${at}: kind ${String(p.kind)}`;
  if (typeof p.keyword !== 'string' || !isInt(p.id)) return `${at}: keyword or id`;
  if (!isInt(p.address) || !isInt(p.length, 1, 64)) return `${at}: address or length`;
  if (!isBytes(p.mask) || (p.mask as number[]).length === 0) return `${at}: mask`;
  if (!isIntOrNull(p.block) || !isIntOrNull(p.index)) return `${at}: block or index`;
  if (p.kind === 'fsw') {
    if (!Array.isArray(p.options)) return `${at}: options`;
    for (const [i, o] of (p.options as unknown[]).entries()) {
      if (!isObj(o) || typeof o.keyword !== 'string' || !isInt(o.id) || !isBytes(o.data)) return `${at}.options[${i}]`;
    }
  }
  return null;
}

function checkCoding(d: Obj): string | null {
  if (!isObj(d.definitions)) return 'definitions';
  for (const [file, def] of Object.entries(d.definitions)) {
    if (!isObj(def)) return `definitions.${file}`;
    if (!Array.isArray(def.blocks) || !Array.isArray(def.parameters) || !Array.isArray(def.unused)) {
      return `definitions.${file}: blocks, parameters or unused`;
    }
    for (const [i, b] of (def.blocks as unknown[]).entries()) {
      if (!isObj(b) || typeof b.name !== 'string' || !isInt(b.address) || !isInt(b.length)) return `definitions.${file}.blocks[${i}]`;
    }
    for (const [i, p] of (def.parameters as unknown[]).entries()) {
      const bad = checkParameter(p, `definitions.${file}.parameters[${i}]`);
      if (bad) return bad;
    }
  }
  if (!isObj(d.names)) return 'names';
  for (const group of ['fsw', 'dir', 'psw', 'block']) {
    const g = d.names[group];
    if (!isObj(g)) return `names.${group}`;
    for (const [k, v] of Object.entries(g)) if (!isName(v)) return `names.${group}.${k}`;
  }
  return null;
}

function checkNames(d: Obj): string | null {
  if (!isObj(d.variants)) return 'variants';
  for (const v of KOMBI_VARIANTS) {
    const names = d.variants[v];
    if (!isObj(names)) return `variants.${v}`;
    for (const group of ['lamps', 'outputs', 'inputs', 'faults']) {
      const g = names[group];
      if (!isObj(g)) return `variants.${v}.${group}`;
      for (const [k, entry] of Object.entries(g)) {
        if (!isName(entry) || typeof (entry as Obj).sgbd !== 'string') return `variants.${v}.${group}.${k}`;
      }
    }
  }
  return null;
}

/** Null when `doc` is a `name` document the app can read; otherwise where it is not. */
export function validateRef(name: RefName, doc: unknown): string | null {
  if (!isObj(doc)) return 'not a JSON object';
  if (doc.schema !== 1) return `schema ${String(doc.schema)}, not 1`;
  if (doc.kind !== name) return `kind ${String(doc.kind)}, not ${name}`;
  return name === 'kombi-coding' ? checkCoding(doc) : checkNames(doc);
}
