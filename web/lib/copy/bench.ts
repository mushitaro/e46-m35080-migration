/**
 * The TEST bench's prose: the procedure, the notes beside the wiring, the parts.
 *
 * A file of its own for the same reason guide.ts is one: its own subject matter, changed by its
 * own kind of edit. docs/BENCH.md says the same things for a reader of the repository; the steps
 * here and the steps there are the same eight, in the same order.
 *
 * Same rules as guide.ts: EN is typed FROM JA so a missing key fails the build; uppercase
 * technical words (KL15, OBD, K+DCAN, CONNECT) are not translated.
 */

import { getLang } from '@/lib/i18n';

const JA = {
  /* ---- the procedure: what to do, and how you know it is done ---- */
  b1Title: '部品を揃える',
  b1Body: '部品表のものを机に揃え、ヒューズをホルダに入れておきます。電源は切ったままにします。',
  b1Done: '必須の部品がすべて手元にある',

  b2Title: '電源をつなぐ',
  b2Body: '電源の + をヒューズホルダ経由で +12V の端子台へ、− を GND の端子台へつなぎます。',
  b2Done: '他に何もつながずに電源を入れると、+12V の端子台と GND の間が 12V。ヒューズを抜くと 0V',

  b3Title: 'スイッチをつなぐ',
  b3Body: '+12V の端子台からトグルスイッチを通して、KL15 の端子台へつなぎます。',
  b3Done: 'スイッチ ON で KL15 の端子台が 12V、OFF で 0V',

  b4Title: 'メータ側のプラグ',
  b4Body:
    '相手側プラグの 4 番を +12V、5 番と 6 番を KL15、1 番を GND の端子台へつなぎます。' +
    'メータの基板に直接はんだ付けはしません。先に、自分のメータでピン番号を確かめてください。',
  b4Done: '電源を切った状態で、各ピンが自分の端子台と導通し、+12V と GND の間は導通しない',

  b5Title: 'OBD ソケット',
  b5Body: '16 番を +12V、4 番と 5 番を GND、7 番をメータ側の 25 番へつなぎます。',
  b5Done: '電源を入れると OBD 16 と OBD 4・5 の間が 12V。OBD 7 とメータ側の 25 番が導通する',

  b6Title: 'K+DCAN をつなぐ',
  b6Body: 'ケーブルを OBD ソケットに差し、切り替えスイッチは E46 で使っている位置（K-line）のまま、USB を PC へつなぎます。',
  b6Done: 'PC にケーブルの USB シリアルポートが現れる',

  b7Title: '通電する',
  b7Body: '電源を入れ（KL30）、次にスイッチを入れます（KL15）。',
  b7Done: 'メータが点灯して電球チェックが走り、ヒューズが切れない',

  b8Title: 'CONNECT',
  b8Body: 'TEST タブの CONNECT で、ケーブルのポートを選びます。',
  b8Done: 'メータの部品番号とバリアント（KOMBI46 / KOMBI46R）が表示される',

  /* ---- beside the wiring ---- */
  pinsUnverified:
    'メータ側のピン番号（X11175）は、公開されているピン配置の 1 つ（bmwgm5）によるもので、' +
    '実物ではまだ確かめていません。電源を入れる前に、自分のメータのコネクタでテスターを使って確かめてください。',
  polarity: '電源の + と − を、両方の端子台で確かめてから、メータのプラグをつないでください。',
  fuseAlways: 'ヒューズは必ず入れてください。配線を間違えたとき、メータの代わりに切れるのはヒューズだけです。',
  noUno: 'UNO はメータにつながないでください。TEST は UNO のポート（USB ベンダー 0x2341）を使いません。',
  benchLamps:
    'CAN の相手がいない机上では、警告灯がいくつか点いたままになることがあります。故障ではありません。' +
    'ランプの確認では、1 つずつ点けて、見えたかどうかを記録します。',
  obdFace: 'OBD ソケットは差し込み面で描いています（車のダッシュ下で見える向き）。',
  clusterList: 'メータ側は物理的な並びが未確認のため、使うピンの一覧で描いています。',

  /* ---- parts (data/bench-parts.json) ---- */
  pPsu: '12V 安定化電源（1A 以上）',
  pFuse: 'ヒューズホルダ + 1A ヒューズ',
  pSwitch: 'トグルスイッチ（KL15 用）',
  pObd: 'OBD-II 16 ピン メスソケット（ブレイクアウト）',
  pClusterPlug: 'メータのコネクタ X11175 の相手側（黒・26 ピン）',
  pTerminals: '端子台',
  pWire: '配線材',
  pKdcan: 'K+DCAN ケーブル',
  pMeter: 'テスター（マルチメータ）',
  nCurrentLimit: '電流制限付きを推奨。制限は 1A 付近に設定',
  nFuseInFeed: '電源の + 側、すべての手前に入れる',
  nPigtail: '中古ハーネスのピッグテールを推奨。メータの基板には直接はんだ付けしない',
  nKdcanOwned: '車で使っているもの',
};

const EN: typeof JA = {
  b1Title: 'Gather the parts',
  b1Body: 'Everything on the list on the desk, the fuse in its holder. The supply stays off.',
  b1Done: 'Every required part is at hand',

  b2Title: 'Wire the supply',
  b2Body: 'PSU + through the fuse holder to the +12 V block; PSU − to the ground block.',
  b2Done: 'With nothing else connected and the supply on, the +12 V block reads 12 V to ground - and 0 V with the fuse out',

  b3Title: 'Wire the switch',
  b3Body: 'From the +12 V block through the toggle switch to the KL15 block.',
  b3Done: 'The KL15 block reads 12 V with the switch on and 0 V with it off',

  b4Title: 'The cluster plug',
  b4Body:
    'On the mating plug: pin 4 to +12 V, pins 5 and 6 to KL15, pin 1 to ground. Never solder to ' +
    "the cluster's board. Check each pin number on your own cluster first.",
  b4Done: 'With the supply off, each plug pin is connected to its block, and nothing connects +12 V to ground',

  b5Title: 'The OBD socket',
  b5Body: '16 to +12 V, 4 and 5 to ground, 7 to cluster pin 25.',
  b5Done: 'With the supply on, OBD 16 reads 12 V to OBD 4 and 5, and OBD 7 has continuity to cluster pin 25',

  b6Title: 'Plug in the K+DCAN',
  b6Body: 'The cable into the socket, its switch where it sits on your E46 (K-line), USB to the PC.',
  b6Done: "The PC lists the cable's USB serial port",

  b7Title: 'Power on',
  b7Body: 'Supply on (KL30), then the switch (KL15).',
  b7Done: 'The cluster lights up, runs its bulb check, and the fuse holds',

  b8Title: 'CONNECT',
  b8Body: "In the TEST tab, press CONNECT and choose the cable's port.",
  b8Done: "The cluster's part number and its variant (KOMBI46 / KOMBI46R) are shown",

  pinsUnverified:
    "The cluster's pin numbers (X11175) come from one public pinout (bmwgm5) and have not been " +
    "checked on a real cluster yet. Before power, check them on your own cluster's connector with a meter.",
  polarity: 'Check + and − at both blocks before the cluster plug goes on.',
  fuseAlways: 'Always fit the fuse. If something is miswired, it is the only thing that fails instead of the cluster.',
  noUno: "Never connect the UNO to the cluster. TEST will not use the UNO's port (USB vendor 0x2341).",
  benchLamps:
    'With no CAN partners on the bench, some warning lamps may stay lit. That is the bench, not a fault. ' +
    'The lamp check lights each lamp on its own and records whether you saw it.',
  obdFace: "The OBD socket is drawn as its mating face - the way the car's socket looks under the dash.",
  clusterList: "The cluster side is drawn as a list of the pins used: its physical layout is unchecked too.",

  pPsu: '12 V bench supply (1 A or more)',
  pFuse: 'Inline fuse holder + 1 A fuse',
  pSwitch: 'Toggle switch (KL15)',
  pObd: 'OBD-II 16-pin female socket (breakout)',
  pClusterPlug: 'Mating plug for the cluster connector X11175 (black, 26 pins)',
  pTerminals: 'Terminal blocks',
  pWire: 'Hookup wire',
  pKdcan: 'K+DCAN cable',
  pMeter: 'Multimeter',
  nCurrentLimit: 'Current-limited is best; set the limit near 1 A',
  nFuseInFeed: 'On the + side, before everything else',
  nPigtail: "A pigtail from a used harness. Never solder to the cluster's board",
  nKdcanOwned: 'The one you use on the car',
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
    'toggle-switch': c.pSwitch,
    'obd2-female-socket': c.pObd,
    'cluster-plug-x11175': c.pClusterPlug,
    'terminal-blocks': c.pTerminals,
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
  };
  return map[note] ?? null;
}
