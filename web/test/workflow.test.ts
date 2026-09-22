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
  backedUp: false,
  chipBlank: false,
  odometerKm: null,
  recordCount: 0,
  inspecting: false,
};

const s = (over: Partial<WorkflowState> = {}): WorkflowState => ({ ...EMPTY, ...over });

describe('deriveSteps - the strip is a sequence', () => {
  it('numbers the steps 1..6 in working order', () => {
    const steps = deriveSteps(EMPTY);
    expect(steps.map((x) => x.id)).toEqual([
      'setup',
      'read',
      'restore',
      'rewrite',
      'inspect',
      'records',
    ]);
    expect(steps.map((x) => x.ordinal)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('never gates INSPECT on a chip or a connection', () => {
    /* Sorting a pile of .bin files into "chip read" and "floating wire" is
       exactly what you do BEFORE getting hardware out. */
    const steps = deriveSteps(EMPTY);
    expect(stepById(steps, 'inspect')).toMatchObject({
      enabled: true,
      complete: false,
      blockedBy: null,
    });
    expect(stepById(deriveSteps(s({ inspecting: true })), 'inspect')?.complete).toBe(true);
  });

  it('lets a cold start reach the bench guide and the records', () => {
    const steps = deriveSteps(EMPTY);
    expect(stepById(steps, 'setup')?.enabled).toBe(true);
    expect(stepById(steps, 'records')?.enabled).toBe(true);
  });

  it('BLOCKS the two chip jobs until an image has been read', () => {
    const steps = deriveSteps(s({ connected: true }));
    for (const id of ['restore', 'rewrite'] as const) {
      const step = stepById(steps, id);
      expect(step?.enabled, `${id} should be blocked`).toBe(false);
      expect(step?.blockedBy).toBe('need-image');
    }
  });

  it('unblocks the chip jobs once there is an image', () => {
    const steps = deriveSteps(s({ connected: true, hasImage: true }));
    expect(stepById(steps, 'restore')?.enabled).toBe(true);
    expect(stepById(steps, 'rewrite')?.enabled).toBe(true);
    expect(stepById(steps, 'restore')?.blockedBy).toBeNull();
  });

  it('tells READ it needs a connection, without disabling it', () => {
    const cold = stepById(deriveSteps(EMPTY), 'read');
    expect(cold?.enabled).toBe(true); // reachable, so the reason can be shown
    expect(cold?.blockedBy).toBe('need-connection');

    const warm = stepById(deriveSteps(s({ connected: true })), 'read');
    expect(warm?.blockedBy).toBeNull();
  });
});

describe('deriveSteps - completion is derived, never stored', () => {
  it('marks SETUP complete only once the link is actually up', () => {
    expect(stepById(deriveSteps(EMPTY), 'setup')?.complete).toBe(false);
    expect(stepById(deriveSteps(s({ connected: true })), 'setup')?.complete).toBe(true);
  });

  it('marks READ complete when an image exists', () => {
    expect(stepById(deriveSteps(s({ connected: true })), 'read')?.complete).toBe(false);
    expect(stepById(deriveSteps(s({ connected: true, hasImage: true })), 'read')?.complete).toBe(
      true,
    );
  });

  it('does not mark a chip job ready until there is a BACKUP', () => {
    const noBackup = deriveSteps(s({ connected: true, hasImage: true }));
    expect(stepById(noBackup, 'rewrite')?.complete).toBe(false);

    const withBackup = deriveSteps(s({ connected: true, hasImage: true, backedUp: true }));
    expect(stepById(withBackup, 'rewrite')?.complete).toBe(true);
  });

  it('marks RECORDS complete once something is stored', () => {
    expect(stepById(deriveSteps(EMPTY), 'records')?.complete).toBe(false);
    expect(stepById(deriveSteps(s({ recordCount: 1 })), 'records')?.complete).toBe(true);
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
  it('sends a blank chip to RESTORE and a raisable one to REWRITE', () => {
    expect(stepFor({ kind: 'restore-ready' })).toBe('restore');
    expect(stepFor({ kind: 'rewrite-possible', currentKm: 1, targetKm: 2 })).toBe('rewrite');
  });

  it('sends a chip that is already too high back to SETUP - you need a part', () => {
    expect(stepFor({ kind: 'needs-new-chip', currentKm: 2, targetKm: 1 })).toBe('setup');
  });

  it('points nowhere when nothing is known', () => {
    expect(stepFor({ kind: 'unknown' })).toBeNull();
  });
});
