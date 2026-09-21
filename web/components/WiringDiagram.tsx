'use client';

/**
 * Breadboard pictorial of the bench wiring.
 *
 * The thing that makes a breadboard drawing useful is not the picture of the
 * board - it is showing WHICH HOLES ARE THE SAME NODE. Five holes in a column
 * are internally joined, and each power rail is joined along its length, so a
 * jumper does not have to land on the chip's own pin to reach it.
 *
 * Two things were measured rather than guessed, and both set the numbers below:
 *
 *   - the pane gives this component 790x708, and a 760x400 viewBox letterboxed
 *     309px of that away - 44% of the height - which is why everything read as
 *     cramped. The viewBox is now close to the container's aspect, so the same
 *     drawing renders ~1.7x larger with no layout change.
 *   - the chip body was #17171C against a #000000 channel: near-identical, so
 *     the chip read as part of the channel and its label looked like it was
 *     sitting on the gap. The body is lighter than the channel now.
 *
 * Pin names, colours and destinations all come from lib/domain/hardware.ts.
 */

import { M35080_PINS, PASSIVES, type ChipPin } from '@/lib/domain/hardware';
import { g } from '@/lib/copy/guide';

/* ---- geometry: one pitch, everything aligned to it ---- */
const VIEW_W = 760;
const VIEW_H = 660; // ~container aspect; see the note above
const PITCH = 26;
const X0 = 330; // centre of column 1
const COLS = 13; // only as many as the build uses

const RAIL_TOP_RED = 112;
const RAIL_TOP_BLUE = 138;
const RAIL_BOT_RED = 518;
const RAIL_BOT_BLUE = 544;

/** Top bank rows A..E; E sits against the channel. */
const ROW_TOP = [186, 212, 238, 264, 290];
/** Bottom bank rows F..J; F sits against the channel. */
const ROW_BOT = [350, 376, 402, 428, 454];
const CHANNEL_TOP = 300;
const CHANNEL_BOT = 340;

const colX = (c: number) => X0 + (c - 1) * PITCH;

/** The four columns the chip straddles. */
const CHIP_COLS = [4, 5, 6, 7];
/** Column -> chip pins. Notch left: 1..4 along the bottom, 8..5 along the top. */
const BOTTOM_PIN: Record<number, number> = { 4: 1, 5: 2, 6: 3, 7: 4 };
const TOP_PIN: Record<number, number> = { 4: 8, 5: 7, 6: 6, 7: 5 };

/** Beside the chip: a decoupling cap is only doing its job if it is close. */
const CAP_COL = 8;
const PULLUP_COL = 5; // pin 2 (S) lives here
const LINK_RED_COL = 12;
const LINK_BLUE_COL = 13;

/** Which hole each jumper lands in - never the chip's own hole. */
const LAND_TOP = ROW_TOP[1]; // row B
const LAND_BOT = ROW_BOT[2]; // row H

const UNO_X = 250;
const UNO_PIN_Y: Record<string, number> = {
  '5V': 190,
  GND: 230,
  D9: 300,
  D10: 340,
  D11: 380,
  D12: 420,
  D13: 460,
};

const RED = '#EF4444';
const BLUE = '#3B82F6';
const WIRE_GREY = '#9A9AA8';

export type WiringDiagramProps = {
  /** Datasheet pin names plus 'passives'. Null shows everything. */
  highlight?: string[] | null;
  onSelectPin?: (name: string) => void;
};

export function WiringDiagram({ highlight = null, onSelectPin }: WiringDiagramProps) {
  const c = g();
  const lit = (name: string) => highlight === null || highlight.includes(name);
  const powerLit = lit('VCC') || lit('VSS');
  const passivesLit = lit('passives');

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="M35080 breadboard wiring"
    >
      {/* ================= Arduino UNO ================= */}
      <rect x={40} y={150} width={210} height={330} rx={8} fill="#0A0A0D" stroke="#2A2A33" />
      <text x={145} y={176} textAnchor="middle" fill="#9A9AA8" fontSize={13} fontFamily="monospace">
        ARDUINO UNO
      </text>

      {/* USB: the UNO's actual power source, and the serial link. */}
      <g opacity={powerLit ? 1 : 0.35}>
        <rect x={12} y={200} width={30} height={26} rx={3} fill="#17171C" stroke={WIRE_GREY} />
        <line x1={0} y1={213} x2={12} y2={213} stroke={WIRE_GREY} strokeWidth={2.5} />
        <text x={27} y={248} textAnchor="middle" fill="#C6C6CF" fontSize={11} fontFamily="monospace">
          USB
        </text>
        <text x={27} y={262} textAnchor="middle" fill="#70707E" fontSize={10} fontFamily="monospace">
          PC
        </text>
      </g>
      <text x={145} y={468} textAnchor="middle" fill="#70707E" fontSize={10} fontFamily="monospace">
        {c.unoPoweredByUsbShort}
      </text>

      {/* header pins */}
      {Object.entries(UNO_PIN_Y).map(([label, y]) => {
        const pin = M35080_PINS.find((p) => p.uno === label);
        const on = label === '5V' || label === 'GND' ? powerLit : !pin || lit(pin.name);
        return (
          <g key={label} opacity={on ? 1 : 0.18}>
            <rect x={UNO_X - 40} y={y - 11} width={40} height={22} rx={3} fill="#17171C" stroke="#2A2A33" />
            <text x={UNO_X - 20} y={y + 5} textAnchor="middle" fill="#DFDFE6" fontSize={12} fontFamily="monospace">
              {label}
            </text>
          </g>
        );
      })}
      {/* 5V is an output, not something you feed */}
      <text x={UNO_X - 20} y={168} textAnchor="middle" fill={RED} fontSize={10} fontFamily="monospace">
        {c.outputLabel}
      </text>

      {/* ================= Breadboard ================= */}
      <rect x={296} y={80} width={420} height={496} rx={10} fill="#0A0A0D" stroke="#2A2A33" />

      {/* rails: one node along the whole length */}
      {[
        { y: RAIL_TOP_RED, color: RED },
        { y: RAIL_TOP_BLUE, color: BLUE },
        { y: RAIL_BOT_RED, color: RED },
        { y: RAIL_BOT_BLUE, color: BLUE },
      ].map((r, i) => (
        <g key={i} opacity={powerLit || passivesLit ? 1 : 0.28}>
          <line x1={312} y1={r.y} x2={700} y2={r.y} stroke={r.color} strokeWidth={2} opacity={0.55} />
          {Array.from({ length: COLS }, (_, k) => (
            <circle key={k} cx={colX(k + 1)} cy={r.y} r={2.2} fill="#2A2A33" />
          ))}
        </g>
      ))}

      {/* Column groups in use - tinted to say "these five holes are one node".
          ONLY the chip's own columns: the cap's legs go into the RAILS, not into
          a bank, so tinting its column would claim a connection that is not
          there. Kept lighter than the wires - the jumpers are the subject, this
          is only the board's own wiring showing through. */}
      {CHIP_COLS.map((col) =>
        [ROW_TOP, ROW_BOT].map((rows, bank) => {
          const pin = bank === 0 ? TOP_PIN[col] : BOTTOM_PIN[col];
          const name = M35080_PINS.find((p) => p.pin === pin)?.name;
          const on = name ? lit(name) : false;
          return (
            <rect
              key={`${col}-${bank}`}
              x={colX(col) - 10}
              y={rows[0] - 10}
              width={20}
              height={rows[4] - rows[0] + 20}
              rx={6}
              fill={on ? 'rgba(38,174,228,0.07)' : 'transparent'}
              stroke={on ? 'rgba(38,174,228,0.22)' : 'transparent'}
            />
          );
        }),
      )}

      {/* holes */}
      {Array.from({ length: COLS }, (_, k) => k + 1).map((col) =>
        [...ROW_TOP, ...ROW_BOT].map((y) => (
          <circle key={`${col}-${y}`} cx={colX(col)} cy={y} r={2.2} fill="#22222A" />
        )),
      )}

      {/* centre channel */}
      <rect x={312} y={CHANNEL_TOP} width={388} height={CHANNEL_BOT - CHANNEL_TOP} fill="#000000" stroke="#1A1A20" />

      {/* ================= Chip on its adapter ================= */}
      {/* Lighter than the channel on purpose - see the header note. */}
      <rect x={384} y={298} width={126} height={44} rx={4} fill="#101015" stroke="#2A2A33" />
      <rect x={392} y={306} width={110} height={28} rx={3} fill="#26262F" stroke="#5A5A68" />
      <path d={`M 392 312 a 7 7 0 0 0 0 16`} fill="#0A0A0D" stroke="#5A5A68" />
      <text x={449} y={325} textAnchor="middle" fill="#DFDFE6" fontSize={12} fontFamily="monospace">
        M35080
      </text>

      {/* chip legs into rows E and F, with the pin number beside each */}
      {CHIP_COLS.map((col) => {
        const top = M35080_PINS.find((p) => p.pin === TOP_PIN[col])!;
        const bot = M35080_PINS.find((p) => p.pin === BOTTOM_PIN[col])!;
        return (
          <g key={col}>
            <g opacity={lit(top.name) ? 1 : 0.18}>
              <line x1={colX(col)} y1={306} x2={colX(col)} y2={ROW_TOP[4]} stroke="#6A6A78" strokeWidth={2.5} />
              <text x={colX(col)} y={ROW_TOP[4] - 12} textAnchor="middle" fill="#C6C6CF" fontSize={11} fontFamily="monospace">
                {top.pin}
              </text>
            </g>
            <g opacity={lit(bot.name) ? 1 : 0.18}>
              <line x1={colX(col)} y1={334} x2={colX(col)} y2={ROW_BOT[0]} stroke="#6A6A78" strokeWidth={2.5} />
              <text x={colX(col)} y={ROW_BOT[0] + 20} textAnchor="middle" fill="#C6C6CF" fontSize={11} fontFamily="monospace">
                {bot.pin}
              </text>
            </g>
          </g>
        );
      })}

      {/* ================= Power ================= */}
      <g opacity={powerLit ? 1 : 0.14}>
        {/* UNO 5V -> top red rail */}
        <path
          d={`M ${UNO_X} ${UNO_PIN_Y['5V']} C 282 ${UNO_PIN_Y['5V']}, 282 ${RAIL_TOP_RED}, ${colX(1)} ${RAIL_TOP_RED}`}
          fill="none"
          stroke={RED}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={colX(1)} cy={RAIL_TOP_RED} r={4} fill={RED} />
        {/* UNO GND -> top blue rail */}
        <path
          d={`M ${UNO_X} ${UNO_PIN_Y.GND} C 288 ${UNO_PIN_Y.GND}, 288 ${RAIL_TOP_BLUE}, ${colX(2)} ${RAIL_TOP_BLUE}`}
          fill="none"
          stroke={BLUE}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={colX(2)} cy={RAIL_TOP_BLUE} r={4} fill={BLUE} />

        {/* bridge the top rails to the bottom ones so both banks have power */}
        <line x1={colX(LINK_RED_COL)} y1={RAIL_TOP_RED} x2={colX(LINK_RED_COL)} y2={RAIL_BOT_RED} stroke={RED} strokeWidth={2.5} />
        <circle cx={colX(LINK_RED_COL)} cy={RAIL_TOP_RED} r={4} fill={RED} />
        <circle cx={colX(LINK_RED_COL)} cy={RAIL_BOT_RED} r={4} fill={RED} />
        <line x1={colX(LINK_BLUE_COL)} y1={RAIL_TOP_BLUE} x2={colX(LINK_BLUE_COL)} y2={RAIL_BOT_BLUE} stroke={BLUE} strokeWidth={2.5} />
        <circle cx={colX(LINK_BLUE_COL)} cy={RAIL_TOP_BLUE} r={4} fill={BLUE} />
        <circle cx={colX(LINK_BLUE_COL)} cy={RAIL_BOT_BLUE} r={4} fill={BLUE} />
      </g>

      {/* pin 8 VCC column -> top red rail */}
      <RailWire
        on={lit('VCC')}
        x={colX(4)}
        fromY={LAND_TOP}
        toY={RAIL_TOP_RED}
        color={RED}
        onClick={() => onSelectPin?.('VCC')}
      />
      {/* pin 1 VSS column -> bottom blue rail */}
      <RailWire
        on={lit('VSS')}
        x={colX(4)}
        fromY={ROW_BOT[3]}
        toY={RAIL_BOT_BLUE}
        color={BLUE}
        onClick={() => onSelectPin?.('VSS')}
      />

      {/* ================= Passives, with real legs ================= */}
      <g opacity={passivesLit ? 1 : 0.14}>
        {/* 0.1uF between the two top rails, beside the chip */}
        <line x1={colX(CAP_COL)} y1={RAIL_TOP_RED} x2={colX(CAP_COL)} y2={RAIL_TOP_BLUE} stroke={WIRE_GREY} strokeWidth={2} />
        <rect x={colX(CAP_COL) - 10} y={117} width={20} height={16} rx={3} fill="#17171C" stroke={WIRE_GREY} />
        <circle cx={colX(CAP_COL)} cy={RAIL_TOP_RED} r={4} fill={WIRE_GREY} />
        <circle cx={colX(CAP_COL)} cy={RAIL_TOP_BLUE} r={4} fill={WIRE_GREY} />
        <text x={colX(CAP_COL) + 16} y={130} fill="#C6C6CF" fontSize={11} fontFamily="monospace">
          {PASSIVES[0].value}
        </text>

        {/* 10k from pin 2 (S)'s column down to the bottom red rail */}
        <line x1={colX(PULLUP_COL)} y1={ROW_BOT[4]} x2={colX(PULLUP_COL)} y2={RAIL_BOT_RED} stroke={WIRE_GREY} strokeWidth={2} />
        <rect x={colX(PULLUP_COL) - 7} y={476} width={14} height={20} rx={3} fill="#17171C" stroke={WIRE_GREY} />
        <circle cx={colX(PULLUP_COL)} cy={ROW_BOT[4]} r={4} fill={WIRE_GREY} />
        <circle cx={colX(PULLUP_COL)} cy={RAIL_BOT_RED} r={4} fill={WIRE_GREY} />
        <text x={colX(PULLUP_COL) + 14} y={492} fill="#C6C6CF" fontSize={11} fontFamily="monospace">
          {PASSIVES[1].value}
        </text>
      </g>

      {/* ================= Signal jumpers ================= */}
      {M35080_PINS.filter((p) => p.role === 'signal').map((p) => {
        const col = CHIP_COLS.find((x) => TOP_PIN[x] === p.pin || BOTTOM_PIN[x] === p.pin)!;
        const isTop = TOP_PIN[col] === p.pin;
        const y = isTop ? LAND_TOP : LAND_BOT;
        const fromY = UNO_PIN_Y[p.uno!];
        const on = lit(p.name);
        return (
          <g
            key={p.pin}
            opacity={on ? 1 : 0.12}
            onClick={() => onSelectPin?.(p.name)}
            style={{ cursor: onSelectPin ? 'pointer' : 'default' }}
          >
            <path
              d={`M ${UNO_X} ${fromY} C ${(UNO_X + colX(col)) / 2} ${fromY}, ${colX(col) - 60} ${y}, ${colX(col)} ${y}`}
              fill="none"
              stroke={p.color!}
              strokeWidth={on ? 3 : 2}
              strokeLinecap="round"
            />
            <circle cx={colX(col)} cy={y} r={4} fill={p.color!} />
          </g>
        );
      })}

      {/* pin 5 NC: labelled so nobody ties it high */}
      <text
        x={colX(7) + 22}
        y={ROW_TOP[4] - 12}
        fill="#70707E"
        fontSize={10}
        fontFamily="monospace"
        opacity={lit('NC') ? 0.85 : 0.14}
      >
        NC
      </text>

      {/* ================= How to read it ================= */}
      <text x={296} y={614} fill="#70707E" fontSize={11} fontFamily="monospace">
        {c.bbColumnNote}
      </text>
    </svg>
  );
}

/** A short jumper from a column group straight to a power rail. */
function RailWire({
  on,
  x,
  fromY,
  toY,
  color,
  onClick,
}: {
  on: boolean;
  x: number;
  fromY: number;
  toY: number;
  color: string;
  onClick?: () => void;
}) {
  return (
    <g opacity={on ? 1 : 0.14} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <line x1={x} y1={fromY} x2={x} y2={toY} stroke={color} strokeWidth={3} strokeLinecap="round" />
      <circle cx={x} cy={fromY} r={4} fill={color} />
      <circle cx={x} cy={toY} r={4} fill={color} />
    </g>
  );
}

/** The wire list beside the diagram. Clicking a row lights that wire. */
export function WiringLegend({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (name: string | null) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {M35080_PINS.map((p: ChipPin) => {
        const active = selected === p.name;
        return (
          <li key={p.pin}>
            <button
              onClick={() => onSelect(active ? null : p.name)}
              className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left font-mono text-[10px]
                          transition-colors ${active ? 'bg-slate-800' : 'hover:bg-slate-800/60'}`}
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: p.color ?? 'transparent',
                  outline: p.color ? 'none' : '1px solid #4C4C58',
                }}
              />
              <span className="w-6 shrink-0 text-slate-600">{p.pin}</span>
              <span className="w-10 shrink-0 text-slate-300">{p.name}</span>
              <span className="ml-auto text-slate-400">{p.uno ?? '—'}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
