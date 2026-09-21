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
import type { VinRead } from '@/lib/domain/vin';
import type { ChipAssessment } from '@/lib/domain/image';
import { STATUS_BIT_DEFS, type StatusBits } from '@/lib/domain/status';
import { t } from '@/lib/i18n';

export type VehicleInfoProps = {
  odometer: OdometerDecode | null;
  vin: VinRead | null;
  chip: ChipAssessment | null;
  status: StatusBits | null;
};

export function VehicleInfo({ odometer, vin, chip, status }: VehicleInfoProps) {
  const copy = t();

  return (
    <div className="flex h-full flex-col justify-center gap-5 px-5 py-4">
      {/* Odometer - the headline reading */}
      <Readout icon={<Gauge className="h-3 w-3" />} label={copy.odometer}>
        {odometer === null ? (
          <Dim>—</Dim>
        ) : odometer.ok ? (
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-bold leading-none text-blue-400 tabular-nums">
              {odometer.km.toLocaleString()}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
              km
            </span>
            {!odometer.canonical && (
              <span className="ml-2 text-[9px] font-mono uppercase text-amber-400">
                non-canonical
              </span>
            )}
          </div>
        ) : (
          <span className="font-mono text-[11px] text-red-400">{copy.odometerUnreadable}</span>
        )}
      </Readout>

      {odometer?.ok && (
        <div className="-mt-3 flex flex-wrap gap-x-3 gap-y-1 pl-5 font-mono text-[9px] text-slate-600">
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
      <Readout icon={<Fingerprint className="h-3 w-3" />} label={copy.vin}>
        {vin === null ? (
          <Dim>—</Dim>
        ) : vin.found === null ? (
          <span className="font-mono text-[11px] text-emerald-400">{copy.vinBlank}</span>
        ) : (
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-base font-bold tracking-wider text-slate-200">
              {vin.found.text}
            </span>
            {/* The address is part of the reading. It is not a constant, and a
                reader who cannot see where it came from cannot check it. */}
            <span className="font-mono text-[9px] text-slate-600">
              @0x{vin.found.offset.toString(16).toUpperCase().padStart(3, '0')}
            </span>
            {vin.candidates.length > 1 && (
              <span className="font-mono text-[9px] text-amber-500">
                +{vin.candidates.length - 1}
              </span>
            )}
          </span>
        )}
      </Readout>

      {/* Chip */}
      <Readout icon={<Cpu className="h-3 w-3" />} label="CHIP">
        {chip === null ? (
          <Dim>{copy.chipUnknown}</Dim>
        ) : (
          <span
            className={`font-mono text-[11px] ${
              chip.blank ? 'text-emerald-400' : 'text-slate-300'
            }`}
          >
            {chip.blank ? copy.chipBlank : copy.chipUsed}
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
      <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-500">
        {icon}
        {label}
      </span>
      <div className="pl-5">{children}</div>
    </div>
  );
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px] text-slate-700">{children}</span>;
}
