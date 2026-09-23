import { describe, expect, it, vi } from 'vitest';
import { refKey, refName, serveRef, type RefBucket } from '../functions/_lib/refdata';
import { describeOrigin, loadRefData, refFromFile } from '@/lib/refdata/load';
import { validateRef } from '@/lib/refdata/validate';

/**
 * The reference data's path from the bucket to the screen. Every document here is SYNTHETIC -
 * invented keywords and numbers in the generator's shape - because the real ones are BMW's and are
 * never in this repository (THIRD-PARTY-NOTICES.md 3.3).
 */

const owner = { id: 'owner-0001', label: 'test' };

function coding(over: Record<string, unknown> = {}) {
  return {
    schema: 1,
    kind: 'kombi-coding',
    generator: 'tools/refdata/gen_refdata.py',
    generatedAt: '2026-09-24T00:00:00Z',
    sources: { 'DEMO.C01': 'a'.repeat(64) },
    terms: {},
    coverage: {},
    definitions: {
      'DEMO.C01': {
        memory: { structure: 'WORDMSB', type: 'TEST' },
        codingIndex: null,
        blocks: [{ kind: 'coding', block: 1, address: 0x70, length: 0x20, name: 'Demo_Block' }],
        parameters: [
          {
            kind: 'fsw', keyword: 'DEMO_SWITCH', id: 1, block: 1, address: 0x72, length: 1, index: null,
            mask: [0x30], unit: null, individual: null,
            options: [{ keyword: 'aus', id: 2, data: [0x00] }, { keyword: 'an', id: 3, data: [0x10] }],
          },
          { kind: 'dir', keyword: 'DEMO_VALUE[1]', id: 4, block: 1, address: 0x80, length: 2, index: null, mask: [0xff, 0xff], operations: [], unit: 0 },
        ],
        unused: [],
      },
    },
    names: {
      fsw: { DEMO_SWITCH: { ja: 'デモ', en: 'Demo', source: 'authored' } },
      dir: {},
      psw: { aus: { ja: null, en: null, source: 'raw' } },
      block: {},
    },
    ...over,
  };
}

function names() {
  const bit = { ja: 'ランプ', en: 'Lamp', source: 'authored', sgbd: 'Demo' };
  const v = { lamps: { 'B1.b0': bit }, outputs: {}, inputs: { 'P0.b0': bit }, faults: { '0x01': bit } };
  return { schema: 1, kind: 'kombi-names', generator: 'x', generatedAt: 'x', sources: {}, terms: {}, coverage: {}, variants: { KOMBI46: v, KOMBI46R: v } };
}

function bucket(objects: Record<string, string>): RefBucket {
  return {
    get: async (key) => (key in objects ? { body: new Response(objects[key]).body } : null),
  };
}

describe('the route: /api/ref/:name', () => {
  it('answers only a signed-in owner', async () => {
    const r = await serveRef(null, 'kombi-coding', bucket({ 'kombi-coding.json': '{}' }));
    expect(r.status).toBe(401);
  });

  it('serves only the names on its list, and 404s for data not uploaded - never a 5xx', async () => {
    const b = bucket({ 'kombi-coding.json': JSON.stringify(coding()), 'secret.json': '{}' });
    expect((await serveRef(owner, 'secret', b)).status).toBe(404);
    expect((await serveRef(owner, '../kombi-coding', b)).status).toBe(404);
    expect((await serveRef(owner, 'kombi-names', b)).status).toBe(404);
    expect((await serveRef(owner, 'kombi-coding', undefined)).status).toBe(404);
    expect(refName(['kombi-names'])).toBe('kombi-names');
    expect(refKey('kombi-names')).toBe('kombi-names.json');
  });

  it('hands the stored bytes over, private and never cached', async () => {
    const body = JSON.stringify(coding());
    const r = await serveRef(owner, 'kombi-coding', bucket({ 'kombi-coding.json': body }));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await r.text()).toBe(body);
  });
});

describe('what the app accepts', () => {
  it('accepts the generator shape', () => {
    expect(validateRef('kombi-coding', coding())).toBeNull();
    expect(validateRef('kombi-names', names())).toBeNull();
  });

  it('names what is wrong instead of half-reading it', () => {
    expect(validateRef('kombi-coding', { ...coding(), schema: 2 })).toMatch(/schema/);
    expect(validateRef('kombi-coding', names())).toMatch(/kind/);
    const bad = coding();
    (bad.definitions['DEMO.C01'].parameters[0] as { mask: unknown }).mask = [0x130];
    expect(validateRef('kombi-coding', bad)).toMatch(/mask/);
    const noOptions = coding();
    (noOptions.definitions['DEMO.C01'].parameters[0] as { options: unknown }).options = null;
    expect(validateRef('kombi-coding', noOptions)).toMatch(/options/);
    const n = names();
    delete (n.variants as Record<string, unknown>).KOMBI46R;
    expect(validateRef('kombi-names', n)).toMatch(/KOMBI46R/);
  });
});

describe('getting it into the app', () => {
  it('makes no request at all outside the preview', async () => {
    const f = vi.fn();
    expect(await loadRefData('kombi-coding', { fetch: f, preview: false })).toEqual({ ok: false, reason: 'not-preview' });
    expect(f).not.toHaveBeenCalled();
  });

  it('says served, with the sha256 of what it read', async () => {
    const body = JSON.stringify(coding());
    const f = vi.fn(async () => new Response(body, { status: 200 }));
    const r = await loadRefData('kombi-coding', { fetch: f as unknown as typeof fetch, preview: true });
    expect(f).toHaveBeenCalledWith('/api/ref/kombi-coding', { credentials: 'same-origin', cache: 'no-store' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.origin.kind).toBe('served');
      expect(r.origin.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(describeOrigin(r.origin)).toMatch(/^SERVED · [0-9a-f]{12}$/);
      expect(Object.keys(r.doc.definitions)).toEqual(['DEMO.C01']);
    }
  });

  it('tells absent, signed out, unreachable and invalid apart', async () => {
    const at = (res: Response | Error) =>
      loadRefData('kombi-names', {
        preview: true,
        fetch: (async () => {
          if (res instanceof Error) throw res;
          return res;
        }) as unknown as typeof fetch,
      });
    expect(await at(new Response('', { status: 404 }))).toMatchObject({ ok: false, reason: 'absent' });
    expect(await at(new Response('', { status: 401 }))).toMatchObject({ ok: false, reason: 'unauthorized' });
    expect(await at(new Error('offline'))).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(await at(new Response('not json', { status: 200 }))).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await at(new Response(JSON.stringify(coding()), { status: 200 }))).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('opens the same JSON from disk, and says so', async () => {
    const r = await refFromFile('kombi-names', { name: 'kombi-names.json', text: async () => JSON.stringify(names()) });
    expect(r.ok && describeOrigin(r.origin)).toMatch(/^FILE · kombi-names\.json · [0-9a-f]{12}$/);
    expect(await refFromFile('kombi-names', { name: 'x.json', text: async () => '{}' })).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
