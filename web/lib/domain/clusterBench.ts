/**
 * The TEST bench, as data: the cluster out of the car, a 12 V supply, and the K+DCAN cable.
 *
 * ONE source of truth for the bench wiring, as hardware.ts is for the chip bench. The diagram,
 * the wire list, the guide and docs/BENCH.md all describe these connections, and bench.test.ts
 * parses the document and fails when the two disagree.
 *
 * NOT VERIFIED. The cluster's pin numbers come from one public pinout of the E46 cluster
 * connector X11175 (bmwgm5). Until they have been checked on a real cluster, `verified` stays
 * false and everything that shows a cluster pin says UNVERIFIED beside it. The OBD side is the
 * J1962 standard - 16 battery +, 4 and 5 ground, 7 K-line - and is not in question.
 *
 * The chip bench and this one never meet: the UNO talks to a chip on a breadboard, the K+DCAN
 * cable talks to a cluster. Nothing here has an UNO end.
 */

export const BENCH_PINOUT = {
  connector: 'X11175',
  source: 'bmwgm5',
  verified: false,
} as const;

/**
 * Where a wire can end.
 *
 *   psu+ / psu-   the supply's terminals
 *   fused         the +12 V block after the 1 A fuse - one node along its length
 *   switched      the block after the KL15 switch
 *   ground        the ground block, tied to psu-
 *   x11175:<n>    a pin of the cluster connector (UNVERIFIED)
 *   obd:<n>       a pin of the OBD-II socket (J1962, female)
 *   kdcan / pc    the cable's plug and the computer at the other end of its USB lead
 */
export type BenchEnd =
  | 'psu+'
  | 'psu-'
  | 'fused'
  | 'switched'
  | 'ground'
  | `x11175:${number}`
  | `obd:${number}`
  | 'kdcan'
  | 'pc';

export type WireKind = 'supply' | 'switched' | 'ground' | 'k-line' | 'usb';

export type BenchWireId =
  | 'feed'
  | 'ground-lead'
  | 'switch'
  | 'kl30'
  | 'kl15'
  | 'klr'
  | 'cluster-gnd'
  | 'obd-16'
  | 'obd-4'
  | 'obd-5'
  | 'k-line'
  | 'usb';

export type BenchWire = {
  id: BenchWireId;
  from: BenchEnd;
  to: BenchEnd;
  kind: WireKind;
  /** A suggested lead colour, one per kind, so the drawing and the bench can look alike. */
  color: string;
};

const COLOR: Record<WireKind, string> = {
  supply: '#EF4444',
  switched: '#F97316',
  ground: '#3B82F6',
  'k-line': '#EAB308',
  usb: '#9A9AA8',
};

const wire = (id: BenchWireId, from: BenchEnd, to: BenchEnd, kind: WireKind): BenchWire => ({
  id,
  from,
  to,
  kind,
  color: COLOR[kind],
});

/**
 * Every conductor on the bench. The fuse sits in the `feed` lead, so everything positive -
 * the cluster AND the cable - is behind it.
 */
export const BENCH_WIRES: readonly BenchWire[] = [
  wire('feed', 'psu+', 'fused', 'supply'),
  wire('ground-lead', 'psu-', 'ground', 'ground'),
  wire('switch', 'fused', 'switched', 'supply'),
  wire('kl30', 'fused', 'x11175:4', 'supply'),
  wire('kl15', 'switched', 'x11175:5', 'switched'),
  wire('klr', 'switched', 'x11175:6', 'switched'),
  wire('cluster-gnd', 'ground', 'x11175:1', 'ground'),
  wire('obd-16', 'fused', 'obd:16', 'supply'),
  wire('obd-4', 'ground', 'obd:4', 'ground'),
  wire('obd-5', 'ground', 'obd:5', 'ground'),
  wire('k-line', 'obd:7', 'x11175:25', 'k-line'),
  wire('usb', 'kdcan', 'pc', 'usb'),
];

export type ConnectorPin = { pin: number; signal: string };

/** The cluster pins the bench uses, by bmwgm5's pinout. UNVERIFIED (BENCH_PINOUT). */
export const CLUSTER_PINS: readonly ConnectorPin[] = [
  { pin: 1, signal: 'GND' },
  { pin: 4, signal: 'KL30' },
  { pin: 5, signal: 'KL15' },
  { pin: 6, signal: 'KL R' },
  { pin: 25, signal: 'TXD' },
];

/** The OBD-II socket pins the K+DCAN cable needs: J1962. */
export const OBD_PINS: readonly ConnectorPin[] = [
  { pin: 4, signal: 'GND' },
  { pin: 5, signal: 'GND' },
  { pin: 7, signal: 'K' },
  { pin: 16, signal: '+12V' },
];

/** Numbers worth saying on screen, not only in a document. */
export const BENCH_ELECTRICAL = {
  supplyVolts: 12,
  /** A supply that cannot give this much browns out during the bulb check. */
  supplyMinAmps: 1,
  /** In the feed: a miswire at the cluster plug blows this, not the cluster. */
  fuseAmps: 1,
  /** The cable's serial settings - DS2, the same as on the car. */
  serial: '9600 8E1',
} as const;

/** How an end is written in docs/BENCH.md and in the wire list. One spelling, both places. */
export function endLabel(end: BenchEnd): string {
  if (end.startsWith('x11175:')) return `X11175 ${end.slice(7)}`;
  if (end.startsWith('obd:')) return `OBD ${end.slice(4)}`;
  const fixed: Record<string, string> = {
    'psu+': 'PSU +',
    'psu-': 'PSU -',
    fused: '+12 V FUSED',
    switched: 'KL15 SWITCHED',
    ground: 'GND',
    kdcan: 'K+DCAN',
    pc: 'PC',
  };
  return fixed[end] ?? end;
}

export function wireById(id: BenchWireId): BenchWire {
  const w = BENCH_WIRES.find((x) => x.id === id);
  if (!w) throw new RangeError(`no bench wire ${id}`);
  return w;
}
