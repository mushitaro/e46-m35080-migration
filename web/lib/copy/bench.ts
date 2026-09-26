/**
 * The TEST bench's prose: the procedure, the notes beside the wiring, the parts.
 *
 * A file of its own for the same reason guide.ts is one: its own subject matter, changed by its
 * own kind of edit. docs/BENCH.md says the same things for a reader of the repository; the steps
 * here and the steps there are the same seven, in the same order.
 *
 * Same rules as guide.ts: EN is typed FROM JA so a missing key fails the build; uppercase
 * technical words (KL15, OBD, K+DCAN, CONNECT, STOP) are not translated.
 */

import { getLang } from '@/lib/i18n';

const JA = {
  /* ---- the procedure: what to do, and how you know it is done ---- */
  b1Title: '部品を揃える',
  b1Body: '部品表のものを机に揃え、ヒューズをホルダに入れておきます。電源は切ったままにします。',
  b1Done: '必須の部品がすべて手元にある',

  b2Title: '電源をつなぐ',
  b2Body:
    'ヒューズホルダの線の片方を電源の + 端子へ、もう片方を +12V のレバー式コネクタへ差します。' +
    '電源の − から GND のコネクタへ 1 本つなぎます。',
  b2Done: '他に何もつながずに電源を入れると、+12V と GND のコネクタの間が 12V。ヒューズを抜くと 0V',

  b3Title: 'メータ側のプラグ',
  b3Body:
    'ピッグテールの 4 番（KL30）・5 番（KL15）・6 番（KL R）を +12V のコネクタへ、1 番を GND のコネクタへ差します。' +
    'どの線かは図の線色で見当を付けます。使わない線は先端を絶縁します。メータの基板にははんだ付けしません。' +
    '先に、自分のメータでピン番号を確かめてください。',
  b3Done: '電源を切った状態で、各ピンが自分のコネクタと導通し、+12V と GND の間は導通しない',

  b4Title: 'OBD ソケット',
  b4Body:
    'ソケットの穴が何番かは、ケーブルのプラグを挿す向きに向かい合わせ、プラグの刻印で決めます（プラグの 16 番が入る穴が 16 番）。' +
    'ピッグテールのどの線がどの穴かは、テスターの導通で確かめます（線色では決めない）。' +
    '16 番を +12V、4 番と 5 番を GND のコネクタへ差します。7 番とメータ側の 25 番は、2 口のコネクタで 1 つにつなぎます。' +
    '使わない線は先端を絶縁します。',
  b4Done: '電源を入れると、差し込む側の接点で OBD 16 と OBD 4・5 の間が 12V。OBD 7 とメータ側の 25 番が導通する',

  b5Title: 'K+DCAN をつなぐ',
  b5Body: 'ケーブルを OBD ソケットに差し、切り替えスイッチは E46 で使っている位置（K-line）のまま、USB を PC へつなぎます。',
  b5Done: 'PC にケーブルの USB シリアルポートが現れる',

  b6Title: '通電する',
  b6Body:
    '電源の出力を入れます。KL30・KL15・KL R が同時に入り、キーを回したときと同じ状態になります。' +
    '切るときは、STOP で診断を終えてから出力を切ります。',
  b6Done: 'メータが点灯して電球チェックが走り、ヒューズが切れない',

  b7Title: 'CONNECT',
  b7Body: 'TEST タブの CONNECT で、ケーブルのポートを選びます。',
  b7Done: 'メータの部品番号とバリアント（KOMBI46 / KOMBI46R）が表示される',

  /* ---- beside the wiring ---- */
  pinsUnverified:
    'メータ側のピン番号・その位置・線色（X11175）は、公開されている資料の 1 つ（bmwgm5）によるもので、' +
    '実物ではまだ確かめていません。電源を入れる前に、自分のメータのコネクタでテスターを使って確かめてください。',
  polarity: '電源の + と − を、両方のコネクタで確かめてから、メータのプラグをつないでください。',
  kLinePins:
    'E46 の診断線は 2 本で、OBD 7 番がエンジン・変速機（TXD2）、8 番がメータを含むそれ以外（TXD1）です。' +
    '車ではケーブルの切り替えスイッチ（K-line 側）が 7・8 番を短絡して、8 番のメータに届きます。' +
    'ベンチではメータの 25 番（TXD1）を、ケーブル自身の K-line である 7 番へ直接つなぐので、8 番は使いません。',
  fuseAlways: 'ヒューズは必ず入れてください。配線を間違えたとき、メータの代わりに切れるのはヒューズだけです。',
  noUno: 'UNO はメータにつながないでください。TEST は UNO のポート（USB ベンダー 0x2341）を使いません。',
  benchLamps:
    'CAN の相手がいない机上では、警告灯がいくつか点いたままになることがあります。故障ではありません。' +
    'ランプの確認では、1 つずつ点けて、見えたかどうかを記録します。',
  leverNode: 'レバー式コネクタは 1 個が 1 つのノードです。どの口に差しても同じです。',
  obdView: '差し込む側から見た向き',
  obdFace: 'OBD ソケットは差し込む側・幅の広い辺が上の向き（1 番が左上）。裏側とケーブルのプラグは左右が逆（1 番が右上）。',
  clusterFace: 'メータのコネクタは、メータを裏から見た向きです（bmwgm5 の写真と同じ）。外したプラグを差し込み面から見ると左右が逆です。',
  wireLetters: '線色は BMW の略記で、先頭が地の色：SW 黒・BR 茶・RT 赤・GE 黄・GN 緑・BL 青・VI 紫・WS 白',

  /* ---- parts (data/bench-parts.json) ---- */
  pPsu: '12V 安定化電源（1A 以上）',
  pFuse: 'ヒューズホルダ（線付き）+ 1A ヒューズ',
  pObd: 'OBD-II 16 ピン メスソケット（線付き）',
  pClusterPlug: 'メータのコネクタ X11175 の相手側（黒・26 ピン）',
  pLever5: 'レバー式コネクタ 5 口（WAGO 221-415 など）',
  pLever2: 'レバー式コネクタ 2 口（WAGO 221-412 など）',
  pWire: '配線材',
  pKdcan: 'K+DCAN ケーブル',
  pMeter: 'テスター（マルチメータ）',
  nCurrentLimit: '電流制限付きを推奨。制限は 1A 付近に設定',
  nFuseInFeed: '電源の + 側、すべての手前に入れる',
  nPigtail: '中古ハーネスのピッグテールを推奨。メータの基板には直接はんだ付けしない',
  nKdcanOwned: '車で使っているもの',
  nLeverRails: '+12V と GND に 1 個ずつ。テスト穴にテスターを当てて測れる',
  nLeverKline: 'OBD 7 とメータ側 25 番の中継',
};

const EN: typeof JA = {
  b1Title: 'Gather the parts',
  b1Body: 'Everything on the list on the desk, the fuse in its holder. The supply stays off.',
  b1Done: 'Every required part is at hand',

  b2Title: 'Wire the supply',
  b2Body:
    'One lead of the fuse holder to PSU +, the other into the +12 V lever connector. ' +
    'One wire from PSU − into the ground connector.',
  b2Done: 'With nothing else connected and the supply on, the +12 V connector reads 12 V to the ground connector - and 0 V with the fuse out',

  b3Title: 'The cluster plug',
  b3Body:
    'On the pigtail: pins 4 (KL30), 5 (KL15) and 6 (KL R) into the +12 V connector, pin 1 into the ground connector. ' +
    "The diagram's wire colours tell you which wire is which. Insulate the ends you do not use. " +
    "Never solder to the cluster's board. Check each pin number on your own cluster first.",
  b3Done: 'With the supply off, each plug pin is connected to its connector, and nothing connects +12 V to ground',

  b4Title: 'The OBD socket',
  b4Body:
    "Number the socket's holes from the cable's plug: hold it face to face as it goes in, and the hole its pin 16 enters is 16. " +
    'Find which pigtail wire goes to which hole with a meter, not by its colour. ' +
    '16 into +12 V, 4 and 5 into ground. 7 and cluster pin 25 meet in the two-port connector. ' +
    'Insulate the ends you do not use.',
  b4Done: "With the supply on, OBD 16 reads 12 V to OBD 4 and 5 at the socket's front contacts, and OBD 7 has continuity to cluster pin 25",

  b5Title: 'Plug in the K+DCAN',
  b5Body: 'The cable into the socket, its switch where it sits on your E46 (K-line), USB to the PC.',
  b5Done: "The PC lists the cable's USB serial port",

  b6Title: 'Power on',
  b6Body:
    'Supply output on. KL30, KL15 and KL R come on together, as with the key turned. ' +
    'To switch off, STOP the session first, then the output.',
  b6Done: 'The cluster lights up, runs its bulb check, and the fuse holds',

  b7Title: 'CONNECT',
  b7Body: "In the TEST tab, press CONNECT and choose the cable's port.",
  b7Done: "The cluster's part number and its variant (KOMBI46 / KOMBI46R) are shown",

  pinsUnverified:
    "The cluster's pin numbers, where they sit and their wire colours (X11175) come from one public source (bmwgm5) " +
    "and have not been checked on a real cluster yet. Before power, check them on your own cluster's connector with a meter.",
  polarity: 'Check + and − at both connectors before the cluster plug goes on.',
  kLinePins:
    'The E46 has two diagnostic lines: OBD 7 for the engine and gearbox (TXD2), OBD 8 for everything else, the cluster among them (TXD1). ' +
    "In the car the cable's switch, on K-line, bridges 7 and 8 to reach the cluster on 8. " +
    "On the bench the cluster's pin 25 (TXD1) goes straight to 7, the cable's own K-line, and 8 is not used.",
  fuseAlways: 'Always fit the fuse. If something is miswired, it is the only thing that fails instead of the cluster.',
  noUno: "Never connect the UNO to the cluster. TEST will not use the UNO's port (USB vendor 0x2341).",
  benchLamps:
    'With no CAN partners on the bench, some warning lamps may stay lit. That is the bench, not a fault. ' +
    'The lamp check lights each lamp on its own and records whether you saw it.',
  leverNode: 'A lever connector is one node: any of its ports will do.',
  obdView: 'seen from the plug-in side',
  obdFace: "OBD socket: plug-in side, wide edge up, 1 top left. Its back and the cable's plug are mirrored.",
  clusterFace: "Cluster connector: from the cluster's back, as bmwgm5's photo; an unplugged plug's face is mirrored.",
  wireLetters: 'Wire colours, base first: SW black, BR brown, RT red, GE yellow, GN green, BL blue, VI violet, WS white',

  pPsu: '12 V bench supply (1 A or more)',
  pFuse: 'Inline fuse holder with leads + 1 A fuse',
  pObd: 'OBD-II 16-pin female socket with leads',
  pClusterPlug: 'Mating plug for the cluster connector X11175 (black, 26 pins)',
  pLever5: '5-port lever connector (WAGO 221-415 or similar)',
  pLever2: '2-port lever connector (WAGO 221-412 or similar)',
  pWire: 'Hookup wire',
  pKdcan: 'K+DCAN cable',
  pMeter: 'Multimeter',
  nCurrentLimit: 'Current-limited is best; set the limit near 1 A',
  nFuseInFeed: 'On the + side, before everything else',
  nPigtail: "A pigtail from a used harness. Never solder to the cluster's board",
  nKdcanOwned: 'The one you use on the car',
  nLeverRails: 'One for +12 V, one for ground. A meter probe fits the test slot',
  nLeverKline: 'Joins OBD 7 to cluster pin 25',
};

export function b(): typeof JA {
  return getLang() === 'ja' ? JA : EN;
}

/** Part id (data/bench-parts.json) -> display name. */
export function benchPartName(id: string): string {
  const c = b();
  const map: Record<string, string> = {
    'bench-psu-12v': c.pPsu,
    'fuse-holder-1a': c.pFuse,
    'obd2-female-socket': c.pObd,
    'cluster-plug-x11175': c.pClusterPlug,
    'lever-connector-5': c.pLever5,
    'lever-connector-2': c.pLever2,
    'hookup-wire': c.pWire,
    'kdcan-cable': c.pKdcan,
    multimeter: c.pMeter,
  };
  return map[id] ?? id;
}

export function benchPartNote(note: string | undefined): string | null {
  if (!note) return null;
  const c = b();
  const map: Record<string, string> = {
    'current-limit': c.nCurrentLimit,
    'fuse-in-feed': c.nFuseInFeed,
    'pigtail-not-board': c.nPigtail,
    'kdcan-owned': c.nKdcanOwned,
    'lever-rails': c.nLeverRails,
    'lever-kline': c.nLeverKline,
  };
  return map[note] ?? null;
}
