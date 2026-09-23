/**
 * The bench vocabulary: workflow steps, the assembly guide, the wiring notes
 * and the parts list.
 *
 * Kept out of lib/i18n.ts rather than folded into it: this is thirty-odd keys
 * of its own subject matter, and the two files are edited by different kinds of
 * change. i18n.ts is the instrument's chrome; this is the procedure.
 *
 * Same rules as i18n.ts. EN is typed FROM JA so a missing key fails the build,
 * and JA is deliberately not `as const` (literal types would force EN to repeat
 * the Japanese strings). Uppercase technical shorthand is not translated.
 */

import { getLang } from '@/lib/i18n';

const JA = {
  /* ---- workflow strip ---- */

  blockedNeedConnection: 'Arduino を接続してください',

  noRecordsHint: 'チップから読んだイメージと、チップへ書いたイメージがここに残ります。',

  /* 復旧はフォーク元 README の原則を新品チップに当てはめたもの。
     ・0x20–0x3FF はバックアップから（新品は全FFで、クラスターのデータが無い）
     ・VIN の欄（0x07A のコーディング側と 0x184 付近の ASCII）はバックアップのまま複製する。
       README の「0x2E8 を 0xFF に」は VIN ではない場所を消す指示だった（vin.ts）
     ・走行距離は書かない（README: 新クラスターの距離は車両より低く。0 は常に低い）
     以前は「バックアップ不要・VIN 8バイトだけ」を標準と称していた。それでは
     標準領域が全FFのままで、車両が戻すのは距離と VIN だけなので復旧しない。 */
  /* 同期は無条件ではない。「正しくコーディングされていれば」が付くうえ、VIN が
     一致しないと距離が進まないという報告もある。 */
  /* ブランクでないチップ向け。走行距離に触れないので何度でもやり直せ、
     「書いて、置いて、読み直す」でデータ保持そのものを試せる。 */
  /* 固定マップは作れない（実チップ4枚に共通の領域が無い）。だからバイト列から
     観測できることだけを出す。0x2E8=VIN と決め打って8バイト消していた失敗の再発防止。 */
  structNote:
    'バイト列から検出した内容です。E46 KOMBI の固定マップではありません（実チップ4枚を比べても共通の領域がなく、固定マップは推測になります）。行をクリックするとHEXがその位置に移動します。',
  structSecureNote: '走行距離。増加方向にのみ書き込み可',
  structRepeatNote: (hex: string, copies: number, stride: number) =>
    `${hex} が ${copies} 箇所（間隔 ${stride}）。1つ失っても残りで復元できます`,
  structRunNote: (len: number, value: number) =>
    `0x${value.toString(16).toUpperCase().padStart(2, '0')} が ${len} バイト連続`,

  /* ---- what this chip allows ---- */
  recTitle: 'このチップでできること',
  /* 同じ「ブランクチップ」でも、タブによって意味が変わる。書き換えタブでは
     「任意の値にできる」が答えだが、復旧タブでそれを言うと、すぐ下の
     「走行距離はこのツールから書かない」と正面から矛盾する。 */
  recRestoreReady: 'ブランクチップです。0 km から任意の値へ設定できます。',
  recRewritePossible: (cur: number, target: number) =>
    `現在 ${cur.toLocaleString()} km。目標 ${target.toLocaleString()} km は上げるだけで届くので、チップ交換は不要です。`,
  recNeedsNewChip: (cur: number, target: number) =>
    `現在 ${cur.toLocaleString()} km で、目標 ${target.toLocaleString()} km より進んでいます。セキュア領域は下げられないため、新品チップへの交換が必要です。`,

  /* ---- assembly guide ---- */
  stepOf: (n: number, total: number) => `ステップ ${n} / ${total}`,

  g1Title: '部品を揃える',
  g1Body: '下のパーツリストから必要なものを選びます。復旧（0 km 化）を行う場合のみ新品の M35080 が要ります。走行距離を上げるだけなら不要です。',
  g1Done: '部品が手元にある',

  g2Title: 'メーターを開けて M35080 を探す',
  g2Body: 'クラスターを分解し、基板上の8本足の IC を探します。表面に M35080 / 35080V6 / 080D0WQ のいずれかが刻印されています。',
  g2Done: '刻印を読めた',

  g3Title: 'チップを外す（または新品を用意する）',
  g3Body: 'ホットエアで SO8 を外します。基板に残さず作業したい場合や、0 km から始めたい場合は、代わりに新品チップを使います。',
  g3Done: 'チップが手元で自由に扱える',

  g4Title: 'アダプタに載せる',
  g4Body: '150 mil の SOP8→DIP8 アダプタに装着します。200 mil 品では足が合いません。1番ピン（切り欠き側）の向きを合わせてください。',
  g4Done: 'アダプタがブレッドボードに挿さっている',

  g5Title: '電源を配線する',
  g5Body:
    'UNO の 5V を赤レール、GND を青レールへ。上下のレールは右端でつないでおきます。8番 VCC の列から赤レールへ、1番 VSS の列から青レールへ。0.1µF は赤青レール間（チップの近く）、10kΩ は 2番 S の列から赤レールへ入れます。5番は NC で何も接続しません。',
  g5Done: '電源2本とパッシブ2点が入った',

  g6Title: '信号線を配線する',
  g6Body: '残り5本をつなぎます。線の色は参照実装のコメントに合わせてあるので、元リポジトリの写真と見比べられます。',
  g6Done: '5本すべてがつながった',

  g7Title: 'ファームを書き込み、接続する',
  g7Body: 'firmware/m35080_bridge をArduino IDE で UNO へ書き込みます。書き込み後、この画面の「接続」を押してポートを選びます。',
  g7Done: 'BRIDGE にバージョンが表示された',

  /* ---- wiring ---- */
  bbColumnNote: '縦5穴＝内部でつながって1点／赤・青のレールは横一列でつながっています',
  unoPoweredByUsbShort: '電源はUSB（PCから）',
  unoPower:
    'Arduino UNO の電源は PC につなぐ USB ケーブルです。外部電源は要りません。UNO の「5V」ピンは入力ではなく出力で、そこから M35080 へ 5V を供給します。',
  wiringNotStandard:
    'M35080 は一般的な 25xx 系とピン配置が異なります。GND は1番、HOLD ピンはありません。',
  wiringVoltage:
    '3.3V のボード（ESP32 / RP2040 など）では動きません。このチップは 4.5〜5.5V が必要で、レベル変換なしでは MCU 側を壊す恐れがあります。',

  /* ---- parts list ---- */
  partsOpen: (n: number) => `選択した ${n} 件を開く`,
  partsOpenNext: (i: number, n: number) => `次を開く（${i} / ${n}）`,
  partsOpenDone: 'すべて開きました',
  partsNoneSelected: '商品を選んでください',
  partsCartNote:
    'AliExpress には公式のカート追加 API がないため、選んだ商品を1件ずつ開きます。各ページでカートに入れてください。',
  partsPriceAsOf: (iso: string) =>
    `価格取得: ${iso.slice(0, 10)}　最新価格は AliExpress でご確認ください`,
  partsNoPrice: '価格は AliExpress でご確認ください',
  partsSearchFallback: '商品未選定のため検索結果を開きます',

  /** 景表法ステマ規制。フッターではなくリスト直上のファーストビューに出す。 */
  adDisclosure:
    '【広告】このリストのリンクはアフィリエイトリンクです。リンク経由の購入により当サイトが収益を得る場合があります。',

  /* part names, keyed by the id in data/parts.json */
  pM35080Blank: 'M35080 新品チップ',
  pArduinoUno: 'Arduino UNO',
  pAdapter: 'SOP8→DIP8 アダプタ（150 mil）',
  pBreadboard: 'ブレッドボード',
  pJumpers: 'ジャンパワイヤ（オス-オス）',
  pCap: 'セラミックコンデンサ 0.1µF',
  pRes: '抵抗 10kΩ',
  pIron: 'はんだごて',
  pHotAir: 'ホットエア リワークステーション',
  pFlux: 'フラックス',

  /* notes attached to specific parts */
  nRestoreOnly: '復旧（0 km 化）を行う場合のみ',
  nNot200: '200 mil 品は不可',
  nDesolderSo8: 'SO8 の取り外しに使用',
  /* --------------------------- address meanings --------------------------- */


  mapOdoNote:
    'M35080 のセキュア領域。16 個の 16 ビットレジスタがビッグエンディアンで並びます。' +
    'これはチップのデータシートで決まっている配置なので、車種によらず同じです。',
  mapOdoLegend: (base: number, bumped: number) =>
    `ベース値 0x${base.toString(16).toUpperCase()}（${base.toLocaleString()}）が 1 ステップ 16 km。` +
    `そこから +1 されたレジスタが ${bumped} 個あり、これが 1 km 単位の端数になります。` +
    'ハードウェア的に増加しかできないため、下げられません。',
  mapOdoUndecodable: (reason: string) => `この領域は解読できません（${reason}）`,

  mapVinNote:
    'チップに入っているのは VIN（17 桁）の最後の 7 桁（11〜17 桁目）で、欄が 2 つあり得ます。' +
    'CODED はコーディング側の欄で、チェックサムで確認できたレイアウトのときだけ 0x07A〜0x07E を読みます。' +
    'ASCII は大文字英数字が 7 文字以上続く箇所を探した末尾 7 文字です（実チップでは 0x184〜0x18A、0x18B が NUL）。',
  checksumNote:
    'このレイアウトには 2 つのチェックサムがあります。0x16E は 0x070〜0x16D の XOR、' +
    '0x3CD は 0x310〜0x3CC の XOR で、0x3DF にも同じ値が入ります。実チップ 2 個で成り立つことを確かめています。',
  checksumUnknown:
    'チェックサムで確認できるレイアウトではないため、検査していません（旧世代のクラスターや、由来の分からないファイル）。',
  checksumBrokenAt: (list: string) => `合っていないチェックサム: ${list}`,
  inspectSaveBroken: (list: string) =>
    `チェックサムが合っていません（${list}）。このファイルをチップに書くと、メータが受け付けない可能性があります。` +
    'FIX CHECKSUMS で直さずに、このまま保存しますか？',
  mapVinCoded:
    '0x07A〜0x07E: 英数字 2 文字のあとに数字 5 桁（BCD）。0x07E の下位 4 ビットは VIN ではありません。' +
    'この欄は 0x16E のチェックサムの範囲に入っているため、書き換えるとチェックサムも計算し直します。',
  mapVinDiffer:
    '2 つの欄の VIN が違います。メータがどちらを使うかは TEST（DS2 の VIN 読み出し）で確かめられます。' +
    'REWRITE で VIN を書くときは、両方の欄を同じ VIN にそろえます。',
  mapVinNone:
    'このチップに VIN はありません。新品チップはこの状態が正常で、' +
    '車両接続後に NCS Expert で書き込みます。',
  mapVinOthers: (others: string[]) => `他の候補: ${others.join(' / ')}`,
  mapVinLead: (at: string, text: string) =>
    `${at} の "${text}" は英大文字ですが VIN ではありません（VIN の 10 桁目でもありません）。読み取りにも書き込みにも含めません。`,

  mapRestNote:
    'ここでは命名しません。実チップ 4 個を 1 バイトずつ比較したところ、' +
    '0xFF を除いて全個体で一致するアドレスは 1 つもありませんでした。' +
    '固定マップは作れません。バイトの「形」については構造パネルを参照してください。',
  /* ------------------------------ file inspect ---------------------------- */


  inspectIntro:
    '手元の .BIN を読み込み、中身を確認して編集できます。実機は不要です。',
  inspectNoDevice:
    'ここで開いたファイルはチップとは切り離されています。書き込み経路には入りません。' +
    'ファイルをチップへ書くのは「復旧」タブで、そちらはバックアップと読み戻しで守られています。',
  inspectClose: '閉じる',

  inspectNotAChip: (v: number) =>
    `1024 バイトすべてが 0x${v.toString(16).toUpperCase().padStart(2, '0')} です。` +
    'これはチップの読み取りではありません（配線が浮いている、D11とD12が直結、' +
    'などのバス側の結果）。ここから読める走行距離も VIN も意味を持ちません。',
  inspectDistinct: (n: number) => `異なるバイト値 ${n} 種`,
  inspectErased: '標準領域は全 FF（消去済み）',
  chipBlankShort: 'セキュア領域は 0（新品）',
  inspectNoReadout:
    'このファイルからは走行距離も VIN も構造も表示しません。'
    + '解読はできてしまいますが、その値は配線の状態であってチップの内容ではないためです。'
    + 'HEX ビューと編集は使えます。',

  inspectPickByte: 'HEX ビューでバイトを選んでください。',
  inspectChanged: (n: number) => `元ファイルとの差分 ${n} バイト`,
  inspectUnchanged: '元ファイルと同一',
  inspectSaveNote:
    '保存は必ず別名です。元ファイルには上書きしません — そのダンプが、' +
    '既に書き換えたチップの唯一の記録であることがあるためです。',
  inspectPracticeChip:
    'このファイル（今の編集を含む）を PRACTICE の模擬チップにします。次の PRACTICE の CONNECT から、このイメージを読みます。実機には何も書きません。',
  inspectPracticeArmed: '次の PRACTICE の CONNECT で読みます。接続中のチップは変わりません。',
};

const EN: typeof JA = {

  blockedNeedConnection: 'Connect the Arduino first',

  noRecordsHint: 'Every image read from or written to a chip is kept here.',

  structNote:
    'Read out of the bytes themselves. This is not a fixed map of the E46 KOMBI - four real chips ' +
    'were compared and no region was common to all of them, so a fixed map would be a guess. ' +
    'Click a row to jump the hex view there.',
  structSecureNote: 'the odometer; writable upward only',
  structRepeatNote: (hex: string, copies: number, stride: number) =>
    `${hex} stored ${copies} times (stride ${stride}) - one lost copy is survivable`,
  structRunNote: (len: number, value: number) =>
    `0x${value.toString(16).toUpperCase().padStart(2, '0')} repeated ${len} bytes`,

  recTitle: 'What this chip allows',
  recRestoreReady: 'A blank chip. It reads 0 km and can be taken to any value upward.',
  recRewritePossible: (cur: number, target: number) =>
    `Currently ${cur.toLocaleString()} km. The target ${target.toLocaleString()} km is reachable by raising it, so no chip swap is needed.`,
  recNeedsNewChip: (cur: number, target: number) =>
    `Currently ${cur.toLocaleString()} km, which is above the target ${target.toLocaleString()} km. The secure area cannot be lowered, so this needs a new chip.`,

  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,

  g1Title: 'Gather the parts',
  g1Body: 'Pick what you need from the list below. A new M35080 is only required for a restore (0 km); raising the mileage needs no new chip.',
  g1Done: 'The parts are on the bench',

  g2Title: 'Open the cluster and find the M35080',
  g2Body: 'Take the cluster apart and find the 8-pin IC on the board. It is marked M35080, 35080V6 or 080D0WQ.',
  g2Done: 'You can read the marking',

  g3Title: 'Remove the chip (or take a new one)',
  g3Body: 'Lift the SO8 with hot air. If you would rather not work on the board, or you want to start from 0 km, use a new chip instead.',
  g3Done: 'The chip is loose and handleable',

  g4Title: 'Seat it in the adapter',
  g4Body: 'Use the 150 mil SOP8-to-DIP8 adapter; the 200 mil one does not fit. Match pin 1 to the notch.',
  g4Done: 'The adapter is seated in the breadboard',

  g5Title: 'Wire the power',
  g5Body:
    "UNO 5V to the red rail, GND to the blue rail, and bridge the top rails to the bottom ones at the right-hand end. Pin 8 VCC's column to the red rail, pin 1 VSS's column to the blue rail. The 0.1uF goes between the red and blue rails beside the chip, and the 10k from pin 2 (S)'s column up to the red rail. Pin 5 is NC - leave it open.",
  g5Done: 'Two power wires and two passives are in',

  g6Title: 'Wire the signals',
  g6Body: 'Run the remaining five. The colours match the reference sketch’s own comments, so you can compare against the photographs in that repository.',
  g6Done: 'All five are connected',

  g7Title: 'Flash the bridge and connect',
  g7Body: 'Upload firmware/m35080_bridge to the UNO with the Arduino IDE, then press CONNECT here and pick the port.',
  g7Done: 'BRIDGE shows a version',

  bbColumnNote: 'Five holes in a column are one node; each rail is one node along its length',
  unoPoweredByUsbShort: 'Powered by USB (from the PC)',
  unoPower:
    'The UNO is powered by the USB cable to your PC - there is no separate supply to connect. Its "5V" pin is an OUTPUT, and that is what feeds the M35080.',
  wiringNotStandard:
    'The M35080 is not the standard 25xx pinout. GND is pin 1, and there is no HOLD pin.',
  wiringVoltage:
    'A 3.3 V board (ESP32, RP2040) will not do. This chip needs 4.5-5.5 V, and without level shifting its output can damage the MCU.',

  partsOpen: (n: number) => `Open ${n} selected`,
  partsOpenNext: (i: number, n: number) => `Open next (${i} of ${n})`,
  partsOpenDone: 'All opened',
  partsNoneSelected: 'Select some parts first',
  partsCartNote:
    'AliExpress has no public add-to-cart API, so selected items open one at a time. Add each to your cart on its own page.',
  partsPriceAsOf: (iso: string) =>
    `Prices fetched ${iso.slice(0, 10)}. Check AliExpress for the current price.`,
  partsNoPrice: 'Check AliExpress for the price',
  partsSearchFallback: 'No product chosen yet - opens a search',

  adDisclosure:
    'AD - The links in this list are affiliate links. We may earn a commission on purchases made through them.',

  pM35080Blank: 'M35080 blank chip',
  pArduinoUno: 'Arduino UNO',
  pAdapter: 'SOP8-to-DIP8 adapter (150 mil)',
  pBreadboard: 'Breadboard',
  pJumpers: 'Jumper wires (male-male)',
  pCap: 'Ceramic capacitor 0.1uF',
  pRes: 'Resistor 10k',
  pIron: 'Soldering iron',
  pHotAir: 'Hot air rework station',
  pFlux: 'Flux',

  nRestoreOnly: 'Only for a restore (0 km)',
  nNot200: 'Not the 200 mil version',
  nDesolderSo8: 'For lifting the SO8',
  /* --------------------------- address meanings --------------------------- */


  mapOdoNote:
    "The M35080's secure area: sixteen 16-bit registers, big-endian. This " +
    'layout comes from the chip datasheet, not from BMW, so it is the same in ' +
    'every car.',
  mapOdoLegend: (base: number, bumped: number) =>
    `The base value 0x${base.toString(16).toUpperCase()} (${base.toLocaleString()}) ` +
    `counts 16 km a step. ${bumped} register(s) hold base + 1, and that is the ` +
    '1 km remainder. The registers only count up in hardware, so this cannot be lowered.',
  mapOdoUndecodable: (reason: string) => `This area cannot be decoded (${reason})`,

  mapVinNote:
    'The chip holds the last 7 characters of the 17-character VIN (positions 11-17), and it can ' +
    'hold them in two fields. CODED is the coding field at 0x07A-0x07E, read only when the layout is ' +
    "confirmed by its checksums. ASCII is found by scanning for a run of 7 or more uppercase " +
    "alphanumerics and taking the run's last 7 (on the real chip: 0x184-0x18A, NUL at 0x18B).",
  checksumNote:
    'This layout carries two checksums. 0x16E is the XOR of 0x070-0x16D; 0x3CD is the XOR of ' +
    '0x310-0x3CC, and 0x3DF holds the same value. Both are confirmed on two real chips.',
  checksumUnknown:
    'Not a layout its checksums can confirm, so nothing was checked (an older-generation cluster, or a file of unknown origin).',
  checksumBrokenAt: (list: string) => `Checksums that do not hold: ${list}`,
  inspectSaveBroken: (list: string) =>
    `The checksums do not hold (${list}). A chip written from this file may be rejected by the cluster. ` +
    'Save it as it is, without FIX CHECKSUMS?',
  mapVinCoded:
    '0x07A-0x07E: two letters or digits, then five digits as BCD. The low nibble of 0x07E is not ' +
    'part of the VIN. The field is inside the 0x16E checksum region, so rewriting it recomputes that byte.',
  mapVinDiffer:
    'The two fields hold different VINs. Which one the cluster uses can be checked on TEST (the DS2 ' +
    'VIN read). A VIN rewrite on REWRITE sets both fields to the same VIN.',
  mapVinNone:
    'This chip carries no VIN. That is the correct state for a new one: the VIN ' +
    'is coded in with NCS Expert once the car is connected.',
  mapVinOthers: (others: string[]) => `Other candidates: ${others.join(' / ')}`,
  mapVinLead: (at: string, text: string) =>
    `"${text}" at ${at} is an uppercase letter but not part of the VIN (nor its 10th character). It is never read or written as VIN.`,

  mapRestNote:
    'Not named here. Four real chips were compared byte for byte and, outside ' +
    '0xFF, not one address held the same value on all four - so there is no ' +
    'fixed map to write down. The structure panel reports their shape instead.',
  /* ------------------------------ file inspect ---------------------------- */


  inspectIntro:
    'Load a .BIN from disk, see what is in it, and edit it. No hardware needed.',
  inspectNoDevice:
    'A file opened here is kept apart from the chip and cannot reach the write ' +
    'path. Writing a file TO a chip is the RESTORE tab, which is guarded by a ' +
    'backup and a read-back.',
  inspectClose: 'Close',

  inspectNotAChip: (v: number) =>
    `All 1024 bytes are 0x${v.toString(16).toUpperCase().padStart(2, '0')}. ` +
    'This is not a chip read - it is the bus (a floating wire, or D11 shorted ' +
    'to D12). Any odometer or VIN read out of it means nothing.',
  inspectDistinct: (n: number) => `${n} distinct byte values`,
  inspectErased: 'standard array all FF (erased)',
  chipBlankShort: 'secure area is zero (new)',
  inspectNoReadout:
    'No odometer, VIN or structure is shown for this file. It would decode - '
    + 'that is the problem - but the value would describe the wiring, not a chip. '
    + 'The hex view and the editor still work.',

  inspectPickByte: 'Pick a byte in the hex view.',
  inspectChanged: (n: number) => `${n} byte(s) differ from the file`,
  inspectUnchanged: 'identical to the file',
  inspectSaveNote:
    'A save always writes a new name, never the source. These dumps are often ' +
    'the only record of a chip that has since been written over.',
  inspectPracticeChip:
    'Make this file, with its edits, the PRACTICE chip. The next PRACTICE CONNECT reads this image. Nothing touches hardware.',
  inspectPracticeArmed: 'The next PRACTICE CONNECT reads it. A chip already connected is not replaced.',
};

/** Read the bench copy for the currently resolved language. */
export function g(): typeof JA {
  return getLang() === 'ja' ? JA : EN;
}

/** Part id (data/parts.json) -> display name. */
export function partName(id: string): string {
  const c = g();
  const map: Record<string, string> = {
    'm35080-blank': c.pM35080Blank,
    'arduino-uno': c.pArduinoUno,
    'sop8-adapter-150mil': c.pAdapter,
    breadboard: c.pBreadboard,
    'jumper-wires': c.pJumpers,
    'cap-100nf': c.pCap,
    'res-10k': c.pRes,
    'soldering-iron': c.pIron,
    'hot-air': c.pHotAir,
    flux: c.pFlux,
  };
  return map[id] ?? id;
}

/** Optional note key on a part -> display text. */
export function partNote(note: string | undefined): string | null {
  if (!note) return null;
  const c = g();
  const map: Record<string, string> = {
    'restore-only': c.nRestoreOnly,
    '150mil-not-200': c.nNot200,
    'desolder-so8': c.nDesolderSo8,
  };
  return map[note] ?? null;
}
