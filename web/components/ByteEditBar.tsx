'use client';

/**
 * REWRITE's HEX edit bar: the byte picked in the hex view, what it is where that is known, its
 * value, and a new one - or, where the input would be, why it is not changed by hand
 * (lib/domain/byteEdits.ts byteLock), or which later part of the job writes it anyway.
 *
 * One line and always there - a reserved slot (tsunagi-m-design section 3): picking a byte changes
 * what it says, never how tall it is. The count, UNDO and REVERT are the side panel's BYTES line;
 * this bar is about one byte. The parent keys it by the address, so a new pick starts with an
 * empty input.
 */

import { useState } from 'react';

import { TextButton, LABEL } from '@/components/ui';
import { explainAddress } from '@/lib/domain/addressMap';
import type { ByteLock } from '@/lib/domain/byteEdits';
import { formatAddress, formatByte } from '@/lib/domain/image';
import { CHROME } from '@/lib/copy/chrome';
import { jc } from '@/lib/copy/job';

/** A part of the job after BYTES that writes the byte, whatever is typed here. */
export type LaterPart = 'vin' | 'coding';

export function ByteEditBar({
  address,
  image,
  lock,
  later,
  onSet,
}: {
  address: number | null;
  /** The image on screen: what the byte holds, and what it is. */
  image: Uint8Array;
  lock: ByteLock | null;
  later: LaterPart | null;
  onSet: (value: number) => void;
}) {
  const c = jc();
  const [value, setValue] = useState('');

  if (address === null) {
    return (
      <div className="flex h-7 shrink-0 items-center">
        <span className={`${LABEL} text-slate-600`}>{CHROME.job.pickByte}</span>
      </div>
    );
  }

  const held = image[address] ?? 0;
  const parsed = /^[0-9a-f]{1,2}$/i.test(value.trim()) ? Number.parseInt(value, 16) : null;
  const reason = lock ? c.bytes.lock[lock] : later ? c.bytes.later[later] : null;
  const set = () => {
    if (parsed === null || parsed === held) return;
    onSet(parsed);
    setValue('');
  };

  return (
    <div className="flex h-7 min-w-0 shrink-0 items-center gap-2 font-mono text-[11px]">
      <span className="shrink-0 text-slate-500">0x{formatAddress(address)}</span>
      <Meaning image={image} address={address} />
      <span className="shrink-0 text-slate-300">{formatByte(held)}</span>
      {reason ? (
        <span className="min-w-0 truncate font-sans text-[10px] text-slate-500">{reason}</span>
      ) : (
        <>
          <span className="shrink-0 text-slate-600">&rarr;</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') set();
            }}
            placeholder={formatByte(held)}
            maxLength={2}
            aria-label={`0x${formatAddress(address)}`}
            className="w-10 shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-center text-[11px] text-slate-200 outline-none
                       placeholder:text-slate-700 focus:ring-1 focus:ring-blue-500/60"
          />
          <TextButton onClick={set} disabled={parsed === null || parsed === held}>
            {CHROME.job.set}
          </TextButton>
        </>
      )}
    </div>
  );
}

/** What the byte is, where that is earned (addressMap.ts): an odometer register, a VIN field, a checksum. */
function Meaning({ image, address }: { image: Uint8Array; address: number }) {
  const m = explainAddress(image, address);
  const text =
    m.kind === 'odometer'
      ? `${CHROME.job.odometerSlot} ${m.slot}${m.half === 'high' ? 'H' : 'L'}`
      : m.kind === 'vin'
        ? `${CHROME.job.vinField} ${m.field.toUpperCase()}`
        : m.kind === 'checksum'
          ? CHROME.job.checksumByte
          : null;
  return text ? <span className={`${LABEL} min-w-0 shrink truncate text-slate-600`}>{text}</span> : null;
}
