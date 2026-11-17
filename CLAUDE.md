# CLAUDE.md — SUNSET HARBOR (make.fun gta6-01 エントリー)

陽光の港町「Costa Serena」を舞台にした、完全オリジナルのオープンワールド犯罪アクション。three.js 製 3D、低ポリ・フラットシェーディング、手続き生成都市。
Rockstar Games / GTA シリーズ他の名前・ロゴ・キャラクター・地図・素材は一切使わない（コメントでも「GTA」を名乗らない）。地名・車種・人物は全て自前（Costa Serena、Marlin、Harbor Line 等）。外部の画像・音声素材は持ち込まず、全て手続き生成/合成。

## 提出ルール要点
- 締切 2026-11-24T15:00:00Z。最終エントリーは締切前の最新提出。
- `main.ts`（Node 22、標準ライブラリのみ）が `game/` と `screenshots/` を `/output` にコピーし、`vendor/makefun-game.ts` の `buildDossier` で `dossier.json` を書く。`vendor/makefun-game.ts` は変更禁止。
- 確認: `mkdir -p /tmp/o1 && MAKEFUN_OUTPUT_DIR=/tmp/o1 node main.ts`。`.gitignore` は転写ゲート対策で削除済みなので、出力先は必ずリポジトリ外（`out/` を作ると `git add -A` で混入する）。
- three.js の MIT 帰属は `game/CREDITS.md`（自作ファイル）に記載。`game/vendor/three.LICENSE.txt` は削除済み。
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
- `src/missions.js` — ミッション連鎖（到達・配送・車窃盗・逃走の6本 + 無限の自動生成 Courier Job）とワールドマーカー
- `src/hud.js` / `src/minimap.js` / `src/ui.js` — HUD、Canvas ミニマップ、タイトル/ポーズ
- `src/world.js` — 上記を束ねるシミュレーション本体。`src/shots.js` — `?shot=` 撮影モード
- Stage 2 で追加済み: `roadNet.js`（道路グラフと車線幾何）、`roadDriver.js`（車線追従AI。交通・警察共用）、`traffic.js`（民間車の循環と再配置）、`pedestrians.js`（歩道コーナーのグラフ歩行・回避・轢かれ）、`wanted.js`（heat→★、逃走タイマー）、`police.js`（パトカーの出動・追跡・逮捕）、`save.js`（localStorage、検証付き）。Stage 3: `audio.js`（WebAudio 合成）、`bench.js`（`?bench=1` 自動運転ベンチ）。
- `characters.js` に歩行者用 `buildPedestrian`（1人5メッシュ、ジオメトリ共有）。`vehicleModels.js` に `patrol`（ライトバー付き）。`vehicles.js` は `kind`（parked/traffic/police）・`health`・`contact`・休止最適化を持つ。

## ステージ計画と完了条件
**Stage 1 — 土台**（完了条件）: 道路グリッドと建物・ヤシ・街灯・海岸と海の手続き生成（シード固定）、アーケード運転+追従カメラ、徒歩⇄乗降、HUD（速度・所持金・★・ミッション枠）、Canvas ミニマップ、タイトル/ポーズ、`?shot=start|drive|walk` と `window.__ready`、3枚のスクショを目視確認、`node main.ts` で dossier 生成、コミット&プッシュ。
**Stage 2 — システム**: 交通AI（車線追従・信号）、歩行者、車の乗り降りと窃盗、手配度★1〜5と警察の出動・追跡・逮捕/逃走、ミッション3本以上と目標マーカー、localStorage セーブ/ロード（壊れたデータでも落ちない）。追跡中の shot で「★+ミニマップ+ミッション+交通+パトカー」が1フレームに写る。
**Stage 2 完了記録**（実装内容と数値）:
- 交通: 民間車16台（`TRAFFIC_COUNT`）。右側通行の車線を純追従で走り、交差点で直進62%/右19%/左19%。前方の車・横断中の歩行者・徒歩プレイヤーに合わせて減速。プレイヤーから240m以上離れたら110〜210m先へ再配置。5分連続シミュレーションで停止5.5秒超の車なし。**信号機は未実装**（車間の減速のみで交差点を処理）。
- 歩行者: 28人（`PED_COUNT`）。歩道コーナー（交差点ごとに4）間を歩き、横断前に交通を待ち、接近車を避けて走る。轢くと倒れ★加算。150m超は非表示で凍結、190m超は再配置。
- 乗降/窃盗: 駐車車は目撃者（24m以内の歩行者か45m以内の警察）がいれば★+1、いなければ無罪。走行中でない（6m/s以下）交通車はハイジャック（★2、運転手が逃げる）。初期のMarlinと一度乗った車は無罪。パトカーは乗れない。
- 手配度: heat→★（閾値 1/3/5.5/8.5/12）。窃盗・轢き・民間車衝突・パトカー衝突で加算。パトカーから85m以上離れて7秒ごとに★−1。
- 警察: ★に応じて2/2/3/4/5台。道路グラフ上で目標に最も近づく曲がりを選び、36m以内で直線が通れば直接体当たり。7m以内で時速23km/h以下なら逮捕メーター（2.2秒でBUSTED）。接触でプレイヤー車を減速。
- ペナルティ: WASTED（車の耐久0、または徒歩で8m/s超の車に轢かれる）$300、BUSTED $200+150×★。どちらもスタート地点にリスポーンし手配度解除、ミッションは最初のステップから。
- ミッション: 6本（到達×3、Package Run 配送、Borrowed Wheels 車窃盗→納車、Heat Check ★3 からの逃走）+ 以降 Courier Job を無限に自動発注。タイマー、距離、報酬、ミニマップ目標表示。
- セーブ: `sunsetHarbor.save.v2`。所持金・クリア数・位置・乗車中の車種/色。10秒ごと・ミッション達成・ポーズ・ページ離脱時に保存。壊れた/範囲外データは無視。タイトルに CONTINUE / NEW GAME。
- 撮影: `?shot=start|drive|chase|walk`。`chase` は後方視点で ★3 + パトカー2台 + 交差路の1台 + 交通 + ミッション + ミニマップが1フレームに入る。`shots.json` は4枚構成。
- 検証: `scripts/shoot.mjs` エラーなし、`main.ts` 2回出力一致、game/ 33ファイル 約0.9MB。
- 注意: ページ内の自動検証スクリプトはリポジトリ外（/tmp）で使った使い捨て。Stage 3 で音（サイレン・エンジン）と性能計測が必要。

**Stage 3 — 仕上げ**: WebAudio 合成サウンド（エンジン・サイレン・環境音、ミュート切替）、ライティング調整、全システムが写るスクショ3〜4枚、性能計測、README バッジ、ゲート検証、提出。

**Stage 3 完了記録**:
- サウンド `src/audio.js`（WebAudio 合成のみ、音源ファイルなし）。`Ui.start()` → `onStart` 内で `audio.start()`（クリック/Enter のジェスチャ内で AudioContext 生成）。ポーズで suspend/resume。`M` でミュート切替（`localStorage: sunsetHarbor.mute` に保存、タイトル/ポーズに状態表示）。
  - エンジン: saw+square を LPF に通し、速度→5段のギアで回転数が上下。タイヤ/風切りはバンドパスノイズで速度連動。
  - サイレン: 追跡中のパトカーのうち最寄り1台（220m以内）で三角波+矩形波のウェール。距離で音量、カメラ向きに対する左右でパン。
  - 衝突: `vehicle.impact > 2.5` でノイズ+低音サイン。ミッション完了/BUSTED/WASTED/ドア/轢き/カージャックは `world.emit(type)` のイベントキューを `audio.update` が消費。
  - 環境音: 波（ノイズ+LFO、海岸 z>120 付近ほど大きい）、街の低いざわめき、数秒おきの鳥のさえずり。
- 性能計測: `node scripts/perf.mjs [秒] [幅] [高さ]`。`?bench=1`（`src/bench.js`）が車に乗り、市内の矩形ルートを自動運転（★3の追跡状態、体力は毎フレーム回復）して、フレーム時間・CPU内訳（sim / HUD+ミニマップ / render 呼び出し）・draw call・三角形数を `window.__bench` に集計する。
  - **限界**: この環境は swiftshader（ソフトウェアGL）のため fps は実機を表さない（1280x720 で約1〜3 fps、ラスタライズ律速）。60fps の達成は実測できていない。指標は draw call / 三角形数 / CPU 時間で見る。
  - 最適化前（640x360、25秒）: draw call 平均226・最大332、三角形 約129k、HUD+ミニマップ 5.2ms/フレーム、render 呼び出し CPU 57ms。
  - 最適化: ① `VehicleManager.cull()`（毎フレーム）で420m超の車を非表示、95m超の車はホイール（1台4メッシュ、影パスで2倍）を非表示。② ミニマップの再描画を1フレームおき（shot モードは毎回）。
  - 最適化後（同条件）: draw call 平均110・最大182、三角形 約121k、HUD+ミニマップ 2.7ms/フレーム、render 呼び出し CPU 42ms。
  - 静的な街並み・景観は元々7メッシュにマージ済み。残る draw call の大半は車（1台5メッシュ）と歩行者（1人5メッシュ）。さらに削るなら InstancedMesh 化。
- 仕上げ: README.md（概要・操作・システム・構成）。タイトル画面のキー一覧と保存情報に背景パネルを追加（砂浜の上で読めなかったため）。HUD のヒントに `M sound`。
- スクショ4枚（1-start / 2-drive / 3-chase / 4-walk、1280x720、各 約125〜145KB）を撮り直し、全て Read で目視確認済み。
- 最終確認: `MAKEFUN_OUTPUT_DIR=/tmp/gta-out node main.ts` 成功、2回出力が同一。game/ は 35 ファイル・約0.92MB、index.html 3.2KB、シンボリックリンクなし、`http(s):` の外部参照なし。shoot.mjs は errors/外部リクエストなし。
- **未了**: README の make.fun バッジ（形式がリポジトリ内に記載なし。仕様が分かり次第 README 先頭に追加）。実機での fps 計測。

## 操作
WASD 移動/運転、Shift 走る、Space ジャンプ/ハンドブレーキ、F 乗降、マウス視点（クリックでポインタロック）、Esc/P ポーズ。

## 撮影手順
- 開発サーバー: `node serve.ts`（http://localhost:8080、`--port N` 可）。
- 撮影: `node scripts/shoot.mjs [shots.json] [outDir]`。serve.ts を空きポートで起動し、playwright-core（`/home/hatch/workspace/tools/shot/`）+ Chrome（`/home/hatch/workspace/tools/chrome-x/opt/google/chrome/chrome`、swiftshader）で `shots.json` の各 `query` を 1280x720 で撮影。pageerror / console error / 外部リクエストがあれば exit 1。
- `?shot=start|drive|chase|walk&seed=N`: `src/shots.js` が決定論的に状況を作り、描画後に `window.__ready = true` を立てる。shot モードのみ `preserveDrawingBuffer`。
- **撮った画像は必ず Read で目視確認**してから `screenshots/` に採用する。
- 提出前チェック: ① shoot.mjs が errors なし ② `MAKEFUN_OUTPUT_DIR=out node main.ts` を2回実行して同一 ③ game/ のファイル数・サイズ ④ `grep -rn "http" game/src game/index.html` で外部参照なし ⑤ スクショの枚数・サイズ・寸法。

## 座標・規約メモ
- 世界: x 東西、z 南北（+z が南＝海側）、y 上。道路は x/z とも間隔80m、幅18m、街区 62m、歩道 3.5m。海は z>340。
- 車/人の向き `h`: 前方ベクトル = (sin h, cos h)。左 = (cos h, -sin h)。h 増加 = 左旋回。モデルのローカル +Z が前方。
- ミニマップは north-up 固定ではなくカメラ向きが上（キャンバス座標 = (-x, -z)）。
