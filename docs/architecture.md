# architecture.md — ソース構成・座標規約・操作（CLAUDE.md から移設）

CLAUDE.md の索引から参照される詳細文書。モジュールを新規追加/変更する・座標や向きを扱う・操作系を触るときに読む。

## ソース構成（game/）
- `index.html` / `style.css` — キャンバス、HUD、タイトル、ポーズ（DOM）
- `src/main.js` — 薄いブートストラップ。レンダラ、ループ、UI 配線のみ
- `src/config.js` — ワールド寸法と定数。`src/rng.js` — シード付き乱数
- `src/cityLayout.js` — 都市の純データ生成（道路グリッド、街区、建物、駐車スロット、コライダ）
- `src/meshBuilder.js` — 頂点カラー付き低ポリジオメトリのビルダ（マージ用）
- `src/textures.js` — 窓の明かり付きテクスチャ（Canvas 生成）
- `src/cityBuilder.js` — 道路・歩道・建物のメッシュ化。`src/scenery.js` — ヤシ・街灯・ビーチ・桟橋・コンテナ
- `src/environment.js` — 空・太陽・雲・海・ライティング・影。`src/skyline.js` — 遠景ビル群のシルエット
- `src/collision.js` — 空間グリッドによる円 vs AABB/円の押し出し、ワールド境界
- `src/vehicleModels.js` / `src/vehicles.js` — 車種定義とモデル、アーケード物理と管理
- `src/characters.js` / `src/player.js` — 人型モデルと歩行アニメ、プレイヤー操作と乗降
- `src/cameraRig.js` — 徒歩/車の追従カメラ
- `src/input.js` — キー・マウス・ポインタロック
- `src/missions.js` — ミッション連鎖（到達・配送・車窃盗・逃走・レース・巡回・Signal Intercept + 無限の自動生成）とワールドマーカー。`src/signalIntercept.js` — Intercept 本体、`src/crests.js` — Sun-Crest 50個
- `src/hud.js` / `src/minimap.js` / `src/ui.js` — HUD、Canvas ミニマップ、タイトル/ポーズ
- `src/world.js` — 上記を束ねるシミュレーション本体。`src/shots.js` — `?shot=` 撮影モード
- Stage 2 で追加済み: `roadNet.js`（道路グラフと車線幾何）、`roadDriver.js`（車線追従AI。交通・警察共用）、`traffic.js`（民間車の循環と再配置）、`pedestrians.js`（歩道コーナーのグラフ歩行・回避・轢かれ）、`wanted.js`（heat→★、逃走タイマー）、`police.js`（パトカーの出動・追跡・逮捕）、`save.js`（localStorage、検証付き）。Stage 3: `audio.js`（WebAudio 合成）、`bench.js`（`?bench=1` 自動運転ベンチ）。
- `characters.js` に歩行者用 `buildPedestrian`（1人5メッシュ、ジオメトリ共有）。`vehicleModels.js` に `patrol`（ライトバー付き）。`vehicles.js` は `kind`（parked/traffic/police）・`health`・`contact`・休止最適化を持つ。

- ボート（improve-batch2 記録 4）: `boatSystem.js`（物理・係留・乗降・波跡）、`boatModels.js`、`shoreline.js`（接地ガード・衝突・上陸点）、`harborPatrol.js`、`contrabandMission.js`、`boatAudio.js`。
- 警察ヘリ（improve-batch3 記録 1）: `airpursuit.js`（Costa Air-1: ヘリ・サーチライト・Spike-Pod・6状態機械・Cold Swap・Scanner Ghost・`?shot=airpursuit` 配置）。`wanted.js`/`vehicles.js`/`hud.js`/`audio.js`/`minimap.js` に小さな連携のみ。
- Solaris Customs（improve-batch3 記録 2）: `customs.js`（配置・状態機械・エクスポート・リコール）、`customsCatalog.js`（価格・数式）、`customsModel.js`（ジオメトリ）、`customsHud.js`、`customsAudio.js`、`customsShot.js`（`?shot=customs`）。`vehicles.js`/`vehicleModels.js`/`traffic.js`/`police.js`/`collision.js`/`minimap.js`/`save.js` に小さな連携のみ。
- SUNSET GP（improve-batch3 記録 3）: `gpCourse.js`、`rivalRacer.js`、`sunsetGP.js`、`gpHud.js`（詳細は history-batch3.md）。
- `ambient/`（街イベント）: `AmbientDirector.js`（スケジューラ）、`TunerBreakdownEvent.js`（Roadside Tuner）、`StuntHaulerEvent.js`（Sky-Ad Stunt Hauler の状態機械・ランプ発射物理・シャード・スローモ）、`HaulerModel.js`（ランプトラックのモデルとランプ寸法）、`HaulerArt.js`（シェブロン/COSTA COLA の Canvas テクスチャ・ドローンキューブ・テザー・シャード）、`AmbientAudio.js`（合成音）。街イベントはこれで gemini-brief2 の全項目が完了。
- 注: git log には Batch 4（Costa Cab / Sunset Photo Tour / Costa Eats Courier / Valet Rush）のコミットがあるが、旧 CLAUDE.md にはそのモジュール記録が無かった。必要なら `git log` と `game/src` を参照。

## 座標・規約メモ
- 世界: x 東西、z 南北（+z が南＝海側）、y 上。道路は x/z とも間隔80m、幅18m、街区 62m、歩道 3.5m。海は z>340。
- 車/人の向き `h`: 前方ベクトル = (sin h, cos h)。左 = (cos h, -sin h)。h 増加 = 左旋回。モデルのローカル +Z が前方。
- ミニマップは north-up 固定ではなくカメラ向きが上（キャンバス座標 = (-x, -z)）。

## 操作
Left Shift（車内）= Nitrous（Solaris Customs で購入）、Solaris Customs のスタール脇/リコールパッドで E。
WASD 移動/運転、Shift 走る、**E 長押し（ストランデッドタナーの修理）**、Space ジャンプ/ハンドブレーキ（ボートではトリムブースト）、F 乗降（ボートの乗降を含む）、マウス視点（クリックでポインタロック）、Esc/P ポーズ。`M` でミュート切替（history-stages.md の Stage 3 参照）。
