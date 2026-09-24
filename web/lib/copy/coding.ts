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
  dataNote: '定義は NCS Expert のものです。このリポジトリにもビルドにも入っておらず、メモリ上だけで使います。',

  ref: {
    'not-preview': 'このビルドは参照データを配信しません。kombi-coding.json をここに開いてください。',
    unauthorized: 'サインインしていないため、参照データを受け取れません。サインインするか、kombi-coding.json をここに開いてください。',
    absent:
      'この配信元には参照データがありません（プレビューにはまだアップロードされていないか、API の無いローカル配信です）。kombi-coding.json をここに開いてください。',
    unreachable: '参照データを取得できませんでした。kombi-coding.json をここに開いてください。',
    invalid: 'この JSON は kombi-coding の形式ではありません。',
  } satisfies Record<RefFailure, string>,
  loading: '参照データを取得しています。',

  needImage: 'チップを READ するか、SOURCE にダンプを開くと、全定義と照合して、それを書いた 1 つを選びます。',

  none: {
    'not-late-layout':
      'このイメージは late layout ではありません（チェックサムで判定）。旧世代の番地は測っていないため、定義を当てはめません。',
    'no-fit': 'チップ自身のコーディングインデックスで、完全に当てはまる定義がありません。',
    ambiguous: '当てはまる定義が 2 つ以上あり、1 つに絞れません。',
  } satisfies Record<NoneReason, string>,
  practicePreset:
    'この模擬チップは定義が届く前に作られたため、どの定義にも当てはまりません。DISCONNECT して CONNECT し直すと、定義に合わせた模擬チップで READ できます。',
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
  /* The same, in a word, for the list's third column; the sentence above is in the detail. */
  short: {
    'protected-range': 'VIN・距離の領域',
    'outside-codable': 'チェックサムの外',
    'direct-value': '直接値',
    curve: 'カーブ',
    'single-option': '選択肢が 1 つ',
    'not-an-option': '値が選択肢にない',
  } satisfies Record<RowReason, string>,

  refused: {
    'not-late-layout': 'late layout ではないため書きません。',
    'checksum-broken':
      'チップのチェックサムが既に合っていません。その上に書き足すことはしません。READ し直すか、良い BACKUP かドナーのファイルを FILE にしてください。',
    'no-definition': 'このチップの定義がありません。',
    'memory-organisation': '定義のメモリ構成が WORDMSB ではありません。',
    'block-layout': '定義のブロック配置が、測った配置と違います。',
    'not-codable': '書き換えられない項目が含まれています。',
    'unknown-option': '定義にない選択肢です。',
    'no-change': '変更はありません。',
  } satisfies Record<CodingRefusalCode, string>,

  selectRow: '行を選ぶと、全選択肢と mask をここに表示します。',
  authoredNote: '名前は、印の無いものが確定訳です。HEURISTIC は辞書から組み立てた補完訳、RAW は訳の無いキーワードです。',
  diff: {
    none: 'DIFF は、SOURCE をダンプにしたとき、ダンプと今のチップで値の違う項目を示します。',
    layout: '今のチップは late layout ではないため、同じ定義では比べません。',
    from: (n: number) => `SOURCE のダンプと今のチップで、${n} 項目の値が違います。`,
  },
};

const EN: typeof JA = {
  dataNote: "The definitions are NCS Expert's. They are in neither this repository nor its build, and are held in memory only.",

  ref: {
    'not-preview': 'This build does not serve the reference data. Open kombi-coding.json here.',
    unauthorized: 'Not signed in, so the reference data is not served. Sign in, or open kombi-coding.json here.',
    absent:
      'This server has no reference data (not uploaded to the preview yet, or a local server with no API). Open kombi-coding.json here.',
    unreachable: 'Could not fetch the reference data. Open kombi-coding.json here.',
    invalid: 'This JSON is not kombi-coding.',
  },
  loading: 'Fetching the reference data.',

  needImage: 'READ the chip, or open a dump as the SOURCE, and it is matched against every definition to find the one that wrote it.',

  none: {
    'not-late-layout':
      "This image is not the late layout (judged by its checksums). The older generation's addresses are not measured, so no definition is applied.",
    'no-fit': "No definition fits completely with the chip's own coding index.",
    ambiguous: 'More than one definition fits, and they cannot be narrowed to one.',
  },
  practicePreset:
    'This practice chip was made before the definitions arrived, so none fits it. DISCONNECT and CONNECT again, and PRACTICE reads a chip built to fit them.',
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
  short: {
    'protected-range': 'VIN / odometer area',
    'outside-codable': 'outside the checksums',
    'direct-value': 'direct value',
    curve: 'curve',
    'single-option': 'one option only',
    'not-an-option': 'not an option',
  },

  refused: {
    'not-late-layout': 'Not the late layout: not written.',
    'checksum-broken':
      "The chip's checksums already fail. CODING does not write on top of that. READ again, or use a good BACKUP or a donor file as the FILE.",
    'no-definition': 'No definition for this chip.',
    'memory-organisation': "The definition's memory is not organised WORDMSB.",
    'block-layout': "The definition's block layout is not the measured one.",
    'not-codable': 'A change touches a row that is not codable.',
    'unknown-option': "Not one of the parameter's options.",
    'no-change': 'Nothing to change.',
  },

  selectRow: 'Pick a row to see all its options and its mask here.',
  authoredNote: 'Unmarked names are authored translations. HEURISTIC is composed from the dictionary; RAW is a keyword nobody has named.',
  diff: {
    none: 'With a dump as the SOURCE, DIFF shows the parameters the dump and the chip hold differently.',
    layout: 'The chip is not the late layout, so it is not read with the same definition.',
    from: (n: number) => `${n} parameter(s) differ between the SOURCE dump and the chip.`,
  },
};

export function cc(): typeof JA {
  return getLang() === 'ja' ? JA : EN;
}
