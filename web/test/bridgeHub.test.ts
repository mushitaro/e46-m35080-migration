import { describe, it, expect, vi } from 'vitest';
import { bridgeHubFor, type BridgeHubState } from '@/lib/hub/bridgeHub';
import { CHROME } from '@/lib/copy/chrome';
import type { RepairPlan, ResetPlan, RewritePlan } from '@/lib/domain/operations';

/**
 * One row per branch of the hub, in the order the hub tests them.
 *
 * The hub used to be a useMemo inside page.tsx that nothing could exercise without rendering the
 * page. These rows pin what it did when it moved, so the move itself is the only change.
 */

const rewriteOk: RewritePlan = {
  ok: true,
  currentKm: 1000,
  targetKm: 2000,
  secureOps: [{ slot: 0, address: 0x00, from: 0x3e, to: 0x7d }],
  byteWrites: [{ address: 0x184, data: new Uint8Array(7), label: 'VIN at 0x184 -> "AB12345"' }],
};
const resetOk: ResetPlan = {
  ok: true,
  byteWrites: [{ address: 0x20, data: new Uint8Array(0x3e0), label: 'standard array 0x20-0x3FF from backup, byte for byte' }],
  resultingKm: 0,
  checksums: 'ok',
};
const repairOk: RepairPlan = {
  ok: true,
  byteWrites: [{ address: 0x100, data: new Uint8Array(2), label: '0x100-0x101 from backup (2 bytes)' }],
  addresses: [0x100, 0x101],
  checksums: 'unchecked',
};
const repairNothing: RepairPlan = { ok: true, byteWrites: [], addresses: [], checksums: 'unchecked' };

function state(over: Partial<BridgeHubState> = {}): BridgeHubState {
  return {
    busy: false,
    phase: 'connected',
    step: 'read',
    hasImage: true,
    backedUp: true,
    chipBlank: false,
    hasBackupFile: false,
    rewritePlan: null,
    restorePlan: null,
    repairPlan: null,
    copy: {
      confirmOdometer: (from, to, n) => `odo ${from}->${to} (${n})`,
      confirmReset: 'reset',
      confirmRepair: (n) => `repair ${n}`,
    },
    act: { connect: vi.fn(), read: vi.fn(), backup: vi.fn(), ask: vi.fn() },
    ...over,
  };
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

  it('offers CONNECT while disconnected, whatever else is true', () => {
    const s = state({ phase: 'disconnected', hasImage: true, step: 'rewrite', rewritePlan: rewriteOk });
    const h = bridgeHubFor(s);
    expect(h.label).toBe(CHROME.hub.connect);
    h.onClick();
    expect(s.act.connect).toHaveBeenCalledOnce();
  });

  it('offers READ when connected with no image', () => {
    const s = state({ hasImage: false });
    const h = bridgeHubFor(s);
    expect(h.label).toBe(CHROME.hub.read);
    h.onClick();
    expect(s.act.read).toHaveBeenCalledOnce();
  });

  it('makes BACKUP the next step before any write, on every tab', () => {
    for (const step of ['read', 'rewrite', 'restore'] as const) {
      const s = state({ backedUp: false, step, rewritePlan: rewriteOk, repairPlan: repairOk, hasBackupFile: true });
      const h = bridgeHubFor(s);
      expect(h.label).toBe(CHROME.hub.backup);
      expect(h.danger).toBeUndefined();
    }
  });

  it('asks before WRITE ODO and lists the WRINCs and byte writes', () => {
    const s = state({ step: 'rewrite', rewritePlan: rewriteOk });
    const h = bridgeHubFor(s);
    expect(h.label).toBe(CHROME.hub.writeOdometer);
    expect(h.danger).toBe(true);
    expect(h.disabled).toBe(false);
    h.onClick();
    expect(s.act.ask).toHaveBeenCalledWith(
      { kind: 'rewrite', byteWrites: rewriteOk.byteWrites, secureOps: rewriteOk.secureOps },
      'odo 1000->2000 (1)',
      ['WRINC 0x00  0x3E -> 0x7D', 'VIN at 0x184 -> "AB12345"'],
    );
  });

  it('disables WRITE ODO when the plan changes nothing', () => {
    const empty: RewritePlan = { ...rewriteOk, secureOps: [], byteWrites: [] };
    expect(bridgeHubFor(state({ step: 'rewrite', rewritePlan: empty })).disabled).toBe(true);
  });

  it('offers WRITE CHIP on RESTORE to a blank chip', () => {
    const s = state({ step: 'restore', chipBlank: true, restorePlan: resetOk, hasBackupFile: true });
    const h = bridgeHubFor(s);
    expect(h.label).toBe(CHROME.hub.writeChip);
    h.onClick();
    expect(s.act.ask).toHaveBeenCalledWith(
      { kind: 'restore', byteWrites: resetOk.byteWrites, secureOps: [] },
      'reset',
      ['standard array 0x20-0x3FF from backup, byte for byte', 'odometer 0x00-0x1F: not written (stays 0 km)'],
    );
  });

  it('offers REPAIR on RESTORE to a used chip with bytes to put back', () => {
    const s = state({ step: 'restore', repairPlan: repairOk, hasBackupFile: true });
    const h = bridgeHubFor(s);
    expect(h.label).toBe(CHROME.hub.repair);
    h.onClick();
    expect(s.act.ask).toHaveBeenCalledWith(
      { kind: 'restore', byteWrites: repairOk.byteWrites, secureOps: [] },
      'repair 2',
      ['0x100-0x101 from backup (2 bytes)', 'odometer 0x00-0x1F: not written'],
    );
  });

  it('names what RESTORE is waiting for, disabled', () => {
    expect(bridgeHubFor(state({ step: 'restore' })).label).toBe(CHROME.hub.selectBackup);
    expect(bridgeHubFor(state({ step: 'restore', hasBackupFile: true, repairPlan: repairNothing })).label).toBe(
      CHROME.hub.nothingToRepair,
    );
    const refused = { ok: false as const, code: 'backup-no-data' as const };
    const h = bridgeHubFor(state({ step: 'restore', hasBackupFile: true, repairPlan: refused }));
    expect(h.label).toBe(CHROME.hub.checkBackup);
    expect(h.disabled).toBe(true);
  });

  it('falls back to READ on a tab with no job', () => {
    for (const step of ['read', 'setup', 'inspect', 'records'] as const) {
      expect(bridgeHubFor(state({ step })).label).toBe(CHROME.hub.read);
    }
  });
});
