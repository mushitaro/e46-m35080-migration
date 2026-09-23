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

import { Plug, Zap, Loader2, Save } from 'lucide-react';
import type { HubConfig } from '@/components/Hub';
import type { Phase, WriteJob } from '@/lib/hooks/useM35080Link';
import type { StepId } from '@/lib/domain/workflow';
import type { t } from '@/lib/i18n';
import { CHROME } from '@/lib/copy/chrome';
import { jobHubFor, type JobHubState } from './jobHub';

type Catalog = ReturnType<typeof t>;

export type BridgeHubState = {
  busy: boolean;
  phase: Phase;
  step: StepId;
  hasImage: boolean;
  backedUp: boolean;
  /** REWRITE's job - planned whether or not a chip is read - or null where there is none. */
  job: JobHubState | null;
  copy: Pick<Catalog, 'confirmJob'>;
  act: {
    connect: () => void;
    /** Read the chip; the caller moves to READ only when the read succeeded. */
    read: () => void;
    backup: () => void;
    /** Open the confirm dialog for a write. The hub never writes by itself. */
    ask: (job: WriteJob, body: string, details: string[]) => void;
  };
};

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

  /* REWRITE: the job - the source, the odometer, the VIN and the coding - in one write. */
  if (s.step === 'rewrite' && s.job) return jobHubFor(s.job, s.copy.confirmJob, s.act.ask);

  return { label: CHROME.hub.read, Icon: Zap, onClick: s.act.read };
}
