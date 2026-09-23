/**
 * The hub on CODING, once the bridge tiers are satisfied (connected, read, backed up): the one
 * write this tab can make, or the reason the ring is idle.
 *
 * Derived, never stored. There is no WRITE CODING until a definition is chosen for this chip AND
 * the reader has picked a value that changes something AND planCoding accepted the lot - so the
 * ring cannot offer a write the planner would refuse. The refusal itself is written in the side
 * panel's reserved line; the ring only says CHECK CODING.
 */

import { FileCode2, Zap } from 'lucide-react';
import type { HubConfig } from '@/components/Hub';
import type { WriteJob } from '@/lib/hooks/useM35080Link';
import type { CodingPlan, CodingRefusal } from '@/lib/ncs/encode';
import { CHROME } from '@/lib/copy/chrome';

export type CodingHubState = {
  /** A definition was chosen for this chip (the data is here, and exactly one fits). */
  ready: boolean;
  /** Picks that change something. */
  staged: number;
  plan: CodingPlan | CodingRefusal | null;
  /** Kept with the record: the definition, the data's sha256, each change. */
  note: string;
};

const idle = (label: string): HubConfig => ({ label, Icon: FileCode2, onClick: () => {}, disabled: true });

export function codingHubFor(
  s: CodingHubState,
  confirm: (changes: number, bytes: number) => string,
  ask: (job: WriteJob, body: string, details: string[]) => void,
): HubConfig {
  if (!s.ready) return idle(CHROME.hub.noDefinition);
  if (s.staged === 0 || !s.plan) return idle(CHROME.hub.noChanges);
  if (!s.plan.ok) return idle(CHROME.hub.checkCoding);
  const plan = s.plan;
  return {
    label: CHROME.hub.writeCoding,
    Icon: Zap,
    danger: true,
    onClick: () =>
      ask(
        { kind: 'coding', byteWrites: plan.byteWrites, secureOps: [], note: s.note },
        confirm(plan.changes.length, plan.byteWrites.length),
        [...plan.byteWrites.map((w) => w.label), 'odometer 0x00-0x1F, VIN 0x07A-0x087: not written'],
      ),
  };
}
