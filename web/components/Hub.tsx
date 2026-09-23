'use client';

/**
 * The hub - one control, many states, always showing the one right next action.
 *
 * Its label, icon and handler are DERIVED by the caller from live state, never
 * stored. Busy states disable it rather than hiding it, so it is visibly the
 * same control, just occupied. Sub-actions live in a fixed-height row beneath
 * so showing or hiding them never moves the ring.
 */

import type { LucideIcon } from 'lucide-react';
import { HUB_LABEL, TextButton } from '@/components/ui';

export type HubConfig = {
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
  /** A write action - the ring takes the danger accent. */
  danger?: boolean;
  disabled?: boolean;
  spin?: boolean;
};

export function Hub({ config, busy }: { config: HubConfig; busy: boolean }) {
  const { label, Icon, onClick, danger, disabled, spin } = config;
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -inset-1 rounded-full border transition
          ${
            busy
              ? 'animate-pulse border-amber-500/50'
              : danger
                ? 'border-red-500/40'
                : 'border-blue-500/30'
          }`}
      />
      <button
        onClick={onClick}
        disabled={disabled || busy}
        /* 72, declared (tsunagi-m-design section 7). The reference fit-scales
           an 80px ring to 0.9 on every screen; transform would keep the 80px
           box while drawing 72, so the size is stated instead. */
        className={`relative flex size-[72px] flex-col items-center justify-center gap-1
                    rounded-full bg-slate-900 ring-1 ring-slate-800 shadow-2xl
                    transition-colors disabled:opacity-40
                    ${
                      danger
                        ? 'text-red-500 hover:bg-slate-800 hover:text-red-400'
                        : 'text-blue-500 hover:bg-slate-800 hover:text-blue-400'
                    }`}
      >
        <Icon className={`size-[18px] stroke-[1.5] ${spin ? 'animate-spin' : ''}`} />
        <span className={`${HUB_LABEL}`}>{label}</span>
      </button>
    </div>
  );
}

export type SubAction = {
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
};

/**
 * The reserved 46px row under the hub. It is NOT an overflow area: it holds
 * about two items, and two sequential steps side by side re-create the "what
 * do I press next?" ambiguity the derived hub exists to remove. A step that
 * belongs to the main sequence belongs IN the hub.
 */
export function SubActionRow({ actions }: { actions: SubAction[] }) {
  return (
    <div className="mt-1 flex h-[46px] items-center justify-center gap-4">
      {actions.map((a) => (
        <TextButton
          key={a.label}
          onClick={a.onClick}
          disabled={a.disabled}
          tone={a.danger ? 'danger' : 'primary'}
          Icon={a.Icon}
        >
          {a.label}
        </TextButton>
      ))}
    </div>
  );
}

/**
 * Reserve a notice line while idle; errors expand so recovery instructions
 * remain readable without hovering over a truncated technical message.
 */
export function NoticeLine({
  text,
  tone = 'info',
}: {
  text: string | null;
  tone?: 'info' | 'error' | 'ok';
}) {
  const color =
    tone === 'error' ? 'text-red-400' : tone === 'ok' ? 'text-emerald-400' : 'text-slate-500';
  return (
    <div className={`mb-4 mt-1 ${tone === 'error' ? 'min-h-[14px]' : 'h-[14px] overflow-hidden'}`}>
      <p className={`${tone === 'error' ? 'break-words' : 'truncate'} text-center text-[10px] font-mono leading-[14px] ${color}`} title={text ?? undefined} role={tone === 'error' ? 'alert' : undefined}>
        {text ?? ''}
      </p>
    </div>
  );
}
