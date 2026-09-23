/**
 * MODE - what the tool is working on, and so which tabs, which cable and which hub.
 *
 *   CHIP  the M35080 off its board, on the UNO: SETUP, READ, REWRITE (the job - source, odometer,
 *         VIN, coding - in one write), INSPECT, RECORDS
 *   TEST  the cluster with its chip back in, on the bench over the K+DCAN cable: BENCH, CHECKS
 *
 * The same shape as TUNER's VE / IDLE: the mode chooses the tabs AND their order, and a corner in
 * the hub panel changes it (components/ModeCorner.tsx). The two modes are two different things on
 * two different cables, so a tab belongs to exactly one of them, and the hub, the status rows and
 * PRACTICE speak for that mode's link (lib/hub/owner.ts) - no control on TEST can act on the UNO,
 * none on CHIP on the cluster.
 *
 * Which modes a build OFFERS is the registry's answer, not this file's: a mode none of whose tabs
 * the build may draw is not offered (TEST is experimental, so a release is CHIP only).
 */

import type { StepId } from './workflow';

export type AppMode = 'chip' | 'test';

export const MODES: readonly AppMode[] = ['chip', 'test'];

/** Each mode's tabs, in the order the job is done. */
export const MODE_STEPS: Record<AppMode, readonly StepId[]> = {
  chip: ['setup', 'read', 'rewrite', 'inspect', 'records'],
  test: ['bench', 'checks'],
};

/** The mode a tab belongs to. Every tab has exactly one (test/modes.test.ts). */
export function modeOf(step: StepId): AppMode {
  return MODE_STEPS.test.includes(step) ? 'test' : 'chip';
}

/** The modes this build offers: those with at least one tab it may draw. */
export function selectableModes(visible: ReadonlySet<string>): AppMode[] {
  return MODES.filter((m) => MODE_STEPS[m].some((s) => visible.has(s)));
}

/**
 * Why the mode cannot be changed right now, or null.
 *
 *   busy     the chip link is reading or writing: its progress and its hub must stay on screen
 *   session  the cluster is in a diagnostic session - it may be holding a needle or a lamp that
 *            only STOP gives back, and STOP is TEST's hub
 */
export type ModeLock = 'busy' | 'session' | null;

export function modeLock(s: { bridgeBusy: boolean; clusterSessionOpen: boolean; clusterBusy: boolean }): ModeLock {
  if (s.bridgeBusy) return 'busy';
  if (s.clusterSessionOpen || s.clusterBusy) return 'session';
  return null;
}
