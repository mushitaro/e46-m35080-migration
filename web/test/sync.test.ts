import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { FEATURES } from '@/lib/domain/features';
import {
  canSync,
  deleteCloudRecord,
  deleteDiagnostic,
  fetchCloudRecord,
  fromCloud,
  listCloudRecords,
  listDiagnostics,
  sendRecord,
  toWire,
} from '@/lib/sync/cloud';
import { diagnosticBody, flushErrorRecords, reportLinkFailure, waitingErrorRecords } from '@/lib/sync/errorRecords';
import type { DeviceRecord } from '@/lib/domain/records';

/**
 * The preview's SYNC, from the side that decides whether anything leaves the device.
 *
 * tsunagi-m-chrome section 6: production is local-only and says so, so the SYNC surfaces are
 * `permanently-closed` in the registry, and a build without the preview's app-variant makes no
 * request at all. Node has no `document`, which is exactly a build with no tag.
 */

function record(): DeviceRecord {
  const bytes = new Uint8Array(1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 3) & 0xff;
  return {
    id: '11111111-2222-4333-8444-555555555555',
    createdAt: 1_790_000_000_000,
    kind: 'backup',
    bytes,
    hash: createHash('sha256').update(bytes).digest('hex'),
    vin: 'AB12345',
    km: 155_940,
    practice: true,
    parentId: '99999999-2222-4333-8444-555555555555',
    note: 'bench',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('owner SYNC - the registry', () => {
  it('is permanently closed, with its reason', () => {
    const f = FEATURES.find((x) => x.id === 'owner-sync');
    expect(f?.stage).toBe('permanently-closed');
    expect(f?.reason).toBeTruthy();
    expect(f?.surfaces).toEqual([]);
  });
});

describe('owner SYNC - a build without the preview tag sends nothing', () => {
  it('cannot sync', () => {
    expect(canSync()).toBe(false);
  });

  it('makes no request from any call, and opens no outbox', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const idbSpy = vi.fn();
    vi.stubGlobal('indexedDB', { open: idbSpy });

    const results = await Promise.all([
      sendRecord(record()),
      listCloudRecords(),
      fetchCloudRecord('11111111-2222-4333-8444-555555555555'),
      deleteCloudRecord('11111111-2222-4333-8444-555555555555'),
      listDiagnostics(),
      deleteDiagnostic('11111111-2222-4333-8444-555555555555'),
    ]);
    reportLinkFailure({
      phase: 'reading',
      error: 'x',
      errorKind: 'transport',
      practice: false,
      image: null,
      status: null,
      firmware: null,
      progress: null,
    });
    expect(await flushErrorRecords()).toBe(0);
    expect(await waitingErrorRecords()).toBe(0);
    await new Promise((r) => setTimeout(r, 10));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(idbSpy).not.toHaveBeenCalled();
    for (const r of results) {
      const status = 'result' in r ? r.result.status : r.status;
      expect(status).toBe(0);
    }
  });
});

describe('owner SYNC - the record on the wire', () => {
  it('round-trips a record exactly, id, date and parent included', () => {
    const r = record();
    const w = toWire(r, '12.abcdef0');
    // What the server hands back: its columns, plus the image.
    const row = {
      id: w.id,
      created_at: w.createdAt,
      synced_at: 1,
      kind: w.kind,
      vin: w.vin,
      km: w.km,
      practice: w.practice ? 1 : 0,
      parent_id: w.parentId,
      note: w.note,
      hash: w.hash,
      app_build: w.appBuild,
      imageB64: w.imageB64,
    };
    const back = fromCloud(row);
    expect(back).not.toBeNull();
    expect(back!.id).toBe(r.id);
    expect(back!.createdAt).toBe(r.createdAt);
    expect(back!.parentId).toBe(r.parentId);
    expect(back!.practice).toBe(true);
    expect(back!.hash).toBe(r.hash);
    expect(Array.from(back!.bytes)).toEqual(Array.from(r.bytes));
  });

  it('refuses a row it cannot read rather than half-filling a record', () => {
    expect(fromCloud({ id: 'x', created_at: 1, kind: 'backup', hash: 'h' })).toBeNull();
    expect(fromCloud({ id: 'x', created_at: 'no', kind: 'backup', hash: 'h', imageB64: '' })).toBeNull();
  });
});

describe('owner SYNC - an error record', () => {
  it('says what was being done, carries PRACTICE, and names the chip without sending its image', async () => {
    const image = new Uint8Array(1024).fill(0xff);
    image.set([...'AB12345'].map((c) => c.charCodeAt(0)), 0x184);
    image[0x18b] = 0;
    const body = await diagnosticBody({
      phase: 'writing',
      error: 'verify mismatch',
      errorKind: 'refused',
      practice: true,
      image,
      status: null,
      firmware: '1.0',
      progress: { done: 3, total: 9, label: 'WRITE' },
    });
    expect(body.phase).toBe('writing');
    expect(body.practice).toBe(true);
    expect(body.errorKind).toBe('refused');
    expect(body.vin).toBe('AB12345');
    expect(body.firmware).toBe('1.0');
    expect(JSON.stringify(body)).not.toContain(Buffer.from(image).toString('base64'));
    // gzip magic, base64-encoded: 1f 8b → "H4s"
    expect(body.payloadGz.startsWith('H4s')).toBe(true);
  });

  it('records a failed connect, which has no chip and no bridge', async () => {
    const body = await diagnosticBody({
      phase: 'connecting',
      error: 'no port',
      errorKind: 'transport',
      practice: false,
      image: null,
      status: null,
      firmware: null,
      progress: null,
    });
    expect(body.phase).toBe('connecting');
    expect(body.vin).toBeNull();
    expect(body.km).toBeNull();
  });
});
