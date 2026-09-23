import { describe, expect, it } from 'vitest';
import { MODES, MODE_STEPS, modeLock, modeOf, selectableModes } from '@/lib/domain/modes';
import { deriveSteps } from '@/lib/domain/workflow';
import { linkOwnerOfMode } from '@/lib/hub/owner';

/**
 * CHIP and TEST: which tabs each mode shows, which link it owns, which a build offers, and when the
 * mode may not change.
 */

describe('the modes', () => {
  it('gives every tab exactly one mode, in the order the job is done', () => {
    const all = deriveSteps({ connected: false, hasImage: false, chipBlank: false, odometerKm: null }).map((s) => s.id);
    const listed = MODES.flatMap((m) => MODE_STEPS[m]);
    expect([...listed].sort()).toEqual([...all].sort());
    expect(new Set(listed).size).toBe(listed.length);
    for (const m of MODES) for (const s of MODE_STEPS[m]) expect(modeOf(s)).toBe(m);
    expect(MODE_STEPS.chip).toEqual(['setup', 'read', 'rewrite', 'inspect', 'records']);
    expect(MODE_STEPS.test).toEqual(['bench', 'checks']);
  });

  it('gives CHIP the UNO bridge and TEST the cluster link', () => {
    expect(linkOwnerOfMode('chip')).toBe('bridge');
    expect(linkOwnerOfMode('test')).toBe('cluster');
  });

  it('offers only the modes a build draws a tab of', () => {
    expect(selectableModes(new Set(['setup', 'read', 'rewrite']))).toEqual(['chip']);
    expect(selectableModes(new Set(['setup', 'bench']))).toEqual(['chip', 'test']);
  });

  it('holds the mode while the chip is being written and while the cluster is in a session', () => {
    expect(modeLock({ bridgeBusy: false, clusterSessionOpen: false, clusterBusy: false })).toBeNull();
    expect(modeLock({ bridgeBusy: true, clusterSessionOpen: false, clusterBusy: false })).toBe('busy');
    expect(modeLock({ bridgeBusy: false, clusterSessionOpen: true, clusterBusy: false })).toBe('session');
    expect(modeLock({ bridgeBusy: false, clusterSessionOpen: false, clusterBusy: true })).toBe('session');
  });
});
