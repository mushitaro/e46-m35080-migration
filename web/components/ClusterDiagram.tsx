'use client';

/**
 * What TEST has told the cluster to show: the five needles and the lamp and output bits.
 *
 * COMMANDED, not read back. The cluster does not report where its needles are; this drawing is
 * the other half of the reader's own eyes - it says what should be on the cluster now, so that
 * SEEN / NOT SEEN compares the two. It says so in its caption, and a needle the cluster holds for
 * itself (before the first command, and after STOP) is drawn dashed at rest and labelled CLUSTER
 * rather than drawn where it probably is.
 *
 * Lamp and output bits are named `B2.b5` / `P6.b0` here; their names are reference data.
 */

import { CHROME } from '@/lib/copy/chrome';
import { tc } from '@/lib/copy/test';
import { GAUGES, LAMP_MASKS, NEEDLE_MAX_DEG, NEEDLE_MIN_DEG, OUTPUT_PORT_MASK, type KombiVariant } from '@/lib/kombi/protocol';
import { lampKey, outputKey } from '@/lib/kombi/checks';
import type { Commanded, Stepping } from '@/lib/hooks/useKombiLink';

const VIEW_W = 760;
const VIEW_H = 560;

const LIT = '#26AEE4';
const ASKED = '#B9A6EE';
const DIM = '#2A2A33';

/** 10-90 degrees of command onto a 240-degree dial, 10 at the lower left. */
function dialAngle(deg: number): number {
  const t = (deg - NEEDLE_MIN_DEG) / (NEEDLE_MAX_DEG - NEEDLE_MIN_DEG);
  return (210 - t * 240) * (Math.PI / 180);
}

export function ClusterDiagram({
  variant,
  commanded,
  stepping,
}: {
  variant: KombiVariant | null;
  commanded: Commanded;
  stepping: Stepping;
}) {
  const asked = stepping ? stepping.keys[stepping.index] : null;
  const masks = LAMP_MASKS[variant ?? 'KOMBI46'];

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Commanded cluster outputs">
      <text x={20} y={30} fill="#B9A6EE" fontSize={12} fontFamily="monospace">
        {CHROME.test.commanded}
      </text>
      <text x={130} y={30} fill="#70707E" fontSize={11} fontFamily="monospace">
        {tc().commanded}
      </text>

      {/* ---- needles ---- */}
      {GAUGES.map((g, i) => {
        const cx = 80 + i * 150;
        const cy = 140;
        const r = 58;
        const deg = commanded.needles[g.id];
        const held = deg === undefined;
        const a = dialAngle(held ? NEEDLE_MIN_DEG : deg);
        const arc = (d: number) => ({ x: cx + r * Math.cos(dialAngle(d)), y: cy - r * Math.sin(dialAngle(d)) });
        const from = arc(NEEDLE_MIN_DEG);
        const to = arc(NEEDLE_MAX_DEG);
        return (
          <g key={g.id}>
            <path d={`M ${from.x} ${from.y} A ${r} ${r} 0 1 1 ${to.x} ${to.y}`} fill="none" stroke={DIM} strokeWidth={4} strokeLinecap="round" />
            {[10, 30, 50, 70, 90].map((d) => {
              const p = arc(d);
              return <circle key={d} cx={p.x} cy={p.y} r={2} fill="#4C4C58" />;
            })}
            <line
              x1={cx}
              y1={cy}
              x2={cx + (r - 8) * Math.cos(a)}
              y2={cy - (r - 8) * Math.sin(a)}
              stroke={held ? '#4C4C58' : LIT}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={held ? '4 4' : undefined}
            />
            <circle cx={cx} cy={cy} r={5} fill={held ? '#4C4C58' : LIT} />
            <text x={cx} y={cy + 44} textAnchor="middle" fill="#C6C6CF" fontSize={11} fontFamily="monospace">
              {CHROME.test.gauge[g.id]}
            </text>
            <text x={cx} y={cy + 60} textAnchor="middle" fill={held ? '#70707E' : LIT} fontSize={11} fontFamily="monospace">
              {held ? CHROME.test.cluster : `${deg}°`}
            </text>
          </g>
        );
      })}

      {/* ---- lamp bits ---- */}
      <text x={20} y={262} fill="#9A9AA8" fontSize={11} fontFamily="monospace">
        {`${CHROME.test.name.lamps}${variant ? ` · ${variant}` : ''}`}
      </text>
      {Array.from({ length: 8 }, (_, bit) => (
        <text key={bit} x={110 + bit * 44} y={284} textAnchor="middle" fill="#70707E" fontSize={10} fontFamily="monospace">
          {`b${bit}`}
        </text>
      ))}
      {masks.map((mask, i) => {
        const byte = i + 1;
        const y = 306 + i * 30;
        return (
          <g key={byte}>
            <text x={40} y={y + 4} fill="#9A9AA8" fontSize={11} fontFamily="monospace">
              {`B${byte}`}
            </text>
            {Array.from({ length: 8 }, (_, bit) => {
              const exists = (mask >> bit) & 1;
              const on = ((commanded.lamps?.[i] ?? 0) >> bit) & 1;
              const isAsked = asked === lampKey(byte, bit);
              const x = 110 + bit * 44;
              if (!exists) return <circle key={bit} cx={x} cy={y} r={2} fill="#2A2A33" />;
              return (
                <g key={bit}>
                  {isAsked && <circle cx={x} cy={y} r={13} fill="none" stroke={ASKED} strokeWidth={1.5} />}
                  <circle cx={x} cy={y} r={8} fill={on ? LIT : '#17171C'} stroke={on ? LIT : '#4C4C58'} />
                </g>
              );
            })}
          </g>
        );
      })}

      {/* ---- output port (KOMBI46 only) ---- */}
      {variant === 'KOMBI46' && (
        <g>
          <text x={500} y={262} fill="#9A9AA8" fontSize={11} fontFamily="monospace">
            {CHROME.test.name.outputs}
          </text>
          {Array.from({ length: 4 }, (_, bit) => bit)
            .filter((bit) => (OUTPUT_PORT_MASK >> bit) & 1)
            .map((bit) => {
              const x = 540 + bit * 50;
              const on = ((commanded.outputs ?? 0) >> bit) & 1;
              const isAsked = asked === outputKey(bit);
              return (
                <g key={bit}>
                  <text x={x} y={284} textAnchor="middle" fill="#70707E" fontSize={10} fontFamily="monospace">
                    {`b${bit}`}
                  </text>
                  {isAsked && <circle cx={x} cy={306} r={13} fill="none" stroke={ASKED} strokeWidth={1.5} />}
                  <circle cx={x} cy={306} r={8} fill={on ? LIT : '#17171C'} stroke={on ? LIT : '#4C4C58'} />
                </g>
              );
            })}
        </g>
      )}
    </svg>
  );
}
