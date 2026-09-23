'use client';

/**
 * The bench procedure, one step at a time.
 *
 * Each step says what to do AND how you know it is finished - a guide that only
 * says what to do leaves the reader guessing whether it worked, which is where
 * people give up or, worse, carry on.
 *
 * The step drives the wiring diagram: the two wiring steps light only their own
 * wires, so the picture answers "which one is this" without a legend hunt.
 * Controlled from outside so the diagram and the guide cannot drift apart.
 */

import { Check, ChevronRight } from 'lucide-react';
import { g } from '@/lib/copy/guide';
import { CHROME } from '@/lib/copy/chrome';
import { LABEL, MicroLabel } from '@/components/ui';

export type GuideStepId = 'parts' | 'open' | 'remove' | 'adapter' | 'power' | 'signals' | 'flash';

/**
 * Which wires each step lights.
 *
 * `null` shows the whole diagram; `[]` shows the board and the chip with every
 * jumper dimmed, which is what "the chip is seated, nothing wired yet" looks
 * like. The pin names come from hardware.ts via the diagram.
 */
export const GUIDE_STEPS: { id: GuideStepId; highlight: string[] | null }[] = [
  { id: 'parts', highlight: null },
  { id: 'open', highlight: null },
  { id: 'remove', highlight: null },
  { id: 'adapter', highlight: [] },
  { id: 'power', highlight: ['VCC', 'VSS', 'passives'] },
  { id: 'signals', highlight: ['S', 'W', 'Q', 'C', 'D'] },
  { id: 'flash', highlight: null },
];

function stepCopy(id: GuideStepId) {
  const c = g();
  switch (id) {
    case 'parts':
      return { title: c.g1Title, body: c.g1Body, done: c.g1Done };
    case 'open':
      return { title: c.g2Title, body: c.g2Body, done: c.g2Done };
    case 'remove':
      return { title: c.g3Title, body: c.g3Body, done: c.g3Done };
    case 'adapter':
      return { title: c.g4Title, body: c.g4Body, done: c.g4Done };
    case 'power':
      return { title: c.g5Title, body: c.g5Body, done: c.g5Done };
    case 'signals':
      return { title: c.g6Title, body: c.g6Body, done: c.g6Done };
    case 'flash':
      return { title: c.g7Title, body: c.g7Body, done: c.g7Done };
  }
}

export function AssemblyGuide({
  active,
  onSelect,
  /** Steps the user has ticked off. Local to the guide - nothing hardware-derived. */
  doneIds,
  onToggleDone,
}: {
  active: GuideStepId;
  onSelect: (id: GuideStepId) => void;
  doneIds: Set<GuideStepId>;
  onToggleDone: (id: GuideStepId) => void;
}) {
  const c = g();
  const total = GUIDE_STEPS.length;

  return (
    <div className="flex flex-col gap-2">
      <MicroLabel as="h3">
        {CHROME.setup.assembly}
      </MicroLabel>

      <ol className="space-y-1">
        {GUIDE_STEPS.map((s, i) => {
          const copy = stepCopy(s.id);
          const isActive = s.id === active;
          const isDone = doneIds.has(s.id);
          return (
            <li key={s.id}>
              <button
                onClick={() => onSelect(s.id)}
                className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors
                  ${isActive ? 'bg-slate-800' : 'hover:bg-slate-800/60'}`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full
                              text-[8px] font-bold leading-none
                    ${
                      isDone
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : isActive
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-slate-800 text-slate-500'
                    }`}
                >
                  {isDone ? <Check className="h-2.5 w-2.5" /> : i + 1}
                </span>
                <span
                  className={`flex-1 text-[11px] leading-snug ${
                    isActive ? 'text-slate-200' : 'text-slate-400'
                  }`}
                >
                  {copy.title}
                </span>
                {isActive && <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-blue-400" />}
              </button>

              {isActive && (
                <div className="mb-1 ml-8 mr-2 mt-1 space-y-2">
                  <p className="text-[11px] leading-relaxed text-slate-400">{copy.body}</p>
                  <div className="flex items-start gap-2 rounded bg-slate-900 px-2 py-1.5">
                    <span className={`shrink-0 ${LABEL} text-slate-600`}>
                      {CHROME.setup.doneWhen}
                    </span>
                    <span className="font-mono text-[10px] leading-snug text-slate-300">
                      {copy.done}
                    </span>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isDone}
                      onChange={() => onToggleDone(s.id)}
                      className="h-3 w-3 accent-blue-500"
                    />
                    <span className={`${LABEL} text-slate-500`}>
                      {c.stepOf(i + 1, total)}
                    </span>
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
