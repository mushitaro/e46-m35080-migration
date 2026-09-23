/**
 * The registry: which surfaces a build is allowed to draw.
 *
 * tsunagi-m-release section 2. The point of putting this in one file is that
 * "what does staging show?" stops being a decision someone makes at deploy
 * time and becomes something the running app reads out of its own code. A
 * deploy's only input about scope is the variant string; everything else is
 * here.
 *
 * WHAT THIS FILE DOES NOT DO
 *
 * It answers "may this be drawn", never "where". The order of the tabs belongs
 * to workflow.ts, which changes far more often - a registry holding both would
 * be two decisions in one file (section 2.4).
 *
 * It also only ever CLOSES things. `enabledSurfaces(true)` is a superset of
 * `enabledSurfaces(false)`, enforced by a test, so no arrangement of flags can
 * make preview hide something the release shows.
 *
 * CREATING IT CHANGED NOTHING
 *
 * Every surface below is `stable`, because every surface ships today. Writing
 * the registry is recording the current state, not re-deciding it: promotion
 * and demotion are the operator's call (section 2.7), and an agent that
 * "tidied up" by demoting something on first contact would be making that call
 * silently.
 */

import type { StepId } from './workflow';

/**
 * `stable`              every environment draws it. This is what a release is.
 * `experimental`        non-production only, AWAITING promotion.
 * `permanently-closed`  non-production only, and never promoted, because
 *                       something published depends on its absence. Kept
 *                       distinct from `experimental` so nobody in a hurry
 *                       reads the list as a to-do (section 2.2).
 */
export type Stage = 'stable' | 'experimental' | 'permanently-closed';

/** Today every surface is a step in the workflow strip. */
export type Surface = StepId;

export type Feature = {
  id: string;
  stage: Stage;
  /**
   * Every surface this feature owns - a group, not one tab. If one screen is
   * generated from another's results there is no world where half of it ships,
   * so that is one entry with two surfaces, not two entries.
   */
  surfaces: Surface[];
  /** Why it is closed. Required for anything not `stable`. */
  reason?: string;
};

export const FEATURES: Feature[] = [
  {
    id: 'bench-setup',
    stage: 'stable',
    surfaces: ['setup'],
  },
  {
    /* Reading and the panels that explain what was read are one feature: the
       address map and the structure list are generated FROM the image, so a
       build with one and not the other cannot exist. */
    id: 'read-and-explain',
    stage: 'stable',
    surfaces: ['read'],
  },
  {
    id: 'restore-from-backup',
    stage: 'stable',
    surfaces: ['restore'],
  },
  {
    id: 'rewrite-odometer-and-vin',
    stage: 'stable',
    surfaces: ['rewrite'],
  },
  {
    /* Opening a file and opening a chip share every reader, but they are not
       one feature: this one works with no hardware and cannot reach the write
       path at all. */
    id: 'inspect-file',
    stage: 'stable',
    surfaces: ['inspect'],
  },
  {
    id: 'records',
    stage: 'stable',
    surfaces: ['records'],
  },
  {
    /* RECORDS › SYNC, the error records, and the PRIVACY link. No tab of its
       own: the SYNC panel sits beside the RECORDS table, and its surfaces are
       gated on the variant where they are drawn (tsunagi-m-chrome section 6). */
    id: 'owner-sync',
    stage: 'permanently-closed',
    surfaces: [],
    reason:
      'Production is local-only: nothing leaves the device. The preview, for owners holding owner_preview on m3, sends the records an owner SYNCs and error records to their own account (operator, 2026-09-23). Promoting it would make that promise false.',
  },
];

/**
 * The surfaces this build may draw.
 *
 * `preview` is the only input, and it can only ADD. A release is
 * `enabledSurfaces(false)`.
 */
export function enabledSurfaces(preview: boolean): Set<Surface> {
  const out = new Set<Surface>();
  for (const f of FEATURES) {
    if (f.stage !== 'stable' && !preview) continue;
    for (const s of f.surfaces) out.add(s);
  }
  return out;
}

/** Which feature owns a surface. Exactly one, or the stages disagree. */
export function ownerOf(surface: Surface): Feature | undefined {
  return FEATURES.find((f) => f.surfaces.includes(surface));
}
