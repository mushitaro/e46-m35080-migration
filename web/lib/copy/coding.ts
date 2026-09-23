/**
 * CODING's prose: why a row cannot be written, why no definition was chosen, why a plan was
 * refused, why the reference data is not here, and the few sentences that frame the screen.
 * Chrome words (CODABLE, WRITE CODING, DIFF ...) are in chrome.ts, not here.
 *
 * Same rules as guide.ts: EN is typed FROM JA so a missing key fails the build. Nothing here
 * names a BMW parameter, option or block - those come from the reference data at run time.
 */

import { getLang } from '@/lib/i18n';
import type { Choice, RowReason } from '@/lib/ncs/decode';
import type { CodingRefusalCode } from '@/lib/ncs/encode';
import type { RefFailure } from '@/lib/refdata/load';

type NoneReason = Extract<Choice, { kind: 'none' }>['reason'];

const JA = {
  lead:
    'チップのイメージを、そのチップを書いたコーディング定義で読みます。全項目を並べ、書き換えてよい項目だけを' +
    '選択肢から変えられます。書き込みは REWRITE と同じ経路（書く → 読み返す → 記録）を通ります。',
  chipOff: 'コーディングはチップをメータから外し、UNO につないだ状態で行います。メータの確認は、チップを戻してから TEST で。',
  dataNote: '定義は NCS Expert のものです。このリポジトリにもビルドにも入っておらず、メモリ上だけで使います。',

  ref: {
    'not-preview': 'このビルドは参照データを配信しません。kombi-coding.json を開くと使えます。',
    unauthorized: 'サインインしていないため、参照データを受け取れません。サインインするか、ファイルを開いてください。',
    absent: '参照データがまだアップロードされていません。ファイルを開いてください。',
    unreachable: '参照データを取得できませんでした。',
    invalid: 'この JSON は kombi-coding の形式ではありません。',
  } satisfies Record<RefFailure, string>,
  loading: '参照データを取得しています。',

  needImage: 'チップを読むと、全定義と照合して、そのチップを書いた 1 つを選びます。',

  none: {
    'not-late-layout':
      'このイメージは late layout ではありません（チェックサムで判定）。旧世代の番地は測っていないため、定義を当てはめません。',
    'no-fit': 'チップ自身のコーディングインデックスで、完全に当てはまる定義がありません。',
    ambiguous: '当てはまる定義が 2 つ以上あり、1 つに絞れません。',
  } satisfies Record<NoneReason, string>,
  fitNote: (anyValue: number, oneValue: number, arrays: number) =>
    `選択肢で値を区別できる項目だけを数えます（どの値でも一致する項目 ${anyValue}、値が 1 つの項目 ${oneValue}、配列 ${arrays} は数えません）。`,
  indexNote: (index: number) => `チップが持つコーディングインデックス ${index} と、定義のインデックスが一致しています。`,

  reason: {
    'protected-range': '保護範囲（距離・VIN・K 値・チェックサム）にあるため書きません。',
    'outside-codable': 'チェックサムで守られた 2 つの領域の外にあるため書きません。',
    'direct-value': '直接値（選択肢のない値）です。表示だけします。',
    curve: '配列（カーブ）です。表示だけします。',
    'single-option': '選択肢の値が 1 つしかなく、変える先がありません。',
    'not-an-option': 'チップの値がどの選択肢にも当たりません。書き換えません。',
  } satisfies Record<RowReason, string>,

  refused: {
    'not-late-layout': 'late layout ではないため書きません。',
    'checksum-broken': 'チップのチェックサムが既に合っていません。その上に書き足すことはしません。',
    'no-definition': 'このチップの定義がありません。',
    'memory-organisation': '定義のメモリ構成が WORDMSB ではありません。',
    'block-layout': '定義のブロック配置が、測った配置と違います。',
    'not-codable': '書き換えられない項目が含まれています。',
    'unknown-option': '定義にない選択肢です。',
    'no-change': '変更はありません。',
  } satisfies Record<CodingRefusalCode, string>,

  selectRow: '行を選ぶと、全選択肢と mask をここに表示します。',
  authoredNote: '名前は、印の無いものが確定訳です。HEURISTIC は辞書から組み立てた補完訳、RAW は訳の無いキーワードです。',
  noChanges: '変更はまだありません。CODABLE の行で新しい値を選んでください。',
  checksumsFollow: 'チェックサムは変更に合わせて計算し直し、一緒に書きます。',
  writtenNote: '書いたあと、hub は BACKUP に戻ります。次の書き込みの前に、書いた後のチップを保存するためです。',

  diff: {
    none: 'ドナーのバックアップがありません。RESTORE で開くと、項目ごとに比べられます。',
    layout: 'ドナーは late layout ではないため、同じ定義では比べません。',
    from: (n: number) => `RESTORE で開いたバックアップ（ドナー）と ${n} 項目が違います。`,
  },
};

const EN: typeof JA = {
  lead:
    'Read the chip image with the coding definition it was written with. Every parameter is listed, and only the ' +
    'ones that may be rewritten can be changed, to one of their options. The write takes the same path as REWRITE ' +
    '(write, read back, record).',
  chipOff: 'Coding is done with the chip off the cluster, on the UNO. Check the cluster with TEST once the chip is back.',
  dataNote: "The definitions are NCS Expert's. They are in neither this repository nor its build, and are held in memory only.",

  ref: {
    'not-preview': 'This build does not serve the reference data. Open kombi-coding.json to use it.',
    unauthorized: 'Not signed in, so the reference data is not served. Sign in, or open the file.',
    absent: 'The reference data has not been uploaded yet. Open the file instead.',
    unreachable: 'Could not fetch the reference data.',
    invalid: 'This JSON is not kombi-coding.',
  },
  loading: 'Fetching the reference data.',

  needImage: 'Read the chip and it is matched against every definition, to find the one that wrote it.',

  none: {
    'not-late-layout':
      "This image is not the late layout (judged by its checksums). The older generation's addresses are not measured, so no definition is applied.",
    'no-fit': "No definition fits completely with the chip's own coding index.",
    ambiguous: 'More than one definition fits, and they cannot be narrowed to one.',
  },
  fitNote: (anyValue: number, oneValue: number, arrays: number) =>
    `Only parameters whose options tell values apart are counted (not the ${anyValue} any value matches, the ${oneValue} with one value, or the ${arrays} arrays).`,
  indexNote: (index: number) => `The chip's own coding index, ${index}, is the definition's.`,

  reason: {
    'protected-range': 'In a protected range (odometer, VIN, K-numbers, checksums): not written.',
    'outside-codable': 'Outside the two checksummed regions: not written.',
    'direct-value': 'A direct value, with no options: shown, not coded.',
    curve: 'An array (a curve): shown, not coded.',
    'single-option': 'Its options set only one value: nothing to change it to.',
    'not-an-option': 'The chip holds a value none of the options set: not written.',
  },

  refused: {
    'not-late-layout': 'Not the late layout: not written.',
    'checksum-broken': "The chip's checksums already fail. CODING does not write on top of that.",
    'no-definition': 'No definition for this chip.',
    'memory-organisation': "The definition's memory is not organised WORDMSB.",
    'block-layout': "The definition's block layout is not the measured one.",
    'not-codable': 'A change touches a row that is not codable.',
    'unknown-option': "Not one of the parameter's options.",
    'no-change': 'Nothing to change.',
  },

  selectRow: 'Pick a row to see all its options and its mask here.',
  authoredNote: 'Unmarked names are authored translations. HEURISTIC is composed from the dictionary; RAW is a keyword nobody has named.',
  noChanges: 'No changes yet. Pick a new value on a CODABLE row.',
  checksumsFollow: 'The checksums are recomputed for the change and written with it.',
  writtenNote: 'After a write the hub goes back to BACKUP, so the chip as written is saved before the next write.',

  diff: {
    none: 'No donor backup. Open one in RESTORE to compare parameter by parameter.',
    layout: 'The donor is not the late layout, so it is not read with the same definition.',
    from: (n: number) => `${n} parameter(s) differ from the backup opened in RESTORE (the donor).`,
  },
};

export function cc(): typeof JA {
  return getLang() === 'ja' ? JA : EN;
}
