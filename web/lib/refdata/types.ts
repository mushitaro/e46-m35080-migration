/**
 * The shape of the reference data tools/refdata/gen_refdata.py writes, as the app reads it.
 *
 * The data itself is never in this repository or its build (THIRD-PARTY-NOTICES.md 3.3); these are
 * only its types. validate.ts checks a document against them before anything reads it.
 */

import type { KombiVariant } from '@/lib/kombi/protocol';

/** Where a name came from: a person, the token dictionary, or nowhere (the keyword itself). */
export type NameSource = 'authored' | 'heuristic' | 'raw';

export type Named = { ja: string | null; en: string | null; source: NameSource };

/* ---------------------------------- coding ---------------------------------- */

export type CodingBlock = {
  kind: 'coding' | 'maker' | 'reserved';
  block: number | null;
  address: number;
  length: number;
  name: string;
};

export type CodingOption = { keyword: string; id: number; data: number[] };

export type FswParameter = {
  kind: 'fsw';
  keyword: string;
  id: number;
  block: number | null;
  address: number;
  length: number;
  index: number | null;
  mask: number[];
  unit: number | null;
  individual: number | null;
  options: CodingOption[];
};

export type DirParameter = {
  kind: 'dir';
  keyword: string;
  id: number;
  block: number | null;
  address: number;
  length: number;
  index: number | null;
  mask: number[];
  operations: string[];
  unit: number;
};

export type CodingParameter = FswParameter | DirParameter;

export type CodingDefinition = {
  memory: { structure: string; type: string } | null;
  codingIndex: unknown;
  delivery?: number[];
  blocks: CodingBlock[];
  parameters: CodingParameter[];
  unused: { block: number | null; address: number; length: number; index: number | null; mask: number[] }[];
};

type Provenance = {
  schema: 1;
  generator: string;
  generatedAt: string;
  /** sha256 of every input file, by name. */
  sources: Record<string, string>;
  terms: Record<string, string>;
  coverage: Record<string, Record<NameSource, number>>;
};

export type CodingDoc = Provenance & {
  kind: 'kombi-coding';
  /** By file name: KMBE46M3.C24, KMB_E46.C08 ... */
  definitions: Record<string, CodingDefinition>;
  names: {
    fsw: Record<string, Named>;
    dir: Record<string, Named>;
    psw: Record<string, Named>;
    block: Record<string, Named>;
  };
};

/* ----------------------------------- names ---------------------------------- */

/** A bit or a fault, with the SGBD's own text beside the translation. */
export type NamedBit = Named & { sgbd: string };

export type VariantNames = {
  /** `B2.b5` */
  lamps: Record<string, NamedBit>;
  /** `P6.b0` */
  outputs: Record<string, NamedBit>;
  /** `P2.b4` */
  inputs: Record<string, NamedBit>;
  /** by fault location code, as the SGBD writes it (`0x87`) */
  faults: Record<string, NamedBit>;
};

export type NamesDoc = Provenance & {
  kind: 'kombi-names';
  variants: Record<KombiVariant, VariantNames>;
};

export type RefDocs = { 'kombi-coding': CodingDoc; 'kombi-names': NamesDoc };
export type RefName = keyof RefDocs;
export const REF_NAMES: readonly RefName[] = ['kombi-coding', 'kombi-names'];
