import { describe, it, expect } from 'vitest';
import { practiceBoxFor } from '@/lib/hub/practiceBox';

describe('practiceBoxFor', () => {
  it('holds the intent while disconnected, and lets the reader change it', () => {
    expect(practiceBoxFor({ phase: 'disconnected', practice: false, busy: false, intent: true })).toEqual({
      checked: true,
      locked: false,
    });
  });

  it('shows what the link IS once it is up, and locks', () => {
    // The intent says practice, the link is real: the box must say real.
    expect(practiceBoxFor({ phase: 'connected', practice: false, busy: false, intent: true })).toEqual({
      checked: false,
      locked: true,
    });
    expect(practiceBoxFor({ phase: 'connected', practice: true, busy: false, intent: false })).toEqual({
      checked: true,
      locked: true,
    });
  });

  it('locks while busy even before a link is up', () => {
    expect(practiceBoxFor({ phase: 'disconnected', practice: false, busy: true, intent: false }).locked).toBe(true);
  });
});
