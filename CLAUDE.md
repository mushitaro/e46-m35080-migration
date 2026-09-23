# E46 M35080 /// Migration

メータ内の M35080 EEPROM を読み書きし、別の個体へ移すツール。Arduino UNO を USB CDC 越しの
SPI ブリッジとして使う。`web/` がアプリ、`firmware/m35080_bridge/` がブリッジ、
`.diagnostics/` にチップの基準値と探索スクリプト。

## 参照するスキル

指示が無くても、手を動かす前に読む。

| 何を決めるとき | スキル |
|---|---|
| 意匠・レイアウト・ハブ・z-index・文言 | `tsunagi-m-design` |
| 技術選定・リポジトリ構成・検査列・ポート | `tsunagi-m-stack` |
| 環境・配信・命名・アイコン | `tsunagi-m-release` |
| スマホでの実装 | `tsunagi-m-mobile` |

## この repo の決まり

- **EEPROM に書く。**CI はテストが通らなければデプロイしない。この門を外さない。
- `basePath` / `trailingSlash` は GitHub Pages 時代の名残で、他の M ツールの手本ではない。
- 依存が他の repo から離れている（TypeScript ^7 / vitest ^5）。揃える側はこの repo。
- **公開リポジトリ（MIT）。**実車のイメージ・VIN・BMW 由来のデータ・秘密はコミットしない。`scripts/check-public-tree.mjs --staged` を通してからコミットする。
- 環境はオーナー向けプレビュー（`e46-m35080-migration-preview`）だけ。ソースは本番の名前とアイコンを持ち、プレビューは `build:preview` でビルド後に付ける。
- `web/functions/_owner-gate/*` と `web/lib/sync/owner-sync.ts` は tsunagi-m3 `tools/owner-gate` の複写。ここで編集しない（`npm run gate:verify`）。
- SYNC の API は持ち主を `ownerOf(context.data)` だけから取り、全クエリに `owner = ?`。配信は `npm run deploy` だけ（公開済みの `origin/main` でなければ拒む）。
