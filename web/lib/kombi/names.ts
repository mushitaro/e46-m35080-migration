/**
 * The names TEST puts beside a bit - a lamp, an output, an input - from the reference data
 * (kombi-names.json, served behind the owner gate or opened from disk; never in this build).
 *
 * The position is always shown and always comes first: `B2.b5` is what was sent and what the
 * report records, whatever the name says. Without the data, or for a bit it does not name, the
 * position is all there is - which is the honest answer, not a gap to paper over.
 *
 * Faults stay raw bytes: how the fault memory splits into entries has not been extracted, so there
 * is no code to look a name up by (TEST's copy says so).
 */

import type { KombiVariant } from './protocol';
import type { NameSource, NamesDoc, VariantNames } from '@/lib/refdata/types';

type Lang = 'ja' | 'en';

export type BitGroup = 'lamps' | 'outputs' | 'inputs';

/** The names for the variant the cluster answered as; none while the variant is unknown. */
export function namesFor(doc: NamesDoc | null, variant: KombiVariant | null): VariantNames | null {
  return doc && variant ? (doc.variants[variant] ?? null) : null;
}

/** A bit's name in the reader's language, and where it came from - or null when there is none. */
export function bitName(
  names: VariantNames | null,
  group: BitGroup,
  key: string,
  lang: Lang,
): { text: string; source: NameSource } | null {
  const n = names?.[group][key];
  const text = n ? (lang === 'ja' ? n.ja : n.en) : null;
  return n && text ? { text, source: n.source } : null;
}
