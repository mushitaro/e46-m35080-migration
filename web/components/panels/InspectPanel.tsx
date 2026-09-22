'use client';

/**
 * The file workbench: open a dump, see what it is, change a byte, save a copy.
 *
 * It shares every reader with the READ step - the same odometer decode, the
 * same VIN scan, the same address map - and shares no state with the device.
 * That separation is the point; see lib/domain/inspect.ts.
 *
 * Nothing here can write to a chip. The controls are: open, edit, undo,
 * revert, save. A file reaches hardware only through RESTORE, which is gated
 * on a backup and a read-back.
 */

import { useMemo, useState } from 'react';
import { Download, RotateCcw, Undo2, X } from 'lucide-react';

import { DropZone } from '@/components/DropZone';
import { VehicleInfo } from '@/components/VehicleInfo';
import { AddressPanel } from '@/components/panels/AddressPanel';
import { StructurePanel } from '@/components/panels/StructurePanel';
import {
  changedAddresses,
  editByte,
  editedFilename,
  isDirty,
  revertAll,
  undoLast,
  verdictFor,
  type Workspace,
} from '@/lib/domain/inspect';
import { assessChip, formatAddress, formatByte } from '@/lib/domain/image';
import { decodeOdometer } from '@/lib/domain/odometer';
import { secureOf } from '@/lib/domain/image';
import { readVin } from '@/lib/domain/vin';
import { downloadImage } from '@/lib/domain/records';
import { g } from '@/lib/copy/guide';
import { CHROME } from '@/lib/copy/chrome';

export function InspectPanel({
  workspace,
  onOpen,
  onChange,
  onClose,
  selected,
  onSelect,
  fileError,
}: {
  workspace: Workspace | null;
  onOpen: (file: File) => void;
  onChange: (next: Workspace) => void;
  onClose: () => void;
  selected: number | null;
  onSelect: (address: number) => void;
  fileError: string | null;
}) {
  const c = g();
  const [value, setValue] = useState('');

  const image = workspace?.current ?? null;
  const verdict = useMemo(() => (image ? verdictFor(image) : null), [image]);
  const changed = useMemo(() => (workspace ? changedAddresses(workspace) : []), [workspace]);
  const odometer = useMemo(() => (image ? decodeOdometer(secureOf(image)) : null), [image]);
  const vin = useMemo(() => (image ? readVin(image) : null), [image]);
  const chip = useMemo(() => (image ? assessChip(image) : null), [image]);

  if (!workspace || !image || !verdict) {
    return (
      <div className="flex flex-col gap-3 px-5 py-4">
        <h3 className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
          {CHROME.inspect.open}
        </h3>
        <p className="text-[10px] leading-snug text-slate-500">{c.inspectIntro}</p>
        <DropZone onFile={onOpen} hint={CHROME.drop.file} />
        {fileError && <p className="text-[10px] leading-snug text-red-400">{fileError}</p>}
        <p className="text-[10px] leading-snug text-slate-600">{c.inspectNoDevice}</p>
      </div>
    );
  }

  const byteAt = selected !== null ? image[selected] : null;
  const parsed = /^[0-9a-f]{1,2}$/i.test(value.trim()) ? Number.parseInt(value, 16) : null;

  return (
    <div className="flex flex-col">
      {/* ------------------------------ the file --------------------------- */}
      <div className="flex flex-col gap-2 border-b border-slate-800 px-5 py-4">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-mono text-[11px] text-slate-200" title={workspace.name}>
            {workspace.name}
          </span>
          <button
            onClick={onClose}
            title={c.inspectClose}
            className="ml-auto text-slate-600 transition-colors hover:text-red-400"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* The verdict comes before anything decoded FROM the file, because a
            reading taken off a dead bus is the failure this screen exists to
            stop - and it looks exactly like a reading. */}
        {verdict.uniform ? (
          <p className="rounded border border-red-500/30 bg-red-500/5 px-2.5 py-2 text-[10px]
                        leading-snug text-red-300">
            {c.inspectNotAChip(verdict.uniformValue ?? 0)}
          </p>
        ) : (
          <p className="font-mono text-[10px] text-slate-500">
            {c.inspectDistinct(verdict.distinct)}
            {verdict.secureBlank && <span className="ml-2 text-emerald-400">{c.chipBlankShort}</span>}
            {verdict.standardErased && (
              <span className="ml-2 text-amber-400">{c.inspectErased}</span>
            )}
          </p>
        )}
      </div>

      {/* ------------------------------- edit ------------------------------ */}
      <div className="flex flex-col gap-2 border-b border-slate-800 px-5 py-4">
        <h3 className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
          {CHROME.inspect.edit}
        </h3>
        {selected === null ? (
          <p className="text-[10px] text-slate-600">{c.inspectPickByte}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-[11px] text-slate-500">
              0x{formatAddress(selected)}
            </code>
            <code className="font-mono text-[11px] text-slate-300">{formatByte(byteAt ?? 0)}</code>
            <span className="text-slate-600">&rarr;</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value.toUpperCase())}
              placeholder="FF"
              maxLength={2}
              className="w-12 rounded border border-slate-800 bg-slate-950 px-2 py-1 text-center
                         font-mono text-[11px] text-slate-200 outline-none focus:border-blue-500/50"
            />
            <button
              onClick={() => {
                if (parsed === null) return;
                const r = editByte(workspace, selected, parsed);
                if (r.ok) {
                  onChange(r.workspace);
                  setValue('');
                }
              }}
              disabled={parsed === null || parsed === byteAt}
              className="rounded border border-blue-500/40 px-2.5 py-1 text-[10px] font-bold
                         uppercase tracking-widest text-blue-400 transition
                         hover:bg-blue-500/10 disabled:opacity-30"
            >
              {CHROME.inspect.set}
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[10px] text-slate-500">
            {changed.length > 0 ? c.inspectChanged(changed.length) : c.inspectUnchanged}
          </span>
          <button
            onClick={() => onChange(undoLast(workspace))}
            disabled={workspace.edits.length === 0}
            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase
                       tracking-widest text-slate-500 transition hover:text-slate-300
                       disabled:opacity-25"
          >
            <Undo2 className="h-3 w-3" />
            {CHROME.inspect.undo}
          </button>
          <button
            onClick={() => onChange(revertAll(workspace))}
            disabled={!isDirty(workspace)}
            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase
                       tracking-widest text-slate-500 transition hover:text-amber-400
                       disabled:opacity-25"
          >
            <RotateCcw className="h-3 w-3" />
            {CHROME.inspect.revert}
          </button>
          <button
            onClick={() => downloadImage(image, editedFilename(workspace.name, new Date()))}
            className="ml-auto inline-flex items-center gap-1.5 rounded border border-blue-500/40
                       px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-400
                       transition hover:bg-blue-500/10"
          >
            <Download className="h-3 w-3" />
            {CHROME.inspect.saveAs}
          </button>
        </div>
        {/* Saving never lands on the source file. These dumps are often the
            only record of a chip that has since been written over. */}
        <p className="text-[10px] leading-snug text-slate-600">{c.inspectSaveNote}</p>
      </div>

      {/* ---------------------------- what it holds ------------------------ */}
      {/* Nothing is decoded from a file that is not a chip read.
          The first version printed the banner and then, directly beneath it,
          "678,480 km" with the full arithmetic - because 0xA5A5 repeated
          sixteen times decodes perfectly well. Saying "this means nothing" and
          then showing a six-figure reading teaches the reader to scroll past
          the warning. */}
      {verdict.uniform ? (
        <div className="px-5 py-4">
          <p className="text-[10px] leading-snug text-slate-600">{c.inspectNoReadout}</p>
        </div>
      ) : (
        <>
          <VehicleInfo odometer={odometer} vin={vin} chip={chip} status={null} />
          <div className="border-t border-slate-800 px-5 py-4">
            <AddressPanel image={image} onSelect={onSelect} />
          </div>
          <div className="border-t border-slate-800 px-5 py-4">
            <StructurePanel image={image} onSelect={onSelect} />
          </div>
        </>
      )}
    </div>
  );
}
