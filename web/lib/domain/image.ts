/**
 * The 1 KB M35080 EEPROM image, its regions, and comparisons between images.
 *
 * The M35080 is 8 Kbit = 1024 bytes (0x000-0x3FF), split by BMW usage into:
 *   0x000-0x01F  secure / incremental - the odometer, increment-only
 *   0x020-0x3FF  standard array       - freely rewritable
 *
 * There is no third fixed region. The VIN used to be listed here as
 * 0x2E8-0x2EF and it is not there; where it lives varies by cluster
 * generation, so it is found by scanning and passed in as a range.
 */

import { SECURE_BYTES, isSecureBlank } from './odometer';

export const IMAGE_SIZE = 0x400; // 1024 bytes
export const SECURE_START = 0x000;
export const SECURE_END = 0x01f;
export const STANDARD_START = 0x020;
export const STANDARD_END = 0x3ff;

export type Region = 'secure' | 'vin' | 'standard';

/** Where a VIN field was found in THIS image. There can be two (vin.ts): coded and ASCII. */
export type VinSpan = { from: number; to: number; field: 'coded' | 'ascii' };

export function regionOf(address: number, vins: readonly VinSpan[] = []): Region {
  if (address <= SECURE_END) return 'secure';
  if (vins.some((v) => address >= v.from && address <= v.to)) return 'vin';
  return 'standard';
}

/** The secure area as its own 32-byte view. */
export function secureOf(image: Uint8Array): Uint8Array {
  return image.slice(SECURE_START, SECURE_START + SECURE_BYTES);
}

/** Addresses at which two images differ. Both must be the same length. */
export function diff(a: Uint8Array, b: Uint8Array): number[] {
  const n = Math.min(a.length, b.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

export type ChipAssessment = {
  /** Secure area is all zero: the odometer reads 0 km and can still be set. */
  secureBlank: boolean;
  /** Standard array is entirely 0xFF - never written since erase. */
  standardErased: boolean;
  /**
   * Safe to treat as a NEW blank chip. Requires the secure area to be zero;
   * that is the only condition that actually makes a 0 km reset possible.
   */
  blank: boolean;
  reasons: string[];
};

/**
 * Decide whether this chip can be treated as blank.
 *
 * Deliberately keyed on the secure area rather than on the UV status bit
 * alone: UV says "has been erased", but what the Reset flow actually needs is
 * "the increment-only counter is still at zero". A chip whose standard array
 * was rewritten but whose counter is zero is still resettable; a chip with UV
 * set but a non-zero counter is not.
 */
export function assessChip(
  image: Uint8Array,
  opts: { uv?: boolean } = {},
): ChipAssessment {
  const secureBlank = isSecureBlank(secureOf(image));
  const standard = image.subarray(STANDARD_START, STANDARD_END + 1);
  const standardErased = standard.every((b) => b === 0xff);

  const reasons: string[] = [];
  if (!secureBlank) {
    reasons.push(
      'the secure area (0x00-0x1F) is not zero - this chip already carries mileage',
    );
  }
  if (secureBlank && !standardErased) {
    reasons.push(
      'secure area is zero but the standard array has been written before',
    );
  }
  if (opts.uv === false && secureBlank) {
    reasons.push('UV (erased) status bit is clear');
  }

  return { secureBlank, standardErased, blank: secureBlank, reasons };
}

/**
 * The byte the firmware clocks out on D while the chip drives Q.
 *
 * Must match SPI_DUMMY in firmware/m35080_bridge. Chosen so that a read of
 * nothing but this value can only mean D is reaching Q's wire directly.
 */
export const SPI_DUMMY = 0xa5;

export type ImageDiagnosis =
  | { kind: 'ok' }
  /** Every byte identical: nothing drove MISO. */
  | { kind: 'no-response'; value: number; status?: number }
  /** Every byte is the dummy: D11 (MOSI) is shorted to D12 (MISO). */
  | { kind: 'loopback'; value: number; status?: number };

/**
 * The failing half of a diagnosis.
 *
 * Named so the copy layer can take "a fault" and always have `value` to render.
 * Without it, `kind === 'loopback' ? ... : d.value` leaves `{kind:'ok'}` in the
 * else branch and the message cannot be written at all.
 */
export type ImageFault = Exclude<ImageDiagnosis, { kind: 'ok' }>;

/**
 * Decide whether an image could have come from a chip at all.
 *
 * A uniform 1 KB image is never a real M35080: a virgin part reads 0x00 across
 * the secure counters AND 0xFF across the standard array, so even a brand-new
 * chip is not uniform. Uniform therefore means the bus, not the part - a
 * floating MISO reads all 0x00 (pulled low) or all 0xFF (pulled high), and a
 * MOSI->MISO short reads all SPI_DUMMY.
 *
 * This exists because the app once rendered 1024 bytes of 0xFF as a confident
 * "1,048,560 km" and offered to back it up. An odometer tool must not show a
 * floating wire as mileage.
 */
export function diagnoseImage(image: Uint8Array, statusRaw?: number): ImageDiagnosis {
  if (image.length === 0) return { kind: 'ok' };
  const first = image[0];
  for (let i = 1; i < image.length; i++) {
    if (image[i] !== first) return { kind: 'ok' };
  }

  /* Uniform - but uniformity alone is one observation, and one observation is
     how a guard turns into a false accusation.
     RDSR runs as its OWN transaction, so the status byte is a SECOND, separate
     look at the same wire. If it came back different from the stuck value, then
     something drove the line between the two reads and this is data, not a dead
     bus. A floating line has no such luck: it reads 0x00 (or 0xFF) both times.
     This matters for a real case - a chip whose array is genuinely uniform is
     indistinguishable from silence until the status register disagrees. */
  if (statusRaw !== undefined && statusRaw !== first) return { kind: 'ok' };

  return first === SPI_DUMMY
    ? { kind: 'loopback', value: first, status: statusRaw }
    : { kind: 'no-response', value: first, status: statusRaw };
}

/**
 * Whether a FILE in hand is a chip read at all - REWRITE's SOURCE shows it in one line, and READ
 * refuses a PRACTICE chip that is not one.
 *
 * This is the question a pile of .bin files actually poses. Of the dumps on this bench, several
 * are not chips: a loopback read that is 1024 bytes of 0xA5, floating-line reads that are all 0x00
 * or all 0xFF, and an export this app once made in PRACTICE mode from its own assumptions. Opening
 * any of them and reading an odometer off it produces a confident number about nothing.
 *
 * `distinct` is the cheap, honest summary: a real E46 image has well over a hundred distinct byte
 * values, and everything listed above has one, two, or ten. It is reported rather than
 * thresholded, because "how much variety" is evidence the reader can weigh and a pass/fail line is
 * a guess. (A file has no status register to ask, so unlike diagnoseImage this cannot tell a
 * uniform chip from a dead bus - and does not try.)
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
  for (let a = SECURE_START; a <= SECURE_END; a++) if (image[a] !== 0x00) secureBlank = false;
  let standardErased = true;
  for (let a = STANDARD_START; a < image.length; a++) if (image[a] !== 0xff) standardErased = false;
  return {
    distinct: seen.size,
    uniform,
    uniformValue: uniform ? (image[0] ?? null) : null,
    secureBlank,
    standardErased,
  };
}

/**
 * Parse a backup file. Refuses anything that is not exactly one image.
 *
 * The refusal carries the SIZE, not a sentence. The sentence is prose and
 * belongs to the reader's language (lib/i18n.ts); what the parser knows is a
 * number, and a refusal that drops it cannot tell "an empty file" from "a
 * 2 KB dump of a different chip" from "a text file".
 */
export function parseImageFile(
  buffer: ArrayBuffer,
): { ok: true; image: Uint8Array } | { ok: false; size: number } {
  if (buffer.byteLength !== IMAGE_SIZE) return { ok: false, size: buffer.byteLength };
  return { ok: true, image: new Uint8Array(buffer) };
}

export const BYTES_PER_ROW = 16;

export type HexRow = {
  address: number;
  bytes: Uint8Array;
};

/** Split an image into fixed-width rows for the hex grid. */
export function hexRows(
  image: Uint8Array,
  bytesPerRow = BYTES_PER_ROW,
): HexRow[] {
  const rows: HexRow[] = [];
  for (let a = 0; a < image.length; a += bytesPerRow) {
    rows.push({ address: a, bytes: image.subarray(a, a + bytesPerRow) });
  }
  return rows;
}

export function formatByte(b: number): string {
  return b.toString(16).toUpperCase().padStart(2, '0');
}

export function formatAddress(a: number, width = 3): string {
  return a.toString(16).toUpperCase().padStart(width, '0');
}

/** Printable-ASCII rendering for the hex view's side column. */
export function asciiOf(b: number): string {
  return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
}

/** SHA-256 of an image, for provenance on stored records. */
export async function hashImage(image: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(image.byteLength);
  new Uint8Array(buf).set(image);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
