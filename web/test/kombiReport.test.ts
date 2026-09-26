import { describe, expect, it } from 'vitest';
import { buildReport, reportFilename, type TestSession } from '@/lib/kombi/report';
import { kombiHubFor } from '@/lib/hub/kombiHub';
import { linkOwnerOf } from '@/lib/hub/owner';
import { deriveSteps } from '@/lib/domain/workflow';
import { CHROME } from '@/lib/copy/chrome';
import type { SentRecord } from '@/lib/kombi/kombiLink';
import { isArduinoPort } from '@/lib/kombi/ports';

describe('the report file', () => {
  const at = new Date(2026, 8, 23, 16, 53);

  it('is named by what the cluster reported, PRACTICE first for a rehearsal', () => {
    expect(reportFilename('CD67890', 123_456, at, false)).toBe('TestReport_CD67890_123456km_20260923-1653.json');
    expect(reportFilename(null, null, at, true)).toBe('PRACTICE_TestReport_noVIN_noKM_20260923-1653.json');
  });

  const telegram = (kind: SentRecord['kind'], outcome: SentRecord['outcome']): SentRecord => ({
    kind,
    cls: kind === 'keep-alive' ? 'session' : 'read',
    frame: Uint8Array.from([0x80, 0x04, 0x9e, 0x1a]),
    at: at.getTime(),
    outcome,
  });

  const session = (over: Partial<TestSession> = {}): TestSession => ({
    practice: false,
    startedAt: at.getTime(),
    endedAt: null,
    end: { kind: 'in-progress' },
    ident: null,
    variant: 'KOMBI46',
    benchConfirmed: true,
    reference: null,
    vin: null,
    odometer: null,
    faults: null,
    inputs: null,
    eeprom: null,
    items: [],
    released: null,
    telegrams: [],
    ...over,
  });

  it('is written for a session that failed, and says how it ended', () => {
    const r = buildReport(
      session({ end: { kind: 'failed', code: 'READ_FAILED', message: 'BreakError', sessionEnded: false }, endedAt: at.getTime() }),
    );
    expect(r.end).toEqual({ kind: 'failed', code: 'READ_FAILED', message: 'BreakError', sessionEnded: false });
    expect(r.endedAt).toBe(at.toISOString());
  });

  it('keeps what was asked beside what happened, and counts heartbeats instead of listing them', () => {
    const r = buildReport(
      session({
        telegrams: [
          telegram('keep-alive', { kind: 'acknowledged' }),
          telegram('vin', { kind: 'rejected', status: 0xb0, description: 'parameter error' }),
          telegram('keep-alive', { kind: 'failed', code: 'READ_TIMEOUT', message: 'x' }),
        ],
      }),
    );
    expect(r.telegrams).toEqual([
      { at: at.toISOString(), kind: 'vin', frame: '80 04 9E 1A', outcome: { kind: 'rejected', status: 0xb0, description: 'parameter error' } },
    ]);
    expect(r.keepAlive).toEqual({ sent: 2, acknowledged: 1 });
  });

  it('carries the unverified pinout and the unmeasured EEPROM mapping it relied on', () => {
    const r = buildReport(session());
    expect(r.bench.pinout.verified).toBe(false);
    expect(r.assumptions.eepromWordMapping).toMatch(/2w/);
  });

  it("is complete with no chip image: the cluster's answers, the EEPROM's words, and nothing compared", () => {
    const r = buildReport(
      session({
        vin: { ok: true, value: 'CD67890' },
        odometer: { ok: false, reason: 'not-bcd', got: 3 },
        eeprom: { fromWord: 0, words: 2, bytes: { ok: true, value: Uint8Array.from([0x12, 0x34, 0xab, 0xcd]) } },
      }),
    );
    expect(r.reference).toBeNull();
    expect(r.compared).toBeNull();
    expect(r.cluster.vin).toBe('CD67890');
    expect(r.cluster.km).toEqual({ unreadable: 'not-bcd', got: 3 });
    expect(r.read.eeprom).toEqual({ fromWord: 0, words: 2, bytes: '12 34 AB CD' });
  });

  it('with a chip image, also holds the reads against it', () => {
    const image = new Uint8Array(1024);
    image.set([0x12, 0x34, 0xab, 0xcc]);
    const r = buildReport(
      session({
        reference: { image, source: 'record', label: 'Backup_x.bin', at: at.getTime() },
        eeprom: { fromWord: 0, words: 2, bytes: { ok: true, value: Uint8Array.from([0x12, 0x34, 0xab, 0xcd]) } },
      }),
    );
    expect(r.reference).toMatchObject({ source: 'record', label: 'Backup_x.bin' });
    expect(r.compared?.vin).toBeNull();
    expect(r.compared?.eeprom).toMatchObject({ result: 'different', differing: [3] });
  });
});

describe('the TEST hub', () => {
  const act = { connect: () => {}, stop: () => {}, saveReport: () => {} };

  it('CONNECT, then STOP armed for the whole open session, then SAVE REPORT', () => {
    expect(kombiHubFor({ phase: 'disconnected', sessionOpen: false, act })).toMatchObject({ label: CHROME.hub.connect });
    expect(kombiHubFor({ phase: 'connecting', sessionOpen: false, act })).toMatchObject({ disabled: true, spin: true });
    const stop = kombiHubFor({ phase: 'connected', sessionOpen: true, act });
    expect(stop).toMatchObject({ label: CHROME.hub.stop, armed: true });
    expect(stop.disabled).toBeFalsy();
    expect(kombiHubFor({ phase: 'stopping', sessionOpen: false, act })).toMatchObject({ label: CHROME.hub.stopping, disabled: true });
    expect(kombiHubFor({ phase: 'connected', sessionOpen: false, act })).toMatchObject({ label: CHROME.hub.saveReport });
  });
});

describe('which link a tab speaks for', () => {
  it("gives every tab its mode's link: TEST's tabs the cluster, CHIP's the bridge", () => {
    const ids = deriveSteps({ connected: false, hasImage: false, chipBlank: false, odometerKm: null }).map((s) => s.id);
    for (const id of ids) expect(linkOwnerOf(id)).toBe(id === 'bench' || id === 'checks' ? 'cluster' : 'bridge');
  });
});

describe('the ports TEST refuses', () => {
  const port = (usbVendorId?: number) => ({ getInfo: () => ({ usbVendorId }) });

  it("refuses an Arduino's port before opening it, and nothing else", () => {
    expect(isArduinoPort(port(0x2341))).toBe(true); // Arduino LLC: the UNO
    expect(isArduinoPort(port(0x2a03))).toBe(true); // Arduino SRL
    expect(isArduinoPort(port(0x0403))).toBe(false); // FTDI: a K+DCAN cable
    expect(isArduinoPort(port(undefined))).toBe(false);
    expect(isArduinoPort({})).toBe(false);
  });
});
