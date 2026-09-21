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
