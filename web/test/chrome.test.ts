import { describe, it, expect } from 'vitest';
import { CHROME } from '@/lib/copy/chrome';
import { setLangForTest, getLang } from '@/lib/i18n';
import { g } from '@/lib/copy/guide';
import { t } from '@/lib/i18n';

/** Every leaf string in the chrome dictionary. */
function leaves(o: unknown): string[] {
  if (typeof o === 'string') return [o];
  if (o && typeof o === 'object') return Object.values(o).flatMap(leaves);
  return [];
}

describe('chrome words - one language, no second slot', () => {
  it('is uppercase technical words, never Japanese', () => {
    /* tsunagi-m-ux section 13: tabs, the hub, buttons and status values are the
       SAME for a Japanese reader and an English one. The strip used to read
       準備 / 読み出し / 復旧 on a Japanese browser. */
    for (const w of leaves(CHROME)) {
      expect(w, w).toBe(w.toUpperCase());
      expect(w, w).not.toMatch(/[぀-ヿ一-鿿]/);
    }
  });

  it('gives the tabs no entry in either catalog', () => {
    /* The point of the separate file: with no key to hold a translation there
       is nowhere to put one by accident. If a tab word reappears in a catalog,
       that door is open again. */
    const orig = getLang();
    for (const lang of ['ja', 'en'] as const) {
      setLangForTest(lang);
      const cat = { ...g(), ...t() } as Record<string, unknown>;
      for (const k of ['stepSetup', 'stepRead', 'stepRestore', 'stepRewrite', 'stepInspect',
        'stepRecords', 'connect', 'read', 'disconnect', 'confirmProceed', 'practiceButton']) {
        expect(cat[k], `${lang}.${k}`).toBeUndefined();
      }
    }
    setLangForTest(orig);
  });

  it('keeps the busy face the present participle of the idle one', () => {
    expect(CHROME.hub.connecting).toBe(`${CHROME.hub.connect}ING`);
    expect(CHROME.hub.reading).toBe(`${CHROME.hub.read}ING`);
  });

  it('gives one word one address', () => {
    /* BLANK already means a chip whose counters are zero, so a VIN that is not
       there must be something else. */
    expect(CHROME.readout.none).not.toBe(CHROME.status.blank);
  });
});
