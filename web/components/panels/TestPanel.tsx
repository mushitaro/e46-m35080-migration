'use client';

/**
 * TEST mode's two side panels (lib/domain/modes.ts): BENCH - how to wire the cluster up - and
 * CHECKS - what to ask it and what it said. They were one TEST tab with a toggle between them; now
 * the mode is TEST and each is a tab, beside its own drawing: the bench diagram, or the drawing of
 * what was commanded.
 */

import { ClusterBenchGuide, type BenchStepId } from '@/components/ClusterBenchGuide';
import { ClusterBenchLegend } from '@/components/ClusterBenchDiagram';
import { PartsList } from '@/components/PartsList';
import { TestChecks } from '@/components/panels/TestChecks';
import { MicroLabel } from '@/components/ui';
import { b, benchPartName, benchPartNote } from '@/lib/copy/bench';
import { CHROME } from '@/lib/copy/chrome';
import { BENCH_PARTS } from '@/lib/domain/partsData';
import type { BenchWireId } from '@/lib/domain/clusterBench';
import type { UseKombiLink } from '@/lib/hooks/useKombiLink';
import type { Reference } from '@/lib/kombi/checks';
import type { RefLoad } from '@/lib/refdata/load';

export function BenchPanel({
  benchStep,
  onBenchStep,
  benchDone,
  onToggleBenchDone,
  benchWire,
  onBenchWire,
}: {
  benchStep: BenchStepId;
  onBenchStep: (id: BenchStepId) => void;
  benchDone: Set<BenchStepId>;
  onToggleBenchDone: (id: BenchStepId) => void;
  benchWire: BenchWireId | null;
  onBenchWire: (id: BenchWireId | null) => void;
}) {
  const c = b();
  return (
    <div className="flex flex-col gap-5 px-5 py-4">
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
    </div>
  );
}

export function ChecksPanel({
  kombi,
  reference,
  lang,
  namesLoad,
  onOpenNames,
}: {
  kombi: UseKombiLink;
  /** What the next CONNECT will compare against; the session keeps its own once connected. */
  reference: Reference | null;
  lang: 'ja' | 'en';
  /** The lamp, output and input names (kombi-names.json), or null while fetching. */
  namesLoad: RefLoad<'kombi-names'> | null;
  onOpenNames: (file: File) => void;
}) {
  return (
    <div className="px-5 py-4">
      <TestChecks
        kombi={kombi}
        reference={kombi.session?.reference ?? reference}
        lang={lang}
        namesLoad={namesLoad}
        onOpenNames={onOpenNames}
      />
    </div>
  );
}
