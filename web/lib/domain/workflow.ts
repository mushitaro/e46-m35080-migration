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
 * Every prerequisite and every completion mark is DERIVED from live state.
 * Nothing about "which step am I on" is stored, so the strip cannot disagree
 * with the device.
 */

export type StepId = 'setup' | 'read' | 'restore' | 'rewrite' | 'inspect' | 'records';

/** Why a step cannot be entered yet. Rendered from i18n, never as prose here. */
export type BlockedReason = 'need-image' | 'need-connection';

export type WorkflowState = {
  connected: boolean;
  /** A full image has been read off the chip. */
  hasImage: boolean;
  /** The current image has been backed up. */
  backedUp: boolean;
  /** Secure area is all zero - a new chip, or one that has never counted. */
  chipBlank: boolean;
  /** Decoded reading, or null when the secure area is not a state we can read. */
  odometerKm: number | null;
  /** How many records are stored. */
  recordCount: number;
  /** A dump file is open on the workbench. Nothing to do with the chip. */
  inspecting: boolean;
};

export type Step = {
  id: StepId;
  /** 1-based position, shown in the tab. */
  ordinal: number;
  enabled: boolean;
  /** The work of this step is done. Drives the check mark. */
  complete: boolean;
  blockedBy: BlockedReason | null;
};

const ORDER: StepId[] = ['setup', 'read', 'restore', 'rewrite', 'inspect', 'records'];

/**
 * Derive the whole strip from state.
 *
 * `setup` and `records` are always reachable: one is reference material you may
 * want mid-job, the other is where a backup lives. The two that touch the chip
 * need an image first, because without one there is nothing to plan against.
 */
export function deriveSteps(s: WorkflowState): Step[] {
  return ORDER.map((id, i) => {
    const ordinal = i + 1;
    switch (id) {
      case 'setup':
        // Nothing gates the bench guide, and it is complete once the link is up:
        // that is the only externally observable proof the wiring is right.
        return { id, ordinal, enabled: true, complete: s.connected, blockedBy: null };

      case 'read':
        return {
          id,
          ordinal,
          enabled: true,
          complete: s.hasImage,
          blockedBy: s.connected ? null : 'need-connection',
        };

      case 'restore':
      case 'rewrite':
        return {
          id,
          ordinal,
          enabled: s.hasImage,
          // A job is never "complete" in the sense a step is - the chip can
          // always be written again. Completion here means "there is a backup
          // and an image", i.e. this step is safe to act from.
          complete: s.hasImage && s.backedUp,
          blockedBy: s.hasImage ? null : 'need-image',
        };

      /* A file on disk, not the chip. Never gated on a connection or an
         image, because needing neither is the whole point: it is how a pile of
         .bin files gets sorted into the ones that are chip reads and the ones
         that are a floating wire. It sits after the bench steps with RECORDS,
         the other surface that touches no hardware. */
      case 'inspect':
        return { id, ordinal, enabled: true, complete: s.inspecting, blockedBy: null };

      case 'records':
        return {
          id,
          ordinal,
          enabled: true,
          complete: s.recordCount > 0,
          blockedBy: null,
        };
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
      return 'restore';
    case 'rewrite-possible':
      return 'rewrite';
    case 'needs-new-chip':
      return 'setup'; // you need a part before you can do anything
    case 'unknown':
      return null;
  }
}
