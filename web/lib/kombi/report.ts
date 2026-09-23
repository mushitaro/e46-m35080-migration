/**
 * The TEST report: everything a bench session found, as one JSON file.
 *
 * Written on every path - a session that failed half way is the one most worth keeping
 * (tsunagi-m-link section 15) - and it says how the session ended next to what it found. What was
 * ASKED is kept beside what HAPPENED: every telegram the gate approved, with its outcome, so a
 * rejection is a status number and not an absence.
 *
 * Download only. TEST reports are not SYNCed: the SYNC schema and the privacy page describe chip
 * records, and a report is not one.
 */

import { toHex } from '@tsunagi/ds2-core';
import { fileStamp } from '@/lib/domain/records';
import { BENCH_PINOUT } from '@/lib/domain/clusterBench';
import type { EepromCheck, FieldCheck, ItemResult, Reference } from './checks';
import type { Decoded, Ident, PortValue } from './decode';
import type { SentRecord } from './kombiLink';
import { WORD_MAPPING_HYPOTHESIS, type KombiVariant } from './protocol';

export type SessionEnd =
  | { kind: 'in-progress' }
  /** The reader pressed STOP. */
  | { kind: 'stopped'; sessionEnded: boolean }
  /** The link failed; the error verbatim. */
  | { kind: 'failed'; code: string; message: string; sessionEnded: boolean }
  | { kind: 'disconnected'; sessionEnded: boolean };

export type TestSession = {
  practice: boolean;
  startedAt: number;
  endedAt: number | null;
  end: SessionEnd;
  ident: Decoded<Ident> | null;
  variant: KombiVariant | null;
  benchConfirmed: boolean;
  reference: Reference | null;
  vin: FieldCheck[] | null;
  odometer: FieldCheck | null;
  /** The cluster's own reading of each, as decoded - the file name uses these. */
  clusterVin: string | null;
  clusterKm: number | null;
  faults: { bytes: string } | { error: string } | null;
  inputs: PortValue[] | null;
  eeprom: EepromCheck | null;
  items: ItemResult[];
  /** After STOP: did the needles and lamps go back to the cluster's own? The reader's answer. */
  released: 'returned' | 'not-returned' | null;
  telegrams: readonly SentRecord[];
};

export type TestReport = ReturnType<typeof buildReport>;

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export function buildReport(s: TestSession) {
  // Heartbeats are counted, not listed: at one every two seconds they would bury the rest.
  const beats = s.telegrams.filter((t) => t.kind === 'keep-alive');
  return {
    schema: 1 as const,
    tool: 'E46 M35080 /// MIGRATION - TEST',
    practice: s.practice,
    startedAt: iso(s.startedAt),
    endedAt: iso(s.endedAt),
    end: s.end,
    cluster: {
      variant: s.variant,
      ident: s.ident?.ok ? s.ident.value : s.ident ? { unreadable: s.ident.reason } : null,
      vin: s.clusterVin,
      km: s.clusterKm,
    },
    bench: { confirmed: s.benchConfirmed, pinout: BENCH_PINOUT },
    reference: s.reference
      ? { source: s.reference.source, label: s.reference.label, at: iso(s.reference.at) }
      : null,
    assumptions: { eepromWordMapping: WORD_MAPPING_HYPOTHESIS },
    compared: { vin: s.vin, odometer: s.odometer, eeprom: s.eeprom },
    read: { faults: s.faults, inputs: s.inputs },
    driven: s.items,
    released: s.released,
    telegrams: s.telegrams
      .filter((t) => t.kind !== 'keep-alive')
      .map((t) => ({ at: iso(t.at), kind: t.kind, frame: toHex(t.frame).toUpperCase(), outcome: t.outcome })),
    keepAlive: {
      sent: beats.length,
      acknowledged: beats.filter((t) => t.outcome.kind === 'acknowledged').length,
    },
  };
}

/** TestReport_<VIN|noVIN>_<km|noKM>_<stamp>.json, PRACTICE_ first for a rehearsal. */
export function reportFilename(vin: string | null, km: number | null, when: Date, practice: boolean): string {
  const parts = [practice ? 'PRACTICE_TestReport' : 'TestReport', vin ?? 'noVIN', km === null ? 'noKM' : `${km}km`, fileStamp(when)];
  return `${parts.join('_')}.json`;
}

export function downloadReport(report: TestReport, filename: string): void {
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
