/**
 * The hub while the cluster link owns the tab (TEST): the one next action, derived.
 *
 * Unlike the bridge's hub this one does not walk the checks - they are the reader's to choose, in
 * the panel. The hub holds the SESSION: open it, end it, keep what it found. While the session is
 * open the cluster may be holding a needle or a lamp this tool set, so STOP is armed: it pulses,
 * and stays pressable while a check runs, because ending a sweep half way is exactly when it is
 * needed.
 */

import { FileDown, Loader2, OctagonX, Plug } from 'lucide-react';
import type { HubConfig } from '@/components/Hub';
import type { KombiPhase } from '@/lib/hooks/useKombiLink';
import { CHROME } from '@/lib/copy/chrome';

export type KombiHubState = {
  phase: KombiPhase;
  /** Between CONNECT and STOP: the diagnostic session is open. */
  sessionOpen: boolean;
  act: {
    connect: () => void;
    stop: () => void;
    saveReport: () => void;
  };
};

const nothing = () => {};

export function kombiHubFor(s: KombiHubState): HubConfig {
  switch (s.phase) {
    case 'connecting':
      return { label: CHROME.hub.connecting, Icon: Loader2, onClick: nothing, spin: true, disabled: true };
    case 'stopping':
      return { label: CHROME.hub.stopping, Icon: Loader2, onClick: nothing, spin: true, disabled: true };
    case 'disconnected':
      return { label: CHROME.hub.connect, Icon: Plug, onClick: s.act.connect };
    case 'connected':
      return s.sessionOpen
        ? { label: CHROME.hub.stop, Icon: OctagonX, onClick: s.act.stop, armed: true }
        : { label: CHROME.hub.saveReport, Icon: FileDown, onClick: s.act.saveReport };
    default: {
      const unreachable: never = s.phase;
      return unreachable;
    }
  }
}
