/**
 * What this tool knows about a coding definition before it reads a chip with it.
 *
 * Numbers only (docs/CODING.md). The four definitions that fit late-layout chips share one
 * coding-block layout; the older ones address a different generation. A definition whose blocks
 * are not this layout, or whose memory is not organised MSB-first, is refused for writing - there
 * is no measurement behind using it on this chip.
 */

import type { CodingDefinition } from '@/lib/refdata/types';

/** [address, length] of every coding block, as the late definitions all declare them. */
export const LATE_CODING_BLOCKS: readonly [number, number][] = [
  [0x020, 0x10],
  [0x056, 0x02],
  [0x070, 0x0a],
  [0x07a, 0x06],
  [0x07e, 0x0a],
  [0x088, 0xe6],
  [0x16e, 0x02],
  [0x170, 0x14],
];

export function blockLayoutMatches(def: CodingDefinition): boolean {
  const blocks = def.blocks
    .filter((b) => b.kind === 'coding')
    .map((b) => [b.address, b.length] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return (
    blocks.length === LATE_CODING_BLOCKS.length &&
    blocks.every(([a, l], i) => a === LATE_CODING_BLOCKS[i]![0] && l === LATE_CODING_BLOCKS[i]![1])
  );
}

export const isWordMsb = (def: CodingDefinition): boolean => def.memory?.structure === 'WORDMSB';

/** The definition's own coding index (SGID_CODIERINDEX), or null when it declares none. */
export function codingIndexOf(def: CodingDefinition): number | null {
  const ci = def.codingIndex as { WERT?: unknown } | null;
  return ci && Number.isInteger(ci.WERT) ? (ci.WERT as number) : null;
}
