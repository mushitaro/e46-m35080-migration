'use client';

/**
 * The bench procedure, one step at a time - AssemblyGuide's shape, for the cluster bench.
 *
 * Each step says what to do and what "done" looks like, and lights only its own wires in the
 * diagram beside it. The same seven steps, in the same order, are in docs/BENCH.md.
 */

import { Check, ChevronRight } from 'lucide-react';
import { b } from '@/lib/copy/bench';
import { g } from '@/lib/copy/guide';
import { CHROME } from '@/lib/copy/chrome';
import { LABEL, MicroLabel } from '@/components/ui';
import type { BenchWireId } from '@/lib/domain/clusterBench';

export type BenchStepId = 'parts' | 'supply' | 'cluster-plug' | 'obd-socket' | 'cable' | 'power-on' | 'connect';

/** Which wires each step lights. `null` shows the whole bench. */
export const BENCH_STEPS: { id: BenchStepId; highlight: BenchWireId[] | null }[] = [
  { id: 'parts', highlight: null },
  { id: 'supply', highlight: ['feed', 'ground-lead'] },
  { id: 'cluster-plug', highlight: ['kl30', 'kl15', 'klr', 'cluster-gnd'] },
  { id: 'obd-socket', highlight: ['obd-16', 'obd-4', 'obd-5', 'obd-7', 'k-line'] },
  { id: 'cable', highlight: ['usb'] },
  { id: 'power-on', highlight: null },
  { id: 'connect', highlight: null },
];

export function benchStepCopy(id: BenchStepId): { title: string; body: string; done: string } {
  const c = b();
  switch (id) {
    case 'parts':
      return { title: c.b1Title, body: c.b1Body, done: c.b1Done };
    case 'supply':
      return { title: c.b2Title, body: c.b2Body, done: c.b2Done };
    case 'cluster-plug':
      return { title: c.b3Title, body: c.b3Body, done: c.b3Done };
    case 'obd-socket':
      return { title: c.b4Title, body: c.b4Body, done: c.b4Done };
    case 'cable':
      return { title: c.b5Title, body: c.b5Body, done: c.b5Done };
    case 'power-on':
      return { title: c.b6Title, body: c.b6Body, done: c.b6Done };
    case 'connect':
      return { title: c.b7Title, body: c.b7Body, done: c.b7Done };
  }
}

export function ClusterBenchGuide({
  active,
  onSelect,
  doneIds,
  onToggleDone,
}: {
  active: BenchStepId;
  onSelect: (id: BenchStepId) => void;
  /** Steps the reader has ticked off. The reader's own record - nothing here is measured. */
  doneIds: Set<BenchStepId>;
  onToggleDone: (id: BenchStepId) => void;
}) {
  const total = BENCH_STEPS.length;
  return (
    <div className="flex flex-col gap-2">
      <MicroLabel as="h3">{CHROME.bench.procedure}</MicroLabel>
      <ol className="space-y-1">
        {BENCH_STEPS.map((s, i) => {
          const copy = benchStepCopy(s.id);
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
                <span className={`flex-1 text-[11px] leading-snug ${isActive ? 'text-slate-200' : 'text-slate-400'}`}>
                  {copy.title}
                </span>
                {isActive && <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-blue-400" />}
              </button>

              {isActive && (
                <div className="mb-1 ml-8 mr-2 mt-1 space-y-2">
                  <p className="text-[11px] leading-relaxed text-slate-400">{copy.body}</p>
                  <div className="flex items-start gap-2 rounded bg-slate-900 px-2 py-1.5">
                    <span className={`shrink-0 ${LABEL} text-slate-600`}>{CHROME.setup.doneWhen}</span>
                    <span className="font-mono text-[10px] leading-snug text-slate-300">{copy.done}</span>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isDone}
                      onChange={() => onToggleDone(s.id)}
                      className="h-3 w-3 accent-blue-500"
                    />
                    <span className={`${LABEL} text-slate-500`}>{g().stepOf(i + 1, total)}</span>
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
