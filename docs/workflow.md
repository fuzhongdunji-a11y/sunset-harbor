# workflow.md — 撮影・検証・提出前チェック（CLAUDE.md から移設）

スクショ撮影、開発サーバー、性能計測、提出前の確認をするときに読む。

## 撮影手順
- 開発サーバー: `node serve.ts`（http://localhost:8080、`--port N` 可）。
- 撮影: `node scripts/shoot.mjs [shots.json] [outDir]`。serve.ts を空きポートで起動し、playwright-core（`/home/hatch/workspace/tools/shot/`）+ Chrome（`/home/hatch/workspace/tools/chrome-x/opt/google/chrome/chrome`、swiftshader）で `shots.json` の各 `query` を 1280x720 で撮影。pageerror / console error / 外部リクエストがあれば exit 1。
- `?shot=start|drive|chase|walk&seed=N`: `src/shots.js` が決定論的に状況を作り、描画後に `window.__ready = true` を立てる。shot モードのみ `preserveDrawingBuffer`。
- **撮った画像は必ず Read で目視確認**してから `screenshots/` に採用する。
- 提出前チェック: ① shoot.mjs が errors なし ② `MAKEFUN_OUTPUT_DIR=out node main.ts` を2回実行して同一（出力先は必ずリポジトリ外。CLAUDE.md 参照） ③ game/ のファイル数・サイズ ④ `grep -rn "http" game/src game/index.html` で外部参照なし ⑤ スクショの枚数・サイズ・寸法。

## 性能計測（Stage 3 より）
- `node scripts/perf.mjs [秒] [幅] [高さ]`。`?bench=1`（`src/bench.js`）が車に乗り、市内の矩形ルートを自動運転（★3の追跡状態、体力は毎フレーム回復）して、フレーム時間・CPU内訳（sim / HUD+ミニマップ / render 呼び出し）・draw call・三角形数を `window.__bench` に集計する。
- **限界**: この環境は swiftshader（ソフトウェアGL）のため fps は実機を表さない（1280x720 で約1〜3 fps、ラスタライズ律速）。60fps の達成は実測できていない。指標は draw call / 三角形数 / CPU 時間で見る。同じ HEAD でも draw call は 112〜120 程度とブレる。
- draw call の目標は 110 前後（+20% まで）。追加機能の draw call 予算は機能ごとに +4〜+6 程度に抑えてきた（各機能の実測値は history-*.md）。
- 静的な街並み・景観は 7 メッシュにマージ済み。残る draw call の大半は車（1台5メッシュ）と歩行者（1人5メッシュ）。さらに削るなら InstancedMesh 化。

## 未了・未検証（全期間の持ち越し）
- README の make.fun バッジ（形式がリポジトリ内に記載なし。仕様が分かり次第 README 先頭に追加。GitHub 提出には必須）。
- 実機での fps 計測、実機のキーボード操作感・聴感（ヘッドレス+swiftshader のため静止画と数値のみ）。
