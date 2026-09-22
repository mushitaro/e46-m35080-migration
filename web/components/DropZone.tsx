'use client';

/**
 * A dashed drop area that doubles as a click target (a transparent file input
 * sits over it). Reused for every file input in the app.
 *
 * tsunagi-m-chrome section 5. `accept` stays `.bin`: application/octet-stream
 * is what Android maps it to and what a chip image actually is, so the broad-
 * MIME/narrow-extension split that CSV needs does not apply here. The real
 * check is the caller's, after the pick - and it has to say what was wrong.
 */

import { useCallback, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';

export function DropZone({
  onFile,
  hint,
  accept = '.bin',
}: {
  onFile: (file: File) => void;
  hint: string;
  accept?: string;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const take = useCallback(
    (files: FileList | null) => {
      const f = files?.[0]; // one file, always the first
      if (f) onFile(f);
      /* Clear the input, or picking the SAME file again after a refusal fires
         no change event: the reader fixes nothing, re-picks, and the tool does
         nothing at all - which reads as broken, not as refused. */
      if (inputRef.current) inputRef.current.value = '';
    },
    [onFile],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        take(e.dataTransfer.files);
        e.dataTransfer.clearData();
      }}
      className={`relative flex h-28 cursor-pointer flex-col items-center justify-center gap-2
                  rounded border-2 border-dashed transition-colors
        ${over ? 'border-blue-400 bg-slate-800' : 'border-slate-600 hover:border-blue-400 hover:bg-slate-800'}`}
    >
      <UploadCloud className="h-6 w-6 text-slate-600" />
      <span className="font-mono text-[10px] text-slate-500">{hint}</span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={(e) => take(e.target.files)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}
