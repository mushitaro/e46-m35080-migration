/**
 * The hub on REWRITE, once the bridge tiers are satisfied (connected, read, backed up): the job's
 * one write, or why the ring is idle.
 *
 * Derived, never stored. WRITE CHIP exists only for a plan planJob accepted AND that writes
 * something - so the ring cannot offer a write the planner refused, and a refusal's words are in
 * the side panel's reserved line, not here.
 */

import { FileCode2, Zap } from 'lucide-react';
import type { HubConfig } from '@/components/Hub';
import type { WriteJob } from '@/lib/hooks/useM35080Link';
import { jobDetails, summarize, writesSomething, type JobInput, type JobPlan, type JobRefusal, type JobSummary } from '@/lib/domain/job';
import { CHROME } from '@/lib/copy/chrome';

export type JobHubState = {
  /** Null while there is nothing to plan: the DUMP source chosen and no dump opened yet. */
  input: JobInput | null;
  plan: JobPlan | JobRefusal | null;
  /** Kept with the record (jobNote). */
  note: string;
};

const idle = (label: string): HubConfig => ({ label, Icon: FileCode2, onClick: () => {}, disabled: true });

export function jobHubFor(
  s: JobHubState,
  confirm: (j: JobSummary) => string,
  ask: (job: WriteJob, body: string, details: string[]) => void,
): HubConfig {
  if (!s.plan || !s.input) return idle(CHROME.hub.noChanges);
  if (!s.plan.ok) return idle(CHROME.hub.checkPlan);
  if (!writesSomething(s.plan)) return idle(CHROME.hub.noChanges);
  const plan = s.plan;
  const input = s.input;
  return {
    label: CHROME.hub.writeChip,
    Icon: Zap,
    danger: true,
    onClick: () =>
      ask(
        {
          /* What the record says it was: a dump put on the chip is a restore, anything else a rewrite. */
          kind: input.source.kind === 'dump' ? 'restore' : 'rewrite',
          byteWrites: plan.byteWrites,
          secureOps: plan.secureOps,
          note: s.note,
        },
        confirm(summarize(plan, input)),
        jobDetails(plan, input),
      ),
  };
}
