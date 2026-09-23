import { describe, expect, it } from 'vitest';
import { WebSerialM35080Link, type LinkTiming } from '@/lib/link/m35080Link';
import { planCoding } from '@/lib/ncs/encode';
import { chooseDefinition, rowsFor } from '@/lib/ncs/decode';
import { detectLayout } from '@/lib/domain/layout';
import { M35080Simulator, ScriptedTransport, TEST_TIMING } from './support/m35080Simulator';
import { codingFixture, P } from './support/codingDoc';

/**
 * A coding plan, written through the real bridge link to the simulated chip, byte by byte and
 * verified as runWrite does - then the chip read back whole. What lands must be exactly the image
 * the plan promised: the parameters changed, both checksums sealed, nothing else touched.
 */

function makeLink(sim: M35080Simulator, timing: Partial<LinkTiming> = {}) {
  const transport = new ScriptedTransport(sim);
  const link = new WebSerialM35080Link({} as never, { ...TEST_TIMING, ...timing });
  (link as unknown as { transport: ScriptedTransport }).transport = transport;
  return { link, transport };
}

describe('writing a coding plan to a chip', () => {
  it('leaves the chip exactly as planned, still its own definition, checksums holding', async () => {
    const { image, doc } = codingFixture();
    const plan = planCoding(image, doc, [
      { param: P.mode, option: 103 },
      { param: P.level, option: 162 },
      { param: P.upper, option: 172 },
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const sim = new M35080Simulator({ image });
    const { link } = makeLink(sim);
    await link.connect();
    for (const w of plan.byteWrites) await link.writeAndVerify(w.address, w.data);
    const after = await link.readImage();

    expect(after).toEqual(plan.after);
    const differing = Array.from(after).flatMap((b, a) => (b !== image[a] ? [a] : []));
    expect(differing.sort((x, y) => x - y)).toEqual(plan.byteWrites.map((w) => w.address).sort((x, y) => x - y));
    const layout = detectLayout(after);
    expect(layout.kind === 'late' && layout.consistent).toBe(true);
    expect(chooseDefinition(after, doc)).toMatchObject({ kind: 'chosen', file: 'DEMO.C01' });
    const rows = rowsFor(after, doc.definitions['DEMO.C01']!);
    expect([rows[P.mode]!.option?.keyword, rows[P.level]!.option?.keyword, rows[P.upper]!.option?.keyword]).toEqual(['m_c', 'v_b', 'u_b']);
  });

  it('never plans the odometer or a VIN byte, so the write path is never asked to', () => {
    const { image, doc } = codingFixture();
    for (const param of [P.guarded, P.vin]) {
      expect(planCoding(image, doc, [{ param, option: 142 }])).toMatchObject({ ok: false, code: 'not-codable' });
    }
  });
});
