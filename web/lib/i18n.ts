/**
 * Language resolution and the copy record.
 *
 * The app opens in the READER's language: resolved once at boot from
 * `navigator.language`, overridden by an explicit stored choice, and written
 * to `document.documentElement.lang`.
 *
 * The Next.js static-export trap: this module is imported during prerender,
 * where `navigator`, `localStorage` and `document` all throw. The `typeof`
 * guards below are where this rule usually dies - the boot write ends up
 * living only inside `setLang()`, and the app ships the static `lang="ja"` to
 * every reader who never touches the toggle. `applyLangToDocument()` exists to
 * be called from a mount effect in the root client component, which is the
 * missing half.
 */

import type { RefusalCode } from './domain/operations';
import type { ImageFault } from './domain/image';

export type Lang = 'ja' | 'en';

/** Just enough of a Refusal to render it. Imported as a type only, no cycle. */
export type RefusalInfo = {
  code: RefusalCode;
  floorKm?: number;
  backupKm?: number;
  maxKm?: number;
  vinLength?: number;
  /** How many bytes a refused file actually had. */
  fileSize?: number;
};

/** Whatever layout.tsx puts in <html lang>. The server snapshot. */
export const STATIC_LANG: Lang = 'ja';

/**
 * The key an earlier build wrote when it still had a ja/en toggle.
 *
 * It is not read. It is DELETED at boot, because tsunagi-m-ux section 13
 * names this exact trap: take the toggle away but keep reading what it saved,
 * and every reader who ever pressed it is frozen in that language with no
 * control left to change it. The browser is now the only source.
 */
const RETIRED_KEY = 'm35080-odo.lang';

function fromNavigator(): Lang {
  if (typeof navigator === 'undefined') return STATIC_LANG; // prerender, not a reader
  // `?.` so a missing language yields 'en', never the author's language.
  return navigator.language?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

let current: Lang = STATIC_LANG;
if (typeof window !== 'undefined') {
  current = fromNavigator();
  try {
    localStorage.removeItem(RETIRED_KEY);
  } catch {
    /* private mode: there is nothing stored to retire */
  }
}

/**
 * A plain function, NOT a hook: the native confirm/alert call sites fire from
 * event handlers that have no hook to read.
 *
 * There is no setter in the app. A reader who wants the other language
 * changes their browser's, which is the right place and fixes every other
 * site as well.
 */
export function getLang(): Lang {
  return current;
}

/**
 * TESTS ONLY - render one catalog, then the other, in the same process.
 *
 * Never persisted and never called from the app: a language control is a
 * question the instrument's chrome has no room for (section 13).
 */
export function setLangForTest(lang: Lang): void {
  current = lang;
  listeners.forEach((l) => l(lang));
}

/** The boot write the `typeof` guards would otherwise delete. */
export function applyLangToDocument(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}

type Listener = (lang: Lang) => void;
const listeners = new Set<Listener>();
export function subscribeLang(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ---------------------------------------------------------------------------
   Copy.

   Safety-relevant strings live HERE rather than at the call site, so a new
   confirm() cannot quietly reintroduce a single-language string - there is
   nowhere convenient to write one. EN is typed FROM JA, so a missing key or a
   changed signature fails the build rather than reaching a dialog about
   erasing a chip as `undefined`.

   Uppercase technical shorthand (WRITE, BACKUP, RESET, VIN) is deliberately
   NOT translated: it is the instrument's vocabulary and part of the
   label-is-a-promise chain.
   --------------------------------------------------------------------------- */

/* The app NAME lives in the header markup, not here: "E46 M35080 /// Migration"
   is a proper noun, so translating it would be a bug, and a key that must hold
   the same string in every language is an invitation to drift. */
const JA = {
  // hub / status

  bridgeConnectionFailed: (detail: string) =>
    'Arduinoとの接続確認に失敗しました。UNOのポートを選び、付属の m35080_bridge.ino を書き込んでください。' +
    '確認用PINGはEEPROMなしでも応答します。専用スケッチが書き込み済みの場合はUSB接続と電源を確認してください。' +
    ` 詳細: ${detail}`,

  /* 1024バイトが全部同じ値 = チップではなくバスを読んでいる。これを受け入れた
     結果、浮いた配線が「1,048,560 km」として表示されたことがある。 */
  imageNotFromChip: (d: ImageFault): string => {
    const b = (v: number | undefined) =>
      v === undefined ? '不明' : `0x${v.toString(16).toUpperCase().padStart(2, '0')}`;
    return d.kind === 'loopback'
      ? `1024バイトすべてが ${b(d.value)}（ステータスも ${b(d.status)}）でした。` +
        'チップではなく配線を読んでいます — D11(MOSI)とD12(MISO)が直結されたままです。' +
        'ループバック用のジャンパーを外してください。'
      : `1024バイトすべてが ${b(d.value)}、ステータスレジスタも ${b(d.status)} でした。` +
        '別々のトランザクションで同じ値が返っているため、チップが応答していません（MISOが浮いています）。' +
        '8番ピンの電源、チップの向き、アダプタの接触を確認してください。';
  },

  /* 実測: 同一チップの読み出しが市販プログラマのダンプと1024バイト中3バイト
     食い違った。1回の読み出しでは検出できない。 */
  readUnstable: (count: number, addr: number, a: number, b: number): string =>
    `同じチップを2回読み出したところ、${count} バイトが一致しませんでした` +
    `（最初の相違は 0x${addr.toString(16).toUpperCase().padStart(3, '0')}: ` +
    `0x${a.toString(16).toUpperCase().padStart(2, '0')} と ` +
    `0x${b.toString(16).toUpperCase().padStart(2, '0')}）。` +
    'この読み出しはバックアップとして使えません。配線の接触を直してから再試行してください。',

  verifyMismatch: (count: number, addr: number): string =>
    `書き込み後の照合で、${count} バイトが意図と異なりました` +
    `（最初の相違は 0x${addr.toString(16).toUpperCase().padStart(3, '0')}）。` +
    '画面にはチップの実際の状態を表示しています。' +
    'セキュア領域は元に戻せないため、このまま次の操作へ進まないでください。',

  practiceMode: 'PRACTICE モード — 実機には書き込みません',

  // odometer
  odometerUnreadable: 'セキュア領域を解読できません',

  // vin

  // confirms - the concrete consequence, stated
  confirmWriteTitle: 'チップへ書き込みます',
  confirmOdometer: (from: number | null, to: number, ops: number) =>
    /* `from` is null when the secure area does not decode. It used to be
       coerced to 0 by the caller, so the one dialog whose job is to state
       the true consequence asserted a current reading the same screen had
       just refused to give. */
    (from === null
      ? `オドメーターを ${to.toLocaleString()} km へ書き換えます。\n` +
        `現在値は読み取れていません（セキュア領域を解読できませんでした）。\n`
      : `オドメーターを ${from.toLocaleString()} km から ${to.toLocaleString()} km へ書き換えます。\n`) +
    `セキュア領域 0x00–0x1F の ${ops} 個のレジスタに WRINC を実行します。\n\n` +
    `この操作は取り消せません。一度書き込んだ値は二度と引き下げられません。\n` +
    `書き込む値は車両の実際の走行距離と一致していなければなりません。`,
  confirmReset:
    'バックアップのクラスターデータを新品チップへ書き込みます。\n' +
    '0x20–0x3FF をバックアップの値で、1 バイトも変えずに書きます。\n' +
    'バックアップに VIN が入っていれば、その VIN も一緒に写ります。\n' +
    '走行距離 0x00–0x1F は書きません（0 km のまま）。\n\n' +
    '走行距離に触れないため、この書き込みは後から別のバックアップでやり直せます。',
  confirmRepair: (n: number) =>
    `標準領域の ${n} バイトを、バックアップの値へ書き戻します。\n` +
    `書き込まないのは走行距離 0x00–0x1F だけです。\n` +
    `VIN もバックアップと違っていれば書き戻します。\n\n` +
    `セキュア領域を上げないため、この操作は何度でもやり直せます。`,
  noCancelDuringWrite: '書き込み中はキャンセルできません',

  // refusals
  refuseNoBackup: '先に BACKUP を実行してください。',

  /* Rendered from a CODE, not from prose the domain layer wrote. This is the
     loudest consumer of the language rule: a refusal is safety copy. */
  refusal: (r: RefusalInfo): { reason: string; detail?: string } => {
    switch (r.code) {
      case 'cannot-lower':
        return {
          reason:
            'この値は書き込めません。セキュア領域はハード的に増加のみで、引き下げは不可能です。',
          detail:
            r.floorKm === undefined
              ? undefined
              : `書き込める最小値は ${r.floorKm.toLocaleString()} km です`,
        };
      case 'not-blank':
        return {
          reason:
            'このチップは使用済みです。セキュア領域が 0 ではないため 0 km にリセットできません。',
          detail: '新品のブランク M35080 を使用してください。増加のみのカウンタは戻せません。',
        };
      case 'restore-lower':
        return {
          reason: 'このチップはバックアップより進んでいるため、復元できません。',
          detail:
            r.backupKm === undefined
              ? undefined
              : `バックアップは ${r.backupKm.toLocaleString()} km です。`,
        };
      case 'vin-invalid':
        return {
          reason: 'VIN の形式が不正です',
          detail: '大文字の英数字のみ、7〜17 文字で入力してください（例 ABC12345）。',
        };
      case 'vin-no-target':
        return {
          reason: 'このチップには書き換え先の VIN がありません。',
          detail:
            'VIN の位置は固定ではなく、チップ上にある VIN を探して同じ場所に書きます。' +
            '新品チップには VIN を書かず、車両接続後に NCS Expert で入れるのが標準手順です。',
        };
      case 'vin-length':
        return {
          reason: '文字数がチップ上の VIN と一致しません。',
          detail:
            r.vinLength === undefined
              ? undefined
              : `チップ上の VIN は ${r.vinLength} 文字です。長さが違うと、隣の領域まで書き換えてしまいます。`,
        };
      case 'km-invalid':
        return { reason: '走行距離は 0 以上の整数で入力してください' };
      case 'km-too-large':
        return {
          reason: '走行距離がこのエンコードの上限を超えています',
          detail: r.maxKm === undefined ? undefined : `上限 ${r.maxKm.toLocaleString()} km`,
        };
      case 'backup-size':
        return {
          reason: 'M35080 のイメージではありません。',
          detail:
            r.fileSize === undefined
              ? '1024 バイトちょうどのファイルが必要です。'
              : r.fileSize === 0
                ? 'ファイルが空です（0 バイト）。'
                : `${r.fileSize.toLocaleString()} バイトのファイルです。1024 バイトちょうどのファイルが必要です。`,
        };
      case 'backup-no-data':
        return {
          reason: 'このバックアップにはクラスターのデータが入っていません。',
          detail:
            '標準領域 0x20–0x3FF が全て同じ値です（全FF・全00など）。正しく読み出せた元チップのバックアップを選んでください。',
        };
      case 'image-size':
      case 'current-size':
        return { reason: 'イメージのサイズが不正です（1024 バイト必要）' };
    }
  },

  // outcomes
  writeOk: '書き込み完了・検証OK',
  writeFailedAt: (done: number, total: number) =>
    `書き込みが途中で失敗しました（${done}/${total} バイト完了）`,
};
/* Deliberately NOT `as const`. Literal types would make `typeof JA` demand that
   EN repeat the Japanese strings verbatim. What we want checked is the SHAPE -
   every key present, every function the same signature - so that a missing key
   cannot reach a confirm dialog about erasing a chip as `undefined`. */

const EN: typeof JA = {

  bridgeConnectionFailed: (detail: string) =>
    'The Arduino handshake failed. Select the UNO port and upload the included m35080_bridge.ino. ' +
    'PING works without an EEPROM. If that sketch is already installed, check the USB connection and power. ' +
    `Details: ${detail}`,

  imageNotFromChip: (d: ImageFault): string => {
    const b = (v: number | undefined) =>
      v === undefined ? 'unknown' : `0x${v.toString(16).toUpperCase().padStart(2, '0')}`;
    return d.kind === 'loopback'
      ? `All 1024 bytes were ${b(d.value)} (status ${b(d.status)}) — that is the wiring, ` +
        'not a chip: D11 (MOSI) is still shorted to D12 (MISO). Remove the loopback jumper.'
      : `All 1024 bytes were ${b(d.value)} and the status register read ${b(d.status)} too. ` +
        'Two separate transactions returned the same value, so the chip is not responding ' +
        "(MISO is floating). Check 5 V on pin 8, the chip's orientation, and that it is " +
        'seated in the adapter.';
  },

  readUnstable: (count: number, addr: number, a: number, b: number): string =>
    `Reading the same chip twice disagreed on ${count} byte(s) ` +
    `(first at 0x${addr.toString(16).toUpperCase().padStart(3, '0')}: ` +
    `0x${a.toString(16).toUpperCase().padStart(2, '0')} vs ` +
    `0x${b.toString(16).toUpperCase().padStart(2, '0')}). ` +
    'This read cannot be trusted as a backup. Fix the wiring contact, then try again.',

  verifyMismatch: (count: number, addr: number): string =>
    `Verification after writing found ${count} byte(s) that do not match the intent ` +
    `(first at 0x${addr.toString(16).toUpperCase().padStart(3, '0')}). ` +
    "The screen shows the chip's actual state. The secure area cannot be undone, so do " +
    'not move on from here.',

  practiceMode: 'PRACTICE mode — nothing is written to hardware',

  odometerUnreadable: 'Cannot decode the secure area',


  confirmWriteTitle: 'Write to the chip',
  confirmOdometer: (from: number | null, to: number, ops: number) =>
    (from === null
      ? `Rewrite the odometer to ${to.toLocaleString()} km.\n` +
        `The current value could not be read - the secure area does not decode.\n`
      : `Rewrite the odometer from ${from.toLocaleString()} km to ${to.toLocaleString()} km.\n`) +
    `This performs WRINC on ${ops} register(s) in the secure area 0x00–0x1F.\n\n` +
    `This cannot be undone. A value once written can never be lowered.\n` +
    `The value written must match the vehicle's true mileage.`,
  confirmReset:
    "Write a backup's cluster data to a new chip.\n" +
    'Writes 0x20-0x3FF from the backup, byte for byte, with nothing altered.\n' +
    "If the backup carries a VIN, that VIN is copied across with it.\n" +
    'The odometer 0x00-0x1F is not written (it stays at 0 km).\n\n' +
    'Because the odometer is untouched, this write can be redone later from another backup.',
  confirmRepair: (n: number) =>
    `Write ${n} standard-array byte(s) back to the backup's values.\n` +
    `The odometer (0x00-0x1F) is the only thing not written.\n` +
    `The VIN is written too, if it differs from the backup.\n\n` +
    `Nothing raises the secure counter, so this can be repeated.`,
  noCancelDuringWrite: 'Cannot cancel during a write',

  refuseNoBackup: 'Run BACKUP first.',

  refusal: (r: RefusalInfo): { reason: string; detail?: string } => {
    switch (r.code) {
      case 'cannot-lower':
        return {
          reason:
            'That value cannot be written. The secure area counts up only, in hardware — it can never be lowered.',
          detail:
            r.floorKm === undefined
              ? undefined
              : `Lowest writable value: ${r.floorKm.toLocaleString()} km`,
        };
      case 'not-blank':
        return {
          reason:
            'This chip has been used: its secure area is not zero, so it cannot be reset to 0 km.',
          detail:
            'Fit a new blank M35080. The increment-only counter cannot be lowered.',
        };
      case 'restore-lower':
        return {
          reason:
            'This chip already reads higher than the backup, so the backup cannot be restored onto it.',
          detail:
            r.backupKm === undefined
              ? undefined
              : `The backup holds ${r.backupKm.toLocaleString()} km.`,
        };
      case 'vin-invalid':
        return {
          reason: 'That is not a VIN this tool will write',
          detail: 'Uppercase letters and digits only, 7 to 17 characters (e.g. ABC12345).',
        };
      case 'vin-no-target':
        return {
          reason: 'There is no VIN on this chip to overwrite.',
          detail:
            'The VIN is found by scanning, not at a fixed address, and it is written ' +
            'back where it was found. A new chip is meant to go in without one and be ' +
            'coded over OBD with the car connected.',
        };
      case 'vin-length':
        return {
          reason: 'That is not the same length as the VIN on the chip.',
          detail:
            r.vinLength === undefined
              ? undefined
              : `The chip holds ${r.vinLength} characters. A different length would run past them.`,
        };
      case 'km-invalid':
        return { reason: 'Mileage must be a whole number of kilometres, 0 or more' };
      case 'km-too-large':
        return {
          reason: 'That mileage exceeds what this encoding can represent',
          detail: r.maxKm === undefined ? undefined : `Maximum ${r.maxKm.toLocaleString()} km`,
        };
      case 'backup-size':
        return {
          reason: 'This is not an M35080 image.',
          detail:
            r.fileSize === undefined
              ? 'The file must be exactly 1024 bytes.'
              : r.fileSize === 0
                ? 'The file is empty (0 bytes).'
                : `The file is ${r.fileSize.toLocaleString()} bytes; it must be exactly 1024.`,
        };
      case 'backup-no-data':
        return {
          reason: 'This backup holds no cluster data.',
          detail:
            'Its standard array 0x20-0x3FF is one value repeated (all FF, all 00, ...). Pick a backup of the original chip that read correctly.',
        };
      case 'image-size':
      case 'current-size':
        return { reason: 'The image is the wrong size (1024 bytes required)' };
    }
  },

  writeOk: 'Write complete, verified',
  writeFailedAt: (done: number, total: number) =>
    `Write failed part-way (${done}/${total} bytes completed)`,
};

/** Read the copy record for the currently resolved language. */
export function t(): typeof JA {
  return current === 'ja' ? JA : EN;
}
