import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The reader's language is taken up AFTER hydration, never at import (lib/i18n.ts).
 *
 * Taken at import, a browser that was not Japanese rendered its first client pass in its own
 * language while the prerendered HTML was Japanese: React's hydration failed (#418), the page was
 * rendered again from the root, and the metas the build writes into the HTML (app-variant,
 * build-id) were lost with the prerendered <head> - the preview ran as production. Found in the
 * deployed preview with an English browser (2026-09-24).
 */

/** A browser for i18n.ts to import into: its language, and the <html> it writes. */
async function importInBrowser(language: string) {
  const html = { lang: 'ja' };
  vi.stubGlobal('window', {});
  vi.stubGlobal('navigator', { language });
  vi.stubGlobal('document', { documentElement: html });
  vi.stubGlobal('localStorage', { removeItem: () => {} });
  vi.resetModules();
  return { i18n: await import('@/lib/i18n'), html };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the reader's language", () => {
  it('is not taken at import: the first client render answers as the prerendered HTML did', async () => {
    const { i18n, html } = await importInBrowser('en-US');
    expect(i18n.getLang()).toBe(i18n.STATIC_LANG);
    expect(html.lang).toBe('ja');
  });

  it('is taken up after hydration, written to <html lang>, and told to every subscriber', async () => {
    const { i18n, html } = await importInBrowser('en-US');
    const heard: string[] = [];
    i18n.subscribeLang((l) => heard.push(l));
    i18n.adoptReaderLang();
    expect(i18n.getLang()).toBe('en');
    expect(html.lang).toBe('en');
    expect(heard).toEqual(['en']);
    // Adopting again - a remounted root - changes nothing and tells nobody twice.
    i18n.adoptReaderLang();
    expect(heard).toEqual(['en']);
  });

  it('is Japanese only for a Japanese browser - any other is English, never the author\'s language', async () => {
    for (const [language, lang] of [['ja-JP', 'ja'], ['ja', 'ja'], ['de-DE', 'en'], ['en-GB', 'en']] as const) {
      const { i18n } = await importInBrowser(language);
      i18n.adoptReaderLang();
      expect(i18n.getLang(), language).toBe(lang);
    }
  });
});
