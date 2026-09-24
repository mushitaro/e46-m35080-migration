/**
 * THE JOB - everything one write to the chip does, planned in one piece: where the cluster's data
 * comes from (the chip as it is, or a file), the bytes changed by hand, the VIN, the coding and
 * the odometer.
 *
 * These used to be separate tabs with separate plans and confirmations - RESTORE put a backup on
 * a chip, REWRITE raised the odometer and set the VIN, CODING changed parameters, INSPECT edited a
 * file that then had to be taken to RESTORE - and moving a cluster to another car meant running
 * them one after another, each writing and verifying on its own. A job is one intent, so it is one
 * plan, one confirmation and one pass through the write path (useM35080Link.runWrite).
 *
 * THE ORDER IS FIXED, and every step builds on the one before:
 *
 *   1. SOURCE   the standard array (0x020-0x3FF) starts as the chip's own, or as the file's (a
 *               donor's dump, a backup, or a file saved here earlier) - the file checked first as
 *               RESTORE checked it: a real cluster's data. The secure area is never taken from a
 *               file.
 *   2. BYTES    hand edits on the source, on the bytes no other part owns (byteEdits.ts byteLock) -
 *               then the checksums: resealed when they held; a file's that did not, only with FIX
 *               CHECKSUMS, and refused until then, as RESTORE refused it; a chip's that did not,
 *               left as read, with any edit inside them refused (a chip's broken checksum is
 *               evidence to read again, not to recompute over).
 *   3. VIN      written to every VIN field the source has (operations.ts planVinWrite): the coded
 *               field only on a late image whose checksums hold, resealing 0x16E.
 *   4. CODING   the source's own definition, every coding gate (ncs/encode.ts planCoding) - so the
 *               definition is chosen from what the chip WILL hold, which is why a file's coding can
 *               be changed on any chip, a blank one or PRACTICE's made-up one included. Resealed.
 *   5. ODOMETER WRINC on the chip's secure area, upward only - never from a file, never on a file.
 *
 * The bytes written are then simply every standard-array byte where the result differs from the
 * chip - one plan, whatever combination produced it - and a refusal names the part that refused.
 *
 * Without a chip (a file opened before anything is connected) the job is still planned: the
 * reader sees what the file would become, and can save it (SAVE EDITED) to write later. Nothing
 * can be written until a chip is read, and the odometer, which only a chip can carry, is not
 * planned at all.
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
import { CHECKSUM_ADDRESSES, checksumRegionOf, detectLayout, recomputeChecksums } from './layout';
import { byteLock, type ByteEdit } from './byteEdits';
import {
  backupChecksums,
  hasClusterData,
  planVinWrite,
  type ByteWrite,
  type ChecksumCheck,
  type Refusal,
  type RefusalCode,
  type VinAction,
} from './operations';
import { planCoding, type CodingChange, type CodingPlan, type CodingRefusal } from '@/lib/ncs/encode';
import type { CodingDoc } from '@/lib/refdata/types';

/** Where the data comes from: the chip as read, or a file (`dump` - a donor's, a backup, one saved here). */
export type JobSource = { kind: 'chip' } | { kind: 'dump'; name: string; image: Uint8Array };

export type OdometerIntent = { kind: 'keep' } | { kind: 'set'; km: number };

/** BYTES: the hand edits on the source, and FIX CHECKSUMS - honoured for a file only (byteEdits.ts). */
export type JobBytes = { edits: readonly ByteEdit[]; reseal: boolean };

export const NO_BYTES: JobBytes = { edits: [], reseal: false };

export type JobInput = {
  /** The chip as read, or null: nothing read yet, so nothing can be written. */
  chip: Uint8Array | null;
  source: JobSource;
  /** Required, so that no caller can plan a job and quietly leave the hand edits out of it. */
  bytes: JobBytes;
  odometer: OdometerIntent;
  vin: VinAction;
  /** Coding changes, with the reference data they were picked from. */
  coding: { doc: CodingDoc; changes: readonly CodingChange[] } | null;
};

/** Which part of the job refused, so the reader is told where to look. */
export type JobPart = 'source' | 'bytes' | 'odometer' | 'vin' | 'coding';

export type JobRefusal =
  | { ok: false; part: 'source' | 'bytes' | 'odometer' | 'vin'; refusal: Refusal }
  | { ok: false; part: 'coding'; refusal: CodingRefusal }
  | { ok: false; part: 'source'; refusal: { code: 'no-chip' } };

export type JobPlan = {
  ok: true;
  /** What the source contributes, before anything changes it. */
  base: Uint8Array;
  /** The source after BYTES: the hand edits, and the checksums resealed after them or by FIX. What VIN and CODING start from. */
  edited: Uint8Array;
  /** Addresses the hand edits change on the source (a reseal's checksum bytes are in `checksums`). */
  handEdits: number[];
  /** FIX CHECKSUMS was applied: a file whose checksums did not hold, recomputed. */
  fixed: boolean;
  /** The image as it will be: the standard array after every edit, the secure area after the WRINCs. */
  target: Uint8Array;
  /** Standard-array bytes the file itself puts on the chip - its own value, not an edit's (0 for the chip). */
  sourceBytes: number;
  /** The file's checksums as checked - 'ok' or 'unchecked' (another layout) - or null for the chip. */
  sourceChecksums: ChecksumCheck | null;
  vinWrites: ByteWrite[];
  coding: CodingPlan | null;
  currentKm: number | null;
  targetKm: number | null;
  secureOps: WriteOp[];
  /** Every standard-array byte that differs from the chip, in runs - what runWrite sends. Empty without a chip. */
  byteWrites: ByteWrite[];
  /** Checksum bytes the job changes, with before and after - on the chip, or without one on the source. */
  checksums: { address: number; before: number; after: number }[];
};

const bytesRefusal = (code: RefusalCode, address: number): JobRefusal => ({
  ok: false,
  part: 'bytes',
  refusal: { ok: false, code, address },
});

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
  if (source.kind === 'chip') {
    if (!chip) return { ok: false, part: 'source', refusal: { code: 'no-chip' } };
    base = Uint8Array.from(chip);
  } else {
    const dump = source.image;
    if (dump.length !== IMAGE_SIZE) return { ok: false, part: 'source', refusal: { ok: false, code: 'backup-size', fileSize: dump.length } };
    if (!hasClusterData(dump)) return { ok: false, part: 'source', refusal: { ok: false, code: 'backup-no-data' } };
    base = Uint8Array.from(dump);
    // The secure area is the chip's: a file's odometer is never copied, only raised to by WRINC.
    if (chip) base.set(secureOf(chip), 0);
  }

  /* 2. BYTES - the hand edits, checked against the same lock the edit bar used, then the checksums */
  const own = source.kind === 'dump' ? source.image : base;
  let edited: Uint8Array = Uint8Array.from(base);
  for (const e of input.bytes.edits) {
    const lock = byteLock(own, e.address);
    if (lock) return bytesRefusal(lock === 'outside' ? 'bytes-outside' : 'bytes-protected', e.address);
    // Edits are made on one source; on any other they would put values nobody chose.
    if (edited[e.address] !== e.before) return bytesRefusal('bytes-stale', e.address);
    edited[e.address] = e.after;
  }
  const handEdits: number[] = [];
  for (let a = STANDARD_START; a <= STANDARD_END; a++) if (edited[a] !== base[a]) handEdits.push(a);

  let fixed = false;
  const layout = detectLayout(base);
  if (layout.kind === 'late') {
    if (layout.consistent) {
      // Held before: sealed again after, as VIN and CODING seal theirs.
      if (handEdits.length > 0) edited = recomputeChecksums(edited).image;
    } else if (source.kind === 'dump') {
      // A file whose checksums fail is refused as RESTORE refused it - until FIX CHECKSUMS says otherwise.
      if (!input.bytes.reseal) return { ok: false, part: 'source', refusal: { ok: false, code: 'backup-checksum-broken' } };
      edited = recomputeChecksums(edited).image;
      fixed = true;
    } else {
      // A chip's: left as read. An edit outside the regions changes nothing they cover; one inside would be sealed over whatever broke them.
      const inside = handEdits.find((a) => checksumRegionOf(a) !== null);
      if (inside !== undefined) return bytesRefusal('bytes-checksum-broken', inside);
    }
  }

  /* The file's checksums, as RESTORE checked them - on the file as BYTES left it, so FIX counts. */
  let sourceChecksums: ChecksumCheck | null = null;
  if (source.kind === 'dump') {
    const checked = backupChecksums(edited);
    if (typeof checked !== 'string') return { ok: false, part: 'source', refusal: checked };
    sourceChecksums = checked;
  }

  /* 3. VIN */
  const vin = planVinWrite(edited, input.vin);
  if (!vin.ok) return { ok: false, part: 'vin', refusal: vin };
  let content = Uint8Array.from(edited);
  for (const w of vin.writes) content.set(w.data, w.address);

  /* 4. CODING */
  let coding: CodingPlan | null = null;
  if (input.coding && input.coding.changes.length > 0) {
    const planned = planCoding(content, input.coding.doc, input.coding.changes);
    if (!planned.ok) return { ok: false, part: 'coding', refusal: planned };
    coding = planned;
    content = Uint8Array.from(planned.after);
  }

  /* 5. ODOMETER - on the chip only */
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
  if (chip) {
    for (let a = STANDARD_START; a <= STANDARD_END; a++) if (target[a] !== chip[a] && target[a] === base[a]) sourceBytes++;
    const from = source.kind === 'dump' ? source.name : null;
    byteWrites = runs(chip, target, (a, b) =>
      a === b
        ? `0x${hex(a, 3)}  0x${hex(chip[a]!)} -> 0x${hex(target[a]!)}${from ? `  (${from})` : ''}`
        : `0x${hex(a, 3)}-0x${hex(b, 3)}  ${b - a + 1} bytes${from ? ` from ${from}` : ''}`,
    );
  }
  /* Against the chip - or, with none, the source: a reseal is a change to say either way. */
  const ref = chip ?? base;
  const checksums = CHECKSUM_ADDRESSES.filter((a) => ref[a] !== target[a]).map((a) => ({ address: a, before: ref[a]!, after: target[a]! }));

  return {
    ok: true,
    base,
    edited,
    handEdits,
    fixed,
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

/**
 * What SAVE EDITED saves: the job's result as a file, to be opened later as the SOURCE FILE and
 * written. The odometer is the SOURCE's own and no WRINC is planned - the chip's for a CHIP
 * source, the file's own for a FILE - so a FILE job saves the same bytes whether a chip is read or
 * not, and no file is ever named for a km no chip has held. Null when there is nothing to save:
 * the plan is refused, or its result is the source unchanged (an unchanged chip is its BACKUP, an
 * unchanged file is itself).
 */
export function savedImage(input: JobInput): Uint8Array | null {
  const source = input.source.kind === 'dump' ? input.source.image : input.chip;
  if (!source) return null;
  const plan = planJob({ ...input, chip: input.source.kind === 'dump' ? null : input.chip, odometer: { kind: 'keep' } });
  if (!plan.ok) return null;
  for (let i = 0; i < source.length; i++) if (source[i] !== plan.target[i]) return plan.target;
  return null;
}

/* ---------------------------------------------------------------- telling it */

/** What the confirmation says, part by part - only the parts this plan actually writes. */
export type JobSummary = {
  odometer: { from: number | null; to: number; ops: number } | null;
  source: { name: string; bytes: number } | null;
  /** Bytes changed by hand that the write still changes. */
  edits: number;
  /** FIX CHECKSUMS: the file's checksums were recomputed. */
  fixed: boolean;
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

/** Hand edits the write still makes: not yet on the chip, and not overwritten by the VIN or the coding after them. */
const handLines = (plan: JobPlan, input: JobInput) =>
  plan.handEdits.filter((a) => plan.target[a] === plan.edited[a] && pending(plan, input, a, 1));

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
    edits: handLines(plan, input).length,
    fixed: plan.fixed,
    vin,
    coding: codingChanges(plan, input).length,
    checksums: plan.checksums.length,
    bytes: plan.byteWrites.reduce((n, w) => n + w.data.length, 0),
  };
}

/**
 * The confirmation's lines, one per thing sent: the WRINCs, what the source changes, each byte
 * changed by hand, FIX CHECKSUMS, the VIN fields, each coding change, each checksum - then the
 * runs themselves, which are what the link sends and what runWrite checks the chip against.
 */
export function jobDetails(plan: JobPlan, input: JobInput): string[] {
  const hex = (n: number, w = 2) => n.toString(16).toUpperCase().padStart(w, '0');
  const from = input.chip ?? plan.base;
  return [
    ...plan.secureOps.map((o) => `WRINC 0x${hex(o.address)}  0x${hex(o.from)} -> 0x${hex(o.to)}`),
    ...(input.source.kind === 'dump' && plan.sourceBytes > 0 ? [`0x020-0x3FF from ${input.source.name}: ${plan.sourceBytes} byte(s) differ`] : []),
    ...handLines(plan, input).map((a) => `0x${hex(a, 3)}  0x${hex(from[a]!)} -> 0x${hex(plan.edited[a]!)}  (BYTES)`),
    ...(plan.fixed ? ["FIX CHECKSUMS: the file's checksums recomputed"] : []),
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
  const from = input.chip ?? plan.base;
  for (const a of handLines(plan, input)) lines.push(`BYTE 0x${hex(a, 3)} 0x${hex(from[a]!)} -> 0x${hex(plan.edited[a]!)}`);
  if (plan.fixed) lines.push('FIX CHECKSUMS');
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
