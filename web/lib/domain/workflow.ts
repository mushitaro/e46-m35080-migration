/**
 * The workflow: what the tabs are, in the order the job is actually done.
 *
 * The tabs used to be a list of features (DUMP / REWRITE / RESET / RESTORE /
 * RECORDS) with no implied order, while the real sequencing lived in the hub's
 * derived chain. That left a first-time reader with no idea where to start.
 *
 * Here the steps ARE the order: prepare the bench, read the chip, then do the
 * one job the chip allows, then keep the record. The hub stays the single write
 * path - a step says WHICH job you are on, the hub says what to press next.
 *
 * Every prerequisite is DERIVED from live state. Nothing about "which step am
 * I on" is stored, so the strip cannot disagree with the device.
 */

export type StepId = 'setup' | 'read' | 'rewrite' | 'records' | 'bench' | 'checks';

/** Why a step cannot be entered yet. Rendered from i18n, never as prose here. */
export type BlockedReason = 'need-connection';

export type WorkflowState = {
  connected: boolean;
  /** A full image has been read off the chip. */
  hasImage: boolean;
  /** Secure area is all zero - a new chip, or one that has never counted. */
  chipBlank: boolean;
  /** Decoded reading, or null when the secure area is not a state we can read. */
  odometerKm: number | null;
};

export type Step = {
  id: StepId;
  enabled: boolean;
  blockedBy: BlockedReason | null;
};

/* Every tab, CHIP's then TEST's. Which of them a screen shows is the mode's (lib/domain/modes.ts). */
const ORDER: StepId[] = ['setup', 'read', 'rewrite', 'records', 'bench', 'checks'];

/**
 * Derive the whole strip from state.
 *
 * `setup` and `records` are always reachable: one is reference material you may
 * want mid-job, the other is where a backup lives. The two that touch the chip
 * need an image first, because without one there is nothing to plan against.
 */
export function deriveSteps(s: WorkflowState): Step[] {
  return ORDER.map((id) => {
    switch (id) {
      case 'setup':
        // Nothing gates the bench guide.
        return { id, enabled: true, blockedBy: null };

      case 'read':
        return { id, enabled: true, blockedBy: s.connected ? null : 'need-connection' };

      /* REWRITE is the job - the source, the bytes, the VIN, the coding and the odometer, written
         together. Never gated: a file can be opened as the source before any chip is read, changed,
         and saved to be written later (SAVE EDITED) - the third of its three uses. Writing it needs
         a chip, read and backed up, and the hub asks for each in turn (lib/hub/bridgeHub.ts). */
      case 'rewrite':
        return { id, enabled: true, blockedBy: null };

      /* TEST mode: the cluster, not the chip. The chip is back on its board by now, and TEST talks
         to it through the cluster over the K+DCAN cable. Neither needs the UNO nor an image - an
         image only gives the checks something to compare with. */
      case 'bench':
      case 'checks':
        return { id, enabled: true, blockedBy: null };

      case 'records':
        return { id, enabled: true, blockedBy: null };
    }
  });
}

export function stepById(steps: Step[], id: StepId): Step | undefined {
  return steps.find((x) => x.id === id);
}

/**
 * Which job this chip actually allows, decided from the chip rather than left
 * to the reader to work out.
 *
 * The rule the whole tool turns on: the secure area counts up only. So a chip
 * that already reads at or above the target can only be replaced, and one that
 * reads below it can simply be raised - no new chip, no desoldering.
 */
export type Recommendation =
  | { kind: 'unknown' }
  /** Blank chip: it reads 0 km and can be taken anywhere upward. */
  | { kind: 'restore-ready' }
  /** Used chip, below the target: raise it. No chip swap needed. */
  | { kind: 'rewrite-possible'; currentKm: number; targetKm: number }
  /** Used chip, at or above the target: only a new chip can go lower. */
  | { kind: 'needs-new-chip'; currentKm: number; targetKm: number };

export function recommend(s: WorkflowState, targetKm: number | null): Recommendation {
  if (!s.hasImage) return { kind: 'unknown' };
  if (s.chipBlank) return { kind: 'restore-ready' };
  if (s.odometerKm === null || targetKm === null) return { kind: 'unknown' };
  return s.odometerKm <= targetKm
    ? { kind: 'rewrite-possible', currentKm: s.odometerKm, targetKm }
    : { kind: 'needs-new-chip', currentKm: s.odometerKm, targetKm };
}

/** The step a recommendation points at, for the "go here next" affordance. */
export function stepFor(r: Recommendation): StepId | null {
  switch (r.kind) {
    case 'restore-ready':
    case 'rewrite-possible':
      return 'rewrite';
    case 'needs-new-chip':
      return 'setup'; // you need a part before you can do anything
    case 'unknown':
      return null;
  }
}
