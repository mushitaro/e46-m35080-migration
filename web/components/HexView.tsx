'use client';

/**
 * The 1 KB image as hex.
 *
 * No windowing here, deliberately: the whole record is 64 rows of 16 cells.
 * The shared-data-window rule exists for logs of thousands of rows where two
 * views must agree on an index; at this size one view renders everything and
 * there is nothing to disagree with.
 *
 * Colour is doing semantic work, not decoration:
 *   secure area  violet  - the increment-only counter
 *   VIN region   blue    - the field the tools care about
 *   changed      red     - differs from the reference image (pending or written)
 */

import { useMemo } from 'react';
import {
  hexRows,
  formatByte,
  formatAddress,
  asciiOf,
  regionOf,
  IMAGE_SIZE,
  BYTES_PER_ROW,
  type Region,
  type VinSpan,
} from '@/lib/domain/image';

const REGION_TINT: Record<Region, string> = {
  secure: 'rgba(155,132,232,0.16)', // M-violet: diagnostic / the counter
  vin: 'rgba(10,155,219,0.16)', // M-blue: the primary field
  standard: 'transparent',
};

const REGION_TEXT: Record<Region, string> = {
  secure: 'text-amber-200',
  vin: 'text-blue-200',
  standard: 'text-slate-400',
};

export type HexViewProps = {
  image: Uint8Array;
  /** Compared against to mark changed bytes. */
  reference?: Uint8Array | null;
  /** How to read a difference: pending = about to write, written = already sent. */
  changeMode?: 'pending' | 'written';
  selected?: number | null;
  /** Where the VIN fields were FOUND in this image - coded and/or ASCII. */
  vins?: readonly VinSpan[];
  onSelect?: (address: number) => void;
  /**
   * A text colour per byte that replaces the region's, for a view that knows more about the
   * bytes than their region (CODING's MAP: codable, protected, checksum). A changed byte keeps
   * the change colour whatever this says.
   */
  textFor?: (address: number) => string | null;
  /** Bytes to ring - the one parameter picked elsewhere - with the same pointer outline as `selected`. */
  ring?: ReadonlySet<number>;
};

export function HexView({
  image,
  reference,
  changeMode = 'pending',
  selected = null,
  onSelect,
  vins = [],
  textFor,
  ring,
}: HexViewProps) {
  const rows = useMemo(() => hexRows(image), [image]);
  const changed = useMemo(() => {
    if (!reference || reference.length !== image.length) return null;
    const set = new Set<number>();
    for (let i = 0; i < image.length; i++) if (image[i] !== reference[i]) set.add(i);
    return set;
  }, [image, reference]);

  const changeFill =
    changeMode === 'pending' ? 'rgba(10,155,219,0.38)' : 'rgba(241,26,34,0.34)';
  const changeText = changeMode === 'pending' ? 'text-blue-100' : 'text-red-100';

  return (
    <div className="h-full overflow-auto">
      <table className="border-separate border-spacing-0 font-mono text-[10px]">
        <thead>
          <tr>
            <th
              className="sticky left-0 top-0 z-20 bg-slate-950 px-2 py-1 text-left
                         text-[10px] uppercase tracking-wider text-slate-600"
            >
              addr
            </th>
            {Array.from({ length: BYTES_PER_ROW }, (_, i) => (
              <th
                key={i}
                className="sticky top-0 z-10 bg-slate-950 px-1 py-1 text-center
                           text-[10px] tracking-wider text-slate-600"
              >
                {i.toString(16).toUpperCase().padStart(2, '0')}
              </th>
            ))}
            <th
              className="sticky top-0 z-10 bg-slate-950 px-2 py-1 text-left
                         text-[10px] uppercase tracking-wider text-slate-600"
            >
              ascii
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.address} className="hover:bg-slate-900/60">
              <td
                className="sticky left-0 z-10 bg-slate-950 px-2 py-0.5 text-slate-600
                           tabular-nums"
              >
                {formatAddress(row.address)}
              </td>
              {Array.from(row.bytes).map((b, i) => {
                const address = row.address + i;
                const region = regionOf(address, vins);
                const isChanged = changed?.has(address) ?? false;
                const isSelected = selected === address || (ring?.has(address) ?? false);
                return (
                  <td
                    key={i}
                    onClick={() => onSelect?.(address)}
                    title={`0x${formatAddress(address)} · ${region}`}
                    className={`cursor-default px-1 py-0.5 text-center tabular-nums transition-colors
                      ${isChanged ? changeText : (textFor?.(address) ?? REGION_TEXT[region])}
                      ${isSelected ? 'outline outline-1 outline-slate-100' : ''}`}
                    style={{
                      background: isChanged ? changeFill : REGION_TINT[region],
                    }}
                  >
                    {formatByte(b)}
                  </td>
                );
              })}
              <td className="whitespace-pre px-2 py-0.5 text-slate-600">
                {Array.from(row.bytes, asciiOf).join('')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The legend. Says what the colours mean once, beside the thing they are about. */
export function HexLegend({
  changedCount,
  vins = [],
}: {
  changedCount: number | null;
  /** The fields found, so the legend names the same bytes it tints. */
  vins?: readonly VinSpan[];
}) {
  const hx = (a: number) => a.toString(16).toUpperCase().padStart(3, '0');
  return (
    <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-wider">
      <Swatch color="rgba(155,132,232,0.4)" label="secure 000-01F" />
      {/* Only when there IS one. This used to read "vin 2E8-2EF" always, which
          named an address that is not the VIN and advertised a colour that
          tinted nothing at all on a chip without one. */}
      {vins.map((v) => (
        <Swatch key={v.field} color="rgba(10,155,219,0.4)" label={`vin ${v.field} ${hx(v.from)}-${hx(v.to)}`} />
      ))}
      {changedCount !== null && changedCount > 0 && (
        <span className="text-blue-400">{changedCount} changed</span>
      )}
      <span className="ml-auto text-slate-600">{IMAGE_SIZE} bytes</span>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-500">
      <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
