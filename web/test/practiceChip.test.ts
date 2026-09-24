import { describe, expect, it } from 'vitest';
import { codedPracticeChip } from '@/lib/ncs/practice';
import { chooseDefinition, rowsFor } from '@/lib/ncs/decode';
import { detectLayout } from '@/lib/domain/layout';
import { readVins } from '@/lib/domain/vin';
import { secureOf } from '@/lib/domain/image';
import { presetImage } from '@/lib/link/mockLink';
import { NO_BYTES, planJob } from '@/lib/domain/job';
import { codingFixture, P } from './support/codingDoc';

/**
 * PRACTICE's chip made to fit a definition, so coding can be rehearsed with nothing opened from
 * disk - on the synthetic definition only.
 */

describe("PRACTICE's coded chip", () => {
  it('fits one definition completely, with its own index: the newest usable one', () => {
    const { doc } = codingFixture();
    const base = presetImage('late');
    expect(chooseDefinition(base, doc).kind).toBe('none'); // the made-up preset fits nothing
    const made = codedPracticeChip(base, doc);
    expect(made?.file).toBe('DEMO.C02');
    expect(chooseDefinition(made!.image, doc)).toMatchObject({ kind: 'chosen', file: 'DEMO.C02' });
  });

  it('keeps the odometer and the coded VIN, and its checksums hold', () => {
    const { doc } = codingFixture();
    const base = presetImage('late');
    const made = codedPracticeChip(base, doc)!;
    expect(secureOf(made.image)).toEqual(secureOf(base));
    expect(readVins(made.image).coded?.text).toBe(readVins(base).coded?.text);
    const layout = detectLayout(made.image);
    expect(layout.kind === 'late' && layout.consistent).toBe(true);
  });

  it('can be coded like a real chip: a CODABLE pick plans and seals', () => {
    const { doc } = codingFixture();
    const made = codedPracticeChip(presetImage('late'), doc)!;
    const rows = rowsFor(made.image, doc.definitions[made.file]!);
    expect(rows[P.mode]!.status).toBe('codable');
    const current = rows[P.mode]!.option!.id;
    const other = [101, 102, 103].find((id) => id !== current)!;
    const plan = planJob({
      chip: made.image,
      source: { kind: 'chip' },
      bytes: NO_BYTES,
      odometer: { kind: 'keep' },
      vin: { kind: 'keep' },
      coding: { doc, changes: [{ param: P.mode, option: other }] },
    });
    expect(plan.ok && plan.coding?.file).toBe('DEMO.C02');
  });

  it('makes nothing when no definition can be used', () => {
    const { doc } = codingFixture();
    const unusable = {
      ...doc,
      definitions: Object.fromEntries(Object.entries(doc.definitions).map(([f, d]) => [f, { ...d, memory: { structure: 'WORDLSB', type: 'X' } }])),
    };
    expect(codedPracticeChip(presetImage('late'), unusable)).toBeNull();
  });
});
