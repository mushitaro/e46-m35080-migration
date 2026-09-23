/**
 * Which link a tab belongs to - the UNO bridge (the chip on the breadboard) or the cluster link
 * (the K+DCAN cable to a cluster on the bench).
 *
 * The page draws ONE hub, one pair of status rows, one notice line and one PRACTICE box, and they
 * all come from the link that owns the tab on screen. Two links can be connected at once - they
 * are two cables to two different things - but a tab only ever speaks for one of them, so its
 * controls can never act on the other.
 */

import type { StepId } from '@/lib/domain/workflow';

export type LinkOwner = 'bridge' | 'cluster';

export function linkOwnerOf(step: StepId): LinkOwner {
  switch (step) {
    case 'test':
      return 'cluster';
    case 'setup':
    case 'read':
    case 'restore':
    case 'rewrite':
    case 'coding':
    case 'inspect':
    case 'records':
      return 'bridge';
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}
