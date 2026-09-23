/**
 * The words on the instrument: tabs, the hub, buttons, tags, status values,
 * column headers, empty states.
 *
 * tsunagi-m-ux section 13. These are the SAME for a Japanese reader and an
 * English one - uppercase technical words, the way READ / EXPORT / TUNE are on
 * every ///M tool. A label is a promise that the tab, the button, the file name
 * and the record row all use one word; a word that changes with
 * `navigator.language` cannot be that word.
 *
 * This file is deliberately NOT a JA/EN record. The catalogs in lib/i18n.ts and
 * lib/copy/guide.ts hold prose - reasons, warnings, advice, the sentences in a
 * confirm dialog - and nothing that appears here has a slot there. There is no
 * second string to put anywhere, so none of these can be translated by
 * accident. (They were, until this file existed: the tab strip read 準備 /
 * 読み出し / 復旧 on a Japanese browser.)
 *
 * One word, one address. BLANK already means "a chip whose counters are zero",
 * so a VIN that is not there is NONE, not BLANK.
 */

export const CHROME = {
  /* ---- the workflow strip ---- */
  tab: {
    setup: 'SETUP',
    read: 'READ',
    restore: 'RESTORE',
    rewrite: 'REWRITE',
    inspect: 'INSPECT',
    records: 'RECORDS',
  },

  /* ---- the hub: the face is a verb, busy is its present participle ---- */
  hub: {
    connect: 'CONNECT',
    connecting: 'CONNECTING',
    read: 'READ',
    reading: 'READING',
    backup: 'BACKUP',
    writing: 'WRITING',
    verifying: 'VERIFYING',
    writeOdometer: 'WRITE ODO',
    writeChip: 'WRITE CHIP',
    repair: 'REPAIR',
    selectBackup: 'SELECT BACKUP',
    checkBackup: 'CHECK BACKUP',
    nothingToRepair: 'NOTHING TO REPAIR',
  },

  disconnect: 'DISCONNECT',

  /* ---- a persistent mode, not an action (tsunagi-m-ux section 16) ---- */
  practice: 'PRACTICE',

  /* ---- status rows ---- */
  status: {
    link: 'LINK',
    chip: 'CHIP',
    idle: 'IDLE',
    ready: 'READY',
    practice: 'PRACTICE',
    noWebSerial: 'NO WEB SERIAL',
    notRead: 'NOT READ',
    blank: 'BLANK',
    used: 'USED',
  },

  /* ---- readouts ---- */
  readout: {
    odometer: 'ODOMETER',
    vin: 'VIN',
    /* The two VIN fields (vin.ts). One word each, used by every panel that names them. */
    coded: 'CODED',
    ascii: 'ASCII',
    differ: 'DIFFER',
    chip: 'CHIP',
    none: 'NONE',
    current: 'CURRENT',
    target: 'TARGET',
  },

  /* ---- a confirm dialog's two buttons ---- */
  proceed: 'PROCEED',
  cancel: 'CANCEL',

  /* ---- empty states: an instrument waiting for input ---- */
  awaiting: {
    connection: 'AWAITING CONNECTION',
    read: 'AWAITING READ',
    file: 'AWAITING FILE',
  },
  empty: {
    records: 'NO RECORDS',
  },

  drop: {
    backup: 'DROP BACKUP .BIN · 1024 BYTES',
    file: 'DROP .BIN · 1024 BYTES',
  },

  /* ---- the two checksums of the late layout (lib/domain/layout.ts) ---- */
  checksum: {
    title: 'CHECKSUMS',
    ok: 'OK',
    broken: 'BROKEN',
    unknown: 'UNKNOWN LAYOUT',
    fix: 'FIX CHECKSUMS',
  },

  /* ---- the file workbench ---- */
  inspect: {
    open: 'OPEN FILE',
    edit: 'EDIT',
    set: 'SET',
    undo: 'UNDO',
    revert: 'REVERT',
    saveAs: 'SAVE AS',
  },

  /* ---- what the bytes hold ---- */
  map: {
    title: 'ADDRESS MAP',
    odometer: 'ODOMETER 000–01F',
    vin: 'VIN',
    rest: 'OTHER',
    base: 'BASE',
    bumped: '+1',
  },

  structure: {
    title: 'STRUCTURE',
    secure: 'SECURE',
    id: 'ID',
    idVin: 'ID · VIN-SHAPED',
    redundant: 'REDUNDANT',
    unused: 'UNUSED',
    zero: 'ZERO',
  },

  /* ---- the bench ---- */
  setup: {
    assembly: 'ASSEMBLY',
    doneWhen: 'DONE WHEN',
    wiring: 'WIRING',
    pin: 'PIN',
    signal: 'SIGNAL',
    uno: 'UNO',
    out: 'OUT',
  },

  /* ---- the cluster bench (TEST): the labels drawn on it; wire ends come from clusterBench.ts ---- */
  bench: {
    title: 'BENCH',
    wiring: 'WIRING',
    procedure: 'PROCEDURE',
    unverified: 'UNVERIFIED',
    psu: '12 V PSU',
    fuse: '1 A',
    toggle: 'KL15',
    cluster: 'CLUSTER X11175',
    obd: 'OBD-II',
    kdcan: 'K+DCAN',
    plugsIn: 'PLUGS IN HERE',
    serial: '9600 8E1',
  },

  parts: {
    title: 'PARTS',
    required: 'REQUIRED',
    optional: 'OPTIONAL',
    selectAll: 'SELECT ALL',
    clear: 'CLEAR',
  },
} as const;
