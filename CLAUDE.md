# E46 M35080 /// Migration

メータ内の M35080 EEPROM を読み書きし、別の個体へ移すツール。Arduino UNO を USB CDC 越しの
SPI ブリッジとして使う。`web/` がアプリ、`firmware/m35080_bridge/` がブリッジ、
`.diagnostics/` にチップの基準値と探索スクリプト。チップを戻したメータは、K+DCAN ケーブルで
DS2 越しに机上で確かめる（TEST）。

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
- **公開リポジトリ（MIT）。**実車のイメージ・VIN・BMW 由来のデータ・秘密はコミットしない。`scripts/check-public-tree.mjs --staged` と `scripts/check-bmw-data.mjs --staged` を通してからコミットする。
- 環境はオーナー向けプレビュー（`e46-m35080-migration-preview`）だけ。ソースは本番の名前とアイコンを持ち、プレビューは `build:preview` でビルド後に付ける。
- `web/functions/_owner-gate/*` と `web/lib/sync/owner-sync.ts` は tsunagi-m3 `tools/owner-gate` の複写。ここで編集しない（`npm run gate:verify`）。
- SYNC の API は持ち主を `ownerOf(context.data)` だけから取り、全クエリに `owner = ?`。配信は `npm run deploy` だけ（公開済みの `origin/main` でなければ拒む）。
- **プレビューは、送るものを示して確認されるまで何も送らない。**初回起動のダイアログ（`web/components/PreviewNotice.tsx`、文言は m3 の告知と同文で `web/lib/copy/sync.ts`）が「確認して続ける」（`preview-notice:v1`）まで画面を塞ぐ。m3 の `/preview-notice` ではなくアプリ自身が示す（運営者、2026-09-24）。送る経路を足すときは `web/lib/sync/cloud.ts` の `maySend()` を通し、送る中身が変わったら m3 の告知とプライバシーポリシーと一緒に直す。

## 機器へ何を送るか

- **モードは CHIP と TEST**（`web/lib/domain/modes.ts`、ハブ枠の左下の MODE コーナー。TUNER の VE / IDLE と同じ形）。モードがタブ・ケーブル・ハブ・PRACTICE を決める。チップへの書き込み中とメータの診断中は切り替えない。
- **UNO はチップだけ、K+DCAN はメータだけ。**同じ物に二つの機器をつながない。TEST は UNO のポート（USB VID 0x2341 / 0x2a03）を拒む。ファーム（`firmware/`）は TEST のために変えない。
- **チップへの書き込みは一本だけ**：`web/lib/hooks/useM35080Link.ts` の `runWrite`（BACKUP が無ければ拒否 → 書く → 読み返す → 全体を読み直して意図と照合 → 記録）。
- **書く計画も一つだけ**：REWRITE のジョブ（`web/lib/domain/job.ts` の `planJob`）。SOURCE（チップ / ファイル）→ BYTES（HEX で手で変えたバイト。変えてよいバイトは `byteEdits.ts` の `byteLock`）→ VIN → コーディング → 走行距離（WRINC、チップのみ）の順に 1 つの計画にし、確認 1 回・書き込み 1 回。チップ無しでは SAVE EDITED（`savedImage`）でファイルにして後で書く。書き込む処理を増やすときは、別のタブや別の計画を作らずジョブの一部にする（INSPECT もこうして REWRITE に入った）。
- **メータへ送ってよいかを決めるのは `web/lib/kombi/runGate.ts` の `mayRun` だけ**。許可リスト・長さの完全一致・バリアントとベンチ確認の門・針の範囲と 1 歩の上限はここにある。送らない要求（05 / 07 / 0F / 12 など）は builder そのものを作らない。
- **番地の意味は `web/lib/domain/layout.ts`**（数値とアドレスだけ）。late layout はチェックサムで判定し、そうでないイメージには番地の意味を当てはめない。範囲を広げるときは、実チップでの測定（`layoutEvidence` / `ncsEvidence`）を先に。コーディングの門と測定値は `docs/CODING.md`。
- TEST モードと REWRITE の CODING 欄は experimental（`web/lib/domain/features.ts` に理由）。昇格は運営者の判断。

## 検査列

`web/` で、この順に：

```
npm run test        # check_ui_tokens → check-bmw-data → verify-ds2-core-sync → vitest
npm run typecheck   # app と functions/
npm run build       # 出力をパイプに通さない（終了コードが grep のものになる）
```

ほかに `python -m unittest discover -s tools/refdata`（repo の根で。CI も走らせる）、コミット前の
`--staged` の二つ。CODING 欄と TEST モードは experimental で `next dev` には出ないので、画面の確認は
`npm run build:preview && npm run serve:out`（http://localhost:5050、`.claude/launch.json` の
`m35080-preview-build`）で行う。serve-out は参照データを `REFDATA_OUT` から `/api/ref` で配る
（プレビューと同じ受け取り方。自分のマシンからの要求にだけ答える）。エージェントが画面を確かめる
ときは、`REFDATA_OUT` を合成データのフォルダに向けた別ポートで起動し、実データをツールに通さない。

## vendoring と参照データ

- `web/packages/ds2-core/` は E46M3 /// MONITORING の `packages/ds2-core`（コミット `2468cf2e`）をバイト単位で写したもの。`web/packages/VENDOR.json` の sha256 と `scripts/verify-ds2-core-sync.mjs`（`npm run test` の中）が照合する。ここで編集しない。上流を直して写し直す。
- **NCS / SGBD 由来のデータ（コーディング定義・ランプや入力の名前）は repo にもビルドにも入れない**（`THIRD-PARTY-NOTICES.md` 3.3）。生成は `tools/refdata/gen_refdata.py`（入力は環境変数、出力は repo の外の `REFDATA_OUT`）、配信は R2 `m35080-refdata` → `/api/ref/<name>`（owner gate の内側、`private, no-store`）、アプリではメモリ上だけ。訳語は非公開の data repo（`E46M3-Monitoring-data/terms/m35080/`）。
- テストは合成データだけ（`web/test/support/codingDoc.ts` など）。実チップと実定義での照合は環境変数（`NCS_REFDATA` / `M35080_DUMPS`）があるときだけ走り、集計値だけを出す。実ダンプや定義の中身をツールに出力させない。
- コードが NCS のキーワードを名前で引くのは、構造上の鍵（コーディングインデックスなど）に限る。定義の中身（項目・選択肢・ブロックの名前）はコミットしない。
