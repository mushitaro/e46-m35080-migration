import { describe, it, expect } from 'vitest';
import {
  IMAGE_SIZE,
  SECURE_END,
  STANDARD_START,
  regionOf,
  secureOf,
  diff,
  assessChip,
  diagnoseImage,
  SPI_DUMMY,
  parseImageFile,
  hexRows,
  formatByte,
  formatAddress,
  asciiOf,
} from '@/lib/domain/image';
import {
  decodeStatus,
  isBlockProtected,
  STATUS_BIT_DEFS,
  STATUS_INC,
  STATUS_UV,
  STATUS_WIP,
} from '@/lib/domain/status';
import { slotsToBytes } from '@/lib/domain/odometer';

describe('regionOf', () => {
  it('maps the three regions at their exact boundaries', () => {
    expect(regionOf(0x000)).toBe('secure');
    expect(regionOf(SECURE_END)).toBe('secure');
    expect(regionOf(STANDARD_START)).toBe('standard');
    /* The VIN range is passed in, because it is found per image rather than
       fixed. With none given, no byte is a VIN byte - which is the honest
       answer for an image whose VIN has not been located. */
    const vins = [
      { from: 0x07a, to: 0x07e, field: 'coded' as const },
      { from: 0x184, to: 0x18a, field: 'ascii' as const },
    ];
    expect(regionOf(0x183, vins)).toBe('standard');
    expect(regionOf(0x184, vins)).toBe('vin');
    expect(regionOf(0x18a, vins)).toBe('vin');
    expect(regionOf(0x18b, vins)).toBe('standard');
    expect(regionOf(0x07a, vins)).toBe('vin');
    expect(regionOf(0x07f, vins)).toBe('standard');
    expect(regionOf(0x184)).toBe('standard');
    expect(regionOf(0x3ff)).toBe('standard');
  });
});

describe('diff', () => {
  it('lists only the addresses that differ', () => {
    const a = new Uint8Array(IMAGE_SIZE);
    const b = new Uint8Array(IMAGE_SIZE);
    b[0x10] = 1;
    b[0x2e8] = 0xff;
    expect(diff(a, b)).toEqual([0x10, 0x2e8]);
  });

  it('is empty for identical images', () => {
    expect(diff(new Uint8Array(4), new Uint8Array(4))).toEqual([]);
  });
});

describe('assessChip - what makes a chip resettable', () => {
  it('treats an all-zero secure area as blank', () => {
    const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
    img.fill(0x00, 0, 0x20);
    const a = assessChip(img, { uv: true });
    expect(a.blank).toBe(true);
    expect(a.secureBlank).toBe(true);
    expect(a.standardErased).toBe(true);
  });

  it('refuses a chip that already carries mileage', () => {
    const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
    img.set(slotsToBytes(Array(16).fill(0x2612)), 0);
    const a = assessChip(img);
    expect(a.blank).toBe(false);
    expect(a.reasons.join(' ')).toMatch(/already carries mileage/);
  });

  it('keys blankness on the counter, not on a written standard array', () => {
    // Counter zero but the standard array has been written: still resettable.
    const img = new Uint8Array(IMAGE_SIZE).fill(0x00);
    const a = assessChip(img);
    expect(a.blank).toBe(true);
    expect(a.standardErased).toBe(false);
    expect(a.reasons.join(' ')).toMatch(/written before/);
  });
});

describe('parseImageFile', () => {
  it('accepts exactly 1024 bytes', () => {
    const r = parseImageFile(new ArrayBuffer(IMAGE_SIZE));
    expect(r.ok).toBe(true);
  });

  it('refuses any other size rather than padding or truncating', () => {
    for (const n of [0, 512, 1023, 1025, 2048]) {
      const r = parseImageFile(new ArrayBuffer(n));
      expect(r.ok).toBe(false);
      /* The size it SAW, so the refusal can tell an empty file from a dump
         of a different chip - a sentence here would be English prose the
         reader's language never reached. */
      if (!r.ok) expect(r.size).toBe(n);
    }
  });
});

describe('hex formatting', () => {
  it('splits a full image into 64 rows of 16', () => {
    const rows = hexRows(new Uint8Array(IMAGE_SIZE));
    expect(rows).toHaveLength(64);
    expect(rows[0].address).toBe(0);
    expect(rows[1].address).toBe(0x10);
    expect(rows[63].bytes).toHaveLength(16);
  });

  it('formats bytes and addresses as fixed-width uppercase hex', () => {
    expect(formatByte(0x0a)).toBe('0A');
    expect(formatByte(0xff)).toBe('FF');
    expect(formatAddress(0x2e8)).toBe('2E8');
    expect(formatAddress(0x00)).toBe('000');
  });

  it('renders only printable ASCII, dots elsewhere', () => {
    expect(asciiOf(0x4b)).toBe('K');
    expect(asciiOf(0x00)).toBe('.');
    expect(asciiOf(0xff)).toBe('.');
  });

  it('secureOf extracts the 32-byte counter area', () => {
    const img = new Uint8Array(IMAGE_SIZE).fill(0xab);
    expect(secureOf(img)).toHaveLength(0x20);
  });
});

describe('decodeStatus', () => {
  it('reads an all-clear status', () => {
    const s = decodeStatus(0x00);
    expect(Object.values(s).filter((v) => v === true)).toHaveLength(0);
    expect(s.raw).toBe(0);
  });

  it('decodes each documented bit from its mask', () => {
    for (const def of STATUS_BIT_DEFS) {
      const s = decodeStatus(def.mask);
      expect(s[def.key]).toBe(true);
      // and nothing else is set
      const others = STATUS_BIT_DEFS.filter((d) => d.key !== def.key);
      expect(others.every((d) => s[d.key] === false)).toBe(true);
    }
  });

  it('decodes a combined status', () => {
    const s = decodeStatus(STATUS_UV | STATUS_INC | STATUS_WIP);
    expect(s.uv).toBe(true);
    expect(s.inc).toBe(true);
    expect(s.wip).toBe(true);
    expect(s.srwd).toBe(false);
  });

  it('masks off anything above 8 bits', () => {
    expect(decodeStatus(0x1ff).raw).toBe(0xff);
  });

  it('isBlockProtected when either BP bit is set', () => {
    expect(isBlockProtected(decodeStatus(0x00))).toBe(false);
    expect(isBlockProtected(decodeStatus(1 << 2))).toBe(true);
    expect(isBlockProtected(decodeStatus(1 << 3))).toBe(true);
  });
});

/*
 * These come from a real bench session: the chip was not responding and the
 * app reported "1,048,560 km" (1024 bytes of 0xFF decoded as 0xFFFF * 16) with
 * a BACKUP button beside it. A uniform image is the bus, never the part.
 */
describe('diagnoseImage', () => {
  const uniform = (v: number) => new Uint8Array(IMAGE_SIZE).fill(v);

  it('accepts a virgin chip, which is NOT uniform', () => {
    // Zero counters + erased array: two values, but in the right places.
    const img = uniform(0xff);
    img.fill(0x00, 0, SECURE_END + 1);
    expect(diagnoseImage(img).kind).toBe('ok');
  });

  it('calls all-0x00 and all-0xFF a non-responding chip', () => {
    expect(diagnoseImage(uniform(0x00))).toEqual({ kind: 'no-response', value: 0x00 });
    expect(diagnoseImage(uniform(0xff))).toEqual({ kind: 'no-response', value: 0xff });
  });

  it('names a MOSI->MISO short by the firmware dummy byte', () => {
    expect(diagnoseImage(uniform(SPI_DUMMY))).toEqual({
      kind: 'loopback',
      value: SPI_DUMMY,
    });
  });

  it('treats one differing byte as a real read', () => {
    const img = uniform(0x00);
    img[IMAGE_SIZE - 1] = 0x01;
    expect(diagnoseImage(img).kind).toBe('ok');
  });

  /* KNOWN LIMIT, asserted so nobody "fixes" it by guessing. One captured
     failure alternated 0x00/0xFF every 128 bytes (one read chunk) - a floating
     line, but not uniform, so this check passes it. Rejecting two-valued images
     is NOT the answer: a virgin chip is exactly two-valued. Refusing a real
     read is as bad as accepting a fake one, so this stays narrow and certain. */
  it('does NOT catch a per-chunk alternating floating line', () => {
    const img = new Uint8Array(IMAGE_SIZE);
    for (let i = 0; i < IMAGE_SIZE; i++) img[i] = (i >> 7) % 2 ? 0xff : 0x00;
    expect(diagnoseImage(img).kind).toBe('ok');
  });
});

/*
 * The status register is read in its OWN transaction, so it is a second,
 * independent look at the same wire. Uniformity alone was one observation -
 * and one observation is how a guard becomes a false accusation. A chip whose
 * array really is uniform is indistinguishable from a dead bus until RDSR
 * disagrees.
 */
describe('diagnoseImage + the status register', () => {
  const uniform = (v: number) => new Uint8Array(IMAGE_SIZE).fill(v);

  it('accepts a uniform image when the status register disagrees', () => {
    // UV set = "erased" on a chip that is plainly answering.
    expect(diagnoseImage(uniform(0x00), STATUS_UV).kind).toBe('ok');
    expect(diagnoseImage(uniform(0xff), 0x00).kind).toBe('ok');
  });

  it('refuses only when the status shows the SAME stuck value', () => {
    expect(diagnoseImage(uniform(0x00), 0x00)).toEqual({
      kind: 'no-response',
      value: 0x00,
      status: 0x00,
    });
    expect(diagnoseImage(uniform(0xff), 0xff)).toEqual({
      kind: 'no-response',
      value: 0xff,
      status: 0xff,
    });
  });

  it('carries the status into a loopback verdict so the message can show it', () => {
    expect(diagnoseImage(uniform(SPI_DUMMY), SPI_DUMMY)).toEqual({
      kind: 'loopback',
      value: SPI_DUMMY,
      status: SPI_DUMMY,
    });
  });
});

describe('backupFilename - the mode is in the name', () => {
  it('prefixes a PRACTICE backup, so it cannot pass for a chip read', async () => {
    /* tsunagi-m-ux section 16. A practice export named exactly like a real
       backup was once read back as evidence for an offset the app itself had
       written. */
    const { backupFilename } = await import('@/lib/domain/records');
    const at = new Date(2026, 8, 23, 10, 20);
    expect(backupFilename('AB12345', 155_940, at, true)).toMatch(/^PRACTICE_Backup_/);
    expect(backupFilename('AB12345', 155_940, at, false)).toMatch(/^Backup_/);
    expect(backupFilename('AB12345', 155_940, at)).toMatch(/^Backup_/);
  });

  it('names a record by what it is, keeping the practice mark', async () => {
    const { recordFilename } = await import('@/lib/domain/records');
    const at = new Date(2026, 8, 17, 16, 53);
    expect(recordFilename('rewrite', 'AB12345', 200_000, at)).toBe('Rewrite_AB12345_200000km_20260917-1653.bin');
    expect(recordFilename('restore', null, 0, at, true)).toBe('PRACTICE_Restore_noVIN_0km_20260917-1653.bin');
    expect(recordFilename('backup', 'AB12345', null, at)).toBe('Backup_AB12345_noKM_20260917-1653.bin');
  });
});
