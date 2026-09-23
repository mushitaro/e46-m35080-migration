import { describe, it, expect, afterAll } from 'vitest';
import { setLangForTest, getLang, t } from '@/lib/i18n';
import type { RefusalCode } from '@/lib/domain/operations';

/**
 * Every refusal must render, in every language.
 *
 * The failure this guards against is an `undefined` reaching a dialog about
 * erasing a chip - which is exactly what a missing branch in a switch over
 * refusal codes produces. The compiler catches a missing KEY; only a test
 * catches a missing CASE.
 */

/**
 * Derived, not hand-written.
 *
 * This was a literal array and it had already drifted: ten entries against
 * twelve RefusalCode members, silently omitting `vin-no-target` - which a
 * user reaches from the REWRITE tab by asking for a VIN on a chip that has
 * none - and a second VIN code that has since been removed.
 *
 * `Record<RefusalCode, true>` moves that from a thing someone must remember to
 * a thing the compiler enforces: add a code to the union and this file stops
 * building until its copy is covered here too.
 */
const CODE_TABLE: Record<RefusalCode, true> = {
  'image-size': true,
  'km-invalid': true,
  'km-too-large': true,
  'cannot-lower': true,
  'vin-invalid': true,
  'vin-no-target': true,
  'vin-coded-shape': true,
  'checksum-broken': true,
  'backup-checksum-broken': true,
  'not-blank': true,
  'backup-no-data': true,
  'backup-size': true,
  'current-size': true,
  'restore-lower': true,
};

const ALL_CODES = Object.keys(CODE_TABLE) as RefusalCode[];

const original = getLang();
afterAll(() => setLangForTest(original));

describe('refusal copy', () => {
  for (const lang of ['ja', 'en'] as const) {
    it(`renders a non-empty reason for every code in ${lang}`, () => {
      setLangForTest(lang);
      for (const code of ALL_CODES) {
        const r = t().refusal({
          code,
          floorKm: 155_940,
          backupKm: 100_000,
          maxKm: 1_048_560,
        });
        expect(r, `no entry for ${code}`).toBeDefined();
        expect(typeof r.reason).toBe('string');
        expect(r.reason.length, `empty reason for ${code}`).toBeGreaterThan(0);
        expect(r.reason).not.toMatch(/undefined/);
        if (r.detail !== undefined) expect(r.detail).not.toMatch(/undefined/);
      }
    });
  }

  it('actually translates - ja and en differ for the safety-critical codes', () => {
    const safety: RefusalCode[] = ['cannot-lower', 'not-blank', 'restore-lower'];
    for (const code of safety) {
      setLangForTest('ja');
      const ja = t().refusal({ code, floorKm: 1, backupKm: 2 });
      setLangForTest('en');
      const en = t().refusal({ code, floorKm: 1, backupKm: 2 });
      expect(ja.reason, `${code} is identical in both languages`).not.toBe(en.reason);
    }
  });

  it('formats the floor into the cannot-lower detail', () => {
    setLangForTest('en');
    const r = t().refusal({ code: 'cannot-lower', floorKm: 155_940 });
    expect(r.detail).toContain('155,940');
  });

  it('omits a detail when the value it needs is absent', () => {
    setLangForTest('en');
    expect(t().refusal({ code: 'cannot-lower' }).detail).toBeUndefined();
    expect(t().refusal({ code: 'restore-lower' }).detail).toBeUndefined();
  });

  it('the no-data backup refusal tells the reader what to pick instead', () => {
    for (const lang of ['ja', 'en'] as const) {
      setLangForTest(lang);
      const r = t().refusal({ code: 'backup-no-data' });
      expect(r.detail, `${lang} backup-no-data has no actionable detail`).toBeTruthy();
      expect(r.detail).toMatch(/0x20/);
    }
  });

  it('the non-blank refusal always tells the reader what to do instead', () => {
    for (const lang of ['ja', 'en'] as const) {
      setLangForTest(lang);
      const r = t().refusal({ code: 'not-blank' });
      expect(r.detail, `${lang} not-blank has no actionable detail`).toBeTruthy();
      expect(r.detail).toMatch(/M35080/);
    }
  });
});
