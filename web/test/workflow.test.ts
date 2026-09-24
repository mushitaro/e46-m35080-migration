import { describe, it, expect } from 'vitest';
import {
  deriveSteps,
  recommend,
  stepById,
  stepFor,
  type WorkflowState,
} from '@/lib/domain/workflow';

const EMPTY: WorkflowState = {
  connected: false,
  hasImage: false,
  chipBlank: false,
  odometerKm: null,
};

const s = (over: Partial<WorkflowState> = {}): WorkflowState => ({ ...EMPTY, ...over });

describe('deriveSteps - the strip is a sequence', () => {
  it('lists the steps in working order', () => {
    const steps = deriveSteps(EMPTY);
    expect(steps.map((x) => x.id)).toEqual([
      'setup',
      'read',
      'rewrite',
      'records',
      'bench',
      'checks',
    ]);
  });

  it('never gates TEST mode on the bridge or an image: it talks to the cluster, and an image only gives it something to compare with', () => {
    for (const id of ['bench', 'checks'] as const) expect(stepById(deriveSteps(EMPTY), id)).toMatchObject({ enabled: true, blockedBy: null });
  });

  it('never gates REWRITE: a dump can be opened as the source, and the job planned, before any chip is read', () => {
    expect(stepById(deriveSteps(EMPTY), 'rewrite')).toMatchObject({ enabled: true, blockedBy: null });
  });

  it('never gates REWRITE on a chip: a file is opened, changed and saved there before any chip is out', () => {
    /* Case c - prepare a file now, write it later - happens on REWRITE with nothing connected. */
    const steps = deriveSteps(EMPTY);
    expect(stepById(steps, 'rewrite')).toMatchObject({ enabled: true, blockedBy: null });
  });

  it('lets a cold start reach the bench guide and the records', () => {
    const steps = deriveSteps(EMPTY);
    expect(stepById(steps, 'setup')?.enabled).toBe(true);
    expect(stepById(steps, 'records')?.enabled).toBe(true);
  });

  it('tells READ it needs a connection, without disabling it', () => {
    const cold = stepById(deriveSteps(EMPTY), 'read');
    expect(cold?.enabled).toBe(true); // reachable, so the reason can be shown
    expect(cold?.blockedBy).toBe('need-connection');

    const warm = stepById(deriveSteps(s({ connected: true })), 'read');
    expect(warm?.blockedBy).toBeNull();
  });
});

describe('recommend - the tool decides which job this chip allows', () => {
  it('says nothing before an image is read', () => {
    expect(recommend(EMPTY, 100_000).kind).toBe('unknown');
  });

  it('a blank chip is ready to restore, whatever the target', () => {
    const r = recommend(s({ hasImage: true, chipBlank: true, odometerKm: 0 }), null);
    expect(r.kind).toBe('restore-ready');
  });

  it('a used chip BELOW the target can simply be raised - no new chip', () => {
    const r = recommend(s({ hasImage: true, odometerKm: 120_000 }), 155_940);
    expect(r.kind).toBe('rewrite-possible');
    if (r.kind !== 'rewrite-possible') return;
    expect(r.currentKm).toBe(120_000);
    expect(r.targetKm).toBe(155_940);
  });

  it('a used chip ABOVE the target needs a new one', () => {
    const r = recommend(s({ hasImage: true, odometerKm: 200_000 }), 155_940);
    expect(r.kind).toBe('needs-new-chip');
  });

  it('treats an exact match as reachable (no write needed, but not a refusal)', () => {
    expect(recommend(s({ hasImage: true, odometerKm: 155_940 }), 155_940).kind).toBe(
      'rewrite-possible',
    );
  });

  it('cannot recommend without a target', () => {
    expect(recommend(s({ hasImage: true, odometerKm: 120_000 }), null).kind).toBe('unknown');
  });

  it('cannot recommend when the secure area did not decode', () => {
    expect(recommend(s({ hasImage: true, odometerKm: null }), 120_000).kind).toBe('unknown');
  });
});

describe('stepFor - where a recommendation points', () => {
  it('sends a blank chip and a raisable one alike to REWRITE, where the dump is its SOURCE', () => {
    expect(stepFor({ kind: 'restore-ready' })).toBe('rewrite');
    expect(stepFor({ kind: 'rewrite-possible', currentKm: 1, targetKm: 2 })).toBe('rewrite');
  });

  it('sends a chip that is already too high back to SETUP - you need a part', () => {
    expect(stepFor({ kind: 'needs-new-chip', currentKm: 2, targetKm: 1 })).toBe('setup');
  });

  it('points nowhere when nothing is known', () => {
    expect(stepFor({ kind: 'unknown' })).toBeNull();
  });
});
