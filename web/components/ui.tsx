'use client';

/**
 * The ///M primitives. UI is built from these; raw Tailwind does not start a row.
 *
 * Ported from E46M3-Diagnosis and E46M3SMG2_TuningTool (tsunagi-m-design
 * section 4), keeping only what this app draws. Nothing here was invented for
 * this repo except `TableBody`, which exists because the records view is a
 * real table and `divide-y` has to live in this file (see below).
 *
 * This app had none of these. Every panel spelled its own label recipe - 35
 * copies in 12 files, at 8, 9 and 10px - and the same section heading was
 * pasted into six of them. The heading is now `MicroLabel`; the recipe is
 * rejected by `tools/check_ui_tokens.mjs`, wrapped across lines or not.
 *
 * ## The border rule
 *
 * A border is a RULE BETWEEN REGIONS, never an OUTLINE AROUND A THING. Allowed:
 * one-sided hairlines that separate (`border-b`, `border-t`, `divide-y` in this
 * file), one outline per floating surface (the confirm modal), the tab
 * underline, the hub ring, and a dashed drop area. Panels, callouts, inputs,
 * pills and buttons are separated by SURFACE or by SPACE.
 *
 * ## The type ramp: two steps
 *
 *   LABEL  10px, bold, uppercase, tracked. Everything that NAMES a thing.
 *   DATA   11px / text-xs, mono when it came from a machine. The thing itself.
 *          Mono meta (versions, addresses, counts) sits at LABEL's 10px.
 *
 * Three named exceptions, none of them a step: WORDMARK (the one <h1>),
 * HUB_LABEL (the one verb in the ring), and the 22px numeric readout. There is
 * no 9px. To make something recede, change its COLOUR (slate-500 -> slate-600),
 * never its size - a size step and a colour step doing the same job is how an
 * app ends up with eight of them.
 */

import type { LucideIcon } from 'lucide-react';

export const LABEL = 'text-[10px] font-bold uppercase tracking-widest';

/** The wordmark. One element in the whole app: the <h1> in the header. */
export const WORDMARK = 'text-sm font-bold uppercase tracking-widest';

/**
 * The verb inside the hub ring. One element. Legible at 8px only because the
 * verbs are short and English - CONNECT, READ, BACKUP. Do not put a sentence
 * here.
 */
export const HUB_LABEL = 'text-[8px] font-bold uppercase tracking-widest';

export type Tone = 'neutral' | 'primary' | 'danger' | 'destructive' | 'caution' | 'secondary' | 'ok';

const TEXT: Record<Tone, string> = {
  neutral: 'text-slate-500 hover:text-slate-300',
  primary: 'text-blue-400 hover:text-blue-300',
  // Muted until you reach for it. For incidental destructive controls
  // (disconnect, revert) that sit among ordinary ones.
  danger: 'text-slate-500 hover:text-red-400',
  // Steady red. Only where being destructive is the whole point of the control.
  destructive: 'text-red-400 hover:text-red-300',
  caution: 'text-slate-500 hover:text-amber-400',
  secondary: 'text-indigo-400 hover:text-indigo-300',
  ok: 'text-emerald-400 hover:text-emerald-300',
};

/**
 * The default button: text, uppercase, tracked, semantic colour, no box.
 * Primary by default, because a text button is a CONTROL and has to look
 * pressable at rest.
 */
export function TextButton({
  children,
  onClick,
  tone = 'primary',
  Icon,
  disabled,
  title,
  className = '',
  ...rest
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: Tone;
  Icon?: LucideIcon;
  disabled?: boolean;
  title?: string;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'title' | 'className'>) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap ${LABEL} transition-colors disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:text-slate-600 ${TEXT[tone]} ${className}`}
      {...rest}
    >
      {Icon && <Icon className="size-3 shrink-0" />}
      {children}
    </button>
  );
}

const FILL: Record<Tone, string> = {
  neutral: 'bg-slate-800 text-slate-400',
  primary: 'bg-blue-500/15 text-blue-400',
  danger: 'bg-red-500/15 text-red-400',
  destructive: 'bg-red-500/15 text-red-400',
  caution: 'bg-amber-500/15 text-amber-400',
  secondary: 'bg-indigo-500/15 text-indigo-400',
  ok: 'bg-emerald-500/15 text-emerald-400',
};

/**
 * A tag. Tint fill, never an outline - outlined pills turn a row of metadata
 * into a row of tiny boxes.
 */
export function Pill({
  children,
  tone = 'neutral',
  title,
  className = '',
}: {
  children: React.ReactNode;
  tone?: Tone;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-block shrink-0 rounded px-1.5 py-0.5 ${LABEL} ${FILL[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** The class a pressable Pill needs, for the one place a tag is also a switch. */
export function pillClass(tone: Tone): string {
  return `inline-block shrink-0 rounded px-1.5 py-0.5 ${LABEL} ${FILL[tone]}`;
}

/**
 * The micro-label above a block. On its own line, no rule under it - the size
 * and colour step is already the separation.
 */
export function MicroLabel({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  /** `h3` where it heads a section, so the outline stays navigable. */
  as?: 'div' | 'h3' | 'span' | 'p';
}) {
  return <Tag className={`${LABEL} text-slate-500 ${className}`}>{children}</Tag>;
}

/** A recessed block for machine output. Surface, not outline. */
export function Well({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded bg-slate-800/40 p-2 ${className}`}>{children}</div>;
}

/**
 * A callout that has to be read - a warning, a refusal - separated from its
 * neighbours by a tint, not by a frame. `tone` is a verdict, never decoration.
 */
export function Callout({
  children,
  tone,
  className = '',
}: {
  children: React.ReactNode;
  tone: 'danger' | 'caution';
  className?: string;
}) {
  const t = tone === 'danger' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300';
  return <div className={`rounded px-2.5 py-2 text-[10px] leading-snug ${t} ${className}`}>{children}</div>;
}

/**
 * A titled block. Deliberately carries no outer margin: the spacing belongs to
 * the container (`Pane`), so blocks can be reordered without re-tuning every
 * neighbour.
 */
export function Section({
  title,
  actions,
  children,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex min-h-[20px] items-baseline justify-between gap-3">
        <MicroLabel as="h3">{title}</MicroLabel>
        {actions && <div className="flex shrink-0 items-baseline gap-3">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A column of Sections, one gap. The gap lives here, not on the Sections. */
export function Pane({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-4 ${className}`}>{children}</div>;
}

/**
 * The empty state: an instrument waiting for input. One shape, used
 * everywhere. It was pasted into two files here, word for word.
 */
export function EmptyState({
  Icon,
  label,
  hint,
  children,
}: {
  Icon: LucideIcon;
  label: string;
  /** In the reader's language: why this is empty and what would fill it. */
  hint?: string;
  /** The one thing that fills it, when it can be done right here (a drop zone). */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center px-6 text-center text-slate-700">
      <div className="mb-4 flex size-16 items-center justify-center rounded-full border-2 border-dashed border-slate-800 opacity-50">
        <Icon className="size-6 opacity-50" />
      </div>
      <p className="font-mono text-xs uppercase tracking-wider opacity-50">{label}</p>
      {hint && <p className="mt-2 max-w-[48ch] text-[11px] leading-relaxed text-slate-400">{hint}</p>}
      {children && <div className="mt-4 w-full max-w-sm">{children}</div>}
    </div>
  );
}

/**
 * The body of a records table.
 *
 * The one addition to the reference set. `divide-y` IS a list - it is what
 * separates rows - so only this file may own it (check_ui_tokens.mjs). The
 * reference's `DataList` is a single-column `<ul>`; the records view is a real
 * multi-column table, which a `<ul>` cannot be, so the row rule gets its own
 * owner here instead of a hand-rolled copy in the panel.
 */
export function TableBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-slate-800/50">{children}</tbody>;
}

/**
 * A list: rows separated by a hairline, and nothing else. `divide-y` lives here
 * and in `TableBody`, nowhere else (check_ui_tokens.mjs).
 */
export function DataList({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-slate-800/50">
      {children}
    </ul>
  );
}

/**
 * One row, three slots in order of importance (tsunagi-m-design section 4):
 *
 *   name   what the thing is CALLED, for a person - first, brightest, truncated last
 *   ident  the machine's word for it, mono - capped, so it truncates first
 *   code   a right-aligned gutter: an address, a count, a verdict. Its colour is a verdict.
 *
 * `marker` sits after the name (a quiet provenance word); `detail` is a second line under all
 * three for what the row says about itself - a value, a control, a reason. The first line is the
 * button that selects the row; the detail line is outside it, so a control can live there.
 */
export function DataRow({
  name,
  ident,
  code,
  codeTone = 'text-slate-500',
  marker,
  detail,
  selected = false,
  onSelect,
}: {
  name: React.ReactNode;
  ident?: React.ReactNode;
  code?: React.ReactNode;
  codeTone?: string;
  marker?: React.ReactNode;
  detail?: React.ReactNode;
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <li className={selected ? 'bg-blue-900/40' : ''}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={onSelect ? selected : undefined}
        className={`flex w-full items-baseline gap-2 px-2 text-left transition-colors ${detail ? 'pb-0.5 pt-1.5' : 'py-1.5'}
          ${selected ? '' : 'hover:bg-slate-800/50'}`}
      >
        <span className={`min-w-0 flex-1 truncate text-[11px] ${selected ? 'text-blue-200' : 'text-slate-300'}`}>{name}</span>
        {marker}
        {ident !== undefined && (
          <span className="max-w-[45%] shrink-0 truncate font-mono text-[10px] text-slate-500">{ident}</span>
        )}
        {code !== undefined && (
          <span className={`w-10 shrink-0 text-right font-mono text-[10px] tabular-nums ${codeTone}`}>{code}</span>
        )}
      </button>
      {detail && (
        <div className="px-2 pb-1.5" onClick={onSelect}>
          {detail}
        </div>
      )}
    </li>
  );
}

/**
 * A label and its value - the readout atom. `labelKind="data"` for a name the
 * machine supplied, which must not be uppercased.
 */
export function Field({
  label,
  value,
  unit,
  tone = 'text-slate-200',
  stacked = false,
  labelKind = 'chrome',
  title,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: string;
  tone?: string;
  stacked?: boolean;
  labelKind?: 'chrome' | 'data';
  title?: string;
}) {
  const labelCls = labelKind === 'chrome' ? `${LABEL} text-slate-600` : 'text-[11px] text-slate-500';
  if (stacked) {
    return (
      <div className="flex flex-col leading-none" title={title}>
        <span className={labelCls}>{label}</span>
        <span className={`mt-1.5 font-mono text-[11px] font-bold tabular-nums ${tone}`}>
          {value}
          {unit && <span className="ml-1 font-normal text-slate-500">{unit}</span>}
        </span>
      </div>
    );
  }
  return (
    <span className="flex items-baseline gap-1.5" title={title}>
      <span className={labelCls}>{label}</span>
      <span className={`font-mono text-xs tabular-nums ${tone}`}>
        {value}
        {unit && <span className="ml-1 text-slate-500">{unit}</span>}
      </span>
    </span>
  );
}
