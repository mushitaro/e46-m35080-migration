'use client';

/**
 * TEST's side panel: BENCH (how to wire the cluster up) and CHECKS (what to ask it and what it
 * said). The two views share the work surface beside them - the bench diagram, or the drawing of
 * what was commanded - so the toggle lives in page.tsx and is handed down.
 */

import { ClusterBenchGuide, type BenchStepId } from '@/components/ClusterBenchGuide';
import { ClusterBenchLegend } from '@/components/ClusterBenchDiagram';
import { PartsList } from '@/components/PartsList';
import { TestChecks } from '@/components/panels/TestChecks';
import { MicroLabel, pillClass } from '@/components/ui';
import { b, benchPartName, benchPartNote } from '@/lib/copy/bench';
import { CHROME } from '@/lib/copy/chrome';
import { BENCH_PARTS } from '@/lib/domain/partsData';
import type { BenchWireId } from '@/lib/domain/clusterBench';
import type { UseKombiLink } from '@/lib/hooks/useKombiLink';
import type { Reference } from '@/lib/kombi/checks';

export type TestView = 'bench' | 'checks';

export function TestPanel({
  view,
  onView,
  benchStep,
  onBenchStep,
  benchDone,
  onToggleBenchDone,
  benchWire,
  onBenchWire,
  kombi,
  reference,
}: {
  view: TestView;
  onView: (v: TestView) => void;
  benchStep: BenchStepId;
  onBenchStep: (id: BenchStepId) => void;
  benchDone: Set<BenchStepId>;
  onToggleBenchDone: (id: BenchStepId) => void;
  benchWire: BenchWireId | null;
  onBenchWire: (id: BenchWireId | null) => void;
  kombi: UseKombiLink;
  /** What the next CONNECT will compare against; the session keeps its own once connected. */
  reference: Reference | null;
}) {
  const c = b();
  return (
    <div className="flex flex-col gap-5 px-5 py-4">
      <div className="flex items-center gap-2">
        {(['bench', 'checks'] as const).map((v) => (
          <button
            key={v}
            onClick={() => onView(v)}
            className={`${pillClass(view === v ? 'primary' : 'neutral')} transition-colors`}
            aria-pressed={view === v}
          >
            {v === 'bench' ? CHROME.test.bench : CHROME.test.checks}
          </button>
        ))}
      </div>

      {view === 'bench' ? (
        <>
          <ClusterBenchGuide active={benchStep} onSelect={onBenchStep} doneIds={benchDone} onToggleDone={onToggleBenchDone} />

          <div className="flex flex-col gap-2 border-t border-slate-800 pt-4">
            <MicroLabel as="h3">{CHROME.bench.wiring}</MicroLabel>
            <ClusterBenchLegend selected={benchWire} onSelect={onBenchWire} />
            {/* The warnings that cost a cluster, where the wiring is. */}
            <p className="text-[10px] leading-snug text-amber-400">{c.pinsUnverified}</p>
            <p className="text-[10px] leading-snug text-slate-400">{c.polarity}</p>
            <p className="text-[10px] leading-snug text-red-400">{c.fuseAlways}</p>
            <p className="text-[10px] leading-snug text-red-400">{c.noUno}</p>
            <p className="text-[10px] leading-snug text-slate-500">{c.benchLamps}</p>
          </div>

          <div className="border-t border-slate-800 pt-4">
            <PartsList manifest={BENCH_PARTS} name={benchPartName} note={benchPartNote} />
          </div>
        </>
      ) : (
        <TestChecks kombi={kombi} reference={kombi.session?.reference ?? reference} />
      )}
    </div>
  );
}
