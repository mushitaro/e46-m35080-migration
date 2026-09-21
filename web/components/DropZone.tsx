'use client';

/**
 * A dashed drop area that doubles as a click target (a transparent file input
 * sits over it). Reused for every file input in the app.
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
      const f = files?.[0];
      if (f) onFile(f);
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
        setOver(false);
        take(e.dataTransfer.files);
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
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </div>
  );
}
