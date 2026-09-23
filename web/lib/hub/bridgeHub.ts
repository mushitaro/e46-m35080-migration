/**
 * The hub while the UNO bridge owns the tab: which one action is next, derived from live state.
 *
 * Lifted out of page.tsx unchanged (it was a 130-line useMemo there) so that it can be tested
 * branch by branch and so that the page can host a second hub - the cluster link's - without
 * the two derivations growing into one nested chain. Nothing here is stored: every call reads
 * the state it is handed, so the ring cannot disagree with the chip.
 *
 * Order is the rule. Busy first (the ring is occupied, not gone), then the link, then the image,
 * then the backup - "backup before write" is structural because it is a tier, not a side quest -
 * and only then the job the current tab is about.
 */

import { Plug, Zap, Loader2, Save, Upload } from 'lucide-react';
import type { HubConfig } from '@/components/Hub';
import type { Phase, WriteJob } from '@/lib/hooks/useM35080Link';
import type { StepId } from '@/lib/domain/workflow';
import type { RepairPlan, ResetPlan, Refusal, RewritePlan } from '@/lib/domain/operations';
import type { t } from '@/lib/i18n';
import { CHROME } from '@/lib/copy/chrome';

type Catalog = ReturnType<typeof t>;

export type BridgeHubState = {
  busy: boolean;
  phase: Phase;
  step: StepId;
  hasImage: boolean;
  backedUp: boolean;
  /** The chip read as blank (secure area all zero). False when it has not been read. */
  chipBlank: boolean;
  hasBackupFile: boolean;
  rewritePlan: RewritePlan | Refusal | null;
  restorePlan: ResetPlan | Refusal | null;
  repairPlan: RepairPlan | Refusal | null;
  copy: Pick<Catalog, 'confirmOdometer' | 'confirmReset' | 'confirmRepair'>;
  act: {
    connect: () => void;
    /** Read the chip; the caller moves to READ only when the read succeeded. */
    read: () => void;
    backup: () => void;
    /** Open the confirm dialog for a write. The hub never writes by itself. */
    ask: (job: WriteJob, body: string, details: string[]) => void;
  };
};

const hex = (n: number) => n.toString(16).toUpperCase();

export function bridgeHubFor(s: BridgeHubState): HubConfig {
  if (s.busy) {
    const label =
      s.phase === 'connecting'
        ? CHROME.hub.connecting
        : s.phase === 'reading'
          ? CHROME.hub.reading
          : s.phase === 'verifying'
            ? CHROME.hub.verifying
            : CHROME.hub.writing;
    return { label, Icon: Loader2, onClick: () => {}, spin: true, disabled: true };
  }
  if (s.phase === 'disconnected') {
    return { label: CHROME.hub.connect, Icon: Plug, onClick: s.act.connect };
  }
  /* Reading lands the user on the tab that shows the result - only on success, because a
     refused read keeps the PREVIOUS image and navigating would show the wrong chip's data. */
  if (!s.hasImage) {
    return { label: CHROME.hub.read, Icon: Zap, onClick: s.act.read };
  }

  // Backup is not a side quest: it is the next step in the sequence, and gating it here is what
  // makes "backup before write" structural.
  if (!s.backedUp) return { label: CHROME.hub.backup, Icon: Save, onClick: s.act.backup };

  const { rewritePlan, restorePlan, repairPlan } = s;

  if (s.step === 'rewrite' && rewritePlan?.ok) {
    return {
      label: CHROME.hub.writeOdometer,
      Icon: Zap,
      danger: true,
      disabled: rewritePlan.secureOps.length === 0 && rewritePlan.byteWrites.length === 0,
      onClick: () =>
        s.act.ask(
          { kind: 'rewrite', byteWrites: rewritePlan.byteWrites, secureOps: rewritePlan.secureOps },
          s.copy.confirmOdometer(
            /* NOT `?? 0`. When the secure area does not decode, the same screen says so in red -
               printing "from 0 km" on the one dialog whose job is to state the true consequence
               made the tool assert a reading it had just refused to give. */
            rewritePlan.currentKm,
            rewritePlan.targetKm,
            rewritePlan.secureOps.length,
          ),
          [
            ...rewritePlan.secureOps.map(
              (o) =>
                `WRINC 0x${o.address.toString(16).padStart(2, '0').toUpperCase()}  0x${hex(o.from)} -> 0x${hex(o.to)}`,
            ),
            ...rewritePlan.byteWrites.map((w) => w.label),
          ],
        ),
    };
  }
  /* RESTORE onto a blank chip: the backup's cluster data, the odometer untouched (planReset). */
  if (s.step === 'restore' && s.chipBlank && restorePlan?.ok) {
    return {
      label: CHROME.hub.writeChip,
      Icon: Upload,
      danger: true,
      onClick: () =>
        s.act.ask({ kind: 'restore', byteWrites: restorePlan.byteWrites, secureOps: [] }, s.copy.confirmReset, [
          ...restorePlan.byteWrites.map((w) => w.label),
          'odometer 0x00-0x1F: not written (stays 0 km)',
        ]),
    };
  }
  /* Not blank: repair what the array has lost instead. Same backup, same "never touch the
     odometer" rule - and repeatable, because it raises no counter, which is what lets it be used
     as a retention test. */
  if (s.step === 'restore' && !s.chipBlank && repairPlan?.ok && repairPlan.byteWrites.length > 0) {
    return {
      label: CHROME.hub.repair,
      Icon: Upload,
      danger: true,
      onClick: () =>
        s.act.ask(
          { kind: 'restore', byteWrites: repairPlan.byteWrites, secureOps: [] },
          s.copy.confirmRepair(repairPlan.addresses.length),
          [...repairPlan.byteWrites.map((w) => w.label), 'odometer 0x00-0x1F: not written'],
        ),
    };
  }
  if (s.step === 'restore') {
    const label = !s.hasBackupFile
      ? CHROME.hub.selectBackup
      : !s.chipBlank && repairPlan?.ok
        ? CHROME.hub.nothingToRepair
        : CHROME.hub.checkBackup;
    return { label, Icon: Upload, onClick: () => {}, disabled: true };
  }
  return { label: CHROME.hub.read, Icon: Zap, onClick: s.act.read };
}
