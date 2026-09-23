'use client';

/**
 * What the image says about the vehicle - the "picture" in the right column.
 *
 * Everything here is read off the image on every render, so it cannot
 * disagree with the bytes. Where the image is not a state the encoding can
 * produce, it says so rather than showing a plausible number.
 */

import { Cpu, Fingerprint, Gauge } from 'lucide-react';
import type { OdometerDecode } from '@/lib/domain/odometer';
import type { VinFields } from '@/lib/domain/vin';
import type { ChipAssessment } from '@/lib/domain/image';
import { STATUS_BIT_DEFS, type StatusBits } from '@/lib/domain/status';
import { t } from '@/lib/i18n';
import { CHROME } from '@/lib/copy/chrome';
import { LABEL } from '@/components/ui';

export type VehicleInfoProps = {
  odometer: OdometerDecode | null;
  vins: VinFields | null;
  chip: ChipAssessment | null;
  status: StatusBits | null;
};

export function VehicleInfo({ odometer, vins, chip, status }: VehicleInfoProps) {
  const copy = t();

  return (
    <div className="flex h-full flex-col justify-center gap-5 px-5 py-4">
      {/* Odometer - the headline reading */}
      <Readout icon={<Gauge className="h-3 w-3" />} label={CHROME.readout.odometer}>
        {odometer === null ? (
          <Dim>—</Dim>
        ) : odometer.ok ? (
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-bold leading-none text-blue-400 tabular-nums">
              {odometer.km.toLocaleString()}
            </span>
            <span className={`${LABEL} text-slate-500`}>
              km
            </span>
            {!odometer.canonical && (
              <span className="ml-2 text-[10px] font-mono uppercase text-amber-400">
                non-canonical
              </span>
            )}
          </div>
        ) : (
          <span className="font-mono text-[11px] text-red-400">{copy.odometerUnreadable}</span>
        )}
      </Readout>

      {odometer?.ok && (
        <div className="-mt-3 flex flex-wrap gap-x-3 gap-y-1 pl-5 font-mono text-[10px] text-slate-600">
          <span>
            base <span className="text-slate-400">0x{odometer.base.toString(16).toUpperCase()}</span>
          </span>
          <span>
            ×16 + <span className="text-slate-400">{odometer.remainder}</span>
          </span>
          {odometer.groups.map((g, i) => (
            <span key={i}>
              {g.count}× <span className="text-slate-400">0x{g.value.toString(16).toUpperCase()}</span>
            </span>
          ))}
        </div>
      )}

      {/* VIN */}
      <Readout icon={<Fingerprint className="h-3 w-3" />} label={CHROME.readout.vin}>
        {vins === null ? (
          <Dim>—</Dim>
        ) : vins.none ? (
          <span className="font-mono text-[11px] text-emerald-400">{CHROME.readout.none}</span>
        ) : (
          /* Both fields, each with its address: they can disagree (vin.ts), and a reader who
             cannot see which bytes a VIN came from cannot check it. */
          <div className="flex flex-col gap-1">
            {vins.coded && <VinLine field={CHROME.readout.coded} text={vins.coded.text} at={vins.coded.from} />}
            {vins.ascii && (
              <VinLine
                field={CHROME.readout.ascii}
                text={vins.ascii.text}
                at={vins.ascii.offset}
                extra={vins.candidates.length > 1 ? `+${vins.candidates.length - 1}` : undefined}
              />
            )}
            {vins.differ && <span className={`${LABEL} text-amber-400`}>{CHROME.readout.differ}</span>}
          </div>
        )}
      </Readout>

      {/* Chip */}
      <Readout icon={<Cpu className="h-3 w-3" />} label="CHIP">
        {chip === null ? (
          <Dim>{CHROME.status.notRead}</Dim>
        ) : (
          <span
            className={`font-mono text-[11px] ${
              chip.blank ? 'text-emerald-400' : 'text-slate-300'
            }`}
          >
            {chip.blank ? CHROME.status.blank : CHROME.status.used}
          </span>
        )}
      </Readout>

      {/* Status register - the machine's own view, always eight cells wide so
          the row never reflows as bits change. */}
      <div className="grid grid-cols-8 gap-1 border-t border-slate-800 pt-3">
        {STATUS_BIT_DEFS.map((def) => {
          const set = status ? status[def.key] : false;
          const tone = !status
            ? 'text-slate-700'
            : !set
              ? 'text-slate-600'
              : def.severity === 'bad'
                ? 'text-red-400'
                : def.severity === 'good'
                  ? 'text-emerald-400'
                  : def.severity === 'busy'
                    ? 'text-amber-400 animate-pulse'
                    : 'text-slate-300';
          return (
            <div key={def.key} className="flex flex-col items-center gap-0.5" title={def.meaning}>
              <span className={`font-mono text-[8px] tracking-wider ${tone}`}>{def.label}</span>
              <span className={`font-mono text-[10px] font-bold ${tone}`}>{set ? '1' : '0'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Readout({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`flex items-center gap-1.5 ${LABEL} text-slate-500`}>
        {icon}
        {label}
      </span>
      <div className="pl-5">{children}</div>
    </div>
  );
}

function VinLine({ field, text, at, extra }: { field: string; text: string; at: number; extra?: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className={`${LABEL} w-12 text-slate-600`}>{field}</span>
      <span className="font-mono text-base font-bold tracking-wider text-slate-200">{text}</span>
      <span className="font-mono text-[10px] text-slate-600">@0x{at.toString(16).toUpperCase().padStart(3, '0')}</span>
      {extra && <span className="font-mono text-[10px] text-amber-500">{extra}</span>}
    </span>
  );
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px] text-slate-700">{children}</span>;
}
