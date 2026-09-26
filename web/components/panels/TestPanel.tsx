'use client';

/**
 * TEST mode's two panels (lib/domain/modes.ts): BENCH - how to wire the cluster up - and CHECKS -
 * what to ask it and what it said. Each is a tab with a drawing, and the two sit opposite ways
 * round. BENCH's wiring diagram is the thing studied, so it takes the work surface and the
 * procedure sits beside it. CHECKS is the thing worked through - a dozen checks, their results,
 * and every lamp waiting for SEEN / NOT SEEN - so it takes the work surface and scrolls there,
 * while the drawing of what was commanded is the instrument in the right-hand column. In the
 * column the checks had a few hundred pixels, and a lamp's answer could open below the fold:
 * the lamp lit, nothing asked, and the check looked stopped.
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
        {/* Why the cluster goes to OBD 7 when the car has it on 8 - the question the drawing raises. */}
        <p className="text-[10px] leading-snug text-slate-400">{c.kLinePins}</p>
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
  onReference,
  lang,
  namesLoad,
  onOpenNames,
}: {
  kombi: UseKombiLink;
  /** What the reads are held against - the session follows it - or null to compare nothing. */
  reference: Reference | null;
  /** A dump the reader opened, or null to let go of it. */
  onReference: (reference: Reference | null) => void;
  lang: 'ja' | 'en';
  /** The lamp, output and input names (kombi-names.json), or null while fetching. */
  namesLoad: RefLoad<'kombi-names'> | null;
  onOpenNames: (file: File) => void;
}) {
  return (
    <div className="h-full overflow-y-auto py-2 pr-2">
      <TestChecks
        kombi={kombi}
        reference={reference}
        onReference={onReference}
        lang={lang}
        namesLoad={namesLoad}
        onOpenNames={onOpenNames}
      />
    </div>
  );
}
