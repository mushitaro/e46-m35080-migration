import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  M35080_PINS,
  ADAPTER,
  ELECTRICAL,
  connectedPins,
  pinByName,
} from '@/lib/domain/hardware';

describe('the pin map', () => {
  it('has eight pins, numbered 1..8', () => {
    expect(M35080_PINS).toHaveLength(8);
    expect(M35080_PINS.map((p) => p.pin)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('matches the firmware wiring exactly', () => {
    // These are the #defines in firmware/m35080_bridge/m35080_bridge.ino.
    // If the two ever disagree, the diagram teaches a miswire.
    const expected: Record<string, string | null> = {
      VSS: 'GND',
      S: 'D10',
      W: 'D9',
      Q: 'D12',
      NC: null,
      C: 'D13',
      D: 'D11',
      VCC: '5V',
    };
    for (const [name, uno] of Object.entries(expected)) {
      expect(pinByName(name)?.uno, `pin ${name}`).toBe(uno);
    }
  });

  it('is NOT the standard 25xx pinout - the mistake this table exists to stop', () => {
    // On a 25xx: pin 1 = CS, pin 4 = VSS, pin 7 = HOLD.
    // On the M35080: pin 1 = VSS, pin 4 = Q, and there is no HOLD at all.
    expect(M35080_PINS[0].name).toBe('VSS');
    expect(M35080_PINS[3].name).toBe('Q');
    expect(M35080_PINS.some((p) => /hold/i.test(p.name))).toBe(false);
    // Only VCC sits where a generic guide would put it.
    expect(M35080_PINS[7].name).toBe('VCC');
  });

  it('leaves pin 5 unconnected, with no colour to imply a wire', () => {
    const nc = pinByName('NC');
    expect(nc?.uno).toBeNull();
    expect(nc?.color).toBeNull();
    expect(nc?.role).toBe('unused');
  });

  it('gives every wired pin a colour, so the diagram can draw it', () => {
    expect(connectedPins()).toHaveLength(7);
    for (const p of connectedPins()) {
      expect(p.color, `pin ${p.pin} ${p.name} has no colour`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('uses a distinct colour per wire', () => {
    const colors = connectedPins().map((p) => p.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe('the part facts that get bought wrong', () => {
  it('specifies the 150 mil adapter, not the 200', () => {
    expect(ADAPTER.widthMil).toBe(150);
    expect(ADAPTER.wrongWidthMil).toBe(200);
  });

  it('records a 5 V part, which is why a 3.3 V board needs shifting', () => {
    expect(ELECTRICAL.supplyMin).toBe(4.5);
    expect(ELECTRICAL.supplyMax).toBe(5.5);
    expect(ELECTRICAL.supplyMin).toBeGreaterThan(3.3);
  });

  it('runs the bus below the part rating', () => {
    expect(ELECTRICAL.firmwareClockHz).toBeLessThanOrEqual(ELECTRICAL.maxClockHz);
  });

  it('states the clock the firmware actually runs', () => {
    // The data said 3 MHz while the sketch had long since moved to 1 MHz, and nothing noticed.
    const ino = fs.readFileSync(
      path.resolve(__dirname, '../../firmware/m35080_bridge/m35080_bridge.ino'),
      'utf8',
    );
    const m = /SPISettings\s+\w+\((\d+)\s*,/.exec(ino);
    expect(m, 'SPISettings in m35080_bridge.ino').not.toBeNull();
    expect(Number(m![1])).toBe(ELECTRICAL.firmwareClockHz);
  });
});

/**
 * The same eight connections are written twice: here, and in the wiring table
 * of docs/HARDWARE.md. Two copies of one fact is how one of them goes stale, so
 * the document is parsed and compared rather than trusted.
 */
describe('parity with docs/HARDWARE.md', () => {
  const doc = fs.readFileSync(
    path.join(process.cwd(), '..', 'docs', 'HARDWARE.md'),
    'utf8',
  );

  /** Rows of the pinout table: | 1 | VSS | Ground | GND | */
  const rows = doc
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\|\s*[1-8]\s*\|/.test(l))
    .map((l) => l.split('|').map((c) => c.trim()))
    .map((c) => ({ pin: Number(c[1]), name: c[2], uno: c[4] }));

  it('found the table', () => {
    expect(rows).toHaveLength(8);
  });

  it('agrees on every pin name and Arduino destination', () => {
    for (const row of rows) {
      const pin = M35080_PINS.find((p) => p.pin === row.pin);
      expect(pin, `doc lists pin ${row.pin}, hardware.ts does not`).toBeDefined();
      expect(pin!.name, `pin ${row.pin} name`).toBe(row.name);

      // The doc writes "leave open" where there is no connection.
      const docUno = /open/i.test(row.uno) ? null : row.uno;
      expect(pin!.uno, `pin ${row.pin} (${row.name}) destination`).toBe(docUno);
    }
  });
});
