import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PreviewNotice, usePreviewNoticeOpen } from '@/components/PreviewNotice';
import { NOTICE_TITLE, syncCopy } from '@/lib/copy/sync';
import { readVariant } from '@/lib/domain/variant';
import { getLang, setLangForTest } from '@/lib/i18n';
import { gunzipB64 } from '@/lib/sync/owner-sync';
import type { DeviceRecord } from '@/lib/domain/records';
import type { LinkFailure } from '@/lib/sync/errorRecords';

/**
 * The preview's first-run notice, from the side that decides whether anything leaves the device.
 *
 * Nothing is sent before the owner has read what the preview sends and confirmed it; a build that
 * is not the preview shows nothing new. Same pattern as test/sync.test.ts: Node has no `document`,
 * which is a build with no app-variant tag, and a stubbed one carrying `preview` is the preview.
 *
 * A confirmation holds in memory for the page load, so each case loads the sync modules afresh -
 * a fresh load is also how "the next page load" is asked.
 */

const ID = '11111111-2222-4333-8444-555555555555';

function record(): DeviceRecord {
  const bytes = new Uint8Array(1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 3) & 0xff;
  return {
    id: ID,
    createdAt: 1_790_000_000_000,
    kind: 'backup',
    bytes,
    hash: createHash('sha256').update(bytes).digest('hex'),
    vin: 'AB12345',
    km: 155_940,
    practice: false,
  };
}

const failure = (): LinkFailure => ({
  phase: 'reading',
  error: 'no answer',
  errorKind: 'transport',
  practice: false,
  image: null,
  status: null,
  firmware: null,
  progress: null,
});

async function fresh() {
  vi.resetModules();
  return {
    notice: await import('@/lib/sync/previewNotice'),
    cloud: await import('@/lib/sync/cloud'),
    errors: await import('@/lib/sync/errorRecords'),
  };
}

/** The preview build: the tag brand-preview stamps, and nothing else. */
function asPreview(): void {
  vi.stubGlobal('document', {
    querySelector: (sel: string) => (sel === 'meta[name="app-variant"]' ? { getAttribute: () => 'preview' } : null),
  });
}

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
}

const refuse = () => {
  throw new Error('storage denied');
};

/** The network and the outbox, both watched. The outbox cannot open here, as in a locked-down browser. */
function watch() {
  const fetchSpy = vi.fn(async (url: string) => {
    const body = url === '/_gate/status' ? { state: 'active', account_label: 'acct-1' } : { id: ID, storedBytes: 1024 };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchSpy);
  const open = vi.fn(() => {
    const req: { onerror?: () => void; error: Error } = { error: new Error('no IndexedDB here') };
    queueMicrotask(() => req.onerror?.());
    return req;
  });
  vi.stubGlobal('indexedDB', { open });
  return { fetchSpy, open };
}

function decode(html: string): string {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('preview notice - a build that is not the preview shows nothing new', () => {
  it('is never required outside the preview, whatever the browser has stored', async () => {
    const { notice } = await fresh();
    for (const acknowledged of [false, true]) {
      expect(notice.noticeRequired('production', acknowledged)).toBe(false);
      expect(notice.noticeRequired('staging', acknowledged)).toBe(false);
    }
    // No document: a build with no tag. No localStorage: nothing ever confirmed. Still nothing.
    expect(readVariant()).toBe('production');
    expect(notice.noticeRequired(readVariant(), notice.noticeAcknowledged())).toBe(false);
  });

  it('puts no notice in the exported page', () => {
    /* The static export is the prerender, and the prerender answers from the server snapshots:
       'production', nothing to ask. What a release ships has no dialog in it. */
    const Page = () => createElement(PreviewNotice, { open: usePreviewNoticeOpen() });
    expect(renderToStaticMarkup(createElement(Page))).toBe('');
    expect(renderToStaticMarkup(createElement(PreviewNotice, { open: false }))).toBe('');
  });
});

describe('preview notice - nothing is sent before it is confirmed', () => {
  it('is asked for, and until then no call makes a request; an error record waits on the device', async () => {
    asPreview();
    vi.stubGlobal('localStorage', memoryStorage());
    const { fetchSpy, open } = watch();
    const { notice, cloud, errors } = await fresh();

    expect(cloud.canSync()).toBe(true); // this is the preview
    expect(notice.noticeAcknowledged()).toBe(false);
    expect(notice.noticeRequired('preview', notice.noticeAcknowledged())).toBe(true);
    expect(cloud.maySend()).toBe(false);

    const results = await Promise.all([
      cloud.sendRecord(record()),
      cloud.listCloudRecords(),
      cloud.fetchCloudRecord(ID),
      cloud.deleteCloudRecord(ID),
      cloud.listDiagnostics(),
      cloud.deleteDiagnostic(ID),
    ]);
    expect(await errors.flushErrorRecords()).toBe(0);
    errors.reportLinkFailure(failure());
    // Into the outbox, as without a connection...
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith('m35080-outbox', 1));

    // ...and nothing anywhere else: not SYNC, not the lists, not /_gate/status, not the record.
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const r of results) expect('result' in r ? r.result.status : r.status).toBe(0);
  });

  it('sends once confirmed, and the next page load remembers it', async () => {
    asPreview();
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const { fetchSpy } = watch();
    const { notice, cloud, errors } = await fresh();

    notice.acknowledgeNotice(Date.UTC(2026, 8, 24));
    expect(storage.getItem('preview-notice:v1')).toBe('2026-09-24T00:00:00.000Z');
    expect(notice.noticeRequired('preview', notice.noticeAcknowledged())).toBe(false);
    expect(cloud.maySend()).toBe(true);

    const sent = await cloud.sendRecord(record());
    expect(sent.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ method: 'POST' }));

    errors.reportLinkFailure(failure());
    await vi.waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith('/api/diagnostics', expect.objectContaining({ method: 'POST' })),
    );

    const next = await fresh();
    expect(next.notice.noticeAcknowledged()).toBe(true);
  });

  it('is asked for when the storage cannot be read, and a confirmation still opens this page', async () => {
    asPreview();
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse });
    const { fetchSpy } = watch();
    const { notice, cloud } = await fresh();

    expect(notice.noticeAcknowledged()).toBe(false);
    expect(notice.noticeRequired('preview', notice.noticeAcknowledged())).toBe(true);
    await cloud.sendRecord(record());
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(() => notice.acknowledgeNotice()).not.toThrow();
    expect(notice.noticeAcknowledged()).toBe(true);
    await cloud.sendRecord(record());
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Not kept, so the next page load asks again.
    const next = await fresh();
    expect(next.notice.noticeAcknowledged()).toBe(false);
  });
});

describe('preview notice - what it says', () => {
  const policy = {
    ja: 'https://m3.tsunagi.app/privacy-policy#preview',
    en: 'https://m3.tsunagi.app/en/privacy-policy#preview',
  } as const;

  for (const lang of ['ja', 'en'] as const) {
    it(`says all of it in ${lang}, with one way past it and the policy in a new tab`, () => {
      const orig = getLang();
      setLangForTest(lang);
      try {
        const html = renderToStaticMarkup(createElement(PreviewNotice, { open: true }));
        const text = decode(html);
        const c = syncCopy().notice;

        expect(text).toContain(NOTICE_TITLE);
        for (const [key, words] of Object.entries(c)) expect(text, key).toContain(words);
        expect(html).toContain('role="dialog"');
        expect(html).toContain('aria-modal="true"');

        // One button, and it is the confirmation: no close, no cancel.
        const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)];
        expect(buttons).toHaveLength(1);
        expect(decode(buttons[0][1])).toBe(c.confirm);

        const links = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
        expect(links).toHaveLength(1);
        expect(links[0]).toContain(`href="${policy[lang]}"`);
        expect(links[0]).toContain('target="_blank"');
        expect(links[0]).toContain('rel="noopener noreferrer"');
      } finally {
        setLangForTest(orig);
      }
    });
  }

  it('says only what is sent: the app version in both, the browser type in error records alone', async () => {
    /* alsoSent. If either record changes what it carries, the notice (lib/copy/sync.ts) and the
       privacy policy change with it - that is what this test is here to make someone do. */
    vi.stubGlobal('document', {
      querySelector: (sel: string) => (sel === 'meta[name="build-id"]' ? { getAttribute: () => '39.abcdef0' } : null),
    });
    const { cloud, errors } = await fresh();

    const session = cloud.toWire(record());
    expect(session.appBuild).toBe('39.abcdef0');
    expect(JSON.stringify(session)).not.toContain(navigator.userAgent);

    const error = await errors.diagnosticBody(failure());
    expect(error.appBuild).toBe('39.abcdef0');
    const payload = JSON.parse(new TextDecoder().decode(await gunzipB64(error.payloadGz)));
    expect(payload.userAgent).toBe(navigator.userAgent);
  });

  it('names its button as the operator did', () => {
    const orig = getLang();
    try {
      setLangForTest('ja');
      expect(syncCopy().notice.confirm).toBe('確認して続ける');
      setLangForTest('en');
      expect(syncCopy().notice.confirm).toBe('Confirm and continue');
    } finally {
      setLangForTest(orig);
    }
  });
});
