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
import { readVin } from '@/lib/domain/vin';
import { formatAddress } from '@/lib/domain/image';
import { g } from '@/lib/copy/guide';
import { CHROME } from '@/lib/copy/chrome';
import { MicroLabel } from '@/components/ui';

function label(f: Finding, c: ReturnType<typeof g>): { tag: string; tone: string; text: string } {
  switch (f.kind) {
    case 'secure':
      return { tag: CHROME.structure.secure, tone: 'text-blue-400', text: c.structSecureNote };
    case 'ascii':
      return {
        tag: f.vinShaped ? CHROME.structure.idVin : CHROME.structure.id,
        tone: f.vinShaped ? 'text-emerald-400' : 'text-slate-300',
        text: `"${f.text}"`,
      };
    case 'repeat':
      return {
        tag: CHROME.structure.redundant,
        tone: 'text-indigo-400',
        text: c.structRepeatNote(f.hex, f.copies, f.stride),
      };
    case 'run':
      return {
        tag: f.value === 0xff ? CHROME.structure.unused : CHROME.structure.zero,
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
  /* A run can carry bytes in front of the VIN that are not part of it (0x183
     on the V6). The run is reported as found; the part that is not the VIN is
     dimmed, so this list and the address view say the same thing. */
  const vin = useMemo(() => readVin(image).found, [image]);

  return (
    <div className="flex flex-col gap-2">
      <MicroLabel as="h3">
        {CHROME.structure.title}
      </MicroLabel>
      <p className="text-[10px] leading-snug text-slate-500">{c.structNote}</p>

      <ul className="flex flex-col gap-0.5">
        {findings.map((f) => {
          const { tag, tone, text } = label(f, c);
          const lead =
            f.kind === 'ascii' && vin?.lead && vin.lead.offset === f.from ? vin.lead.text : null;
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
                <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider ${tone}`}>
                  {tag}
                </span>
                <span className="truncate font-mono text-[10px] text-slate-400">
                  {lead && f.kind === 'ascii' ? (
                    <>
                      &quot;<span className="text-slate-600">{lead}</span>
                      {f.text.slice(lead.length)}&quot;
                    </>
                  ) : (
                    text
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
