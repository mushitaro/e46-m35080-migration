/**
 * THE JOB - everything one write to the chip does, planned in one piece: where the cluster's data
 * comes from (the chip as it is, or a dump), the odometer, the VIN and the coding.
 *
 * These used to be three tabs with three plans and three confirmations - RESTORE put a backup on
 * a chip, REWRITE raised the odometer and set the VIN, CODING changed parameters - and moving a
 * cluster to another car meant running them one after another, each writing and verifying on its
 * own, each against a chip the previous one had just changed. A job is one intent, so it is one
 * plan, one confirmation and one pass through the write path (useM35080Link.runWrite).
 *
 * THE ORDER IS FIXED, and every step builds on the one before:
 *
 *   1. SOURCE   the standard array (0x020-0x3FF) starts as the chip's own, or as the dump's - the
 *               dump checked first as RESTORE checked it: a real cluster's data, and a late-layout
 *               dump only with its checksums holding. The secure area is never taken from a dump.
 *   2. VIN      written to every VIN field the source has (operations.ts planVinWrite): the coded
 *               field only on a late image whose checksums hold, resealing 0x16E.
 *   3. CODING   the source's own definition, every coding gate (ncs/encode.ts planCoding) - so the
 *               definition is chosen from what the chip WILL hold, which is why a dump's coding can
 *               be changed on any chip, a blank one or PRACTICE's made-up one included. Resealed.
 *   4. ODOMETER WRINC on the chip's secure area, upward only - never from a dump, never on a file.
 *
 * The bytes written are then simply every standard-array byte where the result differs from the
 * chip - one plan, whatever combination produced it - and a refusal names the part that refused.
 *
 * Without a chip (a dump opened before anything is connected) the job is still planned: the
 * reader sees the coding and what the dump would become. Nothing can be written until a chip is
 * read, and the odometer, which only a chip can carry, is not planned at all.
 */

import {
  decodeOdometer,
  encodeOdometer,
  minimumReachableKm,
  planSlotWrites,
  readSecureSlots,
  slotsToBytes,
  MAX_KM,
  type WriteOp,
} from './odometer';
import { IMAGE_SIZE, STANDARD_END, STANDARD_START, secureOf } from './image';
import { CHECKSUM_ADDRESSES } from './layout';
import {
  backupChecksums,
  hasClusterData,
  planVinWrite,
  type ByteWrite,
  type ChecksumCheck,
  type Refusal,
  type VinAction,
} from './operations';
import { planCoding, type CodingChange, type CodingPlan, type CodingRefusal } from '@/lib/ncs/encode';
import type { CodingDoc } from '@/lib/refdata/types';

export type JobSource = { kind: 'chip' } | { kind: 'dump'; name: string; image: Uint8Array };

export type OdometerIntent = { kind: 'keep' } | { kind: 'set'; km: number };

export type JobInput = {
  /** The chip as read, or null: nothing read yet, so nothing can be written. */
  chip: Uint8Array | null;
  source: JobSource;
  odometer: OdometerIntent;
  vin: VinAction;
  /** Coding changes, with the reference data they were picked from. */
  coding: { doc: CodingDoc; changes: readonly CodingChange[] } | null;
};

/** Which part of the job refused, so the reader is told where to look. */
export type JobPart = 'source' | 'odometer' | 'vin' | 'coding';

export type JobRefusal =
  | { ok: false; part: 'source' | 'odometer' | 'vin'; refusal: Refusal }
  | { ok: false; part: 'coding'; refusal: CodingRefusal }
  | { ok: false; part: 'source'; refusal: { code: 'no-chip' } };

export type JobPlan = {
  ok: true;
  /** What the source contributes, before the VIN and the coding change it. */
  base: Uint8Array;
  /** The image as it will be: the standard array after every edit, the secure area after the WRINCs. */
  target: Uint8Array;
  /** Standard-array bytes the dump itself puts on the chip - its own value, not an edit's (0 for the chip). */
  sourceBytes: number;
  /** The dump's checksums as checked - 'ok' or 'unchecked' (another layout) - or null for the chip. */
  sourceChecksums: ChecksumCheck | null;
  vinWrites: ByteWrite[];
  coding: CodingPlan | null;
  currentKm: number | null;
  targetKm: number | null;
  secureOps: WriteOp[];
  /** Every standard-array byte that differs from the chip, in runs - what runWrite sends. Empty without a chip. */
  byteWrites: ByteWrite[];
  /** Checksum bytes the chip will change, with before and after. */
  checksums: { address: number; before: number; after: number }[];
};

const hex = (n: number, w = 2) => n.toString(16).toUpperCase().padStart(w, '0');

function runs(chip: Uint8Array, target: Uint8Array, label: (from: number, to: number) => string): ByteWrite[] {
  const out: ByteWrite[] = [];
  for (let a = STANDARD_START; a <= STANDARD_END; ) {
    if (chip[a] === target[a]) {
      a++;
      continue;
    }
    let b = a;
    while (b + 1 <= STANDARD_END && chip[b + 1] !== target[b + 1]) b++;
    out.push({ address: a, data: target.slice(a, b + 1), label: label(a, b) });
    a = b + 1;
  }
  return out;
}

export function planJob(input: JobInput): JobPlan | JobRefusal {
  const { chip, source } = input;
  if (chip && chip.length !== IMAGE_SIZE) return { ok: false, part: 'source', refusal: { ok: false, code: 'image-size' } };

  /* 1. SOURCE */
  let base: Uint8Array;
  let sourceChecksums: ChecksumCheck | null = null;
  if (source.kind === 'chip') {
    if (!chip) return { ok: false, part: 'source', refusal: { code: 'no-chip' } };
    base = Uint8Array.from(chip);
  } else {
    const dump = source.image;
    if (dump.length !== IMAGE_SIZE) return { ok: false, part: 'source', refusal: { ok: false, code: 'backup-size', fileSize: dump.length } };
    if (!hasClusterData(dump)) return { ok: false, part: 'source', refusal: { ok: false, code: 'backup-no-data' } };
    const checked = backupChecksums(dump);
    if (typeof checked !== 'string') return { ok: false, part: 'source', refusal: checked };
    sourceChecksums = checked;
    base = Uint8Array.from(dump);
    // The secure area is the chip's: a dump's odometer is never copied, only raised to by WRINC.
    if (chip) base.set(secureOf(chip), 0);
  }

  /* 2. VIN */
  const vin = planVinWrite(base, input.vin);
  if (!vin.ok) return { ok: false, part: 'vin', refusal: vin };
  let content = Uint8Array.from(base);
  for (const w of vin.writes) content.set(w.data, w.address);

  /* 3. CODING */
  let coding: CodingPlan | null = null;
  if (input.coding && input.coding.changes.length > 0) {
    const planned = planCoding(content, input.coding.doc, input.coding.changes);
    if (!planned.ok) return { ok: false, part: 'coding', refusal: planned };
    coding = planned;
    content = Uint8Array.from(planned.after);
  }

  /* 4. ODOMETER - on the chip only */
  let secureOps: WriteOp[] = [];
  const decoded = chip ? decodeOdometer(secureOf(chip)) : null;
  const currentKm = decoded?.ok ? decoded.km : null;
  let targetKm: number | null = null;
  if (chip && input.odometer.kind === 'set') {
    const km = input.odometer.km;
    if (!Number.isInteger(km) || km < 0) return { ok: false, part: 'odometer', refusal: { ok: false, code: 'km-invalid' } };
    if (km > MAX_KM) return { ok: false, part: 'odometer', refusal: { ok: false, code: 'km-too-large', maxKm: MAX_KM } };
    const planned = planSlotWrites(readSecureSlots(secureOf(chip)), encodeOdometer(km));
    if (!planned.ok) return { ok: false, part: 'odometer', refusal: { ok: false, code: 'cannot-lower', floorKm: minimumReachableKm(secureOf(chip)) } };
    secureOps = planned.ops;
    targetKm = km;
  }

  // The secure area after the WRINCs, the way applyPlanPreview (and so runWrite's check) sees it.
  const target = Uint8Array.from(content);
  if (secureOps.length) {
    const slots = readSecureSlots(secureOf(target));
    for (const op of secureOps) slots[op.slot] = op.to;
    target.set(slotsToBytes(slots), 0);
  }

  /* The writes: every standard-array byte where the result differs from the chip. */
  let sourceBytes = 0;
  let byteWrites: ByteWrite[] = [];
  let checksums: JobPlan['checksums'] = [];
  if (chip) {
    for (let a = STANDARD_START; a <= STANDARD_END; a++) if (target[a] !== chip[a] && target[a] === base[a]) sourceBytes++;
    const from = source.kind === 'dump' ? source.name : null;
    byteWrites = runs(chip, target, (a, b) =>
      a === b
        ? `0x${hex(a, 3)}  0x${hex(chip[a]!)} -> 0x${hex(target[a]!)}${from ? `  (${from})` : ''}`
        : `0x${hex(a, 3)}-0x${hex(b, 3)}  ${b - a + 1} bytes${from ? ` from ${from}` : ''}`,
    );
    checksums = CHECKSUM_ADDRESSES.filter((a) => chip[a] !== target[a]).map((a) => ({ address: a, before: chip[a]!, after: target[a]! }));
  }

  return {
    ok: true,
    base,
    target,
    sourceBytes,
    sourceChecksums,
    vinWrites: vin.writes,
    coding,
    currentKm,
    targetKm,
    secureOps,
    byteWrites,
    checksums,
  };
}

/** Whether a plan writes anything at all. */
export const writesSomething = (p: JobPlan): boolean => p.secureOps.length > 0 || p.byteWrites.length > 0;

/* ---------------------------------------------------------------- telling it */

/** What the confirmation says, part by part - only the parts this plan actually writes. */
export type JobSummary = {
  odometer: { from: number | null; to: number; ops: number } | null;
  source: { name: string; bytes: number } | null;
  vin: { kind: 'write'; vin: string } | { kind: 'blank' } | null;
  coding: number;
  checksums: number;
  bytes: number;
};

/**
 * Whether the job still changes these bytes ON THE CHIP. With no chip every edit is still to come;
 * with one, an edit the chip already holds - after this job was written, say - is not a change.
 */
function pending(plan: JobPlan, input: JobInput, address: number, length: number): boolean {
  const chip = input.chip;
  if (!chip) return true;
  for (let a = address; a < address + length; a++) if (plan.target[a] !== chip[a]) return true;
  return false;
}

const vinLines = (plan: JobPlan, input: JobInput) =>
  plan.vinWrites.filter((w) => !w.label.startsWith('checksum') && pending(plan, input, w.address, w.data.length));

const codingChanges = (plan: JobPlan, input: JobInput) =>
  plan.coding?.changes.filter((c) => c.bytes.some((b) => pending(plan, input, b.address, 1))) ?? [];

export function summarize(plan: JobPlan, input: JobInput): JobSummary {
  const vin =
    vinLines(plan, input).length === 0
      ? null
      : input.vin.kind === 'write'
        ? { kind: 'write' as const, vin: input.vin.vin.trim().toUpperCase() }
        : input.vin.kind === 'blank'
          ? { kind: 'blank' as const }
          : null;
  return {
    odometer: plan.targetKm !== null && plan.secureOps.length > 0 ? { from: plan.currentKm, to: plan.targetKm, ops: plan.secureOps.length } : null,
    source: input.source.kind === 'dump' && plan.sourceBytes > 0 ? { name: input.source.name, bytes: plan.sourceBytes } : null,
    vin,
    coding: codingChanges(plan, input).length,
    checksums: plan.checksums.length,
    bytes: plan.byteWrites.reduce((n, w) => n + w.data.length, 0),
  };
}

/**
 * The confirmation's lines, one per thing sent: the WRINCs, what the source changes, the VIN
 * fields, each coding change, each checksum - then the runs themselves, which are what the link
 * sends and what runWrite checks the chip against.
 */
export function jobDetails(plan: JobPlan, input: JobInput): string[] {
  const hex = (n: number, w = 2) => n.toString(16).toUpperCase().padStart(w, '0');
  return [
    ...plan.secureOps.map((o) => `WRINC 0x${hex(o.address)}  0x${hex(o.from)} -> 0x${hex(o.to)}`),
    ...(input.source.kind === 'dump' && plan.sourceBytes > 0 ? [`0x020-0x3FF from ${input.source.name}: ${plan.sourceBytes} byte(s) differ`] : []),
    ...vinLines(plan, input).map((w) => w.label),
    ...(plan.coding?.byteWrites.filter((w) => !w.label.endsWith('checksum') && pending(plan, input, w.address, 1)).map((w) => w.label) ?? []),
    ...plan.checksums.map((c) => `checksum 0x${hex(c.address, 3)}  0x${hex(c.before)} -> 0x${hex(c.after)}`),
    ...(plan.byteWrites.length > 0 ? [`sent: ${plan.byteWrites.length} write(s)`, ...plan.byteWrites.map((w) => `  ${w.label}`)] : []),
    plan.secureOps.length > 0 ? 'odometer 0x000-0x01F: WRINC only, upward' : 'odometer 0x000-0x01F: not written',
  ];
}

/** SYNC keeps 2000 characters of a note (functions/api/sessions). */
export const NOTE_LIMIT = 2000;

/**
 * What the record keeps beside the bytes: the source, the odometer, the VIN and each coding change
 * with the definition and the reference data's sha256 - what the bytes alone cannot say. Cut to
 * what SYNC keeps, saying how many lines did not fit rather than stopping mid-line.
 */
export function jobNote(plan: JobPlan, input: JobInput, refSha256: string | null): string {
  const lines: string[] = [];
  if (input.source.kind === 'dump') lines.push(`SOURCE ${input.source.name}`);
  if (plan.targetKm !== null && plan.secureOps.length > 0) lines.push(`ODOMETER ${plan.currentKm ?? '?'} -> ${plan.targetKm} km`);
  if (plan.vinWrites.length > 0) lines.push(input.vin.kind === 'write' ? `VIN -> ${input.vin.vin.trim().toUpperCase()}` : 'VIN blanked');
  if (plan.coding) {
    lines.push(`CODING ${plan.coding.file}${refSha256 ? ` ref sha256:${refSha256}` : ''}`);
    for (const c of plan.coding.changes) lines.push(`${c.keyword}: ${c.from.keyword} -> ${c.to.keyword}`);
  }
  const out: string[] = [];
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
