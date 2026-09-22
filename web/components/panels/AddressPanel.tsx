'use client';

/**
 * Which address holds which number.
 *
 * Only two things in this 1 KB can be stated exactly, and this panel states
 * both with their addresses and their arithmetic visible, so the reader can
 * check the tool rather than trust it.
 *
 * The third section is the honest one: most of the chip is not identified, and
 * saying so is more useful than a plausible-looking map. A guessed label here
 * is how 0x2E8 spent weeks being called "the VIN".
 */

import { useMemo } from 'react';
import {
  odometerArithmetic,
  odometerSlots,
  type OdoSlot,
} from '@/lib/domain/addressMap';
import { readVin } from '@/lib/domain/vin';
import { g } from '@/lib/copy/guide';
import { CHROME } from '@/lib/copy/chrome';

const addr = (a: number) => a.toString(16).toUpperCase().padStart(3, '0');
const u16 = (v: number) => v.toString(16).toUpperCase().padStart(4, '0');

function roleTone(role: OdoSlot['role']): string {
  return role === 'bumped'
    ? 'text-emerald-400'
    : role === 'base'
      ? 'text-slate-300'
      : 'text-amber-400';
}

export function AddressPanel({
  image,
  onSelect,
}: {
  image: Uint8Array;
  onSelect: (address: number) => void;
}) {
  const c = g();
  const slots = useMemo(() => odometerSlots(image), [image]);
  const math = useMemo(() => odometerArithmetic(image), [image]);
  const vin = useMemo(() => readVin(image), [image]);

  return (
    <div className="flex flex-col gap-4">
      {/* ---------------------------- odometer ---------------------------- */}
      <section className="flex flex-col gap-1.5">
        <h3 className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
          {CHROME.map.odometer}
        </h3>
        <p className="text-[10px] leading-snug text-slate-500">{c.mapOdoNote}</p>

        {math.ok ? (
          <p className="rounded border border-slate-800 bg-slate-900/40 px-2.5 py-1.5
                        font-mono text-[11px] text-slate-200">
            {math.expression} km
          </p>
        ) : (
          <p className="text-[10px] text-amber-400">{c.mapOdoUndecodable(math.reason)}</p>
        )}

        <ul className="grid grid-cols-2 gap-x-3">
          {slots.map((s) => (
            <li key={s.index}>
              <button
                onClick={() => onSelect(s.from)}
                className="flex w-full items-baseline gap-2 border-b border-slate-900 py-0.5
                           text-left font-mono text-[10px] hover:bg-slate-900/50"
              >
                <span className="text-slate-600">
                  {addr(s.from)}-{addr(s.to)}
                </span>
                <span className={roleTone(s.role)}>{u16(s.value)}</span>
                <span className="ml-auto text-[9px] text-slate-600">
                  {s.role === 'bumped' ? CHROME.map.bumped : s.role === 'base' ? CHROME.map.base : '?'}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {math.ok && (
          <p className="text-[10px] leading-snug text-slate-600">
            {c.mapOdoLegend(math.base, math.bumped)}
          </p>
        )}
      </section>

      {/* ------------------------------- VIN ------------------------------ */}
      <section className="flex flex-col gap-1.5">
        <h3 className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
          {CHROME.map.vin}
        </h3>
        {vin.found === null ? (
          <p className="text-[10px] leading-snug text-slate-500">{c.mapVinNone}</p>
        ) : (
          <>
            <button
              onClick={() => onSelect(vin.found!.offset)}
              className="flex items-baseline gap-2 rounded border border-slate-800
                         bg-slate-900/40 px-2.5 py-1.5 text-left hover:bg-slate-900"
            >
              <span className="font-mono text-[10px] text-slate-600">
                {addr(vin.found.offset)}-{addr(vin.found.offset + vin.found.bytes.length - 1)}
              </span>
              <span className="font-mono text-[11px] font-bold tracking-wider text-blue-300">
                {vin.found.text}
              </span>
              <span className="ml-auto font-mono text-[9px] text-slate-600">
                {vin.found.bytes.length} B ASCII
              </span>
            </button>
            {vin.candidates.length > 1 && (
              <p className="font-mono text-[9px] text-amber-500">
                {c.mapVinOthers(
                  vin.candidates.slice(1).map((x) => `${addr(x.offset)} "${x.text}"`),
                )}
              </p>
            )}
          </>
        )}
        <p className="text-[10px] leading-snug text-slate-600">{c.mapVinNote}</p>
      </section>

      {/* --------------------------- the rest ----------------------------- */}
      <section className="flex flex-col gap-1.5">
        <h3 className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
          {CHROME.map.rest}
        </h3>
        <p className="text-[10px] leading-snug text-slate-500">{c.mapRestNote}</p>
      </section>
    </div>
  );
}
