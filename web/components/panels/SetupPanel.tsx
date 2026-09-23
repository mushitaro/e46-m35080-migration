'use client';

/**
 * The right-hand side of the SETUP step: the procedure, the wire list, and the
 * parts. The diagram itself lives in the work surface beside it, sharing the
 * highlight state so the two cannot drift apart.
 */

import { AssemblyGuide, type GuideStepId } from '@/components/AssemblyGuide';
import { WiringLegend } from '@/components/WiringDiagram';
import { PartsList } from '@/components/PartsList';
import { g, partName, partNote } from '@/lib/copy/guide';
import { SETUP_PARTS } from '@/lib/domain/partsData';
import { CHROME } from '@/lib/copy/chrome';
import { MicroLabel } from '@/components/ui';

export function SetupPanel({
  guideStep,
  onGuideStep,
  doneIds,
  onToggleDone,
  wire,
  onWire,
}: {
  guideStep: GuideStepId;
  onGuideStep: (id: GuideStepId) => void;
  doneIds: Set<GuideStepId>;
  onToggleDone: (id: GuideStepId) => void;
  wire: string | null;
  onWire: (name: string | null) => void;
}) {
  const c = g();
  return (
    <div className="flex flex-col gap-5 px-5 py-4">
      <AssemblyGuide
        active={guideStep}
        onSelect={onGuideStep}
        doneIds={doneIds}
        onToggleDone={onToggleDone}
      />

      <div className="flex flex-col gap-2 border-t border-slate-800 pt-4">
        <MicroLabel as="h3">
          {CHROME.setup.wiring}
        </MicroLabel>
        <WiringLegend selected={wire} onSelect={onWire} />
        {/* The question everyone asks first, answered where the wiring is. */}
        <p className="text-[10px] leading-snug text-slate-400">{c.unoPower}</p>
        {/* The two mistakes that cost a chip, stated where the wiring is. */}
        <p className="text-[10px] leading-snug text-amber-400">{c.wiringNotStandard}</p>
        <p className="text-[10px] leading-snug text-red-400">{c.wiringVoltage}</p>
      </div>

      <div className="border-t border-slate-800 pt-4">
        <PartsList manifest={SETUP_PARTS} name={partName} note={partNote} />
      </div>
    </div>
  );
}
