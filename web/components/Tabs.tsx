'use client';

/**
 * The workflow strip: numbered steps, in the order the job is done.
 *
 * The number is the point - it says this is a sequence, not a menu. A step that
 * is finished carries a check so the reader can see how far they are without
 * remembering.
 *
 * No `title` carrying the disabled reason: it displaces the button's accessible
 * name, so a screen reader announces the sentence instead of the step. The
 * reason is rendered where its subject is - the work surface's empty state -
 * rather than crammed into this 44px bar.
 */

import { Check } from 'lucide-react';

export type TabDef<T extends string> = {
  id: T;
  label: string;
  enabled: boolean;
  /** 1-based position. Omit for a strip that is not a sequence. */
  ordinal?: number;
  /** Shows a check instead of the number. */
  complete?: boolean;
};

export function Tabs<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: TabDef<T>[];
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="no-scrollbar flex h-full items-stretch gap-5 overflow-x-auto overflow-y-hidden">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            disabled={!tab.enabled}
            onClick={() => onSelect(tab.id)}
            className={`flex h-full shrink-0 items-center gap-1.5 border-b-2 text-[10px] font-bold
                        tracking-widest transition disabled:opacity-20
              ${
                isActive
                  ? 'border-blue-400 text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
          >
            {tab.ordinal !== undefined && (
              <span
                aria-hidden="true"
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px]
                            font-bold leading-none transition-colors
                  ${
                    tab.complete
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : isActive
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-slate-800 text-slate-500'
                  }`}
              >
                {tab.complete ? <Check className="h-2.5 w-2.5" /> : tab.ordinal}
              </span>
            )}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
