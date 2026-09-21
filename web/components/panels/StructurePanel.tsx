'use client';

/**
 * What this image contains, read out of the bytes.
 *
 * Every row is something observed in THIS dump - an identifier, a value stored
 * several times, a run of unwritten space. Nothing here is a map of the E46
 * KOMBI: four real chips were compared and no region was common to all of them,
 * so a fixed map would be invention. The one region named outright is the
 * secure area, whose meaning is established rather than guessed.
 */

import { useMemo } from 'react';
import { analyzeStructure, type Finding } from '@/lib/domain/structure';
import { formatAddress } from '@/lib/domain/image';
import { g } from '@/lib/copy/guide';

function label(f: Finding, c: ReturnType<typeof g>): { tag: string; tone: string; text: string } {
  switch (f.kind) {
    case 'secure':
      return { tag: c.structSecure, tone: 'text-blue-400', text: c.structSecureNote };
    case 'ascii':
      return {
        tag: f.vinShaped ? c.structIdVin : c.structId,
        tone: f.vinShaped ? 'text-emerald-400' : 'text-slate-300',
        text: `"${f.text}"`,
      };
    case 'repeat':
      return {
        tag: c.structRepeat,
        tone: 'text-indigo-400',
        text: c.structRepeatNote(f.hex, f.copies, f.stride),
      };
    case 'run':
      return {
        tag: f.value === 0xff ? c.structUnused : c.structZero,
        tone: 'text-slate-500',
        text: c.structRunNote(f.to - f.from + 1, f.value),
      };
  }
}

export function StructurePanel({
  image,
  onSelect,
}: {
  image: Uint8Array;
  onSelect: (address: number) => void;
}) {
  const c = g();
  const findings = useMemo(() => analyzeStructure(image), [image]);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
        {c.structTitle}
      </h3>
      <p className="text-[10px] leading-snug text-slate-500">{c.structNote}</p>

      <ul className="flex flex-col gap-0.5">
        {findings.map((f) => {
          const { tag, tone, text } = label(f, c);
          return (
            <li key={`${f.kind}-${f.from}`}>
              <button
                onClick={() => onSelect(f.from)}
                className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left
                           transition-colors hover:bg-slate-800/60"
              >
                <span className="shrink-0 font-mono text-[10px] text-slate-500">
                  {formatAddress(f.from)}–{formatAddress(f.to)}
                </span>
                <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider ${tone}`}>
                  {tag}
                </span>
                <span className="truncate font-mono text-[10px] text-slate-400">{text}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
