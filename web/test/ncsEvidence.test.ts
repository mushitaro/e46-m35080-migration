import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { be, chooseDefinition, ctz, definitionRefusal, isScalar, matchDefinitions, optionValue } from '@/lib/ncs/decode';
import { blockLayoutMatches, isWordMsb } from '@/lib/ncs/definition';
import { detectLayout } from '@/lib/domain/layout';
import { validateRef } from '@/lib/refdata/validate';
import type { CodingDoc } from '@/lib/refdata/types';

/**
 * The coding rules, replayed against the REAL reference data and REAL chip images - local only.
 *
 * Neither may be committed (THIRD-PARTY-NOTICES.md 3.1, 3.3), so this runs only when the operator
 * points it at both:
 *
 *   NCS_REFDATA    the generated kombi-coding.json (tools/refdata/gen_refdata.py)
 *   M35080_DUMPS   .bin paths separated by `;`
 *
 * It asserts aggregates, never values: which definition each chip resolves to is printed as a
 * count per definition, and no chip's bytes, VIN or odometer appear in the output.
 *
 *   $env:NCS_REFDATA = "C:\EDIABAS-derived\m35080-refdata\kombi-coding.json"
 *   $env:M35080_DUMPS = "C:\...\a.bin;C:\...\b.bin"; npx vitest run test/ncsEvidence.test.ts
 */

const refdata = process.env.NCS_REFDATA ?? '';
const paths = (process.env.M35080_DUMPS ?? '')
  .split(';')
  .map((p) => p.trim())
  .filter(Boolean);

// Read in beforeAll, never in a describe body: vitest runs the body of a skipped suite too, to
// collect its tests, and a read there fails every run that has no data to point at.
const loadDoc = () => JSON.parse(readFileSync(refdata, 'utf8')) as CodingDoc;

describe.runIf(refdata !== '')('the definitions themselves (NCS_REFDATA) - the numbers docs/CODING.md quotes', () => {
  let doc: CodingDoc;
  let defs: CodingDoc['definitions'][string][];
  beforeAll(() => {
    doc = loadDoc();
    defs = Object.values(doc.definitions);
  });

  it('organises every definition MSB-first; says which declare the late block layout', () => {
    const late = Object.entries(doc.definitions).filter(([, d]) => blockLayoutMatches(d)).map(([f]) => f).sort();
    expect(defs.every(isWordMsb)).toBe(true);
    console.log(`${defs.length} definitions, all WORDMSB; late block layout: ${late.length}`, late);
  });

  it('writes every scalar option as the shifted value, the mask wide', () => {
    let options = 0;
    let fitting = 0;
    for (const d of defs) {
      for (const p of d.parameters) {
        if (p.kind !== 'fsw' || !isScalar(p)) continue;
        const mask = be(p.mask);
        for (const o of p.options) {
          options++;
          const v = optionValue(o);
          if (o.data.length === p.mask.length && (v * 2 ** ctz(mask)) <= mask && ((v << ctz(mask)) & ~mask) === 0) fitting++;
        }
      }
    }
    expect(fitting).toBe(options);
    console.log(`${options} scalar options, ${fitting} the mask's width and inside it`);
  });

  it('counts the arrays (a parameter longer than its mask), by shape', () => {
    const shapes: Record<string, number> = {};
    let count = 0;
    for (const d of defs) {
      for (const p of d.parameters) {
        if (isScalar(p)) continue;
        count++;
        const key = `${p.kind} ${p.length / p.mask.length}x${p.mask.length}`;
        shapes[key] = (shapes[key] ?? 0) + 1;
      }
    }
    console.log(`${count} array parameters, by kind and elements x element bytes:`, shapes);
  });
});

describe.runIf(refdata !== '' && paths.length > 0)('coding evidence on real chips (NCS_REFDATA, M35080_DUMPS)', () => {
  let doc: CodingDoc;
  let images: Uint8Array[];
  beforeAll(() => {
    doc = loadDoc();
    images = paths.map((p) => new Uint8Array(readFileSync(p)));
  });

  it('reads the reference data the app reads', () => {
    expect(validateRef('kombi-coding', doc)).toBeNull();
  });

  it('resolves every consistent late-layout chip to exactly one definition: complete fit, its own index, codable', () => {
    const late = images.filter((img) => {
      const l = detectLayout(img);
      return l.kind === 'late' && l.consistent;
    });
    expect(late.length).toBeGreaterThan(0);
    const tally: Record<string, number> = {};
    for (const img of late) {
      const c = chooseDefinition(img, doc);
      expect(c.kind).toBe('chosen');
      if (c.kind !== 'chosen') continue;
      expect(c.match.complete).toBe(true);
      expect(c.match.index).toBe(c.match.chipIndex);
      expect(definitionRefusal(c.def)).toBeNull();
      tally[c.file] = (tally[c.file] ?? 0) + 1;
    }
    console.log(`${late.length} late-layout image(s) resolved:`, tally);
  });

  it('resolves nothing for an image that is not the late layout, and says how close the best came', () => {
    const other = images.filter((img) => detectLayout(img).kind !== 'late');
    const closest: string[] = [];
    for (const img of other) {
      expect(chooseDefinition(img, doc)).toMatchObject({ kind: 'none', reason: 'not-late-layout' });
      const best = matchDefinitions(img, doc)[0];
      if (best) closest.push(`${best.fit.matched}/${best.fit.informative}`);
    }
    console.log(`${other.length} other image(s); best fits:`, closest);
  });

  it('shows how every definition scores on each late-layout image, and which tie with its own', () => {
    const late = images.filter((img) => {
      const l = detectLayout(img);
      return l.kind === 'late' && l.consistent;
    });
    late.forEach((img, i) => {
      const c = chooseDefinition(img, doc);
      const own = c.kind === 'chosen' ? c.file : null;
      const rows = matchDefinitions(img, doc).map((m) => {
        const layout = blockLayoutMatches(doc.definitions[m.file]!) ? 'late' : 'other';
        const index = m.index === null ? 'none' : m.index === m.chipIndex ? 'same' : 'differs';
        return `${m.file === own ? '* ' : ''}${m.file} ${m.fit.matched}/${m.fit.informative} blocks:${layout} index:${index}${m.complete ? ' COMPLETE' : ''}`;
      });
      console.log(`image #${i + 1}:\n  ${rows.join('\n  ')}`);
    });
  });
});
