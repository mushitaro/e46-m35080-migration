import { describe, it, expect, vi } from 'vitest';
import { bridgeHubFor, type BridgeHubState } from '@/lib/hub/bridgeHub';
import { NO_BYTES, planJob, jobDetails, type JobInput } from '@/lib/domain/job';
import { CHROME } from '@/lib/copy/chrome';
import { codingFixture, P } from './support/codingDoc';

/**
 * One row per branch of the hub, in the order the hub tests them: busy, the link, the image, the
 * backup - "backup before write" is a tier - and then the job REWRITE is about.
 */

const keep = { bytes: NO_BYTES, odometer: { kind: 'keep' as const }, vin: { kind: 'keep' as const }, coding: null };

function state(over: Partial<BridgeHubState> = {}): BridgeHubState {
  return {
    busy: false,
    phase: 'connected',
    step: 'read',
    hasImage: true,
    backedUp: true,
    job: null,
    copy: { confirmJob: (j) => `job ${j.coding} coding, ${j.bytes} bytes, odo ${j.odometer ? j.odometer.to : 'kept'}` },
    act: { connect: vi.fn(), read: vi.fn(), backup: vi.fn(), ask: vi.fn() },
    ...over,
  };
}

function job(input: JobInput) {
  return { input, plan: planJob(input), note: 'the note' };
}

describe('bridgeHubFor', () => {
  it('shows the busy participle, disabled and spinning, before anything else', () => {
    for (const [phase, label] of [
      ['connecting', CHROME.hub.connecting],
      ['reading', CHROME.hub.reading],
      ['verifying', CHROME.hub.verifying],
      ['writing', CHROME.hub.writing],
    ] as const) {
      const h = bridgeHubFor(state({ busy: true, phase }));
      expect(h.label).toBe(label);
      expect(h.disabled).toBe(true);
      expect(h.spin).toBe(true);
    }
  });

  it('offers CONNECT while disconnected, whatever the job says', () => {
    const { image, doc } = codingFixture();
    const s = state({
      phase: 'disconnected',
      step: 'rewrite',
      job: job({ chip: image, source: { kind: 'chip' }, ...keep, coding: { doc, changes: [{ param: P.mode, option: 103 }] } }),
    });
    const h = bridgeHubFor(s);
    expect(h.label).toBe(CHROME.hub.connect);
    h.onClick();
    expect(s.act.connect).toHaveBeenCalledOnce();
  });

  it('offers READ when connected with no image - a dump planned without a chip is not writable', () => {
    const { image: dump } = codingFixture();
    const s = state({ hasImage: false, step: 'rewrite', job: job({ chip: null, source: { kind: 'dump', name: 'd.bin', image: dump }, ...keep }) });
    const h = bridgeHubFor(s);
    expect(h.label).toBe(CHROME.hub.read);
    h.onClick();
    expect(s.act.read).toHaveBeenCalledOnce();
  });

  it('makes BACKUP the next step before any write, on every tab', () => {
    const { image, doc } = codingFixture();
    for (const step of ['read', 'rewrite'] as const) {
      const s = state({
        backedUp: false,
        step,
        job: job({ chip: image, source: { kind: 'chip' }, ...keep, coding: { doc, changes: [{ param: P.mode, option: 103 }] } }),
      });
      const h = bridgeHubFor(s);
      expect(h.label).toBe(CHROME.hub.backup);
      expect(h.danger).toBeUndefined();
    }
  });

  it('asks before WRITE CHIP with the whole job: the exact bytes, the WRINCs, the note, and the lines', () => {
    const { image, doc } = codingFixture();
    const input: JobInput = {
      chip: image,
      source: { kind: 'chip' },
      bytes: NO_BYTES,
      odometer: { kind: 'set', km: 170_000 },
      vin: { kind: 'write', vin: 'ZX54321' },
      coding: { doc, changes: [{ param: P.mode, option: 103 }] },
    };
    const j = job(input);
    const s = state({ step: 'rewrite', job: j });
    const h = bridgeHubFor(s);
    expect(h).toMatchObject({ label: CHROME.hub.writeChip, danger: true });
    h.onClick();
    if (!j.plan.ok) throw new Error('plan refused');
    expect(s.act.ask).toHaveBeenCalledWith(
      { kind: 'rewrite', byteWrites: j.plan.byteWrites, secureOps: j.plan.secureOps, note: 'the note' },
      `job 1 coding, ${j.plan.byteWrites.reduce((n, w) => n + w.data.length, 0)} bytes, odo 170000`,
      jobDetails(j.plan, input),
    );
  });

  it('records a dump put on the chip as a restore', () => {
    const { image: dump } = codingFixture();
    const chip = new Uint8Array(1024).fill(0xff);
    chip.fill(0x00, 0, 0x20);
    const s = state({ step: 'rewrite', job: job({ chip, source: { kind: 'dump', name: 'donor.bin', image: dump }, ...keep }) });
    bridgeHubFor(s).onClick();
    expect(s.act.ask).toHaveBeenCalledWith(expect.objectContaining({ kind: 'restore', secureOps: [] }), expect.any(String), expect.any(Array));
  });

  it('says why the ring is idle on REWRITE: nothing to change, nothing to plan, or a refused plan', () => {
    const { image, doc } = codingFixture();
    expect(bridgeHubFor(state({ step: 'rewrite', job: job({ chip: image, source: { kind: 'chip' }, ...keep }) }))).toMatchObject({
      label: CHROME.hub.noChanges,
      disabled: true,
    });
    expect(bridgeHubFor(state({ step: 'rewrite', job: { input: null, plan: null, note: '' } }))).toMatchObject({
      label: CHROME.hub.noChanges,
      disabled: true,
    });
    const refused = job({ chip: image, source: { kind: 'chip' }, ...keep, coding: { doc, changes: [{ param: P.guarded, option: 142 }] } });
    expect(bridgeHubFor(state({ step: 'rewrite', job: refused }))).toMatchObject({ label: CHROME.hub.checkPlan, disabled: true });
  });

  it('falls back to READ on a tab with no job', () => {
    for (const step of ['read', 'setup', 'records'] as const) {
      expect(bridgeHubFor(state({ step })).label).toBe(CHROME.hub.read);
    }
  });
});
