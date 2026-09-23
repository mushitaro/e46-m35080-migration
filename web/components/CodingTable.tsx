'use client';

/**
 * CODING's work surface: every parameter of the chip's own definition, as a LIST grouped by block
 * or as a MAP over the image, with the filters and the search.
 *
 * It draws what lib/ncs/view.ts derives and nothing else. A CODABLE row carries the choice of a
 * new value; every other row says why it has none, in the row, in words - never only on hover.
 */

import { useMemo, useState } from 'react';
import { FileCode2 } from 'lucide-react';

import { HexView } from '@/components/HexView';
import { DataList, DataRow, EmptyState, LABEL, pillClass } from '@/components/ui';
import { CHROME } from '@/lib/copy/chrome';
import { cc } from '@/lib/copy/coding';
import { formatAddress } from '@/lib/domain/image';
import type { ParamRow, RowStatus } from '@/lib/ncs/decode';
import {
  CODING_FILTERS,
  blockName,
  byteRoles,
  bytesOf,
  formatBytes,
  formatOption,
  formatValue,
  groupByBlock,
  matches,
  optionName,
  paramName,
  passes,
  type ByteRole,
  type CodingFilter,
  type Staged,
} from '@/lib/ncs/view';
import type { CodingDefinition, CodingDoc } from '@/lib/refdata/types';

type Lang = 'ja' | 'en';

export type CodingView = 'list' | 'map';

/** The status word's colour: a verdict (tsunagi-m-design 1.5). */
export const STATUS_TONE: Record<RowStatus, string> = {
  codable: 'text-blue-400',
  protected: 'text-red-400',
  value: 'text-slate-500',
  unknown: 'text-amber-400',
};

/** What a byte's role looks like on the MAP - text, never a fill: the face stays black. */
const ROLE_TEXT: Record<Exclude<ByteRole, null>, string> = {
  codable: 'text-blue-300',
  value: 'text-slate-300',
  unknown: 'text-amber-300',
  protected: 'text-red-300',
  checksum: 'text-indigo-300',
};

export function CodingTable({
  doc,
  def,
  rows,
  image,
  after,
  lang,
  staged,
  changed,
  differing,
  selected,
  onSelect,
  onPick,
}: {
  doc: CodingDoc;
  def: CodingDefinition;
  rows: readonly ParamRow[];
  image: Uint8Array;
  /** The image as the accepted plan leaves it, or null while nothing is planned. */
  after: Uint8Array | null;
  lang: Lang;
  staged: Staged;
  /** Rows whose staged value differs from the chip. */
  changed: ReadonlySet<number>;
  /** Rows a donor holds differently, or null when there is no donor to compare. */
  differing: ReadonlySet<number> | null;
  selected: number | null;
  onSelect: (index: number) => void;
  /** Stage a value for a row; null takes the pick back. */
  onPick: (index: number, option: number | null) => void;
}) {
  const c = cc();
  const [view, setView] = useState<CodingView>('list');
  const [filter, setFilter] = useState<CodingFilter>('all');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const out = {} as Record<CodingFilter, number>;
    for (const f of CODING_FILTERS) out[f] = rows.filter((r) => passes(r, f, changed, differing)).length;
    return out;
  }, [rows, changed, differing]);

  const groups = useMemo(() => {
    const shown = rows.filter((r) => passes(r, filter, changed, differing) && matches(doc, r, query));
    return groupByBlock(def, shown);
  }, [def, doc, rows, filter, changed, differing, query]);

  const roles = useMemo(() => byteRoles(rows), [rows]);
  const ring = useMemo(() => (selected !== null && rows[selected] ? bytesOf(rows[selected]!.param) : undefined), [rows, selected]);

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Two lines of controls, the same two at every width: the view and the search, then the
          filters - one line that scrolls sideways on a phone rather than wrapping into four and
          taking the list's height (the work surface is 38.2% of a phone). */}
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex shrink-0 items-center gap-1.5">
          {(['list', 'map'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`${pillClass(view === v ? 'primary' : 'neutral')} transition-colors`}
            >
              {v === 'list' ? CHROME.coding.list : CHROME.coding.map}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={CHROME.coding.search}
          aria-label={CHROME.coding.search}
          className="min-w-0 flex-1 rounded bg-slate-800 px-2 py-1 font-mono text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:ring-1 focus:ring-blue-500/60"
        />
      </div>
      <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto">
        {CODING_FILTERS.map((f) => (
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

      {view === 'map' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <MapLegend />
          <div className="min-h-0 flex-1">
            <HexView
              image={after ?? image}
              reference={after ? image : null}
              changeMode="pending"
              textFor={(a) => {
                const r = roles[a];
                return r ? ROLE_TEXT[r] : 'text-slate-700';
              }}
              ring={ring}
              selected={null}
              onSelect={(a) => {
                const hit = rows.find((r) => a >= r.param.address && a < r.param.address + r.param.length);
                if (hit) onSelect(hit.index);
              }}
            />
          </div>
        </div>
      ) : groups.length === 0 ? (
        <EmptyState Icon={FileCode2} label={CHROME.coding.noRows} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 pb-4">
            {groups.map((g) => (
              <section key={g.block ? `${g.block.address}-${g.block.name}` : 'none'} className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2 px-2">
                  {/* A block's name is data - the definition's, translated or not - so it keeps its case. */}
                  <h3 className="min-w-0 truncate text-[11px] text-slate-400">
                    {g.block ? blockName(doc, g.block, lang).text : CHROME.coding.noBlock}
                  </h3>
                  {g.block && (
                    <span className="shrink-0 font-mono text-[10px] text-slate-600">
                      {formatAddress(g.block.address)}–{formatAddress(g.block.address + g.block.length - 1)}
                    </span>
                  )}
                  {g.block && <span className={`${LABEL} shrink-0 text-slate-600`}>{CHROME.coding.block[g.block.kind]}</span>}
                  {g.checksum && (
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-indigo-400">
                      {CHROME.coding.checksum} {formatAddress(g.checksum.at)}
                    </span>
                  )}
                </div>
                <DataList>
                  {g.rows.map((r) => (
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
                      reason={r.reason ? c.reason[r.reason] : null}
                    />
                  ))}
                </DataList>
              </section>
            ))}
          </div>
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
  reason,
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
  reason: string | null;
}) {
  const p = row.param;
  const name = paramName(doc, p, lang);
  const shownValue = row.value === null ? null : formatValue(p, row.value);
  const value = shownValue ? `0x${shownValue.hex} · ${shownValue.bits}` : formatBytes(row.bytes);
  const current = row.option ? optionName(doc, row.option, lang).text : null;

  return (
    <DataRow
      name={name.text}
      marker={
        name.source === 'authored' ? undefined : (
          <span className={`${LABEL} shrink-0 text-slate-600`}>{CHROME.coding.source[name.source]}</span>
        )
      }
      ident={p.keyword}
      code={formatAddress(p.address)}
      codeTone={changed ? 'text-blue-400' : differs ? 'text-indigo-400' : 'text-slate-500'}
      selected={selected}
      onSelect={onSelect}
      detail={
        <div className="flex min-h-[20px] items-center gap-2 text-[10px]">
          <span className={`${LABEL} w-[5.5rem] shrink-0 ${STATUS_TONE[row.status]}`}>{CHROME.coding.status[row.status]}</span>
          {current && <span className="min-w-0 max-w-[40%] shrink-0 truncate text-slate-400">{current}</span>}
          <span className="shrink-0 font-mono text-slate-500">{value}</span>
          {row.status === 'codable' && p.kind === 'fsw' ? (
            <select
              value={staged ?? ''}
              onChange={(e) => onPick(e.target.value === '' ? null : Number(e.target.value))}
              aria-label={`${CHROME.coding.next} ${p.keyword}`}
              className={`ml-auto min-w-0 max-w-[45%] truncate rounded px-1 py-0.5 font-mono text-[10px] outline-none focus:ring-1 focus:ring-blue-500/60
                ${changed ? 'bg-blue-900/60 text-blue-200' : 'bg-slate-800 text-slate-300'}`}
            >
              <option value="">{CHROME.coding.keep}</option>
              {p.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionName(doc, o, lang).text} · 0x{formatOption(p, o).hex}
                </option>
              ))}
            </select>
          ) : (
            reason && <span className="min-w-0 flex-1 truncate text-slate-600">{reason}</span>
          )}
        </div>
      }
    />
  );
}

function MapLegend() {
  const item = (cls: string, label: string) => (
    <span className={`font-mono text-[10px] uppercase tracking-wider ${cls}`}>{label}</span>
  );
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
      {item(ROLE_TEXT.codable, CHROME.coding.status.codable)}
      {item(ROLE_TEXT.value, CHROME.coding.status.value)}
      {item(ROLE_TEXT.unknown, CHROME.coding.status.unknown)}
      {item(ROLE_TEXT.protected, CHROME.coding.status.protected)}
      {item(ROLE_TEXT.checksum, CHROME.coding.checksum)}
      {item('text-blue-100', CHROME.coding.changes)}
    </div>
  );
}
