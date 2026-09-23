'use client';

/**
 * The TEST bench, drawn: supply, fuse, switch, the three terminal blocks, the OBD socket and the
 * cluster plug.
 *
 * Every wire, end and pin comes from lib/domain/clusterBench.ts; this file only decides WHERE to
 * draw them. Two drawing decisions carry meaning:
 *
 *   - The OBD socket is its MATING FACE, J1962: pins 1-8 across the top, 9-16 across the bottom,
 *     the way the car's socket looks under the dash. That is the standard and not in question.
 *   - The cluster side is a LIST of the pins used, not a picture of the connector, because its
 *     physical layout has not been checked - and while BENCH_PINOUT.verified is false the list
 *     says UNVERIFIED. The rows are grouped by source (switched, permanent, ground, K-line) rather
 *     than by number, which is what lets the wires reach them with two crossings instead of eight.
 *
 * Wires are drawn square, with a dot only where a wire ends: a crossing without a dot is not a
 * connection.
 */

import type { ReactNode } from 'react';
import {
  BENCH_ELECTRICAL,
  BENCH_PINOUT,
  BENCH_WIRES,
  CLUSTER_PINS,
  endLabel,
  type BenchWire,
  type BenchWireId,
} from '@/lib/domain/clusterBench';
import { CHROME } from '@/lib/copy/chrome';
import { b } from '@/lib/copy/bench';

const VIEW_W = 760;
const VIEW_H = 650;

type P = { x: number; y: number };

/* ---- the supply side ---- */
const PSU = { x: 20, y: 40, w: 100, h: 130 };
const PSU_PLUS: P = { x: 120, y: 80 };
const PSU_MINUS: P = { x: 60, y: 170 };
const FUSED_BLOCK = { x: 190, y: 64, w: 190, h: 32 };
const SWITCHED_BLOCK = { x: 440, y: 64, w: 160, h: 32 };
const GROUND_BLOCK = { x: 20, y: 224, w: 230, h: 32 };

/* ---- the OBD socket: J1962 mating face ---- */
const OBD_TOP = 300;
const OBD_BOTTOM = 420;
const obdPin = (n: number): P =>
  n <= 8 ? { x: 50 + (n - 1) * 36, y: 335 } : { x: 68 + (n - 9) * 32, y: 385 };

/* ---- the cluster plug: a list, grouped by source ---- */
const CLUSTER = { x: 470, y: 300, w: 270, h: 300 };
const CLUSTER_ROWS = [5, 6, 4, 1, 25];
const clusterPin = (n: number): P => ({ x: CLUSTER.x, y: 390 + CLUSTER_ROWS.indexOf(n) * 45 });

const KDCAN = { x: 40, y: 450, w: 260, h: 42 };
const PC = { x: 120, y: 556, w: 100, h: 36 };

/**
 * Each wire's route, as the corners it turns. First point is where it leaves, last where it lands.
 * The channels at x 422-462 run beside the cluster plug; a deeper row takes an outer channel.
 */
const ROUTES: Record<BenchWireId, P[]> = {
  feed: [PSU_PLUS, { x: 205, y: 80 }],
  'ground-lead': [PSU_MINUS, { x: 60, y: 240 }],
  switch: [{ x: 355, y: 80 }, { x: 455, y: 80 }],
  kl15: [{ x: 565, y: 80 }, { x: 565, y: 160 }, { x: 462, y: 160 }, { x: 462, y: clusterPin(5).y }, clusterPin(5)],
  klr: [{ x: 510, y: 80 }, { x: 510, y: 145 }, { x: 452, y: 145 }, { x: 452, y: clusterPin(6).y }, clusterPin(6)],
  kl30: [{ x: 305, y: 80 }, { x: 305, y: 130 }, { x: 442, y: 130 }, { x: 442, y: clusterPin(4).y }, clusterPin(4)],
  'cluster-gnd': [{ x: 236, y: 240 }, { x: 236, y: 290 }, { x: 432, y: 290 }, { x: 432, y: clusterPin(1).y }, clusterPin(1)],
  'obd-16': [{ x: 255, y: 80 }, { x: 255, y: 270 }, { x: 345, y: 270 }, { x: 345, y: obdPin(16).y }, obdPin(16)],
  'obd-4': [{ x: obdPin(4).x, y: 240 }, obdPin(4)],
  'obd-5': [{ x: obdPin(5).x, y: 240 }, obdPin(5)],
  'k-line': [obdPin(7), { x: obdPin(7).x, y: 312 }, { x: 422, y: 312 }, { x: 422, y: clusterPin(25).y }, clusterPin(25)],
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

const RED = '#EF4444';
const BLUE = '#3B82F6';
const ORANGE = '#F97316';
const INK = '#9A9AA8';
const UNVERIFIED_INK = '#B9A6EE';

export type ClusterBenchDiagramProps = {
  /** Wires to light; null lights everything. */
  highlight?: readonly BenchWireId[] | null;
  onSelectWire?: (id: BenchWireId) => void;
};

export function ClusterBenchDiagram({ highlight = null, onSelectWire }: ClusterBenchDiagramProps) {
  const c = b();
  const lit = (id: BenchWireId) => highlight === null || highlight.includes(id);
  /** A block or connector is lit when any wire at it is. */
  const anyLit = (pred: (w: BenchWire) => boolean) => BENCH_WIRES.some((w) => pred(w) && lit(w.id));
  const touches = (w: BenchWire, prefix: string) => w.from.startsWith(prefix) || w.to.startsWith(prefix);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Cluster bench wiring"
    >
      {/* ================= supply ================= */}
      <Dim on={anyLit((w) => touches(w, 'psu'))}>
        <rect x={PSU.x} y={PSU.y} width={PSU.w} height={PSU.h} rx={8} fill="#0A0A0D" stroke="#2A2A33" />
        <text x={PSU.x + PSU.w / 2} y={PSU.y + 30} textAnchor="middle" fill="#C6C6CF" fontSize={12} fontFamily="monospace">
          {CHROME.bench.psu}
        </text>
        <text x={PSU.x + PSU.w / 2} y={PSU.y + 48} textAnchor="middle" fill="#70707E" fontSize={10} fontFamily="monospace">
          {`≥ ${BENCH_ELECTRICAL.supplyMinAmps} A`}
        </text>
        <text x={PSU_PLUS.x - 14} y={PSU_PLUS.y + 4} textAnchor="middle" fill={RED} fontSize={13} fontFamily="monospace">
          +
        </text>
        <text x={PSU_MINUS.x} y={PSU_MINUS.y - 12} textAnchor="middle" fill={BLUE} fontSize={13} fontFamily="monospace">
          −
        </text>
      </Dim>

      {/* ================= terminal blocks: one node along each ================= */}
      <Block box={FUSED_BLOCK} color={RED} label={endLabel('fused')} on={anyLit((w) => touches(w, 'fused'))} />
      <Block box={SWITCHED_BLOCK} color={ORANGE} label={endLabel('switched')} on={anyLit((w) => touches(w, 'switched'))} />
      <Block box={GROUND_BLOCK} color={BLUE} label={endLabel('ground')} on={anyLit((w) => touches(w, 'ground'))} below />

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
              <circle cx={p.x} cy={p.y} r={10} fill={used ? '#26262F' : '#17171C'} stroke={used ? '#5A5A68' : '#2A2A33'} />
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
      <Dim on={anyLit((w) => touches(w, 'x11175'))}>
        <rect x={CLUSTER.x} y={CLUSTER.y} width={CLUSTER.w} height={CLUSTER.h} rx={8} fill="#0A0A0D" stroke="#2A2A33" />
        <text x={CLUSTER.x + 16} y={CLUSTER.y + 24} fill="#C6C6CF" fontSize={12} fontFamily="monospace">
          {CHROME.bench.cluster}
        </text>
        {!BENCH_PINOUT.verified && (
          <text x={CLUSTER.x + 16} y={CLUSTER.y + 42} fill={UNVERIFIED_INK} fontSize={10} fontFamily="monospace">
            {`${CHROME.bench.unverified} · ${BENCH_PINOUT.source}`}
          </text>
        )}
        {CLUSTER_ROWS.map((n) => {
          const p = clusterPin(n);
          const signal = CLUSTER_PINS.find((x) => x.pin === n)?.signal ?? '';
          return (
            <g key={n}>
              <text x={CLUSTER.x + 30} y={p.y + 4} fill="#DFDFE6" fontSize={13} fontFamily="monospace">
                {n}
              </text>
              <text x={CLUSTER.x + 70} y={p.y + 4} fill="#9A9AA8" fontSize={12} fontFamily="monospace">
                {signal}
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

      {/* The fuse sits in the feed; the switch in the lead between the two blocks. */}
      <Dim on={lit('feed')}>
        <rect x={140} y={72} width={44} height={16} rx={3} fill="#17171C" stroke={RED} />
        <text x={162} y={64} textAnchor="middle" fill="#C6C6CF" fontSize={11} fontFamily="monospace">
          {CHROME.bench.fuse}
        </text>
      </Dim>
      <Dim on={lit('switch')}>
        <rect x={384} y={70} width={44} height={20} rx={3} fill="#000000" />
        <circle cx={390} cy={80} r={3} fill={RED} />
        <circle cx={422} cy={80} r={3} fill={ORANGE} />
        <line x1={390} y1={80} x2={419} y2={68} stroke="#DFDFE6" strokeWidth={2.5} strokeLinecap="round" />
        <text x={406} y={60} textAnchor="middle" fill="#C6C6CF" fontSize={11} fontFamily="monospace">
          {CHROME.bench.toggle}
        </text>
      </Dim>

      {/* ================= how to read it ================= */}
      <text x={20} y={622} fill="#70707E" fontSize={11} fontFamily="monospace">
        {c.obdFace}
      </text>
      <text x={20} y={640} fill="#70707E" fontSize={11} fontFamily="monospace">
        {c.clusterList}
      </text>
    </svg>
  );
}

function Dim({ on, children }: { on: boolean; children: ReactNode }) {
  return <g opacity={on ? 1 : 0.3}>{children}</g>;
}

/** A terminal block: a bar that is one node along its length, labelled with its end name. */
function Block({
  box,
  color,
  label,
  on,
  below = false,
}: {
  box: { x: number; y: number; w: number; h: number };
  color: string;
  label: string;
  on: boolean;
  below?: boolean;
}) {
  return (
    <Dim on={on}>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={5} fill="#101015" stroke="#2A2A33" />
      <line x1={box.x + 8} y1={box.y + box.h / 2} x2={box.x + box.w - 8} y2={box.y + box.h / 2} stroke={color} strokeWidth={2} opacity={0.55} />
      <text
        x={box.x}
        y={below ? box.y + box.h + 16 : box.y - 8}
        fill={color}
        fontSize={11}
        fontFamily="monospace"
      >
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
