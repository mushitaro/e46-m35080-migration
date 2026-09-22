/**
 * Workflow planning: what a given operation WILL do, decided entirely before
 * anything touches the device.
 *
 * "Validate before touching the device at all" - not "before the erase", but
 * before the first byte. Everything here is pure: it takes the image we read
 * and the user's intent, and returns either a plan the UI can describe in a
 * confirm dialog, or a refusal.
 *
 * A refusal carries a CODE and the values the message needs, never a finished
 * sentence. The UI cannot branch on a sentence, and a sentence baked in here
 * would be in whichever language the author was thinking in - which is how
 * safety copy ends up English inside a Japanese instrument.
 */

import {
  decodeOdometer,
  encodeOdometer,
  planSlotWrites,
  readSecureSlots,
  minimumReachableKm,
  slotsToBytes,
  MAX_KM,
  SECURE_BYTES,
  type WriteOp,
} from './odometer';
import {
  encodeVin,
  readVin,
  vinTarget,
} from './vin';
import { IMAGE_SIZE, STANDARD_START, STANDARD_END, assessChip, secureOf } from './image';

export type VinAction =
  | { kind: 'keep' }
  | { kind: 'blank' }
  | { kind: 'write'; vin: string };

export type ByteWrite = { address: number; data: Uint8Array; label: string };

export type RefusalCode =
  | 'image-size'
  | 'km-invalid'
  | 'km-too-large'
  | 'cannot-lower'
  | 'vin-invalid'
  | 'vin-no-target'
  | 'vin-length'
  | 'not-blank'
  | 'backup-no-data'
  | 'backup-size'
  | 'current-size'
  | 'restore-lower';

export type Refusal = {
  ok: false;
  /** What the UI branches on and renders. Stable across languages. */
  code: RefusalCode;
  /** Values the rendered message needs. */
  floorKm?: number;
  backupKm?: number;
  maxKm?: number;
  /** How many characters the VIN already on the chip has. */
  vinLength?: number;
  /** How many bytes a refused file actually had. */
  fileSize?: number;
};

const refuse = (code: RefusalCode, extra: Omit<Refusal, 'ok' | 'code'> = {}): Refusal => ({
  ok: false,
  code,
  ...extra,
});

/* ------------------------------- REWRITE -------------------------------- */

export type RewritePlan = {
  ok: true;
  currentKm: number | null;
  targetKm: number;
  /** WRINC operations on the secure area. Irreversible. */
  secureOps: WriteOp[];
  /** Plain writes to the standard array (the VIN). */
  byteWrites: ByteWrite[];
};

/**
 * Plan an odometer rewrite (and optional VIN change).
 *
 * Refuses any target the hardware cannot reach. This is the guard that makes
 * the difference between a clear "that is impossible, here is the floor" and
 * the chip silently setting INC half-way through the sixteen registers.
 */
export function planRewrite(
  image: Uint8Array,
  targetKm: number,
  vinAction: VinAction = { kind: 'keep' },
): RewritePlan | Refusal {
  if (image.length !== IMAGE_SIZE) return refuse('image-size');
  if (!Number.isInteger(targetKm) || targetKm < 0) return refuse('km-invalid');
  if (targetKm > MAX_KM) return refuse('km-too-large', { maxKm: MAX_KM });

  const secure = secureOf(image);
  const decoded = decodeOdometer(secure);
  const currentKm = decoded.ok ? decoded.km : null;

  const plan = planSlotWrites(readSecureSlots(secure), encodeOdometer(targetKm));
  if (!plan.ok) return refuse('cannot-lower', { floorKm: minimumReachableKm(secure) });

  const vin = planVinWrite(image, vinAction);
  if (!vin.ok) return vin;

  return {
    ok: true,
    currentKm,
    targetKm,
    secureOps: plan.ops,
    byteWrites: vin.writes,
  };
}

/**
 * The bytes a VIN change writes.
 *
 * Both the address and the length come from the image, never from a constant.
 * `blank` clears exactly the characters that are there; `write` replaces them
 * at the same place. Neither can invent a location, so on a chip with no VIN
 * both refuse - which is correct rather than limiting: a new chip is meant to
 * go in with no VIN and be coded over OBD once the car is connected.
 */
function planVinWrite(
  image: Uint8Array,
  action: VinAction,
): { ok: true; writes: ByteWrite[] } | Refusal {
  switch (action.kind) {
    case 'keep':
      return { ok: true, writes: [] };

    case 'blank': {
      const found = readVin(image).found;
      if (!found) return { ok: true, writes: [] }; // already has none
      return {
        ok: true,
        writes: [
          {
            address: found.offset,
            data: new Uint8Array(found.bytes.length).fill(0xff),
            label: `VIN "${found.text}" at ${hexAddr(found.offset)} -> 0xFF`,
          },
        ],
      };
    }

    case 'write': {
      const v = action.vin.trim().toUpperCase();
      let data: Uint8Array;
      try {
        data = encodeVin(v);
      } catch {
        return refuse('vin-invalid');
      }
      const target = vinTarget(image, v);
      if (!target.ok) return refuse('vin-no-target');
      /* A different length would either truncate the old value or run past it
         into whatever follows. Neither is a VIN write, so neither is offered. */
      if (!target.sameLength) return refuse('vin-length', { vinLength: target.existing.text.length });
      return {
        ok: true,
        writes: [
          {
            address: target.offset,
            data,
            label: `VIN at ${hexAddr(target.offset)} -> "${v}"`,
          },
        ],
      };
    }
  }
}

const hexAddr = (a: number) => `0x${a.toString(16).toUpperCase().padStart(3, '0')}`;

/* ------------------------- RESTORE ONTO A NEW CHIP ------------------------- */

export type ResetPlan = {
  ok: true;
  /** Bytes written to the standard array. The secure area is NOT touched. */
  byteWrites: ByteWrite[];
  resultingKm: 0;
};

/**
 * Plan restoring a failed chip's cluster data onto a NEW blank chip.
 *
 * What is written, and why - the reference project's own rules
 * (gerchanovsky/m35080_odometer_fix, README) applied to a blank chip:
 *
 *   0x020-0x3FF  from the backup  The cluster's data. A new chip holds 0xFF
 *                                 here, and a cluster with nothing in this
 *                                 region is not a working cluster.
 *   0x2E8-0x2EF  0xFF             The VIN, in factory state so it is set over
 *                                 OBD ("you may want to write the whole area
 *                                 blank ... the VIN can be set with
 *                                 manufacturer tools via OBD").
 *   0x000-0x01F  NOT WRITTEN      The odometer stays at 0 km. "Mileage on new
 *                                 cluster MUST be lower than mileage on your
 *                                 car" - 0 always is, and the car syncs the
 *                                 cluster up to the higher value it holds.
 *
 * The backup is REQUIRED. An earlier version took no backup and wrote only the
 * 8 VIN bytes, and the UI called that the standard procedure. It left the whole
 * standard array at 0xFF: the car puts back the mileage and the VIN, never the
 * cluster's data, so that chip restores nothing.
 *
 * Nothing here touches the secure area, so the write can be repeated - a chip
 * that was given the wrong backup is still blank and still accepts this plan.
 */
export function planReset(image: Uint8Array, backup: Uint8Array): ResetPlan | Refusal {
  if (image.length !== IMAGE_SIZE) return refuse('image-size');
  if (backup.length !== IMAGE_SIZE) return refuse('backup-size');
  if (!assessChip(image).blank) return refuse('not-blank');
  if (!hasClusterData(backup)) return refuse('backup-no-data');

  /* The whole array, byte for byte.
     This used to force 0x2E8-0x2EF to 0xFF, "blanking the VIN". That address
     is not the VIN: of four real dumps, two hold live data there and the only
     ASCII identifier found anywhere sat at 0x183. Blanking it destroyed eight
     bytes of a cluster's data and blanked no VIN at all. A region this tool
     cannot prove the meaning of is a region it must copy, not erase. */
  return {
    ok: true,
    byteWrites: [
      {
        address: STANDARD_START,
        data: backup.slice(STANDARD_START, STANDARD_END + 1),
        label: 'standard array 0x20-0x3FF from backup, byte for byte',
      },
    ],
    resultingKm: 0,
  };
}

/**
 * Whether a backup carries any cluster data at all.
 *
 * A real cluster's standard array holds coding, service and configuration
 * records - over a hundred distinct byte values in every dump measured on this
 * bench. One value repeated is not a cluster: all 0xFF is a blank chip or a
 * line floating high, all 0x00 a line floating low, all 0xA5 the loopback
 * jumper. Each of those was saved as a ".bin" here, and restoring one would
 * write exactly the empty chip this plan exists to fill.
 */
function hasClusterData(backup: Uint8Array): boolean {
  const first = backup[STANDARD_START];
  for (let i = STANDARD_START + 1; i <= STANDARD_END; i++) {
    if (backup[i] !== first) return true;
  }
  return false;
}

/* -------------------------- STANDARD-ARRAY REPAIR ------------------------- */

export type RepairPlan = {
  ok: true;
  byteWrites: ByteWrite[];
  /** Every address this would change, so the confirm dialog can name them. */
  addresses: number[];
};

/**
 * Plan repairing a chip's standard array against a backup.
 *
 * Unlike planReset this does NOT need a blank chip, and it writes only the
 * bytes that actually differ.
 *
 * It exists because a chip can LOSE standard-array bytes without anything
 * writing to it. One on this bench lost two more to 0xFF between a programmer's
 * dump and a read two days later, after an erase that was interrupted. Those
 * bytes sit in triplicated records, and once all three copies are 0xFF nothing
 * in the car can reconstruct them - but a backup can.
 *
 * Two regions are never touched:
 *   0x000-0x01F  The odometer. No WRINC is planned here, ever, so a repair can
 *                be run again and again without raising the counter - which is
 *                what makes it usable as a retention TEST: write, wait, re-read.
 *   0x2E8-0x2EF  The VIN. This tool does not copy an identity out of a file.
 *                A VIN is set deliberately - on REWRITE, or over OBD.
 */
export function planRepairStandard(
  image: Uint8Array,
  backup: Uint8Array,
): RepairPlan | Refusal {
  if (image.length !== IMAGE_SIZE) return refuse('image-size');
  if (backup.length !== IMAGE_SIZE) return refuse('backup-size');
  if (!hasClusterData(backup)) return refuse('backup-no-data');

  /* Every differing byte, including 0x2E8-0x2EF. That range used to be skipped
     as "the VIN"; it is not, and skipping it meant refusing to repair real
     cluster data a chip had lost. */
  const addresses: number[] = [];
  for (let a = STANDARD_START; a <= STANDARD_END; a++) {
    if (image[a] !== backup[a]) addresses.push(a);
  }

  // Contiguous runs, so the link sends as few writes as the difference allows.
  const byteWrites: ByteWrite[] = [];
  for (let i = 0; i < addresses.length; ) {
    let j = i;
    while (j + 1 < addresses.length && addresses[j + 1] === addresses[j] + 1) j++;
    const from = addresses[i];
    const to = addresses[j];
    const hex4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(3, '0')}`;
    byteWrites.push({
      address: from,
      data: backup.slice(from, to + 1),
      label: `${hex4(from)}-${hex4(to)} from backup (${to - from + 1} bytes)`,
    });
    i = j + 1;
  }

  return { ok: true, byteWrites, addresses };
}

/* ------------------------------ EXACT CLONE ------------------------------ */

export type RestorePlan = {
  ok: true;
  byteWrites: ByteWrite[];
  secureOps: WriteOp[];
  restoredKm: number | null;
  vin: string | null;
};

/**
 * Plan an EXACT clone of a backup - odometer included - onto a new chip.
 *
 * Not offered by the RESTORE step, which uses planReset. This plan also raises
 * the secure counter to the backup's values with WRINC, and that can never be
 * taken back: any error in the read that produced the backup becomes the car's
 * permanent mileage. A measured bench read differed from a programmer's dump of
 * the same chip inside the secure area, which is exactly that failure.
 *
 * The standard array is written outright. The counter climb is legal only
 * because blank < backup; on a chip that already carries mileage this refuses
 * rather than producing a plan the hardware would reject part-way through.
 */
export function planRestore(
  backup: Uint8Array,
  currentImage: Uint8Array,
): RestorePlan | Refusal {
  if (backup.length !== IMAGE_SIZE) return refuse('backup-size');
  if (currentImage.length !== IMAGE_SIZE) return refuse('current-size');

  const decoded = decodeOdometer(secureOf(backup));
  const plan = planSlotWrites(
    readSecureSlots(secureOf(currentImage)),
    readSecureSlots(secureOf(backup)),
  );
  if (!plan.ok) {
    return refuse('restore-lower', { backupKm: decoded.ok ? decoded.km : undefined });
  }

  return {
    ok: true,
    byteWrites: [
      {
        address: STANDARD_START,
        data: backup.slice(STANDARD_START, STANDARD_END + 1),
        label: 'standard array 0x20-0x3FF from backup',
      },
    ],
    secureOps: plan.ops,
    restoredKm: decoded.ok ? decoded.km : null,
    vin: readVin(backup).found?.text ?? null,
  };
}

/* ------------------------------- summary -------------------------------- */

/** Total bytes a plan will write, for the confirm dialog. */
export function totalBytes(writes: ByteWrite[]): number {
  return writes.reduce((n, w) => n + w.data.length, 0);
}

/**
 * What the image WILL look like after a plan is applied - used to preview the
 * change in the hex view before anything is sent.
 */
export function applyPlanPreview(
  image: Uint8Array,
  byteWrites: ByteWrite[],
  secureOps: WriteOp[] = [],
): Uint8Array {
  const out = image.slice();
  for (const w of byteWrites) out.set(w.data, w.address);
  if (secureOps.length) {
    const slots = readSecureSlots(secureOf(out));
    for (const op of secureOps) slots[op.slot] = op.to;
    out.set(slotsToBytes(slots), 0);
  }
  return out;
}

export const SECURE_AREA_BYTES = SECURE_BYTES;
