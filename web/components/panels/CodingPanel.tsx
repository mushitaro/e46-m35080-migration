'use client';

/**
 * CODING's side panel: where the definitions came from, which one this chip was coded with and
 * how well it fits, the rows by status, the row picked on the left in full, and the changes as
 * they will be written - checksums included.
 *
 * Every refusal is written in a reserved line in words, in the reader's language. Nothing here
 * writes; the hub does, through the one write path.
 */

import { RefreshCw, Trash2 } from 'lucide-react';

import { DropZone } from '@/components/DropZone';
import { STATUS_TONE } from '@/components/CodingTable';
import { Callout, LABEL, MicroLabel, TextButton } from '@/components/ui';
import { CHROME } from '@/lib/copy/chrome';
import { cc } from '@/lib/copy/coding';
import { formatAddress, formatByte } from '@/lib/domain/image';
import { detectLayout } from '@/lib/domain/layout';
import type { Choice, ParamRow } from '@/lib/ncs/decode';
import type { CodingPlan, CodingRefusal } from '@/lib/ncs/encode';
import { formatBytes, formatOption, formatValue, maskBits, optionName, paramName, tally, type Staged } from '@/lib/ncs/view';
import { describeOrigin, type RefLoad } from '@/lib/refdata/load';
import type { CodingDoc } from '@/lib/refdata/types';

type Lang = 'ja' | 'en';

/** Whether DIFF has a donor to compare with, and how many rows differ. */
export type DonorState = { kind: 'none' } | { kind: 'layout' } | { kind: 'ok'; count: number };

export function CodingPanel({
  lang,
  refLoad,
  onOpenFile,
  onReload,
  image,
  choice,
  rows,
  selected,
  staged,
  onPick,
  onDiscard,
  plan,
  donor,
}: {
  lang: Lang;
  /** The reference data, or null while it is being fetched. */
  refLoad: RefLoad<'kombi-coding'> | null;
  onOpenFile: (file: File) => void;
  onReload: () => void;
  image: Uint8Array | null;
  choice: Choice | null;
  rows: readonly ParamRow[] | null;
  selected: number | null;
  staged: Staged;
  onPick: (index: number, option: number | null) => void;
  onDiscard: () => void;
  plan: CodingPlan | CodingRefusal | null;
  donor: DonorState;
}) {
  const c = cc();
  const doc = refLoad?.ok ? refLoad.doc : null;
  const layout = image ? detectLayout(image) : null;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 px-5 py-4">
        <p className="text-[10px] leading-snug text-slate-400">{c.lead}</p>
        <p className="text-[10px] leading-snug text-slate-500">{c.chipOff}</p>
      </div>

      {/* ------------------------------ the data ------------------------------ */}
      <div className="flex flex-col gap-2 border-t border-slate-800 px-5 py-4">
        <div className="flex items-baseline gap-2">
          <MicroLabel as="h3">{CHROME.coding.data}</MicroLabel>
          {refLoad?.ok && refLoad.origin.kind === 'served' && (
            <TextButton tone="neutral" Icon={RefreshCw} onClick={onReload} className="ml-auto">
              {CHROME.coding.reload}
            </TextButton>
          )}
        </div>
        {refLoad === null ? (
          <p className="font-mono text-[10px] text-slate-500">{CHROME.coding.loading} · {c.loading}</p>
        ) : refLoad.ok ? (
          <p className="truncate font-mono text-[10px] text-emerald-400">{describeOrigin(refLoad.origin)}</p>
        ) : (
          <>
            <p className="text-[10px] leading-snug text-amber-400">
              {c.ref[refLoad.reason]}
              {refLoad.detail && <span className="ml-1 font-mono text-slate-500">({refLoad.detail})</span>}
            </p>
            <DropZone onFile={onOpenFile} hint={CHROME.drop.coding} accept=".json,application/json" />
          </>
        )}
        <p className="text-[10px] leading-snug text-slate-600">{c.dataNote}</p>
      </div>

      {/* ---------------------------- the definition --------------------------- */}
      {doc && (
        <div className="flex flex-col gap-2 border-t border-slate-800 px-5 py-4">
          <MicroLabel as="h3">{CHROME.coding.definition}</MicroLabel>
          {!image || !choice ? (
            <p className="text-[10px] leading-snug text-slate-500">{c.needImage}</p>
          ) : choice.kind === 'none' ? (
            <>
              <Callout tone="caution">{c.none[choice.reason]}</Callout>
              {choice.best && (
                <p className="font-mono text-[10px] text-slate-500">
                  {CHROME.coding.closest} {choice.best.file} · {CHROME.coding.fit} {choice.best.fit.matched}/{choice.best.fit.informative}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[11px]">
                <span className="text-slate-200">{choice.file}</span>
                <span className="text-emerald-400">
                  {CHROME.coding.fit} {choice.match.fit.matched}/{choice.match.fit.informative}
                </span>
                <span className="text-slate-400">
                  {CHROME.coding.index} {choice.match.chipIndex}
                </span>
                <span className={layout?.kind === 'late' && layout.consistent ? 'text-emerald-400' : 'text-red-400'}>
                  {CHROME.checksum.title} {layout?.kind === 'late' && layout.consistent ? CHROME.checksum.ok : CHROME.checksum.broken}
                </span>
              </div>
              <p className="text-[10px] leading-snug text-slate-500">
                {c.fitNote(choice.match.fit.tautological, choice.match.fit.singleOption, choice.match.fit.arrays)}{' '}
                {choice.match.chipIndex !== null && c.indexNote(choice.match.chipIndex)}
              </p>
            </>
          )}
        </div>
      )}

      {/* ------------------------------- the rows ------------------------------ */}
      {doc && rows && (
        <div className="flex flex-col gap-2 border-t border-slate-800 px-5 py-4">
          <MicroLabel as="h3">{CHROME.coding.rows}</MicroLabel>
          <Tallies rows={rows} />
          <p className="text-[10px] leading-snug text-slate-600">{c.authoredNote}</p>
          <p className="text-[10px] leading-snug text-slate-500">
            {donor.kind === 'ok' ? c.diff.from(donor.count) : donor.kind === 'layout' ? c.diff.layout : c.diff.none}
          </p>
        </div>
      )}

      {/* ------------------------------ one row -------------------------------- */}
      {doc && rows && (
        <div className="flex flex-col gap-2 border-t border-slate-800 px-5 py-4">
          {selected === null || !rows[selected] ? (
            <p className="text-[10px] leading-snug text-slate-600">{c.selectRow}</p>
          ) : (
            <Detail doc={doc} row={rows[selected]!} lang={lang} staged={staged.get(selected) ?? null} onPick={(o) => onPick(selected, o)} />
          )}
        </div>
      )}

      {/* ------------------------------ the changes ---------------------------- */}
      {doc && rows && (
        <div className="flex flex-col gap-2 border-t border-slate-800 px-5 py-4">
          <div className="flex items-baseline gap-2">
            <MicroLabel as="h3">{CHROME.coding.changes}</MicroLabel>
            <TextButton tone="danger" Icon={Trash2} onClick={onDiscard} disabled={staged.size === 0} className="ml-auto">
              {CHROME.coding.discard}
            </TextButton>
          </div>
          <Changes doc={doc} rows={rows} lang={lang} plan={plan} />
          <p className="text-[10px] leading-snug text-slate-600">{c.checksumsFollow} {c.writtenNote}</p>
        </div>
      )}
    </div>
  );
}

function Tallies({ rows }: { rows: readonly ParamRow[] }) {
  const t = tally(rows);
  const cell = (label: string, n: number, tone: string) => (
    <span className="flex items-baseline gap-1.5">
      <span className={`${LABEL} ${tone}`}>{label}</span>
      <span className="font-mono text-[11px] tabular-nums text-slate-200">{n}</span>
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {cell(CHROME.coding.filter.all, t.all, 'text-slate-500')}
      {cell(CHROME.coding.status.codable, t.codable, STATUS_TONE.codable)}
      {cell(CHROME.coding.status.protected, t.protected, STATUS_TONE.protected)}
      {cell(CHROME.coding.status.value, t.value, STATUS_TONE.value)}
      {cell(CHROME.coding.status.unknown, t.unknown, STATUS_TONE.unknown)}
    </div>
  );
}

function Detail({
  doc,
  row,
  lang,
  staged,
  onPick,
}: {
  doc: CodingDoc;
  row: ParamRow;
  lang: Lang;
  staged: number | null;
  onPick: (option: number | null) => void;
}) {
  const c = cc();
  const p = row.param;
  const name = paramName(doc, p, lang);
  const value = row.value === null ? null : formatValue(p, row.value);
  const codable = row.status === 'codable' && p.kind === 'fsw';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-[11px] text-slate-200">{name.text}</span>
        <span className={`${LABEL} shrink-0 text-slate-600`}>{CHROME.coding.source[name.source]}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[10px] text-slate-500">
        <span className="text-slate-400">{p.keyword}</span>
        <span>
          {formatAddress(p.address)}
          {p.length > 1 && `–${formatAddress(p.address + p.length - 1)}`}
        </span>
        <span>{p.kind.toUpperCase()}</span>
        <span className={`${LABEL} ${STATUS_TONE[row.status]}`}>{CHROME.coding.status[row.status]}</span>
      </div>

      {/* The reason, always in its line - one line tall even when there is none. */}
      <p className="min-h-[14px] text-[10px] leading-snug text-slate-500">{row.reason ? c.reason[row.reason] : ''}</p>

      <div className="flex flex-col gap-1">
        <MicroLabel>{CHROME.coding.mask}</MicroLabel>
        {maskBits(p).map((m) => (
          <div key={m.address} className="flex items-center gap-2 font-mono text-[10px]">
            <span className="w-8 text-slate-600">{formatAddress(m.address)}</span>
            <span className="flex gap-0.5" aria-label={m.bits.map((b) => (b ? '1' : '0')).join('')}>
              {m.bits.map((on, i) => (
                <span key={i} className={`inline-block size-2.5 rounded-sm ${on ? 'bg-blue-500' : 'bg-slate-800'}`} />
              ))}
            </span>
            <span className="text-slate-400">{formatByte(row.bytes[m.address - p.address] ?? 0)}</span>
          </div>
        ))}
      </div>

      <div className="flex items-baseline gap-2 text-[10px]">
        <span className={`${LABEL} text-slate-600`}>{CHROME.coding.current}</span>
        {row.option && <span className="text-slate-300">{optionName(doc, row.option, lang).text}</span>}
        <span className="font-mono text-slate-500">{value ? `0x${value.hex} · ${value.bits}` : formatBytes(row.bytes)}</span>
      </div>

      {p.kind === 'fsw' && (
        <div className="flex flex-col gap-0.5">
          <MicroLabel>{CHROME.coding.options}</MicroLabel>
          {p.options.map((o) => {
            const v = formatOption(p, o);
            const isCurrent = row.option?.id === o.id;
            const isStaged = staged === o.id;
            const label = optionName(doc, o, lang);
            return (
              <button
                key={o.id}
                type="button"
                disabled={!codable}
                onClick={() => onPick(isStaged || isCurrent ? null : o.id)}
                className={`flex items-baseline gap-2 rounded px-1.5 py-0.5 text-left text-[10px] transition-colors disabled:cursor-default
                  ${isStaged ? 'bg-blue-900/60 text-blue-200' : isCurrent ? 'text-slate-200' : 'text-slate-400'}
                  ${codable && !isStaged ? 'hover:bg-slate-800' : ''}`}
              >
                <span className={`${LABEL} w-10 shrink-0 ${isStaged ? 'text-blue-300' : isCurrent ? 'text-emerald-400' : 'text-slate-700'}`}>
                  {isStaged ? CHROME.coding.next : isCurrent ? CHROME.coding.current : ''}
                </span>
                <span className="min-w-0 flex-1 truncate">{label.text}</span>
                <span className="max-w-[40%] shrink-0 truncate font-mono text-slate-600">{o.keyword}</span>
                <span className="w-16 shrink-0 text-right font-mono tabular-nums text-slate-500">
                  {p.length === p.mask.length ? `0x${v.hex}` : formatBytes(o.data)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Changes({
  doc,
  rows,
  lang,
  plan,
}: {
  doc: CodingDoc;
  rows: readonly ParamRow[];
  lang: Lang;
  plan: CodingPlan | CodingRefusal | null;
}) {
  const c = cc();
  if (!plan) return <p className="text-[10px] leading-snug text-slate-500">{c.noChanges}</p>;
  if (!plan.ok) {
    const who = plan.param !== undefined && rows[plan.param] ? paramName(doc, rows[plan.param]!.param, lang).text : null;
    return (
      <Callout tone="danger">
        {c.refused[plan.code]}
        {who && <span className="ml-1">({who})</span>}
      </Callout>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {plan.changes.map((ch) => (
        <div key={ch.param} className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2 text-[10px]">
            <span className="min-w-0 flex-1 truncate text-slate-200">{paramName(doc, rows[ch.param]!.param, lang).text}</span>
            <span className="shrink-0 text-slate-500">{optionName(doc, ch.from, lang).text}</span>
            <span className="shrink-0 text-slate-600">&rarr;</span>
            <span className="shrink-0 text-blue-300">{optionName(doc, ch.to, lang).text}</span>
          </div>
          {ch.bytes.map((b) => (
            <span key={b.address} className="font-mono text-[10px] text-slate-500">
              {formatAddress(b.address)} {formatByte(b.before)} &rarr; <span className="text-blue-300">{formatByte(b.after)}</span>
            </span>
          ))}
        </div>
      ))}
      <div className="flex flex-col gap-0.5">
        <MicroLabel>{CHROME.checksum.title}</MicroLabel>
        {plan.checksums.map((w) => (
          <span key={w.address} className="font-mono text-[10px] text-slate-500">
            {formatAddress(w.address)} {formatByte(w.before)} &rarr; <span className="text-indigo-300">{formatByte(w.after)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
