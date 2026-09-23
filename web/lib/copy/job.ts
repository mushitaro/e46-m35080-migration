/**
 * REWRITE's prose - the job: where the chip's data comes from, the odometer, the VIN, the coding,
 * and what one write will do - and the MODE sheet's. Chrome words (SOURCE, WRITE CHIP, CHIP,
 * TEST ...) are in chrome.ts.
 *
 * Same rules as guide.ts: EN is typed FROM JA so a missing key fails the build.
 */

import { getLang } from '@/lib/i18n';
import type { AppMode, ModeLock } from '@/lib/domain/modes';

const JA = {
  lead:
    'チップを 1 回の書き込みで仕上げます。元になる内容（今のチップか、ダンプ）、走行距離、VIN、コーディングを 1 つの計画にして、' +
    '確認 1 回・書き込み 1 回で書きます。',

  source: {
    chip: '今のチップの内容に、下の変更だけを加えます。',
    dump: '標準領域（0x020–0x3FF）をダンプの内容にしてから、下の変更を加えます。走行距離（0x000–0x01F）はダンプから写しません。',
    blank:
      '新品のチップです。ダンプの内容を丸ごと書きます。走行距離は 0 km のままで、車が自分の値へ上げます（下で目標を入れれば、そこまで上げます）。',
    used: '使用済みのチップです。ダンプと違うバイトだけを書きます。何度書き直しても走行距離は上がりません。',
    bytes: (n: number) => `チップと違うのは ${n} バイトです。`,
    checksumsOk: 'ダンプのチェックサムは成り立っています。',
    checksumsUnchecked: 'ダンプは late layout ではないため、チェックサムは確かめられません。',
    noChip: 'チップはまだ読んでいません。ダンプを開くと、コーディングと VIN の計画までは見られます。書き込むのはチップを READ してから。',
    verify: '取り付けたら、走る前に走行距離を確かめてください。0 km のままなら、ここで目標を入れて書き直します。',
  },

  odometer: {
    keep: '空欄なら走行距離は変えません。',
    needsChip: '走行距離はチップにしか書けません。チップを READ すると設定できます。',
    irreversible: '走行距離の書き込み（WRINC）は取り消せません。車の実際の走行距離と一致させてください。',
  },

  noChipToWrite: 'チップを READ すると書き込めます。',
  nothing: '変更はありません。SOURCE・走行距離・VIN・コーディングのどれかを変えると、ここに計画が出ます。',
  undo: '標準領域は、書く前の BACKUP を SOURCE にして書き戻せます。走行距離は戻せません。',

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
    'Finish the chip in one write: where its data comes from (the chip as it is, or a dump), the odometer, the VIN and the ' +
    'coding, planned as one - one confirmation, one write.',

  source: {
    chip: 'The chip as it is, with only the changes below.',
    dump: "The standard array (0x020-0x3FF) becomes the dump's, then the changes below are made. The odometer (0x000-0x01F) is never copied from a dump.",
    blank:
      'A new chip: the whole dump is written. The odometer stays at 0 km and the car raises it to its own value (or set a target below and it is raised to that).',
    used: 'A used chip: only the bytes that differ from the dump are written. Writing it again never raises the odometer.',
    bytes: (n: number) => `${n} byte(s) differ from the chip.`,
    checksumsOk: "The dump's checksums hold.",
    checksumsUnchecked: 'The dump is not the late layout, so its checksums cannot be checked.',
    noChip: 'No chip read yet. With a dump open, the coding and VIN plan can be seen; writing needs the chip READ first.',
    verify: 'After fitting, check the odometer before driving. If it still reads 0 km, set a target here and write again.',
  },

  odometer: {
    keep: 'Leave it blank to keep the odometer.',
    needsChip: 'Only a chip carries the odometer. READ the chip to set it.',
    irreversible: "An odometer write (WRINC) cannot be undone. It must match the car's true mileage.",
  },

  noChipToWrite: 'READ the chip to write.',
  nothing: 'Nothing to write. Change the SOURCE, the odometer, the VIN or the coding and the plan appears here.',
  undo: 'The standard array can be put back by writing the BACKUP taken before this, as the SOURCE. The odometer cannot.',

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
