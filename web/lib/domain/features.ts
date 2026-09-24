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

/**
 * A tab (a step of either mode), or a section of one whose stage differs from its tab's: CODING is
 * a section of REWRITE, drawn only where the coding feature is.
 */
export type Surface = StepId | 'coding';

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
    /* REWRITE: the job - the source (the chip, or a file: what RESTORE was), the bytes changed by
       hand (what INSPECT's editor was), the VIN, the coding and the odometer, planned and written as
       one, or saved to a file to write later (lib/domain/job.ts). One feature because it is one
       plan. RESTORE, REWRITE and INSPECT were three stable features; INSPECT was folded in at the
       operator's request (2026-09-24) - its edits reach a chip only through this job's gates. */
    id: 'rewrite-job',
    stage: 'stable',
    surfaces: ['rewrite'],
  },
  {
    /* CODING: the chip read with its own NCS coding definition, and changed through the one
       write path (lib/ncs, docs/CODING.md). The definitions are served behind the owner gate or
       opened from disk - never in this build. */
    id: 'coding-ncs',
    stage: 'experimental',
    /* A section of REWRITE, not a tab: the coding is part of the job. */
    surfaces: ['coding'],
    reason:
      'Measured on chip images and definitions only: no chip changed this way has been put back in a cluster yet (docs/CODING.md, "Not yet confirmed"). Promote after one has, and TEST read it back.',
  },
  {
    /* TEST mode: the cluster on the bench over DS2, through the K+DCAN cable (lib/kombi). Its
       tabs are the whole mode, so a build without them offers CHIP only (modes.ts). */
    id: 'cluster-test-ds2',
    stage: 'experimental',
    surfaces: ['bench', 'checks'],
    reason:
      'Not yet run on a real cluster. Every telegram and the variant rule are read out of the SGBDs, and the X11175 pin numbers come from one public pinout - none of it measured (docs/BENCH.md). Promote after the first bench session confirms them.',
  },
  {
    id: 'records',
    stage: 'stable',
    surfaces: ['records'],
  },
  {
    /* RECORDS › SYNC, the error records, the PRIVACY link, and the first-run
       notice that says what they send before anything is sent. No tab of its
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
