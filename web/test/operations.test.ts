import { describe, it, expect } from 'vitest';
import {
  planRewrite,
  planReset,
  planRepairStandard,
  planRestore,
  applyPlanPreview,
  totalBytes,
} from '@/lib/domain/operations';
import { IMAGE_SIZE, STANDARD_START, secureOf } from '@/lib/domain/image';
import { slotsToBytes, encodeOdometer, decodeOdometer, MAX_KM } from '@/lib/domain/odometer';
import { encodeVin, readVin } from '@/lib/domain/vin';

/** Where a real V6 chip carries its VIN, NUL-terminated. */
const VIN_AT = 0x183;
const VIN_LEN = 8;

function usedChip(km = 155_940, vin = 'ABC12345'): Uint8Array {
  const img = new Uint8Array(IMAGE_SIZE).fill(0x00);
  img.set(slotsToBytes(encodeOdometer(km)), 0);
  img.set(encodeVin(vin), VIN_AT);
  return img;
}

function blankChip(): Uint8Array {
  const img = new Uint8Array(IMAGE_SIZE).fill(0xff);
  img.fill(0x00, 0, 0x20);
  return img;
}

describe('planRewrite', () => {
  it('plans an increase and reports the current reading', () => {
    const p = planRewrite(usedChip(155_940), 200_000);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.currentKm).toBe(155_940);
    expect(p.targetKm).toBe(200_000);
    expect(p.secureOps.length).toBeGreaterThan(0);
    expect(p.secureOps.every((o) => o.to > o.from)).toBe(true);
  });

  it('REFUSES a rollback and carries the floor as data', () => {
    const p = planRewrite(usedChip(155_940), 100_000);
    expect(p.ok).toBe(false);
    if (p.ok) return;
    // A code, not a sentence - the UI renders the sentence in the reader's
    // language, so nothing here is language-dependent.
    expect(p.code).toBe('cannot-lower');
    expect(p.floorKm).toBe(155_940);
  });

  it('allows writing the same value (a no-op plan)', () => {
    const p = planRewrite(usedChip(155_940), 155_940);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.secureOps).toHaveLength(0);
  });

  it('rejects a non-integer or negative target', () => {
    for (const bad of [1.5, -5]) {
      const p = planRewrite(usedChip(), bad);
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.code).toBe('km-invalid');
    }
  });

  it('rejects a target above the encodable maximum and says what it is', () => {
    const p = planRewrite(usedChip(), MAX_KM + 1);
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.code).toBe('km-too-large');
    expect(p.maxKm).toBe(MAX_KM);
  });

  it('rejects an image that is not exactly 1024 bytes', () => {
    const p = planRewrite(new Uint8Array(512), 1000);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.code).toBe('image-size');
  });

  it('plans a VIN write alongside the odometer', () => {
    const p = planRewrite(usedChip(), 200_000, { kind: 'write', vin: 'abc12346' });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.byteWrites).toHaveLength(1);
    expect(p.byteWrites[0].address).toBe(VIN_AT);
    expect(String.fromCharCode(...p.byteWrites[0].data)).toBe('ABC12346');
  });

  it('plans a VIN blank over the whole region including the checksum byte', () => {
    const p = planRewrite(usedChip(), 200_000, { kind: 'blank' });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.byteWrites[0].address).toBe(VIN_AT);
    expect(p.byteWrites[0].data).toHaveLength(8);
    expect(Array.from(p.byteWrites[0].data).every((b) => b === 0xff)).toBe(true);
  });

  it('writes nothing to the VIN when the action is keep', () => {
    const p = planRewrite(usedChip(), 200_000, { kind: 'keep' });
    expect(p.ok && p.byteWrites).toHaveLength(0);
  });

  it('refuses a malformed VIN before planning anything', () => {
    const p = planRewrite(usedChip(), 200_000, { kind: 'write', vin: 'BAD' });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.code).toBe('vin-invalid');
  });
});

/*
 * The RESTORE step: a backup's cluster data onto a new blank chip, VIN blanked,
 * odometer untouched. It used to accept no backup and write only the 8 VIN
 * bytes - leaving the standard array 0xFF, a chip that restores no car.
 */
describe('planReset - a backup onto a new blank chip', () => {
  /* Cluster-like data: many distinct values, as every measured dump has.
     usedChip() on its own is nearly all 0x00 and proves little. */
  function clusterBackup(km = 155_940): Uint8Array {
    const img = usedChip(km, 'AW72288');
    for (let a = STANDARD_START; a < IMAGE_SIZE; a++) img[a] = (a * 7 + 3) & 0xff;
    img.set(encodeVin('AW72288'), VIN_AT);
    return img;
  }

  it('REFUSES a used chip', () => {
    const p = planReset(usedChip(155_940), clusterBackup());
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.code).toBe('not-blank');
  });

  /* 0x2E8-0x2EF is copied like everything else. It used to be forced to 0xFF as
     "the VIN"; it is not the VIN - two of four real dumps hold live data there -
     and blanking it destroyed eight bytes of a cluster's data. */
  it('writes 0x20-0x3FF from the backup, byte for byte, VIN region included', () => {
    const backup = clusterBackup();
    const p = planReset(blankChip(), backup);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.byteWrites).toHaveLength(1);
    const w = p.byteWrites[0];
    expect(w.address).toBe(STANDARD_START);
    expect(w.data).toHaveLength(0x3ff - 0x20 + 1);
    for (let a = STANDARD_START; a <= 0x3ff; a++) {
      expect(w.data[a - STANDARD_START], `0x${a.toString(16)}`).toBe(backup[a]);
    }
    // Nothing is forced to 0xFF any more.
    expect(w.data[VIN_AT - STANDARD_START]).toBe(backup[VIN_AT]);
  });

  it('NEVER writes the odometer - it stays at 0 km for the car to sync up', () => {
    const p = planReset(blankChip(), clusterBackup(155_940));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.resultingKm).toBe(0);
    expect(p.byteWrites.every((w) => w.address >= STANDARD_START)).toBe(true);
  });

  it('REFUSES a backup with no cluster data - the empty chip this exists to fill', () => {
    const bad = {
      'all 0xFF (floating high)': new Uint8Array(IMAGE_SIZE).fill(0xff),
      'all 0x00 (floating low)': new Uint8Array(IMAGE_SIZE).fill(0x00),
      'all 0xA5 (loopback)': new Uint8Array(IMAGE_SIZE).fill(0xa5),
      // Not uniform overall (0x00 counters), but its array is still all 0xFF.
      'a virgin chip': blankChip(),
    };
    for (const [name, backup] of Object.entries(bad)) {
      const p = planReset(blankChip(), backup);
      expect(p.ok, name).toBe(false);
      if (!p.ok) expect(p.code, name).toBe('backup-no-data');
    }
  });

  it('rejects a wrong-sized backup', () => {
    const p = planReset(blankChip(), new Uint8Array(10));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.code).toBe('backup-size');
  });
});

describe('planRestore - onto a new blank chip', () => {
  it('plans the standard array plus the counter climb', () => {
    const backup = usedChip(155_940, 'ABC12345');
    const p = planRestore(backup, blankChip());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.restoredKm).toBe(155_940);
    expect(p.vin).toBe('ABC12345');
    expect(p.byteWrites[0].address).toBe(STANDARD_START);
    expect(p.secureOps).toHaveLength(16);
    expect(p.secureOps.every((o) => o.from === 0)).toBe(true);
  });

  it('REFUSES when the fitted chip already reads higher, and names the backup', () => {
    const p = planRestore(usedChip(100_000), usedChip(200_000));
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.code).toBe('restore-lower');
    expect(p.backupKm).toBe(100_000);
  });

  it('rejects a backup that is not exactly 1024 bytes', () => {
    const p = planRestore(new Uint8Array(999), blankChip());
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.code).toBe('backup-size');
  });

  it('rejects a wrong-sized current image', () => {
    const p = planRestore(usedChip(), new Uint8Array(10));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.code).toBe('current-size');
  });

  it('restoring onto an identical chip plans no counter writes', () => {
    const img = usedChip(155_940);
    const p = planRestore(img, img);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.secureOps).toHaveLength(0);
  });
});

describe('applyPlanPreview', () => {
  it('previews the odometer change without touching anything else', () => {
    const before = usedChip(155_940);
    const p = planRewrite(before, 160_000);
    expect(p.ok).toBe(true);
    if (!p.ok) return;

    const after = applyPlanPreview(before, p.byteWrites, p.secureOps);
    expect(decodeOdometer(secureOf(after))).toMatchObject({ ok: true, km: 160_000 });
    expect(readVin(after).found?.text).toBe('ABC12345');
    // the original image was not mutated
    expect(decodeOdometer(secureOf(before))).toMatchObject({ ok: true, km: 155_940 });
  });

  it('previews a VIN blank', () => {
    const before = usedChip();
    const p = planRewrite(before, 155_940, { kind: 'blank' });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const after = applyPlanPreview(before, p.byteWrites, p.secureOps);
    expect(readVin(after).blank).toBe(true);
  });

  it('a restore preview reproduces the backup exactly', () => {
    const backup = usedChip(155_940, 'KP83884');
    const p = planRestore(backup, blankChip());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const after = applyPlanPreview(blankChip(), p.byteWrites, p.secureOps);
    expect(Array.from(after)).toEqual(Array.from(backup));
  });
});

describe('totalBytes', () => {
  it('sums the planned byte writes', () => {
    const p = planRewrite(usedChip(), 200_000, { kind: 'blank' });
    expect(p.ok && totalBytes(p.byteWrites)).toBe(8);
  });

  it('is zero for an empty plan', () => {
    expect(totalBytes([])).toBe(0);
  });
});

/*
 * Putting back what a chip has LOST. A V6 on this bench lost two standard-array
 * bytes to 0xFF with nothing writing to it, days after an interrupted erase -
 * and they were the last surviving copies of a triplicated record.
 */
describe('planRepairStandard - putting back what a chip has lost', () => {
  function clusterBackup(): Uint8Array {
    const img = usedChip(155_940, 'AW72288');
    for (let a = STANDARD_START; a < IMAGE_SIZE; a++) img[a] = (a * 7 + 3) & 0xff;
    img.set(encodeVin('AW72288'), VIN_AT);
    return img;
  }

  it('writes ONLY the differing bytes, and nothing below 0x20', () => {
    const backup = clusterBackup();
    const chip = Uint8Array.from(backup);
    chip[0x025] = 0xff;
    chip[0x02d] = 0xff;
    chip[0x100] = 0xff;
    chip[0x004] = 0x99; // a secure-area difference, which must be ignored

    const p = planRepairStandard(chip, backup);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.addresses).toEqual([0x025, 0x02d, 0x100]);
    expect(p.byteWrites.every((w) => w.address >= STANDARD_START)).toBe(true);
    expect(p.byteWrites.map((w) => [w.address, w.data.length])).toEqual([
      [0x025, 1],
      [0x02d, 1],
      [0x100, 1],
    ]);
    expect(p.byteWrites[0].data[0]).toBe(backup[0x025]);
  });

  it('groups a contiguous run into a single write', () => {
    const backup = clusterBackup();
    const chip = Uint8Array.from(backup);
    for (let a = 0x040; a <= 0x043; a++) chip[a] = 0xff;
    const p = planRepairStandard(chip, backup);
    if (!p.ok) throw new Error('should plan');
    expect(p.byteWrites).toHaveLength(1);
    expect(p.byteWrites[0].address).toBe(0x040);
    expect(p.byteWrites[0].data).toHaveLength(4);
  });

  /* 0x2E8-0x2EF is repaired like any other range. Skipping it as "the VIN" meant
     refusing to put back real cluster data a chip had lost. */
  it('repairs 0x2E8-0x2EF too - it is not the VIN and not special', () => {
    const backup = clusterBackup();
    const chip = Uint8Array.from(backup);
    for (let a = VIN_AT; a < VIN_AT + VIN_LEN; a++) chip[a] = 0xff;
    const p = planRepairStandard(chip, backup);
    if (!p.ok) throw new Error('should plan');
    expect(p.addresses).toHaveLength(8);
    expect(p.byteWrites).toHaveLength(1);
    expect(p.byteWrites[0].address).toBe(VIN_AT);
    expect(Array.from(p.byteWrites[0].data)).toEqual(
      Array.from(backup.subarray(VIN_AT, VIN_AT + VIN_LEN)),
    );
  });

  it('does NOT require a blank chip - that is the whole point of it', () => {
    const p = planRepairStandard(usedChip(155_940), clusterBackup());
    expect(p.ok).toBe(true);
  });

  it('plans nothing when the chip already matches the backup', () => {
    const backup = clusterBackup();
    const p = planRepairStandard(Uint8Array.from(backup), backup);
    if (!p.ok) throw new Error('should plan');
    expect(p.byteWrites).toEqual([]);
    expect(p.addresses).toEqual([]);
  });

  it('REFUSES a backup with no cluster data', () => {
    const p = planRepairStandard(blankChip(), new Uint8Array(IMAGE_SIZE).fill(0xff));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.code).toBe('backup-no-data');
  });
});

/* -------------------------------------------------------------------------
   What RESTORE and REPAIR actually write.

   The app told the user, on the dialog where an irreversible write is
   approved, that the VIN was "not written" or "set to 0xFF". Both plans write
   the whole standard array, and the real VIN (0x183 on every chip here) is
   inside it. These pin the behaviour so the copy cannot drift back.
   ------------------------------------------------------------------------- */

describe('restore and repair carry the VIN - the copy must not claim otherwise', () => {
  it('planReset copies the backup VIN onto the new chip', () => {
    const backup = usedChip(155_940, 'ABC12345');
    const blank = new Uint8Array(IMAGE_SIZE).fill(0xff);
    blank.fill(0x00, 0, 0x20);
    const p = planReset(blank, backup);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const after = applyPlanPreview(blank, p.byteWrites);
    expect(readVin(after).found?.text).toBe('ABC12345');
    expect(readVin(after).found?.offset).toBe(VIN_AT);
  });

  it('planRepairStandard restores a VIN the chip has lost', () => {
    const backup = usedChip(155_940, 'ABC12345');
    const chip = usedChip(155_940, 'ABC12345');
    for (let a = VIN_AT; a < VIN_AT + VIN_LEN; a++) chip[a] = 0xff;
    expect(readVin(chip).found).toBeNull();

    const p = planRepairStandard(chip, backup);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.addresses).toContain(VIN_AT);
    const after = applyPlanPreview(chip, p.byteWrites);
    expect(readVin(after).found?.text).toBe('ABC12345');
  });

  it('neither plan ever touches the odometer', () => {
    const backup = usedChip(155_940, 'ABC12345');
    const chip = usedChip(100_000, 'AW72288');
    for (const p of [planRepairStandard(chip, backup)]) {
      expect(p.ok).toBe(true);
      if (!p.ok) continue;
      for (const w of p.byteWrites) expect(w.address).toBeGreaterThanOrEqual(STANDARD_START);
    }
  });
});
