/**
 * Which of the two E46 clusters this is, from its IDENT reply.
 *
 * The rule is BMW's own: D_0080.grp, the group file EDIABAS runs for address 0x80, reads the
 * diagnosis index out of IDENT and compares it with closed ranges, one per SGBD. The two that are
 * E46 clusters:
 *
 *   0x30-0x35  KOMBI46
 *   0x36-0x40  KOMBI46R
 *
 * The same file has ranges for other cars' clusters; this tool speaks to neither, so an index in
 * one of those is simply not a variant it knows.
 *
 * There is no manual override. A second way to decide the variant would be a second decider, and
 * the variant decides which telegrams the gate lets through. Until IDENT has named it, the gate
 * allows only the reads both variants share.
 */

import type { KombiVariant } from './protocol';

export const VARIANT_RANGES: readonly { variant: KombiVariant; lo: number; hi: number }[] = [
  { variant: 'KOMBI46', lo: 0x30, hi: 0x35 },
  { variant: 'KOMBI46R', lo: 0x36, hi: 0x40 },
];

export function variantOf(diagIndex: number): KombiVariant | null {
  return VARIANT_RANGES.find((r) => diagIndex >= r.lo && diagIndex <= r.hi)?.variant ?? null;
}
