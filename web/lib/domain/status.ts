/**
 * M35080 Status Register (RDSR, opcode 0x05).
 *
 * Ported from `print_status()` in gerchanovsky/m35080_odometer_fix, and
 * cross-checked against the ST datasheet bit assignments.
 *
 * Bit 5 is undocumented/reserved; the reference sketch prints it as "x", so we
 * surface it rather than hiding it - an unexpected 1 there is worth seeing.
 */

export const STATUS_SRWD = 1 << 7; // Status Register Write Disable
export const STATUS_UV = 1 << 6; // chip has been erased (virgin/blank)
export const STATUS_X = 1 << 5; // reserved
export const STATUS_INC = 1 << 4; // last incremental write FAILED
export const STATUS_BP1 = 1 << 3; // Block Protect 1
export const STATUS_BP0 = 1 << 2; // Block Protect 0
export const STATUS_WEL = 1 << 1; // Write Enable Latch
export const STATUS_WIP = 1 << 0; // Write In Progress

export type StatusBits = {
  raw: number;
  srwd: boolean;
  uv: boolean;
  x: boolean;
  inc: boolean;
  bp1: boolean;
  bp0: boolean;
  wel: boolean;
  wip: boolean;
};

export function decodeStatus(raw: number): StatusBits {
  return {
    raw: raw & 0xff,
    srwd: (raw & STATUS_SRWD) !== 0,
    uv: (raw & STATUS_UV) !== 0,
    x: (raw & STATUS_X) !== 0,
    inc: (raw & STATUS_INC) !== 0,
    bp1: (raw & STATUS_BP1) !== 0,
    bp0: (raw & STATUS_BP0) !== 0,
    wel: (raw & STATUS_WEL) !== 0,
    wip: (raw & STATUS_WIP) !== 0,
  };
}

/** How a set bit should read on screen. Drives the LED colour, nothing else. */
export type BitSeverity = 'info' | 'good' | 'busy' | 'bad';

export type StatusBitDef = {
  key: keyof Omit<StatusBits, 'raw'>;
  label: string;
  mask: number;
  /** Severity when the bit is SET. */
  severity: BitSeverity;
  meaning: string;
};

export const STATUS_BIT_DEFS: readonly StatusBitDef[] = [
  {
    key: 'srwd',
    label: 'SRWD',
    mask: STATUS_SRWD,
    severity: 'info',
    meaning: 'Status register write-protected',
  },
  {
    key: 'uv',
    label: 'UV',
    mask: STATUS_UV,
    severity: 'good',
    meaning: 'Chip has been erased (blank)',
  },
  { key: 'x', label: 'X', mask: STATUS_X, severity: 'info', meaning: 'Reserved' },
  {
    key: 'inc',
    label: 'INC',
    mask: STATUS_INC,
    severity: 'bad',
    meaning: 'Incremental write FAILED (value not greater than stored)',
  },
  {
    key: 'bp1',
    label: 'BP1',
    mask: STATUS_BP1,
    severity: 'info',
    meaning: 'Block protect 1',
  },
  {
    key: 'bp0',
    label: 'BP0',
    mask: STATUS_BP0,
    severity: 'info',
    meaning: 'Block protect 0',
  },
  {
    key: 'wel',
    label: 'WEL',
    mask: STATUS_WEL,
    severity: 'info',
    meaning: 'Write enable latch set',
  },
  {
    key: 'wip',
    label: 'WIP',
    mask: STATUS_WIP,
    severity: 'busy',
    meaning: 'Write in progress',
  },
] as const;

/** True when any block-protect bit is set - part of the array is read-only. */
export function isBlockProtected(s: StatusBits): boolean {
  return s.bp0 || s.bp1;
}
