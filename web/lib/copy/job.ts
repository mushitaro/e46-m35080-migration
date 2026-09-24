/**
 * REWRITE's prose - the job: where the chip's data comes from, the bytes changed by hand, the
 * odometer, the VIN, the coding, and what one write (or one saved file) will do - READ's PRACTICE
 * CHIP and its pointer to REWRITE, and the MODE sheet's. Chrome words (SOURCE, FILE, WRITE CHIP,
 * SAVE EDITED, CHIP, TEST ...) are in chrome.ts.
 *
 * Same rules as guide.ts: EN is typed FROM JA so a missing key fails the build.
 */

import { getLang } from '@/lib/i18n';
import type { AppMode, ModeLock } from '@/lib/domain/modes';
import type { ByteLock } from '@/lib/domain/byteEdits';

const JA = {
  lead:
    'チップを 1 回の書き込みで仕上げます。元になる内容（SOURCE）に、手で変えるバイト・VIN・コーディング・走行距離を加えて 1 つの計画にし、' +
    '確認 1 回・書き込み 1 回で書きます。チップが無くても、ファイルを開いて変え、SAVE EDITED で保存して後で書けます。',

  source: {
    /* the three uses, said where the choice is made */
    uses:
      'CHIP：読んだチップを直す。FILE：ドナーのダンプを移す、または用意しておいたファイル（SAVE EDITED で保存したもの）を書く。',
    blank:
      '新品のチップです。ファイルの内容を丸ごと書きます。走行距離は 0 km のままで、車が自分の値へ上げます（下で目標を入れれば、そこまで上げます）。',
    used: '使用済みのチップです。ファイルと違うバイトだけを書きます。走行距離（0x000–0x01F）はファイルから写さず、何度書き直しても上がりません。',
    bytes: (n: number) => `チップと違うのは ${n} バイトです。`,
    checksumsOk: 'ファイルのチェックサムは成り立っています。',
    checksumsUnchecked: 'ファイルは late layout ではないため、チェックサムは確かめられません。',
    noChip:
      'チップはまだ読んでいません。ファイルを開けば、変更を計画して SAVE EDITED で保存できます。書くのはチップを READ して BACKUP してから（ハブが順に進めます）。',
    verify: '取り付けたら、走る前に走行距離を確かめてください。0 km のままなら、ここで目標を入れて書き直します。',
  },

  /* What a file opened as the SOURCE is, before anything is decoded from it (lib/domain/image.ts verdictFor). */
  file: {
    distinct: (n: number) => `値 ${n} 種`,
    notAChip: (v: number) =>
      `1024 バイトすべてが 0x${v.toString(16).toUpperCase().padStart(2, '0')} です。チップの読み出しではありません` +
      '（配線が浮いている、D11 と D12 が直結、などのバス側の結果）。走行距離も VIN も意味を持ちません。',
    blank: 'セキュア領域は 0（新品）',
    erased: '標準領域は全 FF（消去済み）',
  },

  checksum: {
    fileBroken: 'ファイルのチェックサムが合っていません。FIX CHECKSUMS で計算し直すと使えます（取り消せます）。',
    chipBroken:
      'チップのチェックサムが合っていません。まず READ し直してください。直らなければ、良い BACKUP かドナーのファイルを FILE にして書きます。計算し直して隠すことはしません。',
  },

  bytes: {
    hint: 'HEX でバイトを選ぶと、そこで値を変えられます。',
    count: (n: number) => `手で変えたバイト ${n} 個`,
    none: '手で変えたバイトはありません。',
    /* why the byte picked cannot be changed by hand, in the edit bar where its input would be */
    lock: {
      outside: 'チップのアドレスではありません',
      odometer: '走行距離は ODOMETER で上げます',
      vin: 'VIN は VIN で書きます',
      checksum: 'チェックサムはジョブが計算します',
      protected: '走行距離のオフセットと K 値の領域です',
    } satisfies Record<ByteLock, string>,
    /* a later part of the job writes this byte, whatever is typed here */
    later: {
      vin: 'このバイトは VIN が書きます',
      coding: 'このバイトは CODING が書きます',
    },
  },

  save: 'SAVE EDITED は、書く内容をファイルに保存します（新しい名前。開いたファイルには上書きしません）。走行距離は SOURCE のまま入ります。後で SOURCE の FILE に開けば、そのまま書けます。',

  odometer: {
    keep: '空欄なら走行距離は変えません。',
    needsChip: '走行距離はチップにしか書けません。チップを READ すると設定できます。',
    irreversible: '走行距離の書き込み（WRINC）は取り消せません。車の実際の走行距離と一致させてください。',
  },

  noChipToWrite: 'チップを READ すると書き込めます。今の内容は SAVE EDITED でファイルにできます。',
  nothing: '変更はありません。SOURCE・バイト・VIN・コーディング・走行距離のどれかを変えると、ここに計画が出ます。',
  undo: '標準領域は、書く前の BACKUP を SOURCE の FILE にして書き戻せます。走行距離は戻せません。',
  /* the work surface with no chip read and no file open */
  empty: 'チップを READ するか、SOURCE で FILE を開きます。',

  /* READ, after BACKUP: the step after it */
  next: '書く内容を決めます',

  /* READ, before a PRACTICE connect */
  practice: {
    lead: 'PRACTICE で読む模擬チップです。ファイルを選ぶと、その中身を模擬チップにします（ファイルには何も書きません）。',
    madeUp: (file: string | null) => (file ? `架空のチップ（${file} に合わせて作ったもの）` : '架空のチップ'),
  },

  mode: {
    caption: 'いま何を相手にしているか',
    produces: {
      chip: 'チップ（UNO）: 読む、バックアップ、書く — 走行距離・VIN・コーディングを 1 回で',
      test: 'メータ（K+DCAN）: ベンチの配線、照合、針とランプ',
    } satisfies Record<AppMode, string>,
    lock: {
      busy: 'チップを読み書きしている最中です。終わるまで切り替えられません。',
      session: 'メータは診断中です。針やランプを保持しているかもしれないので、STOP で終えてから切り替えてください。',
    } satisfies Record<Exclude<ModeLock, null>, string>,
    note: 'タブ、ハブ、PRACTICE はモードごとです。CHIP は UNO、TEST は K+DCAN ケーブルを使います。',
  },
};

const EN: typeof JA = {
  lead:
    'Finish the chip in one write: what it starts from (the SOURCE), then the bytes changed by hand, the VIN, the coding and the ' +
    'odometer, planned as one - one confirmation, one write. With no chip, open a file, change it and SAVE EDITED to write it later.',

  source: {
    uses: "CHIP: fix the chip that was read. FILE: move a donor's dump over, or write a file prepared earlier (one SAVE EDITED saved).",
    blank:
      'A new chip: the whole file is written. The odometer stays at 0 km and the car raises it to its own value (or set a target below and it is raised to that).',
    used: 'A used chip: only the bytes that differ from the file are written. The odometer (0x000-0x01F) is never copied from a file, and writing again never raises it.',
    bytes: (n: number) => `${n} byte(s) differ from the chip.`,
    checksumsOk: "The file's checksums hold.",
    checksumsUnchecked: 'The file is not the late layout, so its checksums cannot be checked.',
    noChip:
      'No chip read yet. Open a file and the changes can be planned and saved with SAVE EDITED. Writing needs the chip READ and backed up first (the hub takes you through it).',
    verify: 'After fitting, check the odometer before driving. If it still reads 0 km, set a target here and write again.',
  },

  file: {
    distinct: (n: number) => `${n} distinct values`,
    notAChip: (v: number) =>
      `All 1024 bytes are 0x${v.toString(16).toUpperCase().padStart(2, '0')}. This is not a chip read - it is the bus ` +
      '(a floating wire, or D11 shorted to D12). Any odometer or VIN read out of it means nothing.',
    blank: 'secure area zero (new)',
    erased: 'standard array all FF (erased)',
  },

  checksum: {
    fileBroken: "The file's checksums do not hold. FIX CHECKSUMS recomputes them so it can be used (and can be taken back).",
    chipBroken:
      "The chip's checksums do not hold. READ it again first; if they still fail, write a good BACKUP or a donor file as the FILE. They are not recomputed over whatever broke them.",
  },

  bytes: {
    hint: 'Pick a byte in HEX to change its value there.',
    count: (n: number) => `${n} byte(s) changed by hand`,
    none: 'No byte changed by hand.',
    lock: {
      outside: 'not an address of the chip',
      odometer: 'the odometer: raise it in ODOMETER',
      vin: 'the VIN: write it in VIN',
      checksum: 'a checksum: the job computes it',
      protected: 'the odometer offset and the K-numbers',
    },
    later: {
      vin: 'VIN writes this byte',
      coding: 'CODING writes this byte',
    },
  },

  save: "SAVE EDITED saves what would be written as a file (a new name - never over the file opened). The odometer is the SOURCE's own. Open it later as the SOURCE FILE to write it.",

  odometer: {
    keep: 'Leave it blank to keep the odometer.',
    needsChip: 'Only a chip carries the odometer. READ the chip to set it.',
    irreversible: "An odometer write (WRINC) cannot be undone. It must match the car's true mileage.",
  },

  noChipToWrite: 'READ the chip to write. What is here can be saved as a file with SAVE EDITED now.',
  nothing: 'Nothing to write. Change the SOURCE, a byte, the VIN, the coding or the odometer and the plan appears here.',
  undo: 'The standard array can be put back by writing the BACKUP taken before this, as the SOURCE FILE. The odometer cannot.',
  empty: 'READ the chip, or open a FILE in SOURCE.',

  next: 'decide what to write',

  practice: {
    lead: 'The chip PRACTICE reads. Pick a file and the simulated chip holds its bytes (nothing is written to the file).',
    madeUp: (file: string | null) => (file ? `a made-up chip, built to fit ${file}` : 'a made-up chip'),
  },

  mode: {
    caption: 'What the tool is working on',
    produces: {
      chip: 'The chip (UNO): read, back up, write - odometer, VIN and coding in one',
      test: 'The cluster (K+DCAN): the bench wiring, comparisons, needles and lamps',
    },
    lock: {
      busy: 'The chip is being read or written. The mode can change when it is done.',
      session: 'The cluster is in a diagnostic session and may be holding a needle or a lamp. STOP it first.',
    },
    note: 'Tabs, the hub and PRACTICE belong to a mode. CHIP uses the UNO, TEST the K+DCAN cable.',
  },
};

export function jc(): typeof JA {
  return getLang() === 'ja' ? JA : EN;
}
