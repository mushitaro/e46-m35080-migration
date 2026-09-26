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
import { compareReads, type EepromRead, type ItemResult, type Reference } from './checks';
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
  /** The chip image the reads are held against, fixed at CONNECT - or null, and nothing is compared. */
  reference: Reference | null;
  /**
   * What the cluster answered, decoded - or why it would not decode. Null until read. These ARE
   * the results; a comparison with the reference is derived from them where it is shown.
   */
  vin: Decoded<string> | null;
  odometer: Decoded<number> | null;
  faults: { bytes: string } | { error: string } | null;
  inputs: PortValue[] | null;
  eeprom: EepromRead | null;
  items: ItemResult[];
  /** After STOP: did the needles and lamps go back to the cluster's own? The reader's answer. */
  released: 'returned' | 'not-returned' | null;
  telegrams: readonly SentRecord[];
};

export type TestReport = ReturnType<typeof buildReport>;

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** A read's value, or null when it has not been made or would not decode - the file name uses these. */
export const valueOf = <T>(d: Decoded<T> | null): T | null => (d?.ok ? d.value : null);

/** A read as the report writes it: the value, or what would not decode and how many bytes came. */
const written = <T, U>(d: Decoded<T> | null, show: (v: T) => U) =>
  d === null ? null : d.ok ? show(d.value) : { unreadable: d.reason, got: d.got };

export function buildReport(s: TestSession) {
  // Heartbeats are counted, not listed: at one every two seconds they would bury the rest.
  const beats = s.telegrams.filter((t) => t.kind === 'keep-alive');
  return {
    schema: 2 as const,
    tool: 'E46 M35080 /// MIGRATION - TEST',
    practice: s.practice,
    startedAt: iso(s.startedAt),
    endedAt: iso(s.endedAt),
    end: s.end,
    cluster: {
      variant: s.variant,
      ident: s.ident?.ok ? s.ident.value : s.ident ? { unreadable: s.ident.reason } : null,
      vin: written(s.vin, (v) => v),
      km: written(s.odometer, (v) => v),
    },
    bench: { confirmed: s.benchConfirmed, pinout: BENCH_PINOUT },
    reference: s.reference
      ? { source: s.reference.source, label: s.reference.label, at: iso(s.reference.at) }
      : null,
    assumptions: { eepromWordMapping: WORD_MAPPING_HYPOTHESIS },
    read: {
      faults: s.faults,
      inputs: s.inputs,
      // The words by number, their bytes as the cluster sent them: no chip address is assumed here.
      eeprom: s.eeprom && {
        fromWord: s.eeprom.fromWord,
        words: s.eeprom.words,
        bytes: written(s.eeprom.bytes, (b) => toHex(b).toUpperCase()),
      },
    },
    // Only with a chip image to hold the reads against; without one there is nothing to compare.
    compared: s.reference ? compareReads(s, s.reference) : null,
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
