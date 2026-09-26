/**
 * Telegrams that read the cluster, and the two that manage the session. Nothing here changes what
 * the cluster shows; actuations.ts holds the ones that do.
 *
 * A builder only encodes. Whether a telegram may be sent is runGate.ts's question alone, asked of
 * the bytes a builder produced - so a builder handed a bad argument builds the bad telegram and the
 * gate refuses it, rather than two places each holding half of the rule.
 */

import {
  AIF_ODOMETER,
  AIF_VIN,
  FAULTS_ALL,
  INPUT_PORTS,
  INPUT_PORTS_46,
  INPUT_PORTS_46R,
  KombiControl,
  SEGMENT_EEPROM,
  request,
  type KombiRequest,
  type KombiVariant,
} from './protocol';

/** Part number, hardware and software numbers, and the diagnosis index the variant comes from. */
export function readIdent(): KombiRequest {
  return request(KombiControl.IDENT);
}

/** The seven-character VIN the cluster holds. */
export function readVin(): KombiRequest {
  return request(KombiControl.READ_AIF, [AIF_VIN]);
}

/** The total distance the cluster counts. */
export function readOdometer(): KombiRequest {
  return request(KombiControl.READ_AIF, [AIF_ODOMETER]);
}

export function readFaults(): KombiRequest {
  return request(KombiControl.READ_FAULTS, [FAULTS_ALL]);
}

/**
 * The digital inputs: ignition terminals, buttons, switches. One telegram on a KOMBI46 (ports 0-6
 * together), one per port on a KOMBI46R.
 */
export function readInputs(variant: KombiVariant): KombiRequest[] {
  // A KOMBIR40 reads its ports as a KOMBI46 does.
  if (variant !== 'KOMBI46R') return [request(KombiControl.READ_INPUTS, [INPUT_PORTS, ...INPUT_PORTS_46])];
  return INPUT_PORTS_46R.map((port) => request(KombiControl.READ_INPUTS, [INPUT_PORTS, port, 0x00]));
}

/**
 * `count` words of the cluster's EEPROM from word `word`. The two variants address it differently:
 * a KOMBI46 takes one address byte (words 00-FF), a KOMBI46R two (words 000-3FF).
 */
export function readEeprom(variant: KombiVariant, word: number, count: number): KombiRequest {
  if (!Number.isInteger(word) || word < 0 || word > 0xffff) throw new RangeError(`word address ${word}`);
  if (!Number.isInteger(count) || count < 0 || count > 0xff) throw new RangeError(`word count ${count}`);
  // A KOMBIR40 addresses it as a KOMBI46 does: one byte, words 00-FF.
  return variant !== 'KOMBI46R'
    ? request(KombiControl.READ_MEMORY, [SEGMENT_EEPROM, 0x00, 0x00, word & 0xff, count])
    : request(KombiControl.READ_MEMORY, [SEGMENT_EEPROM, 0x00, (word >> 8) & 0xff, word & 0xff, count]);
}

/* --------------------------------- session -------------------------------- */

/** Tester present: keeps the diagnostic session, and with it every output this tool is holding. */
export function keepAlive(): KombiRequest {
  return request(KombiControl.KEEP_ALIVE);
}

/** Ends the session. The cluster takes its needles and lamps back and shows its own inputs again. */
export function endSession(): KombiRequest {
  return request(KombiControl.END_SESSION);
}
