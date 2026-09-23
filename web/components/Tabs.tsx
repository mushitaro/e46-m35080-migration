'use client';

/**
 * The tab bar. tsunagi-m-design section 4: horizontal, active by underline -
 * blue text and a blue underline; inactive recedes and brightens on hover;
 * disabled is very low opacity. A label, and nothing else.
 *
 * It used to prefix every tab with a numbered circle that turned into a check
 * mark when the step was "complete". Neither is in the design system, and the
 * order already says it: the tabs sit in the order the job is done.
 *
 * No `title` carrying the disabled reason: it displaces the button's accessible
 * name, so a screen reader announces the sentence instead of the step. The
 * reason is rendered where its subject is - the work surface's empty state -
 * rather than crammed into this 44px bar.
 */

import { LABEL } from '@/components/ui';

export type TabDef<T extends string> = {
  id: T;
  label: string;
  enabled: boolean;
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
            className={`flex h-full shrink-0 items-center border-b-2 ${LABEL} transition
                        disabled:opacity-20
              ${
                isActive
                  ? 'border-blue-400 text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
