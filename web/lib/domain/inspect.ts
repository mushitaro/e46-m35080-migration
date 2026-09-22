/**
 * An opened dump file, and the edits made to it.
 *
 * WHY THIS IS NOT `state.image`
 *
 * The device image means one thing in this app: the bytes that came off the
 * chip in front of you, read twice and compared. Every write plans against it
 * and verifies against it. A file loaded from disk is a different claim - it
 * might be last week's chip, another car's, or an export this app made in
 * PRACTICE mode.
 *
 * Letting the two share a variable would be one `setState` away from planning
 * an irreversible write from somebody else's dump while the screen said it had
 * verified. So they do not share one. This workspace is its own subject with
 * its own hex view, and nothing here can reach the chip. The path that DOES
 * take a file to the chip is RESTORE, which is gated on a backup, a blank
 * check, a byte-level plan and a read-back.
 *
 * WHAT AN EDIT IS
 *
 * `original` is what was on disk and is never written to. `current` carries
 * the edits. Keeping both is what lets the hex view mark exactly what changed,
 * what lets an edit be undone, and what makes "save" honest about being a new
 * file rather than a patch of the old one.
 */

import { IMAGE_SIZE, diff } from './image';

/** One byte, changed. `before` is what makes the edit reversible. */
export type ByteEdit = { address: number; before: number; after: number };

export type Workspace = {
  /** The file's own name, so a save can be traced back to a source. */
  name: string;
  /** Exactly as loaded. Never mutated. */
  original: Uint8Array;
  /** The bytes as edited. */
  current: Uint8Array;
  /** In the order they were made, so the last one can be taken back. */
  edits: ByteEdit[];
};

export function openWorkspace(name: string, image: Uint8Array): Workspace {
  return {
    name,
    original: image.slice(),
    current: image.slice(),
    edits: [],
  };
}

/** Addresses where the workspace differs from the file it came from. */
export function changedAddresses(ws: Workspace): number[] {
  return diff(ws.original, ws.current);
}

export function isDirty(ws: Workspace): boolean {
  return changedAddresses(ws).length > 0;
}

export type EditResult =
  | { ok: true; workspace: Workspace }
  | { ok: false; reason: 'out-of-range' | 'not-a-byte' | 'no-change' };

/**
 * Set one byte.
 *
 * Refuses a no-op rather than recording it. An undo stack that fills with
 * entries that changed nothing makes "undo" stop meaning anything - you press
 * it and the bytes do not move.
 */
export function editByte(ws: Workspace, address: number, value: number): EditResult {
  if (!Number.isInteger(address) || address < 0 || address >= IMAGE_SIZE) {
    return { ok: false, reason: 'out-of-range' };
  }
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    return { ok: false, reason: 'not-a-byte' };
  }
  const before = ws.current[address];
  if (before === value) return { ok: false, reason: 'no-change' };

  const current = ws.current.slice();
  current[address] = value;
  return {
    ok: true,
    workspace: { ...ws, current, edits: [...ws.edits, { address, before, after: value }] },
  };
}

/** Take back the most recent edit. */
export function undoLast(ws: Workspace): Workspace {
  const last = ws.edits[ws.edits.length - 1];
  if (!last) return ws;
  const current = ws.current.slice();
  current[last.address] = last.before;
  return { ...ws, current, edits: ws.edits.slice(0, -1) };
}

/** Back to the file as it was opened. */
export function revertAll(ws: Workspace): Workspace {
  return { ...ws, current: ws.original.slice(), edits: [] };
}

/**
 * A name for the edited file.
 *
 * Deliberately NOT the original name. A save that lands on top of its source
 * is how the only copy of a real dump gets replaced by an experiment - and
 * these files are often the only record of a chip that has since been written.
 */
export function editedFilename(name: string, at: Date): string {
  const stem = name.replace(/\.[^.]*$/, '');
  const stamp = at.toISOString().slice(0, 19).replace(/[:T]/g, '').replace(/-/g, '');
  return `${stem}_edited_${stamp}.bin`;
}

/* ------------------------------- the check -------------------------------- */

/**
 * Whether the file in hand is a chip read at all.
 *
 * This is the question a pile of .bin files actually poses. Of the dumps on
 * this bench, several are not chips: a loopback read that is 1024 bytes of
 * 0xA5, floating-line reads that are all 0x00 or all 0xFF, and one export this
 * app produced in PRACTICE mode from its own assumptions. Opening any of them
 * and reading an odometer off it produces a confident number about nothing.
 *
 * `distinct` is the cheap, honest summary: a real E46 image has well over a
 * hundred distinct byte values, and everything listed above has one, two, or
 * ten. It is reported rather than thresholded, because "how much variety" is
 * evidence the reader can weigh and a pass/fail line is a guess.
 */
export type FileVerdict = {
  /** How many different byte values appear. One means a dead bus. */
  distinct: number;
  /** True when every byte is the same value - never a real M35080. */
  uniform: boolean;
  /** The repeated value, when uniform. */
  uniformValue: number | null;
  /** Secure area all zero: a new chip, or one that never counted. */
  secureBlank: boolean;
  /** Standard array untouched since erase. */
  standardErased: boolean;
};

export function verdictFor(image: Uint8Array): FileVerdict {
  const seen = new Set<number>();
  for (const b of image) seen.add(b);
  const uniform = seen.size === 1;
  let secureBlank = true;
  for (let a = 0; a < 0x20; a++) if (image[a] !== 0x00) secureBlank = false;
  let standardErased = true;
  for (let a = 0x20; a < image.length; a++) if (image[a] !== 0xff) standardErased = false;
  return {
    distinct: seen.size,
    uniform,
    uniformValue: uniform ? image[0] : null,
    secureBlank,
    standardErased,
  };
}
