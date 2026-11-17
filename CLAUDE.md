# CLAUDE.md — SUNSET HARBOR (make.fun gta6-01 エントリー)

陽光の港町「Costa Serena」を舞台にした、完全オリジナルのオープンワールド犯罪アクション。three.js 製 3D、低ポリ・フラットシェーディング、手続き生成都市。
Rockstar Games / GTA シリーズ他の名前・ロゴ・キャラクター・地図・素材は一切使わない（コメントでも「GTA」を名乗らない）。地名・車種・人物は全て自前（Costa Serena、Marlin、Harbor Line 等）。外部の画像・音声素材は持ち込まず、全て手続き生成/合成。

## 提出ルール要点
- 締切 2026-11-24T15:00:00Z。最終エントリーは締切前の最新提出。
- `main.ts`（Node 22、標準ライブラリのみ）が `game/` と `screenshots/` を `/output` にコピーし、`vendor/makefun-game.ts` の `buildDossier` で `dossier.json` を書く。`vendor/makefun-game.ts` は変更禁止。
- 確認: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts`（`out/` は .gitignore 済み）。
- `game/` は静的ファイルのみ・オフライン動作。ネットワーク参照禁止（`http(s):`、`//host`、game/ 外のパスは失格）。**993ファイル以下・合計48MiB以下**、`index.html` は1MiB以下。シンボリックリンク禁止。
- スクリーンショット: `screenshots/` に3〜4枚、各256KiB以下、長辺1280px以下・短辺480px以上。名前順の先頭がカバー。実ゲームの未加工レンダリングのみ。
- ライブラリは `game/vendor/three.module.min.js`（three 0.187.0, MIT）。`import * as THREE from '../vendor/three.module.min.js'`（相対パス、import map なし）。
- ゲートの転写要件: ソースはエージェントが Write/Edit で書く。外部コードを cp/curl で持ち込まない。`main.ts` 先頭に自作のヘッダコメントがある。
- GitHub 提出には `.makefun/owner.json`（済）と README のバッジが必要（Stage 3）。

## 審査基準（優先順）
1. スクショで確認できる完成したオープンワールド（徒歩と車の街、交通と歩行者、手配度と警察、ミッション）
2. 深さと面白さ
3. 操作感と polish、ミニマップ付きHUD
4. 見た目と独自性
5. ソース構成（1ファイル1責務。ファイル名・先頭宣言で内容が分かるように）
上位10は人間が実際にプレイする。

## ソース構成（game/）
- `index.html` / `style.css` — キャンバス、HUD、タイトル、ポーズ（DOM）
- `src/main.js` — 薄いブートストラップ。レンダラ、ループ、UI 配線のみ
- `src/config.js` — ワールド寸法と定数。`src/rng.js` — シード付き乱数
- `src/cityLayout.js` — 都市の純データ生成（道路グリッド、街区、建物、駐車スロット、コライダ）
- `src/meshBuilder.js` — 頂点カラー付き低ポリジオメトリのビルダ（マージ用）
- `src/textures.js` — 窓の明かり付きテクスチャ（Canvas 生成）
- `src/cityBuilder.js` — 道路・歩道・建物のメッシュ化。`src/scenery.js` — ヤシ・街灯・ビーチ・桟橋・コンテナ
- `src/environment.js` — 空・太陽・雲・海・ライティング・影
- `src/collision.js` — 空間グリッドによる円 vs AABB/円の押し出し、ワールド境界
- `src/vehicleModels.js` / `src/vehicles.js` — 車種定義とモデル、アーケード物理と管理
- `src/characters.js` / `src/player.js` — 人型モデルと歩行アニメ、プレイヤー操作と乗降
- `src/cameraRig.js` — 徒歩/車の追従カメラ
- `src/input.js` — キー・マウス・ポインタロック
- `src/missions.js` — ミッション状態（Stage 1 は到達型の簡易）
- `src/hud.js` / `src/minimap.js` / `src/ui.js` — HUD、Canvas ミニマップ、タイトル/ポーズ
- `src/world.js` — 上記を束ねるシミュレーション本体。`src/shots.js` — `?shot=` 撮影モード
- Stage 2 で追加予定: `traffic.js`、`pedestrians.js`、`wanted.js`、`police.js`、`save.js`。Stage 3: `audio.js`。

## ステージ計画と完了条件
**Stage 1 — 土台**（完了条件）: 道路グリッドと建物・ヤシ・街灯・海岸と海の手続き生成（シード固定）、アーケード運転+追従カメラ、徒歩⇄乗降、HUD（速度・所持金・★・ミッション枠）、Canvas ミニマップ、タイトル/ポーズ、`?shot=start|drive|walk` と `window.__ready`、3枚のスクショを目視確認、`node main.ts` で dossier 生成、コミット&プッシュ。
**Stage 2 — システム**: 交通AI（車線追従・信号）、歩行者、車の乗り降りと窃盗、手配度★1〜5と警察の出動・追跡・逮捕/逃走、ミッション3本以上と目標マーカー、localStorage セーブ/ロード（壊れたデータでも落ちない）。追跡中の shot で「★+ミニマップ+ミッション+交通+パトカー」が1フレームに写る。
**Stage 3 — 仕上げ**: WebAudio 合成サウンド（エンジン・サイレン・環境音、ミュート切替）、ライティング調整、全システムが写るスクショ3〜4枚、性能計測、README バッジ、ゲート検証、提出。

## 操作
WASD 移動/運転、Shift 走る、Space ジャンプ/ハンドブレーキ、F 乗降、マウス視点（クリックでポインタロック）、Esc/P ポーズ。

## 撮影手順
- 開発サーバー: `node serve.ts`（http://localhost:8080、`--port N` 可）。
- 撮影: `node scripts/shoot.mjs [shots.json] [outDir]`。serve.ts を空きポートで起動し、playwright-core（`/home/hatch/workspace/tools/shot/`）+ Chrome（`/home/hatch/workspace/tools/chrome-x/opt/google/chrome/chrome`、swiftshader）で `shots.json` の各 `query` を 1280x720 で撮影。pageerror / console error / 外部リクエストがあれば exit 1。
- `?shot=start|drive|walk&seed=N`: `src/shots.js` が決定論的に状況を作り、描画後に `window.__ready = true` を立てる。shot モードのみ `preserveDrawingBuffer`。
- **撮った画像は必ず Read で目視確認**してから `screenshots/` に採用する。
- 提出前チェック: ① shoot.mjs が errors なし ② `MAKEFUN_OUTPUT_DIR=out node main.ts` を2回実行して同一 ③ game/ のファイル数・サイズ ④ `grep -rn "http" game/src game/index.html` で外部参照なし ⑤ スクショの枚数・サイズ・寸法。

## 座標・規約メモ
- 世界: x 東西、z 南北（+z が南＝海側）、y 上。道路は x/z とも間隔80m、幅18m、街区 62m、歩道 3.5m。海は z>340。
- 車/人の向き `h`: 前方ベクトル = (sin h, cos h)。左 = (cos h, -sin h)。h 増加 = 左旋回。モデルのローカル +Z が前方。
- ミニマップは north-up 固定ではなくカメラ向きが上（キャンバス座標 = (-x, -z)）。
