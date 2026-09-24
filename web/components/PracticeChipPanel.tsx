'use client';

/**
 * READ, before a PRACTICE connect: what the simulated chip will hold - the made-up chip, or a file.
 *
 * It sits where the chip is read, because it is chosen before CONNECT and says what READ will find.
 * The file is copied: the practice run never writes to it (lib/link/mockLink.ts). A file that is
 * one byte value repeated is refused by the caller - a practice run on a floating wire rehearses
 * nothing. The choice stays on screen, named, until it is cleared.
 */

import { FlaskConical, X } from 'lucide-react';

import { DropZone } from '@/components/DropZone';
import { MicroLabel, TextButton } from '@/components/ui';
import { CHROME } from '@/lib/copy/chrome';
import { jc } from '@/lib/copy/job';

export function PracticeChipPanel({
  chip,
  madeUp,
  error,
  onFile,
  onClear,
}: {
  /** The file chosen, or null for the made-up chip. */
  chip: { name: string } | null;
  /** The definition file the made-up chip is built to fit, once the definitions are here. */
  madeUp: string | null;
  error: string | null;
  onFile: (file: File) => void;
  onClear: () => void;
}) {
  const c = jc();
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto">
      <div className="flex w-[min(26rem,100%)] flex-col gap-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="size-3.5 shrink-0 text-amber-400" />
          <MicroLabel as="h3">{CHROME.practiceChip.title}</MicroLabel>
          {chip && (
            <TextButton tone="danger" Icon={X} onClick={onClear} className="ml-auto">
              {CHROME.practiceChip.clear}
            </TextButton>
          )}
        </div>
        <p className="truncate font-mono text-[11px] text-amber-400">{chip ? chip.name : c.practice.madeUp(madeUp)}</p>
        <p className="text-[10px] leading-snug text-slate-500">{c.practice.lead}</p>
        <DropZone onFile={onFile} hint={CHROME.drop.file} />
        {/* Reserved: a refusal appears here without moving the drop zone. */}
        <p className="min-h-[28px] text-[10px] leading-snug text-red-400">{error ?? ''}</p>
      </div>
    </div>
  );
}
