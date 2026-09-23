import { describe, it, expect } from 'vitest';
import {
  analyzeStructure,
  asciiRuns,
  repeatedGroups,
  constantRuns,
} from '@/lib/domain/structure';
import { IMAGE_SIZE } from '@/lib/domain/image';

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe('structure - what the bytes say, not what a map claims', () => {
  it('finds an uppercase identifier and flags a VIN-shaped one', () => {
    // The real case: the only identifier on a V6 sat at 0x183-0x18A, not at
    // 0x2E8. Structure reports the raw run - the 0x4C in front included; it is
    // vin.ts, not this file, that knows the VIN is the last seven of it.
    const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
    img[0x183] = 0x4c;
    img.set(ascii('AB12345'), 0x184);
    const runs = asciiRuns(img);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ from: 0x183, to: 0x18a, text: 'LAB12345', vinShaped: true });
  });

  it('does NOT turn lowercase noise into an identifier', () => {
    // A real E46 dump produced "lNFEx" and "KZsZ|" under a printable-range
    // filter. Uppercase-only is what keeps this list worth reading.
    const img = new Uint8Array(IMAGE_SIZE);
    img.set(ascii('lNFEx'), 0x100);
    expect(asciiRuns(img)).toHaveLength(0);
  });

  it('finds a value stored three times and reports the stride', () => {
    const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
    img.set([0x02, 0x98, 0x02, 0x98, 0x02, 0x98], 0x30); // seen on two unrelated chips
    const g = repeatedGroups(img).filter((f) => f.from === 0x30);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ hex: '0298', copies: 3, stride: 2, to: 0x35 });
  });

  it('finds the stride-3 triple - the shape that lost every copy on the bench', () => {
    const img = new Uint8Array(IMAGE_SIZE);
    img.set([0xf6, 0x88, 0x13, 0xf7, 0x88, 0x13, 0xf8, 0x88, 0x13], 0x21);
    const g = repeatedGroups(img).filter((f) => f.hex === '8813');
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ from: 0x22, copies: 3, stride: 3 });
  });

  it('never calls all-FF or all-00 redundancy - that is absence, not a copy', () => {
    expect(repeatedGroups(new Uint8Array(IMAGE_SIZE).fill(0xff))).toEqual([]);
    expect(repeatedGroups(new Uint8Array(IMAGE_SIZE))).toEqual([]);
  });

  it('reports long constant runs with the value they hold', () => {
    const runs = constantRuns(new Uint8Array(IMAGE_SIZE).fill(0xff));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ from: 0, to: IMAGE_SIZE - 1, value: 0xff });
  });

  it('always names the secure area first, and sorts everything by address', () => {
    const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
    img.set(ascii('AB12345'), 0x200);
    const f = analyzeStructure(img);
    expect(f[0]).toMatchObject({ kind: 'secure', from: 0, to: 0x1f });
    const addrs = f.map((x) => x.from);
    expect(addrs).toEqual([...addrs].sort((a, b) => a - b));
    expect(f.some((x) => x.kind === 'ascii' && x.vinShaped)).toBe(true);
  });
});
