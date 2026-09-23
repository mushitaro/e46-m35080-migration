/**
 * mayRun - whether a telegram may go to the cluster. The only place that decides it
 * (tsunagi-m-stack section 5).
 *
 * It judges BYTES, not intentions. A request is its control byte and payload; the gate finds the
 * one rule those bytes fit, and a telegram that fits no rule is refused however it was built. So a
 * mislabelled request cannot pass, and a telegram this tool has no builder for - clearing the
 * fault memory, writing the EEPROM, resetting the cluster - is refused even when someone hands the
 * link its bytes.
 *
 * What the rules say, in order of how they are checked:
 *
 *   1. The control byte and the bytes after it name exactly one telegram on the list.
 *   2. Its length is exactly that telegram's length - on this variant, where the variants differ.
 *   3. A telegram whose shape depends on the variant waits until IDENT has named the variant.
 *      Until then only the session frames and the reads both variants share can go.
 *   4. Every telegram that DRIVES something waits for the variant AND for the reader to have
 *      confirmed the cluster is out of the car, on the bench.
 *   5. Its arguments are inside what the SGBD accepts: a needle between 10 and 90 degrees and
 *      within one step of where it was, only lamp bits that exist, only EEPROM words that exist.
 *
 * The context is the link's state, passed in, so the rule is a pure function a test can sweep.
 */

import {
  AIF_ODOMETER,
  AIF_VIN,
  Drive,
  EEPROM_MAX_WORDS,
  EEPROM_WORD_LIMIT,
  FAULTS_ALL,
  GAUGES,
  GAUGE_IDS,
  INPUT_PORTS,
  INPUT_PORTS_46,
  INPUT_PORTS_46R,
  KombiControl,
  LAMP_MASKS,
  NEEDLE_MAX_DEG,
  NEEDLE_MAX_STEP_DEG,
  NEEDLE_MIN_DEG,
  NEEDLE_REST_DEG,
  NEEDLE_SCALE,
  OUTPUT_PORT,
  OUTPUT_PORT_MASK,
  SEGMENT_EEPROM,
  gaugeOf,
  type GaugeId,
  type KombiRequest,
  type KombiVariant,
} from './protocol';

export type RequestKind =
  | 'keep-alive'
  | 'end-session'
  | 'ident'
  | 'vin'
  | 'odometer'
  | 'faults'
  | 'inputs'
  | 'eeprom'
  | 'needle'
  | 'lamps'
  | 'outputs'
  | 'gong'
  | 'piezo';

/** session: keeps or ends the diagnostic session. read: changes nothing. drive: changes what the cluster shows or sounds. */
export type RequestClass = 'session' | 'read' | 'drive';

/**
 * Where a needle may be. `null` while the cluster itself holds it - before this tool has moved it,
 * and again after the session ends - and then the only move allowed is to the rest angle, the one
 * target that is a known distance from anywhere. After a command that may or may not have landed,
 * the span covers both ends and the next move has to be within one step of each.
 */
export type NeedleSpan = { lo: number; hi: number } | null;

export type GateContext = {
  /** The variant IDENT named, or null until it has. */
  variant: KombiVariant | null;
  /** The reader has confirmed the cluster is out of the car, on the bench. */
  benchConfirmed: boolean;
  needles: Readonly<Record<GaugeId, NeedleSpan>>;
};

export function clusterHeldNeedles(): Record<GaugeId, NeedleSpan> {
  return Object.fromEntries(GAUGE_IDS.map((id) => [id, null])) as Record<GaugeId, NeedleSpan>;
}

/** The span after a needle command, from whether the reply confirmed it. */
export function nextNeedleSpan(span: NeedleSpan, degrees: number, delivered: boolean): NeedleSpan {
  if (delivered) return { lo: degrees, hi: degrees };
  if (span === null) return null;
  return { lo: Math.min(span.lo, degrees), hi: Math.max(span.hi, degrees) };
}

export type GateRefusal =
  /** No telegram on the list starts with these bytes. */
  | 'not-allowed'
  /** It is on the list, but not with this many bytes. */
  | 'wrong-length'
  /** Its shape depends on the variant, and IDENT has not named one. */
  | 'variant-unknown'
  /** This variant has no such telegram. */
  | 'not-on-this-variant'
  /** It drives the cluster, and the reader has not confirmed the bench. */
  | 'bench-unconfirmed'
  /** An argument outside what the SGBD accepts. */
  | 'out-of-range'
  /** A needle move larger than one step from where the needle may be. */
  | 'step-too-large';

export type GateVerdict =
  | { ok: true; kind: RequestKind; cls: RequestClass }
  | { ok: false; kind: RequestKind | null; reason: GateRefusal };

type Rule = {
  kind: RequestKind;
  cls: RequestClass;
  control: number;
  /** The payload bytes that name the telegram. */
  prefix: readonly number[];
  /**
   * The exact payload length. A number when both variants share the telegram - then it is allowed
   * before the variant is known. A record when they differ, or when only one variant has it.
   */
  length: number | Partial<Record<KombiVariant, number>>;
  /** Argument checks, run last. `variant` is null only for a rule whose length is a number. */
  check?: (payload: Uint8Array, variant: KombiVariant | null, ctx: GateContext) => GateRefusal | null;
};

const BOTH = (n: number): Record<KombiVariant, number> => ({ KOMBI46: n, KOMBI46R: n });

function checkInputs(p: Uint8Array, variant: KombiVariant | null): GateRefusal | null {
  if (variant === 'KOMBI46') {
    return INPUT_PORTS_46.every((port, i) => p[1 + i] === port) ? null : 'out-of-range';
  }
  return (INPUT_PORTS_46R as readonly number[]).includes(p[1] ?? -1) && p[2] === 0x00 ? null : 'out-of-range';
}

function checkEeprom(p: Uint8Array, variant: KombiVariant | null): GateRefusal | null {
  if (variant === null) return 'variant-unknown';
  let word: number;
  if (variant === 'KOMBI46') {
    if (p[1] !== 0x00 || p[2] !== 0x00) return 'out-of-range';
    word = p[3] ?? 0;
  } else {
    if (p[1] !== 0x00) return 'out-of-range';
    word = ((p[2] ?? 0) << 8) | (p[3] ?? 0);
  }
  const count = p[4] ?? 0;
  if (count < 1 || count > EEPROM_MAX_WORDS) return 'out-of-range';
  return word + count <= EEPROM_WORD_LIMIT[variant] ? null : 'out-of-range';
}

function checkNeedle(p: Uint8Array, variant: KombiVariant | null, ctx: GateContext): GateRefusal | null {
  const gauge = gaugeOf(p[0] ?? -1);
  if (variant === null || gauge === null) return 'out-of-range';
  const raw = ((p[1] ?? 0) << 8) | (p[2] ?? 0);
  const scale = NEEDLE_SCALE[variant];
  if (raw % scale !== 0) return 'out-of-range';
  const degrees = raw / scale;
  if (degrees < NEEDLE_MIN_DEG || degrees > NEEDLE_MAX_DEG) return 'out-of-range';
  const span = ctx.needles[gauge];
  if (span === null) return degrees === NEEDLE_REST_DEG ? null : 'step-too-large';
  return Math.abs(degrees - span.lo) <= NEEDLE_MAX_STEP_DEG && Math.abs(degrees - span.hi) <= NEEDLE_MAX_STEP_DEG
    ? null
    : 'step-too-large';
}

function checkLamps(p: Uint8Array, variant: KombiVariant | null): GateRefusal | null {
  if (variant === null) return 'variant-unknown';
  const masks = LAMP_MASKS[variant];
  // A 46R's lamp bytes follow a fixed 00.
  const first = variant === 'KOMBI46' ? 1 : 2;
  if (variant === 'KOMBI46R' && p[1] !== 0x00) return 'out-of-range';
  return masks.every((mask, i) => ((p[first + i] ?? 0) & ~mask) === 0) ? null : 'out-of-range';
}

function checkOutputs(p: Uint8Array): GateRefusal | null {
  return ((p[2] ?? 0) & ~OUTPUT_PORT_MASK) === 0 ? null : 'out-of-range';
}

/** The list. Anything not here does not go. */
const RULES: readonly Rule[] = [
  { kind: 'keep-alive', cls: 'session', control: KombiControl.KEEP_ALIVE, prefix: [], length: 0 },
  { kind: 'end-session', cls: 'session', control: KombiControl.END_SESSION, prefix: [], length: 0 },

  { kind: 'ident', cls: 'read', control: KombiControl.IDENT, prefix: [], length: 0 },
  { kind: 'vin', cls: 'read', control: KombiControl.READ_AIF, prefix: [AIF_VIN], length: 1 },
  { kind: 'odometer', cls: 'read', control: KombiControl.READ_AIF, prefix: [AIF_ODOMETER], length: 1 },
  { kind: 'faults', cls: 'read', control: KombiControl.READ_FAULTS, prefix: [FAULTS_ALL], length: 1 },
  {
    kind: 'inputs',
    cls: 'read',
    control: KombiControl.READ_INPUTS,
    prefix: [INPUT_PORTS],
    length: { KOMBI46: 1 + INPUT_PORTS_46.length, KOMBI46R: 3 },
    check: checkInputs,
  },
  {
    kind: 'eeprom',
    cls: 'read',
    control: KombiControl.READ_MEMORY,
    prefix: [SEGMENT_EEPROM],
    length: BOTH(5),
    check: checkEeprom,
  },

  ...GAUGES.map(
    (g): Rule => ({
      kind: 'needle',
      cls: 'drive',
      control: KombiControl.DRIVE,
      prefix: [g.select],
      length: BOTH(3),
      check: checkNeedle,
    }),
  ),
  {
    kind: 'lamps',
    cls: 'drive',
    control: KombiControl.DRIVE,
    prefix: [Drive.LAMPS],
    length: { KOMBI46: 1 + LAMP_MASKS.KOMBI46.length, KOMBI46R: 2 + LAMP_MASKS.KOMBI46R.length },
    check: checkLamps,
  },
  {
    kind: 'outputs',
    cls: 'drive',
    control: KombiControl.DRIVE,
    prefix: [Drive.PORT, OUTPUT_PORT],
    length: { KOMBI46: 3 },
    check: checkOutputs,
  },
  { kind: 'gong', cls: 'drive', control: KombiControl.DRIVE, prefix: [Drive.GONG], length: BOTH(1) },
  { kind: 'piezo', cls: 'drive', control: KombiControl.DRIVE, prefix: [Drive.PIEZO], length: BOTH(1) },
];

function ruleFor(req: KombiRequest): Rule | null {
  let best: Rule | null = null;
  for (const r of RULES) {
    if (r.control !== req.control || req.payload.length < r.prefix.length) continue;
    if (!r.prefix.every((b, i) => req.payload[i] === b)) continue;
    if (!best || r.prefix.length > best.prefix.length) best = r;
  }
  return best;
}

export function mayRun(req: KombiRequest, ctx: GateContext): GateVerdict {
  const rule = ruleFor(req);
  if (!rule) return { ok: false, kind: null, reason: 'not-allowed' };
  const refuse = (reason: GateRefusal): GateVerdict => ({ ok: false, kind: rule.kind, reason });

  let variant: KombiVariant | null = null;
  if (typeof rule.length === 'number') {
    if (req.payload.length !== rule.length) return refuse('wrong-length');
  } else {
    if (ctx.variant === null) return refuse('variant-unknown');
    const length = rule.length[ctx.variant];
    if (length === undefined) return refuse('not-on-this-variant');
    if (req.payload.length !== length) return refuse('wrong-length');
    variant = ctx.variant;
  }

  if (rule.cls === 'drive') {
    if (variant === null) return refuse('variant-unknown');
    if (!ctx.benchConfirmed) return refuse('bench-unconfirmed');
  }

  const bad = rule.check?.(req.payload, variant, ctx) ?? null;
  return bad ? refuse(bad) : { ok: true, kind: rule.kind, cls: rule.cls };
}
