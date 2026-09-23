'use client';

/**
 * REWRITE's CODING list, the way NCS Dummy shows a module's coding: one row per function (FSW), in
 * the order the definition lists them, with the option (PSW) it is set to and the option it will
 * be set to - names in the reader's language, the keywords beside them.
 *
 * The bytes are not the reader's question here, so they are not in the list: where a function
 * lives (address, mask) and its raw value are in the side panel's detail of the row picked.
 * A function that cannot be changed says why in a word where the choice would be; the full reason
 * is in the detail. The direct values (the VIN field, indexes, dates) follow the functions, read
 * only, as NCS Dummy keeps them apart from the switchable functions.
 */

import { useMemo, useState } from 'react';
import { FileCode2 } from 'lucide-react';

import { DataList, EmptyState, LABEL, MicroLabel, pillClass } from '@/components/ui';
import { CHROME } from '@/lib/copy/chrome';
import { cc } from '@/lib/copy/coding';
import type { ParamRow, RowStatus } from '@/lib/ncs/decode';
import { LIST_FILTERS, formatBytes, formatValue, inFilter, listOrder, matches, optionName, paramName, type ListFilter, type Staged } from '@/lib/ncs/view';
import type { CodingDoc } from '@/lib/refdata/types';

type Lang = 'ja' | 'en';

/** The status word's colour: a verdict (tsunagi-m-design 1.5). Used by the detail panel. */
export const STATUS_TONE: Record<RowStatus, string> = {
  codable: 'text-blue-400',
  protected: 'text-red-400',
  value: 'text-slate-500',
  unknown: 'text-amber-400',
};

/** Function | current option | new option, from 640px up; stacked below it. */
const COLUMNS = 'min-[640px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]';

export function CodingTable({
  doc,
  rows,
  lang,
  staged,
  changed,
  differing,
  selected,
  onSelect,
  onPick,
}: {
  doc: CodingDoc;
  rows: readonly ParamRow[];
  lang: Lang;
  staged: Staged;
  /** Rows whose pick differs from the source. */
  changed: ReadonlySet<number>;
  /** Rows a dump and the chip hold differently, or null when there is no dump to compare. */
  differing: ReadonlySet<number> | null;
  selected: number | null;
  onSelect: (index: number) => void;
  /** Stage a value for a row; null takes the pick back. */
  onPick: (index: number, option: number | null) => void;
}) {
  const [filter, setFilter] = useState<ListFilter>('all');
  const [query, setQuery] = useState('');

  const ordered = useMemo(() => listOrder(rows), [rows]);
  const counts = useMemo(() => {
    const out = {} as Record<ListFilter, number>;
    for (const f of LIST_FILTERS) out[f] = ordered.functions.filter((r) => inFilter(r, f, changed, differing)).length;
    return out;
  }, [ordered, changed, differing]);

  // The definition's own order - the order NCS Expert and NCS Dummy list a module's functions in.
  const functions = ordered.functions.filter((r) => inFilter(r, filter, changed, differing) && matches(doc, r, query));
  const values = filter === 'all' ? ordered.values.filter((r) => matches(doc, r, query)) : [];

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={CHROME.coding.search}
          aria-label={CHROME.coding.search}
          className="min-w-0 flex-1 rounded bg-slate-800 px-2 py-1 font-mono text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:ring-1 focus:ring-blue-500/60"
        />
      </div>
      <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto">
        {LIST_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            disabled={f === 'diff' && differing === null}
            className={`${pillClass(filter === f ? 'primary' : 'neutral')} whitespace-nowrap transition-colors disabled:opacity-40`}
          >
            {CHROME.coding.filter[f]} <span className="font-mono tabular-nums">{f === 'diff' && differing === null ? '—' : counts[f]}</span>
          </button>
        ))}
      </div>

      {/* The column heads, where there are columns. */}
      <div className={`hidden shrink-0 gap-3 px-2 min-[640px]:grid ${COLUMNS}`}>
        <span className={`${LABEL} text-slate-600`}>{CHROME.coding.function}</span>
        <span className={`${LABEL} text-slate-600`}>{CHROME.coding.current}</span>
        <span className={`${LABEL} text-slate-600`}>{CHROME.coding.next}</span>
      </div>

      {functions.length === 0 && values.length === 0 ? (
        <EmptyState Icon={FileCode2} label={CHROME.coding.noRows} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DataList label={CHROME.coding.function}>
            {functions.map((r) => (
              <Row
                key={r.index}
                doc={doc}
                row={r}
                lang={lang}
                staged={staged.get(r.index) ?? null}
                changed={changed.has(r.index)}
                differs={differing?.has(r.index) ?? false}
                selected={selected === r.index}
                onSelect={() => onSelect(r.index)}
                onPick={(o) => onPick(r.index, o)}
              />
            ))}
          </DataList>
          {values.length > 0 && (
            <div className="mt-4 flex flex-col gap-1 pb-4">
              <MicroLabel as="h3" className="px-2">
                {CHROME.coding.values}
              </MicroLabel>
              <DataList label={CHROME.coding.values}>
                {values.map((r) => (
                  <Row
                    key={r.index}
                    doc={doc}
                    row={r}
                    lang={lang}
                    staged={null}
                    changed={false}
                    differs={differing?.has(r.index) ?? false}
                    selected={selected === r.index}
                    onSelect={() => onSelect(r.index)}
                    onPick={() => {}}
                  />
                ))}
              </DataList>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  doc,
  row,
  lang,
  staged,
  changed,
  differs,
  selected,
  onSelect,
  onPick,
}: {
  doc: CodingDoc;
  row: ParamRow;
  lang: Lang;
  staged: number | null;
  changed: boolean;
  differs: boolean;
  selected: boolean;
  onSelect: () => void;
  onPick: (option: number | null) => void;
}) {
  const c = cc();
  const p = row.param;
  const name = paramName(doc, p, lang);
  const raw = row.value === null ? formatBytes(row.bytes) : `0x${formatValue(p, row.value).hex}`;

  return (
    <li className={selected ? 'bg-blue-900/40' : changed ? 'bg-blue-500/10' : ''}>
      <div className={`grid grid-cols-2 items-center gap-x-3 gap-y-0.5 px-2 py-1.5 ${COLUMNS}`} onClick={onSelect}>
        {/* The function - what NCS Dummy calls the FSW - and its keyword. */}
        <button type="button" onClick={onSelect} aria-pressed={selected} className="col-span-2 min-w-0 text-left min-[640px]:col-span-1">
          <span className={`block truncate text-[11px] ${selected ? 'text-blue-200' : 'text-slate-200'}`}>
            {name.text}
            {name.source !== 'authored' && <span className={`${LABEL} ml-2 text-slate-600`}>{CHROME.coding.source[name.source]}</span>}
          </span>
          <span className={`block truncate font-mono text-[10px] ${differs ? 'text-indigo-400' : 'text-slate-500'}`}>{p.keyword}</span>
        </button>

        {/* What it is set to now - the PSW - or, for a value, the value. */}
        <span className="min-w-0 truncate text-[11px]">
          {row.option ? (
            <span className="text-slate-300">{optionName(doc, row.option, lang).text}</span>
          ) : row.status === 'unknown' ? (
            <span className="font-mono text-amber-400">? {raw}</span>
          ) : (
            <span className="font-mono text-slate-400">{raw}</span>
          )}
        </span>

        {/* What it will be set to - a choice where one may be made, a word on why not where it may not. */}
        {row.status === 'codable' && p.kind === 'fsw' ? (
          <select
            value={staged ?? ''}
            onChange={(e) => onPick(e.target.value === '' ? null : Number(e.target.value))}
            aria-label={`${CHROME.coding.next} ${name.text}`}
            className={`min-w-0 truncate rounded px-1 py-0.5 text-[11px] outline-none focus:ring-1 focus:ring-blue-500/60
              ${changed ? 'bg-blue-900/60 text-blue-200' : 'bg-slate-800 text-slate-300'}`}
          >
            <option value="">{CHROME.coding.keep}</option>
            {p.options.map((o) => (
              <option key={o.id} value={o.id}>
                {optionName(doc, o, lang).text}
                {o.id === row.option?.id ? ` (${CHROME.coding.current})` : ''}
              </option>
            ))}
          </select>
        ) : (
          <span className="min-w-0 truncate text-[10px] text-slate-600">{row.reason ? c.short[row.reason] : ''}</span>
        )}
      </div>
    </li>
  );
}
