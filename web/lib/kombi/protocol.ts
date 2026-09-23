/**
 * The instrument cluster (KOMBI) on the DS2 bus: its address, its two E46 variants, and the
 * numbers every telegram this tool sends it is built from. Pure - nothing here touches a port.
 *
 * WHERE THE NUMBERS COME FROM
 * The two E46 cluster SGBDs, KOMBI46.prg and KOMBI46R.prg, disassembled, and the group file that
 * picks between them for address 0x80, D_0080.grp. What is committed is the wire: control bytes,
 * where each argument sits, the scaling, which bits of a lamp byte exist. What is NOT committed is
 * what the SGBDs say things MEAN - their job names, lamp names, input names and fault texts. Those
 * arrive at run time behind the owner gate (lib/refdata); until they do, a lamp is `B2.b5` and a
 * fault is its code. The names in this file are this tool's own, in English.
 *
 * NOT YET MEASURED ON A CLUSTER. Every shape here is read out of BMW's own tester logic, which is
 * strong evidence, not a measurement. docs/BENCH.md lists what the first bench session confirms.
 *
 * WHAT IS NEVER BUILT
 * The SGBDs can also clear the fault memory (control 05), write the EEPROM - coding, vehicle
 * order, odometer offset (07), reset the cluster (12), reset the service interval (0C 12), drive
 * the speed-signal output (0C 08), start a self-test (30) and put the cluster to sleep (9B, 9D).
 * This tool has no function that builds any of them, and runGate.ts refuses them - and everything
 * else not on its list - even when handed the bytes.
 */

import { Ds2Control } from '@tsunagi/ds2-core';

/** The cluster's DS2 address. ds2-core names the modules it was written for; this is not one. */
export const KOMBI_ADDRESS = 0x80;

/** The two E46 clusters, by the SGBD that speaks for each (variant.ts decides which one this is). */
export const KOMBI_VARIANTS = ['KOMBI46', 'KOMBI46R'] as const;
export type KombiVariant = (typeof KOMBI_VARIANTS)[number];

/** One telegram's content: the control byte and what follows it. Address, length and checksum
 *  are the link's to add. */
export type KombiRequest = {
  readonly control: number;
  readonly payload: Uint8Array;
};

export function request(control: number, payload: readonly number[] = []): KombiRequest {
  return { control, payload: Uint8Array.from(payload) };
}

/* -------------------------------- controls -------------------------------- */

export const KombiControl = {
  IDENT: 0x00,
  /** The user-information field: 01 odometer, 02 VIN. */
  READ_AIF: 0x02,
  READ_FAULTS: Ds2Control.READ_ERROR_MEMORY,
  READ_MEMORY: Ds2Control.READ_MEMORY,
  READ_INPUTS: Ds2Control.READ_IO_STATUS,
  /** Every actuation: lamps, needles, gong, piezo, port outputs - told apart by the next byte. */
  DRIVE: Ds2Control.SET_IO_STATUS,
  KEEP_ALIVE: Ds2Control.KEEP_ALIVE,
  END_SESSION: Ds2Control.END_DIAGNOSTIC_MODE,
} as const;

export const AIF_ODOMETER = 0x01;
export const AIF_VIN = 0x02;
/** The one fault-memory read the SGBDs send. */
export const FAULTS_ALL = 0x01;
/** READ_MEMORY's segment byte for the EEPROM. */
export const SEGMENT_EEPROM = 0x03;
/** READ_INPUTS' selector for the digital ports. */
export const INPUT_PORTS = 0x14;

/** The byte after DRIVE. */
export const Drive = {
  LAMPS: 0x09,
  PIEZO: 0x10,
  GONG: 0x11,
  /** Port outputs (KOMBI46 only): the byte after it names the port, and only port 6 is driven. */
  PORT: 0x14,
} as const;

/* --------------------------------- gauges --------------------------------- */

/**
 * The five needles and the byte that selects each. The SGBDs' names are German and one of them is
 * a trap for an English reader - their "TACHO" is the SPEED gauge - so this tool uses its own.
 */
export const GAUGES = [
  { id: 'speed', select: 0x0a },
  { id: 'rpm', select: 0x0b },
  { id: 'fuel', select: 0x0c },
  { id: 'coolant', select: 0x0d },
  { id: 'consumption', select: 0x0e },
] as const;
export type GaugeId = (typeof GAUGES)[number]['id'];

export const GAUGE_IDS: readonly GaugeId[] = GAUGES.map((g) => g.id);

export function gaugeSelect(id: GaugeId): number {
  const g = GAUGES.find((x) => x.id === id);
  if (!g) throw new RangeError(`unknown gauge ${String(id)}`);
  return g.select;
}

export function gaugeOf(select: number): GaugeId | null {
  return GAUGES.find((x) => x.select === select)?.id ?? null;
}

/** Needle angle in degrees. The SGBDs accept 10-90. */
export const NEEDLE_MIN_DEG = 10;
export const NEEDLE_MAX_DEG = 90;
/**
 * The largest move from where a needle last was. The SGBDs warn only against jumps of more than
 * 90 degrees; this tool moves in steps of 10 so a sweep can be watched stage by stage and nothing
 * it sends comes near that warning.
 */
export const NEEDLE_MAX_STEP_DEG = 10;
/** Where a needle is taken to be before this tool has moved it: the bottom of the range. */
export const NEEDLE_REST_DEG = NEEDLE_MIN_DEG;

/** Degrees to the 16-bit value on the wire: 45 degrees is 0x05A0 on a KOMBI46, 0x01C2 on a 46R. */
export const NEEDLE_SCALE: Record<KombiVariant, number> = { KOMBI46: 32, KOMBI46R: 10 };

/* ---------------------------------- lamps --------------------------------- */

/**
 * The lamp frame's data bytes, and which bits of each exist:
 *
 *   KOMBI46   0C 09 B1 B2 B3 B4
 *   KOMBI46R  0C 09 00 B1 B2 B3 B4 B5 B6     (the 00 is fixed)
 *
 * A bit outside its mask is one the SGBD marks free or reserved. It is not a lamp, and the gate
 * refuses a frame that sets it.
 */
export const LAMP_MASKS: Record<KombiVariant, readonly number[]> = {
  KOMBI46: [0x3f, 0xff, 0xff, 0x7f],
  KOMBI46R: [0x3d, 0xff, 0x3f, 0x7f, 0xbf, 0xbf],
};

/** Every lamp bit of a variant as `{ byte, bit }`, byte counted from 1 as the SGBDs number them. */
export function lampBits(variant: KombiVariant): { byte: number; bit: number }[] {
  return LAMP_MASKS[variant].flatMap((mask, i) =>
    Array.from({ length: 8 }, (_, bit) => bit)
      .filter((bit) => (mask >> bit) & 1)
      .map((bit) => ({ byte: i + 1, bit })),
  );
}

/** The one output port a KOMBI46 lets the tester drive, and its bits (indicators, high beam, rear fog). */
export const OUTPUT_PORT = 0x06;
export const OUTPUT_PORT_MASK = 0x0f;

/* --------------------------------- inputs --------------------------------- */

/** KOMBI46 reads ports 0-6 in one telegram. */
export const INPUT_PORTS_46 = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06] as const;
/** A KOMBI46R reads one port per telegram, and these are the ports its SGBD reads. */
export const INPUT_PORTS_46R = [0x00, 0x03, 0x05, 0x06, 0x09, 0x0d, 0x0e] as const;

/* --------------------------------- EEPROM --------------------------------- */

/**
 * The cluster's own EEPROM read counts in 16-bit WORDS, not bytes. How a word address lands on the
 * M35080's byte addresses has not been confirmed on a cluster, so anything that compares a read
 * with a chip image has to say which mapping it assumed (WORD_MAPPING_HYPOTHESIS).
 */
export const EEPROM_WORD_LIMIT: Record<KombiVariant, number> = { KOMBI46: 0x100, KOMBI46R: 0x400 };
/** Words per read, both variants. */
export const EEPROM_MAX_WORDS = 16;

/**
 * The working assumption, stated once so every comparison and the simulated cluster use the same
 * one: word `w` is the chip's bytes `2w` (high) and `2w + 1` (low). A bench read settles it.
 */
export const WORD_MAPPING_HYPOTHESIS = 'word w = chip bytes 2w, 2w+1 (high first)';

export function wordToByteAddress(word: number): number {
  return word * 2;
}
