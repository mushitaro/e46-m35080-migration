/**
 * What the PRACTICE checkbox shows, derived.
 *
 * tsunagi-m-ux section 16: the box is always drawn, top right of the hub area, in every link
 * state. While no link is up it holds the reader's INTENT for the next connect; while a link is
 * up it shows what that link IS - the authority, not the intent - and cannot change it, because
 * an open link cannot be retargeted and a live box would lie.
 */

export type PracticeBoxState = {
  /** The phase of the link that owns the current tab. */
  phase: string;
  /** Whether that link, when up, is a practice one. */
  practice: boolean;
  busy: boolean;
  /** The reader's choice for the next connect. */
  intent: boolean;
};

export function practiceBoxFor(s: PracticeBoxState): { checked: boolean; locked: boolean } {
  const idle = s.phase === 'disconnected';
  return {
    checked: idle ? s.intent : s.practice,
    locked: !idle || s.busy,
  };
}
