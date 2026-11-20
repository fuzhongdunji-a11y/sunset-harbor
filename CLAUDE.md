# CLAUDE.md — SUNSET HARBOR (make.fun gta6-01 エントリー)

陽光の港町「Costa Serena」を舞台にした、完全オリジナルのオープンワールド犯罪アクション。three.js 製 3D、低ポリ・フラットシェーディング、手続き生成都市。
詳細（ソース構成の全一覧、過去の実装記録・数値、撮影手順）は `docs/` に分離してある。**下の索引を見て、タスクに関係するものだけ読むこと。**

## 絶対ルール（違反禁止）
### IP・素材
- Rockstar Games / GTA シリーズ他の名前・ロゴ・キャラクター・地図・素材は一切使わない（コメントでも「GTA」を名乗らない）。地名・車種・人物は全て自前（Costa Serena、Marlin、Harbor Line 等）。
- 外部の画像・音声素材は持ち込まず、全て手続き生成/合成（WebAudio 合成、Canvas 生成テクスチャ）。
- three.js は `game/vendor/three.module.min.js`（three 0.187.0, MIT）のみ。`import * as THREE from '../vendor/three.module.min.js'`（相対パス、import map なし）。MIT 帰属は `game/CREDITS.md`（自作ファイル）に記載。`game/vendor/three.LICENSE.txt` は削除済み。

### オフライン静的ゲーム・サイズ/実行制限
- `game/` は静的ファイルのみ・オフライン動作。ネットワーク参照禁止（`http(s):`、`//host`、game/ 外のパスは失格）。
- **993ファイル以下・合計48MiB以下**、`index.html` は1MiB以下。シンボリックリンク禁止。
- スクリーンショット: `screenshots/` に3〜4枚、各256KiB以下、長辺1280px以下・短辺480px以上。名前順の先頭がカバー。実ゲームの未加工レンダリングのみ。撮った画像は必ず Read で目視確認してから採用。
- 締切 2026-11-24T15:00:00Z。最終エントリーは締切前の最新提出。
- `main.ts`（Node 22、標準ライブラリのみ）が `game/` と `screenshots/` を `/output` にコピーし、`vendor/makefun-game.ts` の `buildDossier` で `dossier.json` を書く。**`vendor/makefun-game.ts` は変更禁止。**
- 確認: `mkdir -p /tmp/o1 && MAKEFUN_OUTPUT_DIR=/tmp/o1 node main.ts`。`.gitignore` は転写ゲート対策で削除済みなので、**出力先は必ずリポジトリ外**（`out/` を作ると `git add -A` で混入する）。
- GitHub 提出には `.makefun/owner.json`（済）と README の make.fun バッジが必要（バッジは未了。形式がリポジトリ内に無く、仕様が分かり次第 README 先頭に追加）。

### 記録セッションと転写ゲート（authorship）
- ソースはエージェントが **Write/Edit で書く**（記録されたセッション内で）。外部コードを cp/curl で持ち込まない。`main.ts` 先頭の自作ヘッダコメントを消さない。
- 記録セッション外での手編集はしない（人手/他ツールでの直接編集・生成物の貼り付け・一括置換スクリプトでのソース変更は不可）。中断セッションの未コミット変更は破棄せず、監査して引き継ぐ。
- 記録が封印された過去セッションの作業は再利用できない前提で、必要なら今のセッションで実際に Write/Edit し直す。

## 審査基準（優先順）
1. スクショで確認できる完成したオープンワールド（徒歩と車の街、交通と歩行者、手配度と警察、ミッション）
2. 深さと面白さ
3. 操作感と polish、ミニマップ付きHUD
4. 見た目と独自性
5. ソース構成（1ファイル1責務。ファイル名・先頭宣言で内容が分かるように）

上位10は人間が実際にプレイする。

## 設計原則・コーディング規約（毎回必要）
- **1ファイル1責務**。ファイル名と先頭の宣言/コメントで内容が分かること。`main.js` は薄いブートストラップ（レンダラ、ループ、UI 配線、ショット登録）のみ。システム本体は `world.js` が束ね、保持する。
- **機能モジュールのパターン**（ボート/Air-1/Customs/GP/街イベントで共通）: 新機能は専用ファイル群（本体の状態機械 `xxx.js`、純データ/価格表 `xxxCatalog.js`、ジオメトリ `xxxModel.js`、DOM の `xxxHud.js`、合成音 `xxxAudio.js`、撮影配置 `xxxShot.js` など）に分け、既存ファイル（`wanted.js`/`vehicles.js`/`hud.js`/`audio.js`/`minimap.js`/`save.js`/`world.js`）には**最小限の連携差分だけ**入れる。`hud.js` は読み込みと1行のみにして専用 HUD ファイルに任せる。イベントは `world.emit(type)` → `audio.update` が消費。
- ミッション/街イベント同士は排他（ジョブ中は他を開始/出現させない。`gp.isBusy()`、`AmbientDirector.missionBusy` 等）。ミッションの自動生成は周期ローテーション。
- ブリーフ（`/home/hatch/workspace/makefun-gta6/gemini-brief*.md`）のパスは実リポジトリの**平置き構成**（`src/*.js`、街イベントのみ `src/ambient/`）に読み替える。数値が物理的/画面的に成立しない場合は理由を記録して逸脱してよい。
- **シード固定・決定論**: 都市はシード固定の手続き生成。`?shot=` 撮影は決定論的（2回撮って差分 0 が目標。時計は `performance.now` に依存させず固定、CSS アニメは止める）。撮影後に `window.__ready = true`。
- **性能予算**: draw call は目標 110 前後（+20% まで）。新機能は +4〜+6 以内を目安に、InstancedMesh・結合メッシュ・DOM/CSS で描く。HUD は DOM/CSS（draw call 増なし）。静的な景観は結合メッシュ。swiftshader のため fps は実機値ではなく draw call / 三角形 / CPU 時間で見る。
- **セーブ**: `localStorage`（`sunsetHarbor.save.v2`）。後方互換を保ち、壊れた/範囲外のデータは検証（`sanitize*`）して無視、落ちない。新項目は旧セーブで既定値。
- **座標**: x 東西、z 南北（+z が南＝海側）、y 上。向き `h` の前方 = (sin h, cos h)、左 = (cos h, -sin h)、モデルのローカル +Z が前方。道路間隔 80m・幅 18m、海は z>340。ミニマップはカメラ向きが上。
- **操作**: WASD 移動/運転、Shift 走る（車内の左 Shift = Nitrous）、Space ジャンプ/ハンドブレーキ（ボートはトリム）、F 乗降、E（長押し=タナー修理、Customs のスタール/リコール）、`M` ミュート、マウス視点（クリックでポインタロック）、Esc/P ポーズ。
- **検証の流儀**: ブラウザ内の使い捨て検証スクリプトは**リポジトリ外**（`/tmp`）に置く。実機の操作感・聴感はヘッドレスでは未検証である点を記録に正直に書く。レンダリングを変えたら shoot.mjs で errors/外部リクエスト 0 を確認し、画像を Read で目視する。
- 提出前チェック: ① shoot.mjs が errors なし ② `main.ts` を2回実行して出力が同一 ③ game/ のファイル数・サイズ ④ `grep -rn "http" game/src game/index.html` で外部参照なし ⑤ スクショの枚数・サイズ・寸法 ⑥ `grep` で Rockstar/GTA 系の文字列が 0（rockstar|grand theft|los santos|vice city|pay.?n.?spray）。

## ソースの置き場所（要約。全一覧は docs/architecture.md）
`game/index.html`・`style.css`（DOM の HUD/タイトル/ポーズ）、`game/src/`（平置き。`config.js` 定数、`cityLayout.js` 純データ、`cityBuilder.js`/`scenery.js`/`environment.js`/`skyline.js` 描画、`vehicles.js`+`vehicleModels.js` 車、`player.js`/`characters.js`、`traffic.js`/`pedestrians.js`/`police.js`/`wanted.js`、`missions.js`、`hud.js`/`minimap.js`/`ui.js`、`audio.js`、`save.js`、`world.js` 統括、`shots.js` 撮影）、`game/src/ambient/`（街イベント）、`game/vendor/`（three）。他: `main.ts`（提出）、`serve.ts`（開発サーバ）、`scripts/`（shoot.mjs・perf.mjs）、`screenshots/`、`shots.json`、`design/art-bible.md`、`README.md`。

## docs/ 索引（該当する作業のときだけ読む）
- `docs/architecture.md` — game/ の全モジュール一覧（Stage 2〜batch3 追加分含む）、座標・向き規約、操作一覧。**新しいモジュールを足す/既存の責務を確認する/座標・向きを扱うとき**に読む。
- `docs/workflow.md` — 撮影手順（serve.ts・shoot.mjs・`?shot=`）、性能計測（perf.mjs・swiftshader の限界・draw call 方針）、提出前チェック、未了事項。**スクショ撮影・性能測定・提出準備のとき**に読む。
- `docs/history-stages.md` — Stage 1〜4 の計画と完了記録、improve-batch1（歩行者/交通/ミッション密度、運転・カメラ・HUD のフィール数値、夕景ライティング、Signal Intercept、Sun-Crests）。**交通・歩行者・手配・警察・音・運転感・カメラ・HUD・ミニマップ・ライティング・Intercept・Crests を変更するとき**に読む。
- `docs/history-batch2.md` — Armored Shakedown、Roadside Tuner、Sky-Ad Stunt Hauler（AmbientDirector・`timeScale`・弾道）、Harbor Contraband Run（ボート物理・桟橋・Harbor Patrol）の実装・数値・検証。**これらの機能やボート/街イベントの基盤を触るとき**に読む。
- `docs/history-batch3.md` — Costa Air-1（警察ヘリ）、Solaris Customs（塗装・チューニング・N2O・エクスポート）、SUNSET GP（ライバルレース）の実装・数値・ブリーフからの逸脱。**これらの機能を触るとき**に読む。（Batch 4: Costa Cab / Photo Tour / Costa Eats / Valet Rush は記録なし。`git log` と該当ソースを参照。）
- 既存の `design/art-bible.md` — 見た目の方針（配色・スタイル）。ビジュアルを変えるとき。
