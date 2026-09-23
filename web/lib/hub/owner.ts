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
import { modeOf, type AppMode } from '@/lib/domain/modes';

export type LinkOwner = 'bridge' | 'cluster';

/** CHIP mode is the UNO bridge's, TEST mode the cluster link's. */
export const linkOwnerOfMode = (mode: AppMode): LinkOwner => (mode === 'test' ? 'cluster' : 'bridge');

export const linkOwnerOf = (step: StepId): LinkOwner => linkOwnerOfMode(modeOf(step));
