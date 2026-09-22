'use client';

/**
 * Stored records: what was read off a chip, and what was sent to one.
 *
 * Append-only by construction - the table only reads and deletes. A backup is
 * re-downloadable from here, which is what makes "back up before you write"
 * worth doing rather than a box to tick.
 */

import { Download, Trash2, FileCode } from 'lucide-react';
import { backupFilename, downloadImage, type DeviceRecord } from '@/lib/domain/records';
import { g } from '@/lib/copy/guide';

export function RecordsTable({
  records,
  onDelete,
}: {
  records: DeviceRecord[];
  onDelete: (id: string) => void;
}) {
  const c = g();

  if (records.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-slate-700">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-slate-800 opacity-50">
          <FileCode className="h-6 w-6 opacity-50" />
        </div>
        <p className="font-mono text-xs opacity-50">{c.noRecords}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full font-mono text-[10px]">
        <thead>
          <tr className="sticky top-0 bg-slate-950 text-left uppercase tracking-wider text-slate-500">
            <th className="px-3 py-2">when</th>
            <th className="px-3 py-2">kind</th>
            <th className="px-3 py-2">vin</th>
            <th className="px-3 py-2">km</th>
            <th className="px-3 py-2">hash</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/50">
          {records.map((r) => (
            <tr key={r.id} className="hover:bg-slate-800/50">
              <td className="px-3 py-1 text-slate-400">{new Date(r.createdAt).toLocaleString()}</td>
              <td className="px-3 py-1">
                <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-blue-400">
                  {r.kind}
                </span>
                {r.practice && (
                  <span className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-amber-400">
                    practice
                  </span>
                )}
              </td>
              <td className="px-3 py-1 text-slate-300">{r.vin ?? '—'}</td>
              <td className="px-3 py-1 tabular-nums text-blue-400">
                {r.km === null ? '—' : r.km.toLocaleString()}
              </td>
              <td className="px-3 py-1 text-slate-600">{r.hash.slice(0, 10)}</td>
              <td className="px-3 py-1 text-right">
                <button
                  onClick={() =>
                    downloadImage(r.bytes, backupFilename(r.vin, r.km, new Date(r.createdAt), r.practice))
                  }
                  className="mr-2 text-slate-600 transition-colors hover:text-blue-400"
                  title="download .bin"
                >
                  <Download className="h-3 w-3" />
                </button>
                <button
                  onClick={() => onDelete(r.id)}
                  className="text-slate-600 transition-colors hover:text-red-400"
                  title="delete record"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
