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
    /* CHIP mode */
    setup: 'SETUP',
    read: 'READ',
    rewrite: 'REWRITE',
    records: 'RECORDS',
    /* TEST mode */
    bench: 'BENCH',
    checks: 'CHECKS',
  },

  /* ---- the mode corner (lib/domain/modes.ts): what the tool is working on ---- */
  mode: {
    title: 'MODE',
    chip: 'CHIP',
    test: 'TEST',
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
    /* REWRITE: the job - everything it plans, in one write - and why the ring is idle when it is */
    writeChip: 'WRITE CHIP',
    noChanges: 'NO CHANGES',
    checkPlan: 'CHECK PLAN',
    noDefinition: 'NO DEFINITION',
    /* TEST: STOP is armed while the cluster may be holding anything this tool set */
    stop: 'STOP',
    stopping: 'STOPPING',
    saveReport: 'SAVE REPORT',
  },

  disconnect: 'DISCONNECT',

  /* ---- a persistent mode, not an action (tsunagi-m-ux section 16) ---- */
  practice: 'PRACTICE',

  /* ---- status rows ---- */
  status: {
    link: 'LINK',
    chip: 'CHIP',
    cluster: 'CLUSTER',
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
    definition: 'AWAITING DEFINITION',
  },
  empty: {
    records: 'NO RECORDS',
  },

  drop: {
    file: 'DROP .BIN · 1024 BYTES',
    coding: 'DROP .JSON · KOMBI-CODING',
    names: 'DROP .JSON · KOMBI-NAMES',
  },

  /* ---- the two checksums of the late layout (lib/domain/layout.ts) ---- */
  checksum: {
    title: 'CHECKSUMS',
    ok: 'OK',
    broken: 'BROKEN',
    unknown: 'UNKNOWN LAYOUT',
    fix: 'FIX CHECKSUMS',
    /* FIX CHECKSUMS applied to a file, and not yet taken back */
    fixed: 'FIXED',
  },

  /* ---- READ, before a PRACTICE connect: what the simulated chip holds (lib/link/mockLink.ts) ---- */
  practiceChip: {
    title: 'PRACTICE CHIP',
    clear: 'CLEAR',
  },

  /* ---- READ's pointer to the step after it ---- */
  next: 'NEXT',

  /* ---- REWRITE: the job's parts (lib/domain/job.ts) ---- */
  job: {
    source: 'SOURCE',
    chip: 'CHIP',
    /* a donor's dump, a backup, or a file SAVE EDITED made - one word for all three */
    file: 'FILE',
    odometer: 'ODOMETER',
    vin: 'VIN',
    coding: 'CODING',
    changes: 'CHANGES',
    hex: 'HEX',
    clear: 'CLEAR',
    wrinc: 'WRINC',
    /* BYTES: changed by hand in the HEX view (lib/domain/byteEdits.ts) */
    bytes: 'BYTES',
    /* the edit bar, before a byte is picked in the hex view */
    pickByte: 'PICK A BYTE',
    set: 'SET',
    undo: 'UNDO',
    revert: 'REVERT',
    /* the job's result as a file, to write later - named Edited_... (lib/domain/records.ts) */
    saveEdited: 'SAVE EDITED',
    /* what the byte picked is, where that is known (lib/domain/addressMap.ts explainAddress) */
    odometerSlot: 'ODO',
    vinField: 'VIN',
    checksumByte: 'CHECKSUM',
  },

  /* ---- CODING: the chip read with its own coding definition (lib/ncs) ---- */
  coding: {
    data: 'REFERENCE DATA',
    reload: 'RELOAD',
    loading: 'LOADING',
    notLoaded: 'NOT LOADED',
    none: 'NONE',
    definition: 'DEFINITION',
    fit: 'FIT',
    index: 'INDEX',
    closest: 'CLOSEST',
    anyValue: 'ANY VALUE',
    oneValue: 'ONE VALUE',
    arrays: 'ARRAYS',
    rows: 'ROWS',
    /* the list's columns, as NCS Dummy's: the function (FSW), what it is set to, what it will be */
    function: 'FUNCTION',
    values: 'VALUES',
    search: 'SEARCH',
    noRows: 'NO ROWS',
    options: 'OPTIONS',
    mask: 'MASK',
    current: 'CURRENT',
    next: 'NEW',
    keep: 'KEEP',
    changes: 'CHANGES',
    discard: 'DISCARD',
    donor: 'DONOR',
    bytes: 'BYTES',
    checksum: 'CHECKSUM',
    /* what a row is to CODING (lib/ncs/decode.ts RowStatus) */
    status: {
      codable: 'CODABLE',
      protected: 'PROTECTED',
      value: 'VALUE',
      unknown: 'UNKNOWN',
    },
    filter: {
      all: 'ALL',
      codable: 'CODABLE',
      changed: 'CHANGED',
      diff: 'DIFF',
    },
    /* where a name came from (lib/refdata/types.ts NameSource) */
    source: {
      authored: 'AUTHORED',
      heuristic: 'HEURISTIC',
      raw: 'RAW',
    },
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
    /* the supply's output button: with no ignition switch on the bench, it is the key */
    output: 'OUTPUT',
    fuse: '1 A',
    cluster: 'CLUSTER X11175',
    obd: 'OBD-II',
    kdcan: 'K+DCAN',
    plugsIn: 'PLUGS IN HERE',
    serial: '9600 8E1',
  },

  /* ---- TEST: the checks, and how a result is said ---- */
  test: {
    bench: 'BENCH',
    checks: 'CHECKS',
    run: 'RUN',
    running: 'RUNNING',
    seen: 'SEEN',
    notSeen: 'NOT SEEN',
    heard: 'HEARD',
    notHeard: 'NOT HEARD',
    start: 'START',
    noBytes: 'NO BYTES',
    returned: 'RETURNED',
    notReturned: 'NOT RETURNED',
    equal: 'EQUAL',
    different: 'DIFFERENT',
    notCompared: 'NOT COMPARED',
    sent: 'SENT',
    failed: 'FAILED',
    refused: 'REFUSED',
    commanded: 'COMMANDED',
    cluster: 'CLUSTER',
    chip: 'CHIP',
    variant: 'VARIANT',
    unknown: 'UNKNOWN',
    live: 'LIVE',
    pause: 'PAUSE',
    onBench: 'ON THE BENCH',
    reference: 'REFERENCE',
    ended: 'SESSION ENDED',
    part: 'PART',
    diag: 'DIAG',
    /* the reference data that names lamps, outputs and inputs (lib/kombi/names.ts) */
    names: 'NAMES',
    name: {
      vin: 'VIN',
      odometer: 'ODOMETER',
      faults: 'FAULT MEMORY',
      inputs: 'INPUTS',
      eeprom: 'EEPROM',
      needles: 'NEEDLES',
      lamps: 'LAMPS',
      outputs: 'OUTPUT PORT',
      gong: 'GONG',
      piezo: 'PIEZO',
      release: 'AFTER STOP',
    },
    gauge: {
      speed: 'SPEED',
      rpm: 'RPM',
      fuel: 'FUEL',
      coolant: 'COOLANT',
      consumption: 'CONSUMPTION',
    },
    /* the chip image's fields a read is held against, when there is one (lib/kombi/checks.ts) */
    field: {
      'vin-coded': 'CHIP · CODED',
      'vin-ascii': 'CHIP · ASCII',
      odometer: 'CHIP',
    },
    /* the EEPROM read's words, folded away until asked for */
    show: 'SHOW',
    hide: 'HIDE',
    /* where the image the reads are held against came from (lib/kombi/checks.ts Reference) */
    source: {
      file: 'FILE',
      'chip-read': 'CHIP READ',
      record: 'RECORD',
    },
    clear: 'CLEAR',
  },

  parts: {
    title: 'PARTS',
    required: 'REQUIRED',
    optional: 'OPTIONAL',
    selectAll: 'SELECT ALL',
    clear: 'CLEAR',
  },
} as const;
