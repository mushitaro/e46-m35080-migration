'use client';

/**
 * The TEST bench, drawn: the supply and its fuse, the three lever connectors, the OBD socket and
 * the cluster plug.
 *
 * Every wire, end, pin and port count comes from lib/domain/clusterBench.ts; this file only decides
 * WHERE to draw them. Three drawing decisions carry meaning:
 *
 *   - A lever connector is drawn with ALL its ports on one bar, used or not. The bar is the node,
 *     as a breadboard's rail is, and an empty port is room to spare. Which port a wire lands in is
 *     this file's choice (PORT_OF) - on the bench any port of the right connector will do.
 *   - The OBD socket is its MATING FACE, J1962: pins 1-8 across the top, 9-16 across the bottom,
 *     the way the car's socket looks under the dash. That is the standard and not in question.
 *   - The cluster side is two things. The wires land on a list of the five pigtail wires the bench
 *     uses - pin, signal, and the wire's colour, which is how it is found in a cut harness. Beside
 *     it, X11175 as seen from the back of the cluster, the way bmwgm5's photo of the board shows
 *     it, every pin numbered and the five outlined in their wire's colour. The wires stop at the
 *     list rather than the face because on the face 1, 4, 5 and 6 sit behind the other column:
 *     a lead reaching them would run across pins it does not touch. While BENCH_PINOUT.verified is
 *     false the box says UNVERIFIED. The rows run 6, 5, 4 down as on the face, then ground, then
 *     K-line, which is what lets the wires reach them without crossing one another.
 *
 * Wires are drawn square, with a dot only where a wire ends: a crossing without a dot is not a
 * connection. There are two, both on the OBD 16 lead.
 */

import type { ReactNode } from 'react';
import {
  BENCH_CONNECTORS,
  BENCH_ELECTRICAL,
  BENCH_PINOUT,
  BENCH_WIRES,
  CLUSTER_PINS,
  X11175_ROWS,
  endLabel,
  x11175Slot,
  type BenchWire,
  type BenchWireId,
  type ConnectorEnd,
  type WireLetter,
} from '@/lib/domain/clusterBench';
import { CHROME } from '@/lib/copy/chrome';
import { b } from '@/lib/copy/bench';

const VIEW_W = 760;
const VIEW_H = 664;

type P = { x: number; y: number };

const RED = '#EF4444';
const BLUE = '#3B82F6';
const YELLOW = '#EAB308';
const INK = '#9A9AA8';
const UNVERIFIED_INK = '#B9A6EE';

/* ---- the supply ---- */
const PSU = { x: 20, y: 40, w: 100, h: 130 };
const PSU_PLUS: P = { x: 120, y: 80 };
const PSU_MINUS: P = { x: 86, y: 170 };
const FUSE = { x: 140, y: 72, w: 44, h: 16 };

/* ---- the lever connectors: where the first port sits, and the pitch along the bar ---- */
const LEVER_PAD = 18;
const LEVER: Record<ConnectorEnd, { x0: number; y: number; pitch: number; color: string; below: boolean }> = {
  fused: { x0: 222, y: 80, pitch: 40, color: RED, below: false },
  ground: { x0: 86, y: 240, pitch: 36, color: BLUE, below: true },
  kline: { x0: 376, y: 312, pitch: 30, color: YELLOW, below: true },
};
const portsOf = (end: ConnectorEnd) => BENCH_CONNECTORS.find((c) => c.end === end)?.ports ?? 0;
const port = (end: ConnectorEnd, i: number): P => ({ x: LEVER[end].x0 + i * LEVER[end].pitch, y: LEVER[end].y });

/**
 * Which port each wire takes at its connector. Chosen for the drawing, not the bench: the ground
 * connector's ports line up over OBD 4 and 5, and port 1 there is the spare.
 */
const PORT_OF: Partial<Record<BenchWireId, number>> = {
  feed: 0,
  'obd-16': 1,
  kl30: 2,
  kl15: 3,
  klr: 4,
  'ground-lead': 0,
  'obd-4': 2,
  'obd-5': 3,
  'cluster-gnd': 4,
  'obd-7': 0,
  'k-line': 1,
};

/* ---- the OBD socket: J1962 mating face ---- */
const OBD_TOP = 300;
const OBD_BOTTOM = 420;
const obdPin = (n: number): P =>
  n <= 8 ? { x: 50 + (n - 1) * 36, y: 335 } : { x: 68 + (n - 9) * 32, y: 385 };
const OBD_PIN_R = 10;
/** Where a lead meets a pin of the face: on the pin's rim, so its number stays readable. */
const obdRim = (n: number, from: 'above' | 'right'): P => {
  const p = obdPin(n);
  return from === 'above' ? { x: p.x, y: p.y - OBD_PIN_R } : { x: p.x + OBD_PIN_R, y: p.y };
};

/* ---- the cluster plug: the wires it uses, and its face seen from the back of the cluster ---- */
const CLUSTER = { x: 490, y: 190, w: 258, h: 300 };
const CLUSTER_ROW_Y: Record<number, number> = { 6: 275, 5: 310, 4: 345, 1: 400, 25: 450 };
const clusterPin = (n: number): P => ({ x: CLUSTER.x, y: CLUSTER_ROW_Y[n] });

/** X11175's face: the left-hand column's x, the pitch between columns and rows, and the top row's y. */
const FACE = { x: 692, pitch: 26, row: 17, y: 262, r: 7.5 };
const facePin = (n: number): P => {
  const s = x11175Slot(n);
  return { x: FACE.x + (s.column === 'right' ? FACE.pitch : 0), y: FACE.y + s.row * FACE.row };
};

/** BMW's wire-colour letters, as the swatches paint them. */
const WIRE_HEX: Record<WireLetter, string> = {
  SW: '#111114',
  BR: '#8A5A33',
  RT: '#E03131',
  GE: '#F2C94C',
  GN: '#2F9E44',
  BL: '#3B6FD8',
  VI: '#8E5BD0',
  GR: '#8C8C96',
  WS: '#F2F2F5',
};

const KDCAN = { x: 40, y: 446, w: 260, h: 42 };
const PC = { x: 120, y: 540, w: 100, h: 36 };

/** Where a wire meets its connector: the port PORT_OF gives it. */
function at(id: BenchWireId): P {
  const w = BENCH_WIRES.find((x) => x.id === id);
  const end = BENCH_CONNECTORS.find((k) => k.end === w?.from || k.end === w?.to)?.end;
  const i = PORT_OF[id];
  if (!end || i === undefined) throw new RangeError(`bench wire ${id} has no port`);
  return port(end, i);
}

/**
 * Each wire's route, as the corners it turns. First point is where it leaves, last where it lands.
 * A lead leaves its port straight up or down - never along the bar, through the next port - and
 * the channels at x 438-478 run beside the cluster list, a higher row taking a channel nearer it.
 */
const ROUTES: Record<BenchWireId, P[]> = {
  feed: [PSU_PLUS, at('feed')],
  'ground-lead': [PSU_MINUS, at('ground-lead')],
  klr: [at('klr'), { x: at('klr').x, y: 120 }, { x: 478, y: 120 }, { x: 478, y: clusterPin(6).y }, clusterPin(6)],
  kl15: [at('kl15'), { x: at('kl15').x, y: 135 }, { x: 468, y: 135 }, { x: 468, y: clusterPin(5).y }, clusterPin(5)],
  kl30: [at('kl30'), { x: at('kl30').x, y: 150 }, { x: 458, y: 150 }, { x: 458, y: clusterPin(4).y }, clusterPin(4)],
  'cluster-gnd': [
    at('cluster-gnd'),
    { x: at('cluster-gnd').x, y: 285 },
    { x: 448, y: 285 },
    { x: 448, y: clusterPin(1).y },
    clusterPin(1),
  ],
  'obd-16': [at('obd-16'), { x: at('obd-16').x, y: 270 }, { x: 345, y: 270 }, { x: 345, y: obdPin(16).y }, obdRim(16, 'right')],
  'obd-4': [at('obd-4'), obdRim(4, 'above')],
  'obd-5': [at('obd-5'), obdRim(5, 'above')],
  'obd-7': [at('obd-7'), { x: obdPin(7).x, y: at('obd-7').y }, obdRim(7, 'above')],
  'k-line': [at('k-line'), { x: 438, y: at('k-line').y }, { x: 438, y: clusterPin(25).y }, clusterPin(25)],
  usb: [{ x: 170, y: KDCAN.y + KDCAN.h }, { x: 170, y: PC.y }],
};

/** Square corners, softened: a path through `pts` with each corner rounded by `r`. */
function routePath(pts: P[], r = 8): string {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const cur = pts[i];
    const next = pts[i + 1];
    if (!next) {
      d += ` L ${cur.x} ${cur.y}`;
      break;
    }
    const prev = pts[i - 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const k = Math.min(r, inLen / 2, outLen / 2);
    const a = { x: cur.x - ((cur.x - prev.x) / inLen) * k, y: cur.y - ((cur.y - prev.y) / inLen) * k };
    const c = { x: cur.x + ((next.x - cur.x) / outLen) * k, y: cur.y + ((next.y - cur.y) / outLen) * k };
    d += ` L ${a.x} ${a.y} Q ${cur.x} ${cur.y} ${c.x} ${c.y}`;
  }
  return d;
}

export type ClusterBenchDiagramProps = {
  /** Wires to light; null lights everything. */
  highlight?: readonly BenchWireId[] | null;
  onSelectWire?: (id: BenchWireId) => void;
};

export function ClusterBenchDiagram({ highlight = null, onSelectWire }: ClusterBenchDiagramProps) {
  const c = b();
  const lit = (id: BenchWireId) => highlight === null || highlight.includes(id);
  /** A connector, socket or plug is lit when any wire at it is. */
  const anyLit = (pred: (w: BenchWire) => boolean) => BENCH_WIRES.some((w) => pred(w) && lit(w.id));
  const touches = (w: BenchWire, prefix: string) => w.from.startsWith(prefix) || w.to.startsWith(prefix);
  const clusterLit = anyLit((w) => touches(w, 'x11175'));
  /** Inside a lit cluster box, a pin whose lead is not lit steps back - on the list and on the face. */
  const rowDimmed = (pin: number) => {
    const w = BENCH_WIRES.find((x) => x.to === `x11175:${pin}`);
    return clusterLit && w !== undefined && !lit(w.id);
  };

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Cluster bench wiring"
    >
      {/* ================= supply: its output is the key ================= */}
      <Dim on={anyLit((w) => touches(w, 'psu'))}>
        <rect x={PSU.x} y={PSU.y} width={PSU.w} height={PSU.h} rx={8} fill="#0A0A0D" stroke="#2A2A33" />
        <text x={PSU.x + PSU.w / 2} y={PSU.y + 30} textAnchor="middle" fill="#C6C6CF" fontSize={12} fontFamily="monospace">
          {CHROME.bench.psu}
        </text>
        <text x={PSU.x + PSU.w / 2} y={PSU.y + 48} textAnchor="middle" fill="#70707E" fontSize={10} fontFamily="monospace">
          {`≥ ${BENCH_ELECTRICAL.supplyMinAmps} A`}
        </text>
        <rect x={PSU.x + 16} y={PSU.y + 72} width={PSU.w - 32} height={20} rx={3} fill="#17171C" stroke="#2A2A33" />
        <text x={PSU.x + PSU.w / 2} y={PSU.y + 86} textAnchor="middle" fill="#9A9AA8" fontSize={10} fontFamily="monospace">
          {CHROME.bench.output}
        </text>
        <text x={PSU_PLUS.x - 14} y={PSU_PLUS.y + 4} textAnchor="middle" fill={RED} fontSize={13} fontFamily="monospace">
          +
        </text>
        <text x={PSU_MINUS.x} y={PSU_MINUS.y - 12} textAnchor="middle" fill={BLUE} fontSize={13} fontFamily="monospace">
          −
        </text>
      </Dim>

      {/* ================= lever connectors: one node along each ================= */}
      {BENCH_CONNECTORS.map(({ end }) => (
        <Lever key={end} end={end} label={endLabel(end)} on={anyLit((w) => w.from === end || w.to === end)} />
      ))}

      {/* ================= OBD socket, mating face ================= */}
      <Dim on={anyLit((w) => touches(w, 'obd'))}>
        <text x={20} y={OBD_TOP - 8} fill="#C6C6CF" fontSize={12} fontFamily="monospace">
          {CHROME.bench.obd}
        </text>
        <path
          d={`M 20 ${OBD_TOP} L 330 ${OBD_TOP} L 308 ${OBD_BOTTOM} L 42 ${OBD_BOTTOM} Z`}
          fill="#0A0A0D"
          stroke="#2A2A33"
        />
        {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => {
          const p = obdPin(n);
          const used = BENCH_WIRES.some((w) => w.from === `obd:${n}` || w.to === `obd:${n}`);
          return (
            <g key={n}>
              <circle cx={p.x} cy={p.y} r={OBD_PIN_R} fill={used ? '#26262F' : '#17171C'} stroke={used ? '#5A5A68' : '#2A2A33'} />
              <text
                x={p.x}
                y={p.y + 4}
                textAnchor="middle"
                fill={used ? '#DFDFE6' : '#4C4C58'}
                fontSize={10}
                fontFamily="monospace"
              >
                {n}
              </text>
            </g>
          );
        })}
      </Dim>

      {/* The cable plugs into the face; its USB lead goes to the PC. */}
      <Dim on={lit('usb')}>
        <rect x={KDCAN.x} y={KDCAN.y} width={KDCAN.w} height={KDCAN.h} rx={6} fill="#101015" stroke="#2A2A33" />
        <text x={KDCAN.x + 14} y={KDCAN.y + 26} fill="#DFDFE6" fontSize={12} fontFamily="monospace">
          {CHROME.bench.kdcan}
        </text>
        <line x1={170} y1={KDCAN.y} x2={170} y2={OBD_BOTTOM + 6} stroke={INK} strokeWidth={1.5} strokeDasharray="3 3" />
        <text x={180} y={KDCAN.y - 8} fill="#70707E" fontSize={10} fontFamily="monospace">
          {CHROME.bench.plugsIn}
        </text>
        <rect x={PC.x} y={PC.y} width={PC.w} height={PC.h} rx={4} fill="#0A0A0D" stroke="#2A2A33" />
        <text x={PC.x + PC.w / 2} y={PC.y + 23} textAnchor="middle" fill="#C6C6CF" fontSize={12} fontFamily="monospace">
          {endLabel('pc')}
        </text>
        <text x={180} y={(KDCAN.y + KDCAN.h + PC.y) / 2 + 4} fill="#70707E" fontSize={10} fontFamily="monospace">
          {BENCH_ELECTRICAL.serial}
        </text>
      </Dim>

      {/* ================= cluster plug: a list, not a picture ================= */}
      <Dim on={clusterLit}>
        <rect x={CLUSTER.x} y={CLUSTER.y} width={CLUSTER.w} height={CLUSTER.h} rx={8} fill="#0A0A0D" stroke="#2A2A33" />
        <text x={CLUSTER.x + 16} y={CLUSTER.y + 24} fill="#C6C6CF" fontSize={12} fontFamily="monospace">
          {CHROME.bench.cluster}
        </text>
        {!BENCH_PINOUT.verified && (
          <text x={CLUSTER.x + 16} y={CLUSTER.y + 42} fill={UNVERIFIED_INK} fontSize={10} fontFamily="monospace">
            {`${CHROME.bench.unverified} · ${BENCH_PINOUT.source}`}
          </text>
        )}
        {/* The five pigtail wires: pin, signal, and the colour that finds the wire in a cut harness. */}
        {CLUSTER_PINS.map(({ pin, signal, wire }) => {
          const p = clusterPin(pin);
          return (
            <g key={pin} opacity={rowDimmed(pin) ? 0.35 : 1}>
              <text x={CLUSTER.x + 18} y={p.y + 4} fill="#DFDFE6" fontSize={13} fontFamily="monospace">
                {pin}
              </text>
              <text x={CLUSTER.x + 46} y={p.y + 4} fill="#9A9AA8" fontSize={12} fontFamily="monospace">
                {signal}
              </text>
              <WireSwatch x={CLUSTER.x + 90} y={p.y} wire={wire} />
              <text x={CLUSTER.x + 118} y={p.y + 4} fill="#70707E" fontSize={10} fontFamily="monospace">
                {wire.join('/')}
              </text>
            </g>
          );
        })}

        {/* X11175 from the back of the cluster: every pin, the five in use outlined in their lead's colour. */}
        <rect
          x={FACE.x - FACE.r - 8}
          y={FACE.y - FACE.r - 8}
          width={FACE.pitch + 2 * (FACE.r + 8)}
          height={(X11175_ROWS - 1) * FACE.row + 2 * (FACE.r + 8)}
          rx={4}
          fill="#101015"
          stroke="#2A2A33"
        />
        {Array.from({ length: 2 * X11175_ROWS }, (_, i) => i + 1).map((n) => {
          const p = facePin(n);
          const w = BENCH_WIRES.find((x) => x.to === `x11175:${n}`);
          return (
            <g key={n} opacity={w && rowDimmed(n) ? 0.35 : 1}>
              <circle
                cx={p.x}
                cy={p.y}
                r={FACE.r}
                fill={w ? '#26262F' : '#17171C'}
                stroke={w ? w.color : '#2A2A33'}
                strokeWidth={w ? 1.5 : 1}
              />
              <text x={p.x} y={p.y + 3} textAnchor="middle" fill={w ? '#DFDFE6' : '#4C4C58'} fontSize={8} fontFamily="monospace">
                {n}
              </text>
            </g>
          );
        })}
      </Dim>

      {/* ================= the wires ================= */}
      {BENCH_WIRES.filter((w) => w.kind !== 'usb').map((w) => {
        const pts = ROUTES[w.id];
        const on = lit(w.id);
        return (
          <g
            key={w.id}
            opacity={on ? 1 : 0.12}
            onClick={() => onSelectWire?.(w.id)}
            style={{ cursor: onSelectWire ? 'pointer' : 'default' }}
          >
            <path d={routePath(pts)} fill="none" stroke={w.color} strokeWidth={on ? 3 : 2} strokeLinecap="round" />
            <circle cx={pts[0].x} cy={pts[0].y} r={4} fill={w.color} />
            <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={4} fill={w.color} />
          </g>
        );
      })}
      <g opacity={lit('usb') ? 1 : 0.12} onClick={() => onSelectWire?.('usb')} style={{ cursor: onSelectWire ? 'pointer' : 'default' }}>
        <path d={routePath(ROUTES.usb)} fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      </g>

      {/* The fuse sits in the feed, between the supply and everything else. */}
      <Dim on={lit('feed')}>
        <rect x={FUSE.x} y={FUSE.y} width={FUSE.w} height={FUSE.h} rx={3} fill="#17171C" stroke={RED} />
        <text x={FUSE.x + FUSE.w / 2} y={FUSE.y - 8} textAnchor="middle" fill="#C6C6CF" fontSize={11} fontFamily="monospace">
          {CHROME.bench.fuse}
        </text>
      </Dim>

      {/* ================= how to read it ================= */}
      {[c.leverNode, c.obdFace, c.clusterFace, c.wireLetters].map((line, i) => (
        <text key={i} x={20} y={600 + i * 17} fill="#70707E" fontSize={11} fontFamily="monospace">
          {line}
        </text>
      ))}
    </svg>
  );
}

function Dim({ on, children }: { on: boolean; children: ReactNode }) {
  return <g opacity={on ? 1 : 0.3}>{children}</g>;
}

/** A harness wire's colour: the base colour as a short bar, each stripe as a line along it. */
function WireSwatch({ x, y, wire }: { x: number; y: number; wire: readonly WireLetter[] }) {
  const [base, ...stripes] = wire;
  const h = 8;
  return (
    <g>
      <rect x={x} y={y - h / 2} width={22} height={h} rx={2} fill={WIRE_HEX[base]} stroke="#5A5A68" strokeWidth={0.75} />
      {stripes.map((s, i) => {
        const sy = y - h / 2 + ((i + 1) * h) / (stripes.length + 1);
        return <line key={i} x1={x + 3} y1={sy} x2={x + 19} y2={sy} stroke={WIRE_HEX[s]} strokeWidth={stripes.length > 1 ? 1.5 : 2} />;
      })}
    </g>
  );
}

/**
 * A lever connector: every port on one bar, the bar being the node. Each port has its lever above
 * it; a port a wire lands in is outlined brighter than a spare one.
 */
function Lever({ end, label, on }: { end: ConnectorEnd; label: string; on: boolean }) {
  const g = LEVER[end];
  const xs = Array.from({ length: portsOf(end) }, (_, i) => port(end, i).x);
  const left = xs[0] - LEVER_PAD;
  const right = xs[xs.length - 1] + LEVER_PAD;
  const used = new Set(
    BENCH_WIRES.filter((w) => (w.from === end || w.to === end) && PORT_OF[w.id] !== undefined).map((w) => PORT_OF[w.id]),
  );
  return (
    <Dim on={on}>
      <rect x={left} y={g.y - 16} width={right - left} height={32} rx={6} fill="#101015" stroke="#2A2A33" />
      <line x1={left + 8} y1={g.y} x2={right - 8} y2={g.y} stroke={g.color} strokeWidth={2} opacity={0.55} />
      {xs.map((x, i) => (
        <g key={i}>
          <rect x={x - 8} y={g.y - 13} width={16} height={4} rx={1.5} fill="#2A2A33" />
          <rect x={x - 6} y={g.y - 6} width={12} height={12} rx={2} fill="#000000" stroke={used.has(i) ? '#5A5A68' : '#2A2A33'} />
        </g>
      ))}
      <text x={left} y={g.below ? g.y + 32 : g.y - 24} fill={g.color} fontSize={11} fontFamily="monospace">
        {label}
      </text>
    </Dim>
  );
}

/** The wire list beside the diagram. Clicking a row lights that wire; a cluster pin says UNVERIFIED. */
export function ClusterBenchLegend({
  selected,
  onSelect,
}: {
  selected: BenchWireId | null;
  onSelect: (id: BenchWireId | null) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {BENCH_WIRES.map((w) => {
        const active = selected === w.id;
        const unverified = !BENCH_PINOUT.verified && (w.from.startsWith('x11175') || w.to.startsWith('x11175'));
        return (
          <li key={w.id}>
            <button
              onClick={() => onSelect(active ? null : w.id)}
              className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left font-mono text-[10px]
                          transition-colors ${active ? 'bg-slate-800' : 'hover:bg-slate-800/60'}`}
            >
              <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: w.color }} />
              <span className="w-24 shrink-0 truncate text-slate-400">{endLabel(w.from)}</span>
              <span className="shrink-0 text-slate-600">&rarr;</span>
              <span className="truncate text-slate-300">{endLabel(w.to)}</span>
              {unverified && <span className="ml-auto shrink-0 text-amber-400">{CHROME.bench.unverified}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
