/**
 * The TEST bench, as data: the cluster out of the car, a 12 V supply, and the K+DCAN cable.
 *
 * ONE source of truth for the bench wiring, as hardware.ts is for the chip bench. The diagram,
 * the wire list, the guide and docs/BENCH.md all describe these connections, and bench.test.ts
 * parses the document and fails when the two disagree.
 *
 * Built like a breadboard. Every joint is a lever connector (BENCH_CONNECTORS), and a lever
 * connector is one node the way a breadboard's rail is: a wire in any of its ports is on that
 * node. The fuse holder's leads and the loose ends of the two pigtails - the cluster plug's and the
 * OBD socket's - push straight in. Nothing is soldered, crimped or screwed down.
 *
 * No ignition switch. KL15 and KL R sit on the fused +12 V beside KL30, so the supply's output is
 * the key: switched on, the cluster sees battery and ignition together, as with the key turned.
 * Nothing TEST does needs the ignition off with the battery still on.
 *
 * OBD 7, not 8. The E46 has two diagnostic lines: OBD 7 is D_TXD2 (engine and gearbox) and OBD 8
 * is D_TXD1 (everything else, the cluster among them - X11175 pin 25 is D_TXD1). A K+DCAN cable
 * talks on 7, the J1962 K-line; its switch, in the K-line position, bridges 7 and 8, which is how
 * it reaches the cluster in the car. On the bench the cluster is the only thing on the line, so its
 * pin 25 goes straight to 7 and nothing needs bridging. (The two lines as E46 INPA wiring guides
 * give them; pin 25 as bmwgm5's table does.)
 *
 * NOT VERIFIED. The cluster's pin numbers, where they sit in the connector and the colours of
 * their wires come from one public source for the E46 cluster connector X11175 (bmwgm5: its
 * pinout table, and its photo of the board). Until they have been checked on a real cluster,
 * `verified` stays false and everything that shows a cluster pin says UNVERIFIED beside it. The
 * OBD side is the J1962 standard - 16 battery +, 4 and 5 ground, 7 K-line - and is not in question.
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
 *   fused         the +12 V lever connector, after the 1 A fuse
 *   ground        the ground lever connector, tied to psu-
 *   kline         the two-port lever connector joining the cable's K-line to the cluster's
 *   x11175:<n>    a pin of the cluster connector (UNVERIFIED)
 *   obd:<n>       a pin of the OBD-II socket (J1962, female)
 *   kdcan / pc    the cable's plug and the computer at the other end of its USB lead
 */
export type BenchEnd =
  | 'psu+'
  | 'psu-'
  | ConnectorEnd
  | `x11175:${number}`
  | `obd:${number}`
  | 'kdcan'
  | 'pc';

/** The ends that are lever connectors. */
export type ConnectorEnd = 'fused' | 'ground' | 'kline';

export type WireKind = 'supply' | 'ground' | 'k-line' | 'usb';

export type BenchWireId =
  | 'feed'
  | 'ground-lead'
  | 'kl30'
  | 'kl15'
  | 'klr'
  | 'cluster-gnd'
  | 'obd-16'
  | 'obd-4'
  | 'obd-5'
  | 'obd-7'
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
  wire('kl30', 'fused', 'x11175:4', 'supply'),
  wire('kl15', 'fused', 'x11175:5', 'supply'),
  wire('klr', 'fused', 'x11175:6', 'supply'),
  wire('cluster-gnd', 'ground', 'x11175:1', 'ground'),
  wire('obd-16', 'fused', 'obd:16', 'supply'),
  wire('obd-4', 'ground', 'obd:4', 'ground'),
  wire('obd-5', 'ground', 'obd:5', 'ground'),
  wire('obd-7', 'kline', 'obd:7', 'k-line'),
  wire('k-line', 'kline', 'x11175:25', 'k-line'),
  wire('usb', 'kdcan', 'pc', 'usb'),
];

/**
 * The lever connectors and their ports. Which port a wire takes does not matter - only which
 * connector - so the drawing may put any wire in any port, and an empty port is room to spare.
 * The parts list buys one `lever-connector-<ports>` for each (bench.test.ts holds the two together).
 */
export const BENCH_CONNECTORS: readonly { end: ConnectorEnd; ports: number }[] = [
  { end: 'fused', ports: 5 },
  { end: 'ground', ports: 5 },
  { end: 'kline', ports: 2 },
];

export type ConnectorPin = { pin: number; signal: string };

/** A harness wire's colour in BMW's letters: SW black, BR brown, RT red, GE yellow, GN green, BL blue, VI violet, GR grey, WS white. */
export type WireLetter = 'SW' | 'BR' | 'RT' | 'GE' | 'GN' | 'BL' | 'VI' | 'GR' | 'WS';

/**
 * The cluster pins the bench uses, by bmwgm5's pinout, each with the colour its table gives the
 * harness wire - base colour first, then the stripes. That colour is how a wire is found in a
 * pigtail cut from a used harness. UNVERIFIED (BENCH_PINOUT).
 */
export const CLUSTER_PINS: readonly (ConnectorPin & { wire: readonly WireLetter[] })[] = [
  { pin: 1, signal: 'GND', wire: ['BR', 'SW'] },
  { pin: 4, signal: 'KL30', wire: ['RT', 'GE', 'WS'] },
  { pin: 5, signal: 'KL15', wire: ['GN', 'BL'] },
  { pin: 6, signal: 'KL R', wire: ['VI', 'GE'] },
  { pin: 25, signal: 'TXD1', wire: ['WS', 'VI'] },
];

/** X11175 has two columns of this many pins. */
export const X11175_ROWS = 13;

/**
 * Where a pin sits in X11175 seen from the back of the cluster, as bmwgm5's photo of the board
 * shows it: 1-13 up the right-hand column from the bottom, 14-26 up the left-hand one, so pin n
 * sits beside pin n + 13. Row 0 is the top. UNVERIFIED with the rest (BENCH_PINOUT).
 */
export function x11175Slot(pin: number): { column: 'left' | 'right'; row: number } {
  if (!Number.isInteger(pin) || pin < 1 || pin > 2 * X11175_ROWS) throw new RangeError(`X11175 has no pin ${pin}`);
  return pin <= X11175_ROWS ? { column: 'right', row: X11175_ROWS - pin } : { column: 'left', row: 2 * X11175_ROWS - pin };
}

/**
 * The OBD-II socket pins the K+DCAN cable needs: J1962. 7 is the cable's K-line; 8, where the car
 * keeps the cluster's line, is not wired on the bench (see the note at the top).
 */
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
    ground: 'GND',
    kline: 'K-LINE',
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
