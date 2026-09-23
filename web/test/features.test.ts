import { describe, it, expect } from 'vitest';
import { FEATURES, enabledSurfaces, ownerOf, type Surface } from '@/lib/domain/features';
import { deriveSteps } from '@/lib/domain/workflow';

/**
 * The release set, written out as a literal.
 *
 * tsunagi-m-release section 2.3. A stage is one word, and left alone that word
 * moves in a commit about something else and nobody looks. Pinning the set
 * here means a promotion cannot land without editing this line - in a place
 * where it reads as a deliberate act.
 */
const RELEASE: Surface[] = ['setup', 'read', 'restore', 'rewrite', 'inspect', 'records'];

describe('the feature registry', () => {
  it('ships exactly these surfaces in a release', () => {
    expect([...enabledSurfaces(false)].sort()).toEqual([...RELEASE].sort());
  });

  it('preview can only ADD to the release, never remove', () => {
    /* A preview that hid something the release shows would be testing a
       different app from the one that ships. */
    const release = enabledSurfaces(false);
    const preview = enabledSurfaces(true);
    for (const s of release) expect(preview.has(s)).toBe(true);
  });

  it('gives every surface exactly one owner', () => {
    /* Two features claiming one tab have no answer when their stages differ. */
    const seen = new Map<Surface, string>();
    for (const f of FEATURES) {
      for (const s of f.surfaces) {
        expect(seen.get(s), `${s} is owned by both ${seen.get(s)} and ${f.id}`).toBeUndefined();
        seen.set(s, f.id);
      }
    }
    for (const s of RELEASE) expect(ownerOf(s)).toBeDefined();
  });

  it('makes every non-stable feature say why', () => {
    /* `experimental` and `permanently-closed` are different promises - one is
       waiting, the other never moves - and the difference only survives if the
       reason is written down beside the stage. */
    for (const f of FEATURES) {
      if (f.stage === 'stable') continue;
      expect(f.reason, `${f.id} is ${f.stage} with no reason`).toBeTruthy();
    }
  });

  it('gives every tab the workflow can produce exactly one owner', () => {
    /* A tab with no feature entry is filtered out of every build without a word - it exists in
       workflow.ts and never appears. So every StepId, not just the release set, needs an owner. */
    const ids = deriveSteps({ connected: false, hasImage: false, chipBlank: false, odometerKm: null }).map((s) => s.id);
    for (const id of ids) {
      const owners = FEATURES.filter((f) => f.surfaces.includes(id));
      expect(owners.map((f) => f.id), `${id} owners`).toHaveLength(1);
    }
  });

  it('keeps CODING out of a release: it writes a chip on rules not yet confirmed in a cluster', () => {
    expect(ownerOf('coding')).toMatchObject({ id: 'coding-ncs', stage: 'experimental' });
    expect(enabledSurfaces(false).has('coding')).toBe(false);
    expect(enabledSurfaces(true).has('coding')).toBe(true);
  });

  it('never lets a feature own a surface twice', () => {
    for (const f of FEATURES) {
      expect(new Set(f.surfaces).size).toBe(f.surfaces.length);
    }
  });
});
