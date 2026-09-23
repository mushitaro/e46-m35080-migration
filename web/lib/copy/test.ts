/**
 * TEST's prose: what each check does, why a comparison could not be made, why the gate refused,
 * and what the link reports. Chrome words (RUN, SEEN, EQUAL...) are in chrome.ts, not here.
 *
 * Same rules as guide.ts: EN is typed FROM JA so a missing key fails the build.
 */

import { getLang } from '@/lib/i18n';
import type { GateRefusal } from '@/lib/kombi/runGate';
import type { CheckId, NotCompared } from '@/lib/kombi/checks';

const JA = {
  checksLead:
    'メータに DS2 で問い合わせ、読み出したものをチップのイメージと比べ、針とランプを 1 つずつ動かします。' +
    '合否は付けません。何を送り、メータが何を返し、あなたが何を見たかを記録します。',
  benchStatement: 'このメータは車から外してあり、机の上の電源につないでいる',
  benchWhy: '確認するまで、針・ランプ・音を動かす要求は送りません（読み出しは送ります）。',
  variantUnknown:
    'IDENT の診断インデックスが KOMBI46 / 46R のどちらにも当たりません。どちらにも共通の読み出しだけを送ります。',

  check: {
    vin: 'メータが持つ VIN を読み、チップの 2 つの欄（0x07A のコーディング側、ASCII 側）と比べます。',
    odometer: 'メータが数えている走行距離を読み、チップのカウンタ（0x000–0x01F）と比べます。',
    faults: '故障メモリをそのまま読みます。項目への分け方はまだ抽出していないため、生のバイトで示します。',
    inputs: 'イグニッションの端子やボタンの入力を読みます。ビットの名前は参照データが無い間 P2.b4 のように示します。',
    eeprom:
      'メータ越しに EEPROM を読み、チップのイメージと比べます。語 w をチップの 2w・2w+1 バイトと仮定しています（実機では未確認）。',
    needles: '針を 1 本ずつ、10° ずつ動かして上まで行き、戻します。各段で止まります。',
    lamps: 'ランプを 1 つずつ点けます。見えたかどうかを記録してください。',
    outputs: '出力ポートの 4 ビットを 1 つずつ点けます（KOMBI46 のみ）。',
    gong: 'ゴングを 1 回鳴らします。',
    piezo: 'ピエゾを 1 回鳴らします。',
    release: 'STOP で診断を終えたあと、針とランプがメータ自身の表示に戻ったかを記録します。',
  } satisfies Record<CheckId, string>,

  notCompared: {
    'no-reference': '比べるチップのイメージがありません（この画面で読んだものも、記録もありません）。',
    'no-field': 'チップのイメージにこの欄がありません。',
    unreadable: 'メータの応答を読めませんでした。',
  } satisfies Record<NotCompared, string>,

  refused: {
    'not-allowed': 'このツールが送らない要求です。',
    'wrong-length': '長さが違うため送りません。',
    'variant-unknown': 'バリアントが分かるまで送りません。',
    'not-on-this-variant': 'このバリアントにはない要求です。',
    'bench-unconfirmed': 'ベンチの確認がまだです。',
    'out-of-range': '範囲外の値のため送りません。',
    'step-too-large': '針を一度に 10° より大きく動かす要求は送りません。',
  } satisfies Record<GateRefusal, string>,

  noWebSerial: 'このブラウザでは Web Serial が使えません。デスクトップの Chrome か Edge で開いてください。',
  unoRefused:
    'これは Arduino（UNO）のポートです。TEST は K+DCAN ケーブルでメータと話します。UNO はメータにつながないでください。',
  noIdent: (detail: string) => `メータが IDENT に応答しません。配線・電源（KL15）・ケーブルの切り替えを確認してください。（${detail}）`,
  connected: (variant: string) => `メータに接続しました: ${variant}`,
  practiceConnected: 'PRACTICE: 模擬メータに接続しました。何もハードウェアには送りません。',
  sessionEnded: '診断を終えました（9F）。メータが針とランプを自分に戻します。',
  sessionEndUnanswered: '診断終了（9F）に応答がありませんでした。メータの表示を目で確かめてください。',
  linkLost: (detail: string) => `ケーブルとの通信が切れました。（${detail}）`,
  commanded: '指令した値です。メータが実際に表示しているものではありません。',
  releaseQuestion: 'STOP のあと、針とランプはメータ自身の表示に戻りましたか？',
  reportNote: 'レポートは JSON でダウンロードされます。SYNC には送りません。',
  mappingNote: '語 w ＝ チップの 2w・2w+1 バイト（仮定）',
  referenceFrom: (label: string) => `比較の相手: ${label}`,
  noReference: '比較の相手がありません。チップを読むか、記録があれば比べます。',
};

const EN: typeof JA = {
  checksLead:
    'Ask the cluster over DS2, compare what it says with the chip image, and move the needles and ' +
    'lamps one at a time. Nothing passes or fails: TEST records what was sent, what the cluster ' +
    'answered, and what you saw.',
  benchStatement: 'This cluster is out of the car, powered on the bench',
  benchWhy: 'Until this is ticked, nothing that moves a needle, lights a lamp or makes a sound is sent (reads are).',
  variantUnknown:
    "IDENT's diagnosis index is in neither the KOMBI46 nor the 46R range. Only the reads both share are sent.",

  check: {
    vin: "Read the cluster's VIN and compare it with both chip fields (coded at 0x07A, and ASCII).",
    odometer: "Read the distance the cluster counts and compare it with the chip's counter (0x000-0x01F).",
    faults: 'Read the fault memory as it is. How it splits into entries has not been extracted yet, so it is shown as raw bytes.',
    inputs: 'Read the ignition terminals and button inputs. Until reference data names the bits, a bit is shown as P2.b4.',
    eeprom:
      "Read the EEPROM through the cluster and compare it with the chip image, assuming word w is the chip's bytes 2w and 2w+1 (unmeasured).",
    needles: 'Move each needle up in steps of 10 degrees and back, holding at each step.',
    lamps: 'Light the lamps one at a time. Record whether you saw each.',
    outputs: 'Drive the four bits of the output port one at a time (KOMBI46 only).',
    gong: 'Sound the gong once.',
    piezo: 'Sound the piezo once.',
    release: 'After STOP ends the session, record whether the needles and lamps went back to the cluster.',
  },

  notCompared: {
    'no-reference': 'No chip image to compare with (none read here, and no record).',
    'no-field': 'The chip image has no such field.',
    unreadable: "The cluster's reply could not be read.",
  },

  refused: {
    'not-allowed': 'This tool does not send that.',
    'wrong-length': 'Not sent: the wrong length.',
    'variant-unknown': 'Not sent until the variant is known.',
    'not-on-this-variant': 'This variant has no such telegram.',
    'bench-unconfirmed': 'The bench has not been confirmed.',
    'out-of-range': 'Not sent: a value out of range.',
    'step-too-large': 'Not sent: a needle move larger than 10 degrees.',
  },

  noWebSerial: 'This browser has no Web Serial. Open the tool in desktop Chrome or Edge.',
  unoRefused:
    'That is an Arduino (UNO) port. TEST talks to the cluster through the K+DCAN cable - never connect the UNO to the cluster.',
  noIdent: (detail: string) => `The cluster does not answer IDENT. Check the wiring, KL15 and the cable's switch. (${detail})`,
  connected: (variant: string) => `Connected to the cluster: ${variant}`,
  practiceConnected: 'PRACTICE: connected to a simulated cluster. Nothing is sent to hardware.',
  sessionEnded: 'Session ended (9F). The cluster takes its needles and lamps back.',
  sessionEndUnanswered: 'The session end (9F) was not answered. Check the cluster by eye.',
  linkLost: (detail: string) => `Lost the cable. (${detail})`,
  commanded: 'What was commanded - not what the cluster is actually showing.',
  releaseQuestion: 'After STOP, did the needles and lamps go back to the cluster?',
  reportNote: 'The report downloads as JSON. It is not SYNCed.',
  mappingNote: "word w = chip bytes 2w, 2w+1 (assumed)",
  referenceFrom: (label: string) => `Compared with: ${label}`,
  noReference: 'Nothing to compare with. Read the chip, or keep a record, and TEST compares.',
};

export function tc(): typeof JA {
  return getLang() === 'ja' ? JA : EN;
}
