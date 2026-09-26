/**
 * TEST's prose: what each check does, why a comparison could not be made, why the gate refused,
 * and what the link reports. Chrome words (RUN, SEEN, EQUAL...) are in chrome.ts, not here.
 *
 * Same rules as guide.ts: EN is typed FROM JA so a missing key fails the build.
 */

import { getLang } from '@/lib/i18n';
import type { GateRefusal } from '@/lib/kombi/runGate';
import type { CheckId, NotCompared } from '@/lib/kombi/checks';
import type { DecodeFailure } from '@/lib/kombi/decode';
import type { LineSilence } from '@/lib/kombi/kombiLink';
import type { RefFailure } from '@/lib/refdata/load';

/**
 * A CONNECT that got no answer, by where the line went quiet (kombiLink.ts LineSilence): a short
 * headline for the hub's notice, what happened, and the checks for THAT fault, cheapest first
 * (tsunagi-m-link section 27). The four need different checks - a cable that never drove the line
 * and a cluster that heard and did not answer have nothing to check in common.
 */
type SilenceCopy = { headline: string; what: string; checks: readonly string[] };

const SILENCE_JA: Record<LineSilence, SilenceCopy> = {
  'no-echo': {
    headline: '送った電文がケーブルに戻ってきません',
    what: 'IDENT を送りましたが、その電文がケーブル自身に戻ってきません。ケーブルが K-line を動かしておらず、メータには何も届いていません。',
    checks: [
      'OBD 16 と OBD 4・5 の間が 12V か。16 番の穴は、ケーブルのプラグを向かい合わせたときにプラグの 16 番が入る穴（裏から数えると 9 番と取り違えます）。ケーブルの K-line 側は OBD 16 から電源をとります',
      '選んだポートが K+DCAN のものか（他の USB シリアル機器ではないか）',
      'OBD 7（K-LINE のコネクタ）が +12V に触れていないか',
      'ケーブルの切り替えスイッチが K-line 側か',
    ],
  },
  'partial-echo': {
    headline: '送った電文が途中までしか戻ってきません',
    what: '送った電文の一部しか戻ってきません。送信の途中で何かが K-line を引き下げています。',
    checks: [
      'コネクタを挿し直し、つないだまま揺すってみる',
      'OBD 7 と GND の間が短絡していないか',
      'GND（OBD 4・5 とメータの 1 番）がつながっているか',
    ],
  },
  'no-answer': {
    headline: '電文は線に出ましたが、メータが答えません',
    what: 'IDENT は K-line に出て、ケーブルに戻ってきました（ケーブルは線を動かしています）。メータが答えていません。',
    checks: [
      'OBD 7 とメータの 25 番（白/紫）が導通しているか（K-LINE のコネクタ）。7 番の穴は、プラグの 7 番が入る穴（裏から数えると 2 番と取り違えます）',
      'メータの 5 番（KL15）と 6 番（KL R）が 12V か',
      'ケーブルの切り替えスイッチを K-line 側にする（ケーブルの中で 7・8 番がつながる）',
      '25 番が本当に TXD1 か。メータのピン番号は実物で確かめていません',
    ],
  },
  'cut-short': {
    headline: 'メータの返事が途中で途切れました',
    what: 'メータは答え始めましたが、返事が途中で途切れました。',
    checks: ['コネクタを挿し直し、つないだまま揺すってみる', 'GND（OBD 4・5 とメータの 1 番）がつながっているか'],
  },
};

const SILENCE_EN: typeof SILENCE_JA = {
  'no-echo': {
    headline: 'the telegram did not come back to the cable',
    what: 'IDENT was sent, but it did not come back to the cable itself. The cable is not driving the K-line, so nothing reached the cluster.',
    checks: [
      "OBD 16 reads 12 V to OBD 4 and 5. Hole 16 is the one the cable plug's pin 16 enters, face to face (counted from the back it is mistaken for 9); the cable powers its K-line side from OBD 16",
      "The port picked is the K+DCAN's (not another USB serial device)",
      'OBD 7 (the K-LINE connector) is not touching +12 V',
      "The cable's switch is on K-line",
    ],
  },
  'partial-echo': {
    headline: 'only part of the telegram came back',
    what: 'Only part of the telegram came back. Something pulls the K-line down while it is sent.',
    checks: [
      'Reseat the connectors, and wiggle them while connected',
      'OBD 7 is not shorted to ground',
      'Ground (OBD 4 and 5, cluster pin 1) is connected',
    ],
  },
  'no-answer': {
    headline: 'the telegram went out, and the cluster did not answer',
    what: 'IDENT went out on the K-line and came back to the cable (the cable is driving the line). The cluster did not answer.',
    checks: [
      "OBD 7 has continuity to cluster pin 25 (white/violet), at the K-LINE connector. Hole 7 is the one the plug's pin 7 enters (counted from the back it is mistaken for 2)",
      'Cluster pins 5 (KL15) and 6 (KL R) read 12 V',
      "Put the cable's switch on K-line (it joins 7 and 8 inside the cable)",
      'Pin 25 really is TXD1 - the cluster pin numbers have not been checked on a real cluster',
    ],
  },
  'cut-short': {
    headline: "the cluster's answer broke off",
    what: 'The cluster began to answer, and the answer broke off.',
    checks: ['Reseat the connectors, and wiggle them while connected', 'Ground (OBD 4 and 5, cluster pin 1) is connected'],
  },
};

/** Why a reply would not decode (decode.ts DecodeFailure), for the line that says so. */
const DECODE_JA: Record<DecodeFailure, string> = {
  short: '短すぎます',
  'not-bcd': 'BCD でない桁があります',
  'not-vin-shaped': 'VIN の形ではありません',
  'length-mismatch': '長さが合いません',
};

const DECODE_EN: typeof DECODE_JA = {
  short: 'too short',
  'not-bcd': 'a digit is not BCD',
  'not-vin-shaped': 'not shaped like a VIN',
  'length-mismatch': 'the length does not match',
};

const JA = {
  checksLead:
    'メータに DS2 で問い合わせて答えをそのまま示し、針とランプを 1 つずつ動かします。' +
    '合否は付けません。何を送り、メータが何を返し、あなたが何を見たかを記録します。',
  /** What REFERENCE is for, said once where the dump is opened. */
  referenceLead:
    'ダンプ（.bin）を開くと、VIN・走行距離・EEPROM をそれとも比べます。開かなければ CHIP モードで読んだイメージか最新の記録と比べ、' +
    'どれも無ければ比べません（テストはすべて行えます）。ファイルはこのブラウザの中でだけ使い、どこにも送りません。',
  benchStatement: 'このメータは車から外してあり、机の上の電源につないでいる',
  benchWhy: 'チェックするまで、この下の針・ランプ・音を動かす要求は送りません。',
  variantUnknown:
    'IDENT の診断インデックスが KOMBI46 / 46R / KOMBIR40 のどれにも当たりません。共通の読み出しだけを送ります。',
  /** Under IDENT's bytes when no variant came of them: the ranges, so the reader can see why. */
  variantWhy: (diag: string | null) =>
    diag === null
      ? 'IDENT の応答を読めないため、メータの種類が決まりません。針・ランプ・入力・EEPROM は送りません。上のバイト列を知らせてください。'
      : `診断インデックス ${diag} は KOMBI46（0x30–0x35）・KOMBI46R（0x36–0x40）・KOMBIR40（0x50–0x54）のどれにも入りません。針・ランプ・入力・EEPROM は送りません。上のバイト列を知らせてください。`,

  check: {
    vin: 'メータが持つ VIN を読みます。',
    odometer: 'メータが数えている走行距離を読みます。',
    faults: '故障メモリをそのまま読みます。項目への分け方はまだ抽出していないため、生のバイトで示します。',
    inputs: 'イグニッションの端子やボタンの入力を読みます。ビットの名前は参照データが無い間 P2.b4 のように示します。',
    eeprom: 'メータ越しに EEPROM を読みます。メータは 2 バイトの語で数えます。',
    needles:
      '針を 1 本ずつ、10° ずつ動かして上まで行き、戻します。メータの針が動いたら SEEN、動かなかったら NOT SEEN を押してください。',
    lamps:
      'ランプを 1 つだけ点けます。メータでそのランプが点いたら SEEN、点かなかったら NOT SEEN を押すと、次のランプに進みます。NOT SEEN と答えたものが下に赤く残ります（球切れ・配線を疑う候補）。',
    outputs: '出力ポートの 4 ビットを 1 つずつ点けます（KOMBI46 のみ）。点いたら SEEN、点かなかったら NOT SEEN。',
    gong: 'ゴングを 1 回鳴らします。聞こえたら HEARD、聞こえなかったら NOT HEARD を押してください。',
    piezo: 'ピエゾを 1 回鳴らします。聞こえたら HEARD、聞こえなかったら NOT HEARD を押してください。',
    release: 'STOP で診断を終えたあと、針とランプがメータ自身の表示に戻ったかを記録します。',
  } satisfies Record<CheckId, string>,

  notCompared: {
    'no-field': 'チップのイメージにこの欄がありません。',
    unreadable: 'メータの応答を読めませんでした。',
  } satisfies Record<NotCompared, string>,

  /** A reply that came, and would not decode as what was asked. */
  unreadable: (why: DecodeFailure, got: number) => `読めない応答: ${DECODE_JA[why]}（${got} バイト）`,
  /** The EEPROM read, by the cluster's own word numbers. */
  eepromWords: (first: string, last: string, words: number) => `語 ${first}–${last}（${words} 語）`,
  differingBytes: (n: number, of: number) => `${of} バイト中 ${n} バイトが違う`,

  refused: {
    'not-allowed': 'このツールが送らない要求です。',
    'wrong-length': '長さが違うため送りません。',
    'variant-unknown': 'メータの種類が IDENT から決まらないため送りません（上の IDENT を参照）。',
    'not-on-this-variant': 'このバリアントにはない要求です。',
    'bench-unconfirmed': 'ON THE BENCH にチェックすると送ります。',
    'out-of-range': '範囲外の値のため送りません。',
    'step-too-large': '針を一度に 10° より大きく動かす要求は送りません。',
  } satisfies Record<GateRefusal, string>,

  noWebSerial: 'このブラウザでは Web Serial が使えません。デスクトップの Chrome か Edge で開いてください。',
  unoRefused:
    'これは Arduino（UNO）のポートです。TEST は K+DCAN ケーブルでメータと話します。UNO はメータにつながないでください。',
  noIdent: (detail: string, silence: LineSilence | null) =>
    silence
      ? `メータが IDENT に応答しません: ${SILENCE_JA[silence].headline}（${detail}）。確かめる所は CHECKS に出ています。`
      : `メータが IDENT に応答しません。配線・電源（KL15）・ケーブルの切り替えを確認してください。（${detail}）`,
  /** Where a failed CONNECT went quiet: what happened, then the checks for THAT, cheapest first. */
  silence: SILENCE_JA,
  connected: (variant: string) => `メータに接続しました: ${variant}`,
  practiceConnected: 'PRACTICE: 模擬メータに接続しました。何もハードウェアには送りません。',
  sessionEnded: '診断を終えました（9F）。メータが針とランプを自分に戻します。',
  sessionEndUnanswered: '診断終了（9F）に応答がありませんでした。メータの表示を目で確かめてください。',
  linkLost: (detail: string) => `ケーブルとの通信が切れました。（${detail}）`,
  commanded: '指令した値です。メータが実際に表示しているものではありません。',
  releaseQuestion: 'STOP のあと、針とランプはメータ自身の表示に戻りましたか？',
  reportNote: 'レポートは JSON でダウンロードされます。SYNC には送りません。',
  mappingNote: '語 w ＝ チップの 2w・2w+1 バイト（仮定。実機では未確認）',

  names: {
    'not-preview': 'このビルドはランプ・入力の名前を配信しません。kombi-names.json を開くと表示します。',
    unauthorized: 'サインインしていないため、名前を受け取れません。サインインするか、ファイルを開いてください。',
    absent:
      'この配信元には名前のデータがありません（ワークス版ならまだアップロードされていない、手元のサーバなら REFDATA_OUT のフォルダに無い）。kombi-names.json を開くと表示します。',
    unreachable: '名前のデータを取得できませんでした。',
    invalid: 'この JSON は kombi-names の形式ではありません。',
  } satisfies Record<RefFailure, string>,
  namesNote: '名前は SGBD の説明から作った参照データです。送る要求と記録は位置（B2.b5）で表し、名前はその横に添えるだけです。',
};

const EN: typeof JA = {
  checksLead:
    'Ask the cluster over DS2 and show what it answers, and move the needles and lamps one at a ' +
    'time. Nothing passes or fails: TEST records what was sent, what the cluster answered, and what ' +
    'you saw.',
  referenceLead:
    'Open a dump (.bin) and the VIN, odometer and EEPROM are also compared with it. Without one, ' +
    'the image read in CHIP mode or the newest record is used; with none of them nothing is compared ' +
    '(every check still runs). The file is used in this browser only and sent nowhere.',
  benchStatement: 'This cluster is out of the car, powered on the bench',
  benchWhy: 'Until this is ticked, nothing below that moves a needle, lights a lamp or makes a sound is sent.',
  variantUnknown:
    "IDENT's diagnosis index is in none of the KOMBI46, 46R and KOMBIR40 ranges. Only the shared reads are sent.",
  variantWhy: (diag: string | null) =>
    diag === null
      ? "IDENT's reply could not be read, so the cluster is not named: no needle, lamp, input or EEPROM telegram is sent. Send the bytes above."
      : `Diagnosis index ${diag} is in none of KOMBI46 (0x30-0x35), KOMBI46R (0x36-0x40) and KOMBIR40 (0x50-0x54): no needle, lamp, input or EEPROM telegram is sent. Send the bytes above.`,

  check: {
    vin: "Read the cluster's VIN.",
    odometer: 'Read the distance the cluster counts.',
    faults: 'Read the fault memory as it is. How it splits into entries has not been extracted yet, so it is shown as raw bytes.',
    inputs: 'Read the ignition terminals and button inputs. Until reference data names the bits, a bit is shown as P2.b4.',
    eeprom: 'Read the EEPROM through the cluster. The cluster counts it in 2-byte words.',
    needles: 'Move each needle up in steps of 10 degrees and back. Press SEEN if the needle moved on the cluster, NOT SEEN if it did not.',
    lamps:
      'Light one lamp at a time. Press SEEN if it lit on the cluster, NOT SEEN if it did not, and the next one lights. What you marked NOT SEEN stays below in red - the lamps to check for a bulb or wiring.',
    outputs: 'Drive the four bits of the output port one at a time (KOMBI46 only). SEEN if it lit, NOT SEEN if not.',
    gong: 'Sound the gong once. Press HEARD if you heard it, NOT HEARD if not.',
    piezo: 'Sound the piezo once. Press HEARD if you heard it, NOT HEARD if not.',
    release: 'After STOP ends the session, record whether the needles and lamps went back to the cluster.',
  },

  notCompared: {
    'no-field': 'The chip image has no such field.',
    unreadable: "The cluster's reply could not be read.",
  },

  unreadable: (why: DecodeFailure, got: number) => `Unreadable reply: ${DECODE_EN[why]} (${got} bytes)`,
  eepromWords: (first: string, last: string, words: number) => `words ${first}-${last} (${words})`,
  differingBytes: (n: number, of: number) => `${n} of ${of} bytes differ`,

  refused: {
    'not-allowed': 'This tool does not send that.',
    'wrong-length': 'Not sent: the wrong length.',
    'variant-unknown': 'Not sent: IDENT did not name the cluster - see IDENT above.',
    'not-on-this-variant': 'This variant has no such telegram.',
    'bench-unconfirmed': 'Sent once ON THE BENCH is ticked.',
    'out-of-range': 'Not sent: a value out of range.',
    'step-too-large': 'Not sent: a needle move larger than 10 degrees.',
  },

  noWebSerial: 'This browser has no Web Serial. Open the tool in desktop Chrome or Edge.',
  unoRefused:
    'That is an Arduino (UNO) port. TEST talks to the cluster through the K+DCAN cable - never connect the UNO to the cluster.',
  noIdent: (detail: string, silence: LineSilence | null) =>
    silence
      ? `The cluster does not answer IDENT: ${SILENCE_EN[silence].headline} (${detail}). What to check is in CHECKS.`
      : `The cluster does not answer IDENT. Check the wiring, KL15 and the cable's switch. (${detail})`,
  silence: SILENCE_EN,
  connected: (variant: string) => `Connected to the cluster: ${variant}`,
  practiceConnected: 'PRACTICE: connected to a simulated cluster. Nothing is sent to hardware.',
  sessionEnded: 'Session ended (9F). The cluster takes its needles and lamps back.',
  sessionEndUnanswered: 'The session end (9F) was not answered. Check the cluster by eye.',
  linkLost: (detail: string) => `Lost the cable. (${detail})`,
  commanded: 'What was commanded - not what the cluster is actually showing.',
  releaseQuestion: 'After STOP, did the needles and lamps go back to the cluster?',
  reportNote: 'The report downloads as JSON. It is not SYNCed.',
  mappingNote: 'word w = chip bytes 2w, 2w+1 (assumed, not yet measured)',

  names: {
    'not-preview': 'This build does not serve the lamp and input names. Open kombi-names.json to show them.',
    unauthorized: 'Not signed in, so the names are not served. Sign in, or open the file.',
    absent:
      "This server has no names (not uploaded to the WORKS build yet, or not in a local server's REFDATA_OUT folder). Open kombi-names.json to show them.",
    unreachable: 'Could not fetch the names.',
    invalid: 'This JSON is not kombi-names.',
  },
  namesNote: 'The names are reference data made from the SGBD descriptions. What is sent and recorded is the position (B2.b5); the name only goes beside it.',
};

export function tc(): typeof JA {
  return getLang() === 'ja' ? JA : EN;
}
