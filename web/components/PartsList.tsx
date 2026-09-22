'use client';

/**
 * The bill of materials, with links.
 *
 * AliExpress has no public add-to-cart API - the documented endpoint is dead and
 * the undocumented one is single-item and login-walled - so "add the selected
 * items" is honestly implemented as "open the selected items, one at a time".
 * Affiliate attribution is set by the click itself, so a reader adding each to
 * their own cart loses nothing.
 *
 * One at a time is also what survives a popup blocker: every window.open()
 * happens inside its own click, never in a loop.
 *
 * Disclosure sits directly above the list, in the first view. Japan's
 * stealth-marketing rule treats a site-wide notice at the top of the page as
 * insufficient, and a footer is worse.
 */

import { useMemo, useState } from 'react';
import { ExternalLink, Megaphone } from 'lucide-react';
import { resolvedParts, priceFetchedAt, relFor, type ResolvedPart } from '@/lib/domain/partsData';
import { g, partName, partNote } from '@/lib/copy/guide';
import { CHROME } from '@/lib/copy/chrome';

export function PartsList() {
  const c = g();
  const parts = useMemo(() => resolvedParts(), []);
  // Required parts start ticked: that is the honest default for a BOM.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(parts.filter((p) => p.required).map((p) => p.id)),
  );
  /** How many of the current queue have been opened. Resets when the pick changes. */
  const [opened, setOpened] = useState(0);

  const queue = useMemo(() => parts.filter((p) => selected.has(p.id)), [parts, selected]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setOpened(0);
  };

  const openNext = () => {
    const part = queue[opened];
    if (!part) return;
    // Inside the click handler, one window per gesture - never a loop.
    window.open(part.href, '_blank', 'noopener,noreferrer');
    setOpened((n) => n + 1);
  };

  const remaining = queue.length - opened;

  return (
    <div className="flex flex-col gap-3">
      {/* Disclosure. First view, directly above the list it describes. */}
      <div className="flex items-start gap-2 rounded bg-slate-900 px-2.5 py-2">
        <Megaphone className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
        <p className="text-[10px] leading-snug text-slate-400">{c.adDisclosure}</p>
      </div>

      <div className="flex items-center gap-3">
        <h3 className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
          {CHROME.parts.title}
        </h3>
        <button
          onClick={() => {
            setSelected(new Set(parts.map((p) => p.id)));
            setOpened(0);
          }}
          className="text-[9px] font-bold uppercase tracking-widest text-blue-400 transition-colors hover:text-blue-300"
        >
          {CHROME.parts.selectAll}
        </button>
        <button
          onClick={() => {
            setSelected(new Set());
            setOpened(0);
          }}
          className="text-[9px] font-bold uppercase tracking-widest text-slate-600 transition-colors hover:text-slate-400"
        >
          {CHROME.parts.clear}
        </button>
      </div>

      <ul className="space-y-0.5">
        {parts.map((p) => (
          <PartRow key={p.id} part={p} checked={selected.has(p.id)} onToggle={() => toggle(p.id)} />
        ))}
      </ul>

      {/* Open control. Reserved height so the row does not appear and shift the list. */}
      <div className="flex min-h-[46px] flex-col justify-center gap-1">
        <button
          onClick={openNext}
          disabled={remaining <= 0}
          className="inline-flex items-center justify-center gap-1.5 rounded bg-blue-600 px-3 py-1.5
                     text-[10px] font-bold uppercase tracking-widest text-white transition-colors
                     hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600"
        >
          <ExternalLink className="h-3 w-3" />
          {queue.length === 0
            ? c.partsNoneSelected
            : remaining <= 0
              ? c.partsOpenDone
              : opened === 0
                ? c.partsOpen(queue.length)
                : c.partsOpenNext(opened + 1, queue.length)}
        </button>
        <p className="text-[9px] leading-snug text-slate-600">{c.partsCartNote}</p>
      </div>

      <p className="font-mono text-[9px] text-slate-600">
        {priceFetchedAt ? c.partsPriceAsOf(priceFetchedAt) : c.partsNoPrice}
      </p>
    </div>
  );
}

function PartRow({
  part,
  checked,
  onToggle,
}: {
  part: ResolvedPart;
  checked: boolean;
  onToggle: () => void;
}) {
  const c = g();
  const note = partNote(part.note);
  return (
    <li className="flex items-start gap-2 rounded px-1.5 py-1 hover:bg-slate-800/50">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1 h-3 w-3 shrink-0 accent-blue-500"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[11px] text-slate-300">{partName(part.id)}</span>
          <span
            className={`shrink-0 text-[8px] font-bold uppercase tracking-widest ${
              part.required ? 'text-blue-400' : 'text-slate-600'
            }`}
          >
            {part.required ? CHROME.parts.required : CHROME.parts.optional}
          </span>
          {part.qty > 1 && (
            <span className="shrink-0 font-mono text-[9px] text-slate-500">x{part.qty}</span>
          )}
        </div>
        {note && <p className="text-[9px] leading-snug text-amber-400">{note}</p>}
        {!part.productId && (
          <p className="font-mono text-[9px] text-slate-600">{c.partsSearchFallback}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {part.price && (
          <span className="font-mono text-[10px] text-slate-400">
            {part.currency === 'JPY' ? '¥' : ''}
            {Number(part.price).toLocaleString()}
          </span>
        )}
        <a
          href={part.href}
          target="_blank"
          rel={relFor(part.href)}
          className="text-slate-600 transition-colors hover:text-blue-400"
          title={part.searchQuery}
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </li>
  );
}
