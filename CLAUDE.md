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
- `ambient/`（街イベント）: `AmbientDirector.js`（スケジューラ）、`TunerBreakdownEvent.js`（Roadside Tuner）、`StuntHaulerEvent.js`（Sky-Ad Stunt Hauler の状態機械・ランプ発射物理・シャード・スローモ）、`HaulerModel.js`（ランプトラックのモデルとランプ寸法）、`HaulerArt.js`（シェブロン/COSTA COLA の Canvas テクスチャ・ドローンキューブ・テザー・シャード）、`AmbientAudio.js`（合成音）。街イベントはこれで gemini-brief2 の全項目が完了。

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

**Stage 4 完了記録（グラフィック強化）**:
- 経緯: 最初の Stage 4 セッションが実行環境の再起動で中断（recording は封印）。未コミットの変更が残っていたため、再開セッションで全ファイルの構文（`node --check`）と配線（world.js → ContactShadows、cityBuilder.js → signage.js、pedestrians.js → setDetail）を精査。不完全な編集・構文エラーは無く、追加修正なしで shoot.mjs/perf.mjs が通った。
- 内容: 人物を関節モデル化（頭・首・胴・上下腕・上下脚、肘/膝、歩行/走行/轢かれアニメ、近距離のみ肘膝ありの `setDetail` LOD）、車両ディテール（`vehicleModels.js`）、看板アトラス `signage.js`（店名 Canvas 生成）と建物テクスチャ、`contactShadows.js`（InstancedMesh のブロブ影 1 draw call）、港/景観の追加（`scenery.js`）、空・光・フォグ（`config.js` SKY、`environment.js`）、`design/art-bible.md`。
- 性能（perf.mjs 25秒 640x360、swiftshader）: draw call 平均 110→101、最大 182→208。三角形 約121k→148k。render 呼び出し CPU 42→120ms（ソフトウェアGLの律速で実機の値ではない）。draw call は目標（110前後、+20%まで）内。
- スクショ4枚を撮り直し全て目視確認（人物は関節・服・髪が見え棒人間ではない、看板・日よけ・接地影あり）。shoot.mjs errors/外部リクエストなし、`main.ts` 成功、game/ 37 ファイル 約1.0MB。

**improve-batch1 記録（街とミッションの密度）**:
- 歩行者: 35人（`PED_COUNT`）、外見 40 種（`PED_VARIANTS`、`(n*7+3)%40`）。スロット `n%7` で性格: 0=ジョガー(2.7〜3.3m/s)、2=のんびり、5=早足、3+4=並んで歩くペア（4 は 3 の `leader` に追従し、横断状態も共有。`_followLeader`）。ペアのリーダーが倒れる/非アクティブなら通常の単独歩行に戻る。
- 交通: 20台（`TRAFFIC_COUNT`）。`Traffic._pickCruise` で気質付き（バン/ピックアップは遅め、Vesper は速め、セダン/ハッチは慎重 18% / 急ぎ 16%）。
- ミッション: 走行中ずっと動く1つの時計＋`bonus`（ゲート通過ごとの加算秒）を `MissionTracker._enterStep` に追加。スクリプト 6=Costa Circuit（8ゲートのチェックポイントレース、ピンク色マーカー、車必須）、7=Seaside Patrol（5か所の巡回、徒歩/車可、緑マーカー）。以降の自動生成は `index-8` を3周期（Courier Job → Circuit Race → Harbor Patrol）。セーブは完了数のみなので互換。
- ショット: `drive` を進行中のレース（ゲート2/8・0:44）＋歩道の人々、`walk` をペア/ジョガー込みの歩道に変更。4枚とも目視確認済み。
- 性能（perf.mjs 25秒 640x360）: draw call 平均 101→114（予算 110+20% 以内）、最大 208→251、三角形 約152k。shoot.mjs errors なし、`main.ts` 成功。
- 注意: `shots.js` のペア従者は peds.list の index%7==4（4, 11, …）なので placeBetween で配置しない。

**improve-batch1 記録 v3（ゲームフィール）**:
- 運転（`vehicles.js`、プレイヤー運転時のみ。AI の加速/ブレーキは従来通り）: 加速は発進ブースト＋`1-(v/max)^1.25`、全体 0.72 倍で「溜めて伸びる」感触に（Marlin 0-100km/h 3.2秒、旧 2.7。Vesper 2.0秒）。ブレーキ 0.62 倍（100→0 約1.4秒、旧 0.9秒で壁のようだった）。ステア: 切り込み 9/s、戻し・切り返し 15/s、低速の切れ角を増加。グリップはハンドブレーキ解除後に 5/s で復帰（`this.grip`、急に噛まない）。スライドを追う自己整列アシスト（`yaw -= vR*0.16`、プレイヤーのみ・ハンドブレーキ中は無効）。ガスを踏んだままのハンドブレーキは速度低下を約半分（Marlin 60km/h で 1.5 秒に 141° 旋回し 21km/h 残る）。`vehicle.slip`（横滑り m/s）を公開。数値は `/tmp` の使い捨てシムで確認（0-60/0-100、ブレーキ、ハンドブレーキ旋回、復帰時間）。
- カメラ（`cameraRig.js`）: 車は「ステア+スライドの先読み」（`lead`、最大±約0.5rad、14m/s で全開、3/s で平滑化）、追従 4.5→4.2/s。FOV は `62+17(1-e^(-v/24))`（立ち上がりで広がり、頭打ち）、変化 2.5/s。衝突の揺れはランダムから正弦波に変更、閾値 impact>3、上限 0.16、減衰 9/s（酔いと見づらさ対策）。徒歩はダッシュで引き+0.35m・FOV+4。
- 手配（`wanted.js`/`police.js`/`world.js`/`audio.js`）: 追跡中パトカーの巡航速度 `24+1.8×★`（25.8〜33 m/s、プレイヤーの Marlin 41 m/s 以下）、増援間隔 `max(1.2, 2.5-0.3×★)`秒。★上昇で `wantedUp` 音、完全に逃げ切ると `onEscape(peak)`：ボーナス `$120×最大★`、大きな緑の `LOST THEM +$N` トースト＋`escaped` ジングル。台数・逮捕条件・heat 閾値は変更なし。
- HUD（`hud.js`/`style.css`/`index.html`）: ★獲得時のポップ、所持金の増減ポップと `+$N`/`-$N` 差分表示（2秒、連続加算は合算）、手配中の「POLICE ON YOU」/「EVADING…」メーター（`EVADE_TIME` を export）、赤青の画面端（★と最寄りパトカーの近さで濃さが変化、検索中は弱い）、DRIFT タグ（0.35秒保持）、最高速付近の速度線（`#speedfx` CSS のみ）、速度バーのレッドライン、`[F]` キーキャップ付きプロンプト、ミッション目標変更時のパネルフラッシュ、残り20秒未満のタイマー脈動、トースト登場アニメ、操作ヒントは14秒後に薄く。HUD はすべて DOM/CSS で draw call 増なし。
- ショット: `chase` を★4（heat 8.6）、パトカー4台に変更。4枚とも撮り直して目視確認済み。shoot.mjs errors なし。
- 性能（perf.mjs 25秒 640x360）: draw call 平均 103（前回 114）、最大 228、三角形 約146k。`main.ts` 成功・2回出力一致。game/ 37 ファイル 約1.0MB。
- 未検証: 実機でのキーボード操作感（この環境はヘッドレス+swiftshader のため、操作感は物理シムの数値と静止画での確認のみ）。画面端演出の赤青切替は静止画では片色しか写らない。

**improve-batch1 記録 v4（見た目2: 夕景）**:
- ライティング（`environment.js`/`config.js`）: `SUN_DIR` を南西の低い位置 (-0.5,0.47,0.72) に変更（海側から差し、影は北東へ長い）。太陽 0xffbb78×3.5、半球光 空 0xc8dcff/地 0xffd8ae ×2.8（影は青紫で潰れない）。フォグ 0xf3c9a6。画面が暗くなりすぎないよう半球光を厚めに調整。
- 空/雲/海: 空ドームを 40×20 分割にして地平アプリコット→薔薇帯→青→天頂＋太陽方位の暖色グロー。太陽ディスクは橙。雲は上面ピーチ/下面ローズ、太陽側ほど橙。海は遠方ほど空色（アプリコット）を映し、きらめきを太陽下の帯に集中、スペキュラは橙。
- スカイライン: 新規 `src/skyline.js`（街の外周に2層の遠景ビル群、クラスター中心で高さに山谷、段付き冠・尖塔・アンテナ。MeshBasic で紫がかったシルエット、+1 draw call）。丘は青灰系に。港: `scenery.js` に外側埠頭（歩行範囲外、コライダ不要）にガントリークレーン2基・コンテナ・貨物船を追加。
- ミニマップ（`minimap.js`/`style.css`）: 配色整理（海を濃青＋浅瀬帯、街区は明るい暖色＋縁、道路は暗色）、車・歩行者・パトカーに暗い縁取り、目標マーカーは3層縁＋脈動＋中心点（リム外は三角）、プレイヤー矢印に暗縁＋視野コーン、リムに暗い外輪。ズームは速度連動（徒歩 1.0、車 0.78→0.52）で 8%/フレームで平滑化。
- ショット: `shots.json` の4枚目を walk から `marina`（桟橋から夕日の海・空・灯台・ヨット）に変更。4枚とも目視確認済み。shoot.mjs errors なし。
- 性能（perf.mjs 25秒 640x360）: draw call 平均 100（前回 103）、最大 248、三角形 約148k。`main.ts` 成功。
- 注意: スカイラインは歩行範囲外の飾り。`?shot=harbor` はクレーン真下の画面（外側埠頭は背後）。

**improve-batch1 記録 v5（コンテンツ量: Gemini 設計の導入）**:
- 設計: Gemini 4 Carbon 作成の `/home/hatch/workspace/makefun-gta6/gemini-brief2.md`（Signal Intercept / Armored Shakedown / Costa Sun-Crests / 街イベント2種）を採用。優先順に実装。**実装したのは Signal Intercept と Sun-Crests。Armored Shakedown と街イベント（Tuner Breakdown / Sky-Ad Hauler）は未実装**（時間配分で 1・2 の完成度を優先）。
- 新ファイル: `src/signalIntercept.js`（標的セダン・Upload/Suspicion・回避行動・3D リング・報酬）、`src/crests.js`（配置・InstancedMesh 2本・取得・マイルストーン・セーブ ID）。
- **Signal Intercept**: スクリプト 8 番。ビーコン（reach、シアン）→ `kind:'intercept'` ステップで黒セダン `shade`（`vehicles.spawnTarget`、locked、`kind:'target'`）が 48〜78m 先の車線に出現し 45km/h で巡航（`RoadDriver`）。15〜45m で Upload +2%/s、15m 未満で Suspicion +25%/s（15m 以上で −10%/s、設計にない減衰を追加。無いと Ghost が不可能）、45m 超で一時停止＆12s で信号ロスト。Upload 50%/80% で標的が回避（ダッシュ 75km/h 6s / 脇道へ強制右左折 `RoadDriver.forceTurn` / 3s 急ブレーキ。順序は乱数）。100% で残り<20s なら +20s、20s 以内に 80m 超へ離脱で成功。失敗: Suspicion100、ロスト12s、標的に接触（`Vehicle.bumped`）、★2以上、150s タイマー、離脱 20s 超過。報酬 $1,400+$15×残秒+($400 ghost: PeakSuspicion<25%)。自動生成の周期は 4 本（Courier→Race→Patrol→Intercept）、`index-9` 起点。HUD は上中央の二重バー（280px）＋距離表示 `31 m [OPTIMAL]`、ミニマップはシアン三角＋赤破線 15m＋シアン実線 45m（範囲外で黄色点滅）、3D は 45m のシアン円筒＋15m の赤リング。
- 警察抑制（`police.js`）: Intercept 中は ★1 で出動 1 台のみ・出現距離 130m 以上・補充 6 秒間隔。`wanted.heatScale=0.6` で接触の加熱を弱める。
- **Sun-Crests**: 50 個（市 25: 公園 5＋歩道 20 / ビーチ 10 / 港 15: 桟橋＋コンテナヤード）。金の8角形メダル（InstancedMesh）＋黄色い光の箱で draw call +2。間隔は設計の 110m では収まらないため市 85m / ビーチ 55m / 港 26m に縮小（詰まったら緩和、実測最小 21m）。車線上には置かない。**屋上・ガレージ・日よけ・バージ・ジャンプ台などの高所/難所は未実装（すべて地上）**。35m（マイルストーン40以降 70m）でミニマップに金ダイヤ＋ソナーリング、取得で各 $250、右上トースト 4s（n/50・地区別・次のマイルストーンバー）、カウンター `◆ n / 50`、ポーズ画面に合計。マイルストーン 10/20/30/40/50: +$2,500/5,000/8,000/12,000/25,000、効果は走り+15%（`player.sprintMul`）、衝突ダメージ×0.75（`world.durability`）、手配低下 −20%（`wanted.evadeScale`）、レーダー2倍＋Dune Hopper（ビーチ縁石）、Serena Solari GT（マリーナ縁石）。セーブは `crests`（取得 ID 配列、`sanitize` 検証、旧データ互換）。
- ファイル別の手当て（前回 v3 の記録が封印できなかった9本に新機能に伴う変更）: `audio.js` 新イベント（icptStart/Evade/Done・failed・crestNear/crest/crestMilestone）と Upload ブリップ/疑念ブザー、`cameraRig.js` 標的を画面内に保つピボット寄せ・近接で引き＋FOV、`hud.js` 二重バー・距離表示・クレストカード/カウンター、`police.js` 抑制ルール、`shots.js` `?shot=intercept|crest`、`vehicles.js` `spawnTarget`・`bumped`、`wanted.js` `heatScale`/`evadeScale`、`world.js` Intercept/Crests の生成・更新・カメラ aid・耐久、`index.html` HUD 要素・タイトルの一文・ポーズのクレスト行。
- 検証（ブラウザ内スクリプト、`/tmp` の使い捨て）: 勝利時 $1,400+15×63+400=$2,745 を確認、クレスト取得・マイルストーン 10/40/50 の効果と報酬車、保存 ID、配置 50個（25/10/15）。ボットでの追尾はボットが壁に刺さり完走せず（ロジックの上限ケースは手動で検証）。**実機の操作感・長時間プレイは未検証**。
- ショット: `shots.json` を start / intercept / chase / crest に変更（drive と marina は撤去）。4枚とも目視確認済み。shoot.mjs errors なし。
- 性能（perf.mjs 25秒 640x360、同日の直前コミットの計測 115 に対し）: draw call 平均 121（+約5%）、最大 238、三角形 約157k。HUD+ミニマップ 3.1→4.4ms。`main.ts` 成功・2回出力一致。game/ 40 ファイル 約1.1MB。

**improve-batch2 記録 1（Armored Shakedown）**:
- 設計: Gemini 4 Carbon 作成 `/home/hatch/workspace/makefun-gta6/gemini-brief-batch2-1.md`（装甲輸送車強襲）を採用し全体を実装。前セッションが書いた実装を本セッションで動作検証。
- 新ファイル: `src/armoredTruck.js`（`ArmoredHeist`: 装甲車・アーマー・★エスカレーション・納品ビーコン・報酬・失敗判定）、`src/briefcases.js`（金ブリーフケース3個の放物線/バウンド/回転、光の柱+脈動リングを InstancedMesh 3本、回収判定 車3.8m/徒歩2.6m）、`src/particles.js`（黒煙・火花の ParticlePool）。`vehicleModels.js` に `armored`（ネイビー+ハザード、ルーフ灯2基、重量2.8）、`vehicles.js` に `spawnArmored`・`hitSpeed/hitBy/shield`、`wanted.raiseTo(n)`、`police.scramble`。
- ミッション: スクリプト 9 番（ビーコン→`kind:'armored'`）。自動生成は 5 本周期（Courier→Race→Patrol→Intercept→Armored）、`index-10` 起点。165秒、アーマー300、ダメージ `clamp((v-6)*5,18,75)`、最低 8m/s・1.2秒クールダウン、200/100/0 HP でケース放出（同時跨ぎは0.35秒差）、★1→★2（1個目放出）→★3（3個目＋パトカー2台即時出動）。3個回収で +30秒・納品点（350〜550m、ビーコン）、パトカー30m以内でロック（赤ビーコン+警告）、納品で★クリア。報酬 $2,800+残秒×$15(上限$2,100)+ヘビーラム×$150(最大4)+徒歩回収×$250(最大3)。失敗: タイマー、アーマー残で280m以上15秒。
- 検証（`/tmp/ams-test/ams-test.mjs`、ブラウザ内スクリプト、使い捨て）全項目 PASS: 開始時の出現 154m（120〜180）、ラム→ダメージ/★1/逃走21m/s、クールダウン、閾値ごとのケース放出、★3、停止、車での回収と徒歩回収（ON-FOOT GRAB ポップ）、3個目で deliver フェーズ＋ +30秒、ドロップ412m、パトカー8mでロック、離してクリア（$5,750・★0・次ミッションへ）、タイマー失敗、280m 15秒で失敗（14秒時点では継続）。バグ修正は不要だった。未検証: 実機の操作感、アラーム音等の聴感（ヘッドレス）。
- ショット: `?shot=armored`（黒煙の装甲車・光の柱つきケース・徒歩プレイヤー・★3・ON-FOOT GRAB ポップ）。`shots.json` は start / armored / chase / intercept の4枚に変更（crest は撤去、`?shot=crest` 自体は残存）。4枚とも目視確認済み、shoot.mjs errors なし。
- 性能（perf.mjs 25秒 640x360）: draw call 平均 111（前回121）、最大 234、三角形 約151k。`main.ts` 成功・2回出力一致。game/ 43 ファイル 約1.2MB。

**improve-batch2 記録 2（Roadside Tuner Breakdown: 街イベント1）**:
- 設計: Gemini 4 Carbon 作成 `/home/hatch/workspace/makefun-gta6/gemini-brief3.md` §1/§2/§4/§5/§6/§7（概要は `gemini-brief2.md` §3 Event 1）。**実装したのは AmbientDirector と Tuner のみ。Event 2（Sky-Ad Stunt Hauler）は次スロット**。ブリーフのファイル名（`systems/WantedSystem.js` 等）は実リポジトリの平置き構成（`wanted.js`/`save.js`/`hud.js`…）に読み替えた。
- 新ファイル（`src/ambient/`）: `AmbientDirector.js`（タイマー・ゲート・前方 110〜160m の道路スポット探索・1 件排他・`register(name, {curb, fits, create})` でハウラーを後から追加可・`forceSpawn`・`makeSpot`）、`TunerBreakdownEvent.js`（状態機械・メッシュ・リペア・盗難・退場）、`AmbientAudio.js`（`GameAudio` 上の合成: ホーン・リレークリック・ラジエータ音・修理アルペジオ）。`world.ambient` として world.js が保持、`afterStep` で更新。
- Director: 初回 60s、以後イベント終了/失敗/退場から 240s（`COOLDOWN`）。ジョブ中（`stepIndex>0` か `timeLeft!==null` か Intercept/Armored 稼働）は減らない。ジョブ終了後 5s 保留。ゲート（1s ごと）: ★≤1、海 30m 以内、前方コーン 35° の 80m グリッド直線道路（交差点中心から 18m 以上、取れなければ 2s ごとに再試行）。コライダと重ならない場所のみ。ジョブが始まるとイベントは即撤去（プレイヤーが盗んだ車は残る）。種類選択は登録種が 2 つ以上になった時の 80/20 交互ロジックのみ（今は 1 種）。
- Tuner: 縁石（道路中心から 7.9m）に18°歩道側へ鼻を向けた **Kestrel Street Tuner**（`vehicleModels.js` の新車種 `tuner`: クーペ車体、バイオレット 0x8b1eff、シアンのアンダーグロー、リアウィング。`accelMult 1.15`・最高速 42m/s）。ボンネットは 45° 開き（ヒンジ付き別メッシュ）、エンジン+橙のマニホールド、琥珀ハザード 2Hz（140m 以内）、白い蒸気キューブ InstancedMesh 10 個、シアンのリング（直径 2.0m・3rad/s で脈動）、手を振る NPC（`characters.js` の `buildNpc`、右腕の肩ロール 110〜155°）。生成時に 7m 以内の路駐車を撤去、12m 以内の民間車を遠方へ移動（`Traffic.clearArea`）。
- 遊び方: 140m 以内で下部キャプション `[AMBIENT] Stranded Street Tuner`（3s）+ ミニマップに脈動する水色レンチ（半径外ではリムに貼り付き）、70m 以内でホーン（9s ごと）、50m 以内でハザードのリレー音とラジエータ音。**A 修理**: 徒歩でリング内（≤1.0m・速度<1m/s）で **E 長押し 3s**（離すと -1/s で戻る、進捗バーは `#prompt-bar`）→ +$600 とポリス・バウチャー（★1 以上なら即クリア、0 なら 1 枠を貯める）。ボンネットが閉まり蒸気とリングが消え、NPC が跳ねて乗り込み、車は民間交通に合流（`Traffic.adopt`）、8s で終了。**B 盗む**: F で乗る（ハイジャック遅延なし）→ ★+1、オーナーが拳を振って通報し逃げる。時速 15m/s 以上で体当たりしても同じ（★+1、リング消失）。車は残り +15% 加速。**無視**: 220m 離れる/90s（修理中は停止）で消える、ペナルティなし。★2 以上: リングが消えて NPC は逃げる（修理不可）が盗むことは可能（★+1、最大 5）。
- バウチャー: `wanted.js` に `vouch`（0|1）・`grantVouch()`・`_redeemVouch()`。0→★1 の遷移から 0.6s 後に1つ消費（0→★2+ なら1つ減）。`onVouch` で `POLICE VOUCH REDEEMED` トースト。HUD は★の下に水色の `★ VOUCH x1` バッジ、`save.js` が `vouch` を保存（旧セーブは 0）。盗難＋バウチャーなら ★1 が点滅して 0 に戻る。
- ショット: `?shot=tuner`（コースト道路、東向きのタナーを手前から。4.2s 時点の蒸気・ハザード点灯・手を振る NPC・リング・徒歩プレイヤー（リングから 2.6m）・奥に民間車 2 台と歩行者 2 人・キャプション・ミニマップのレンチ）。カメラは設計の低い 3/4 位置（T+F*7.8−R*4.6+2.35、FOV48）だが、**車の前方側から撮る**（設計通りだとボンネットの裏側しか写らないため）、注視点を歩道側に 1.2m ずらして HUD と被らないようにした。`shots.json` は start / armored / chase / tuner（intercept は撤去、`?shot=intercept` 自体は残存）。4枚とも目視確認済み、shoot.mjs errors/外部リクエストなし。
- 検証（ブラウザ内、`/tmp/tn/check.mjs`、使い捨て）25/25 PASS: 60s 前に出現せず・60s 後に 115m・コーン内 8°、キャプション/アイコンは 140m 以内のみ（150m では無し）、ホーン 70m・クリック+ラジエータ 50m、1.5s で 50%→離して 0、3s で +$600+バウチャー、★1→0 の遷移 0.6s 後に消費、保存に `vouch:1`・リロード（CONTINUE）で復元、★1 での修理は即 0（バウチャーなし）、★2 でリング消失/NPC 逃走/盗みは ★+1・加速 1.15、盗み 0★→★1・バウチャーで点滅後 0、盗んだ車は残りイベントは終わりクールダウン 240、215m では残り 225m で消える・$0・車撤去、90s で消える、★2 とジョブ中は出現しない、ジョブ開始で撤去、ジョブ終了 5s 後に再開。**未検証: 実機の操作感・聴感（ヘッドレス）。音は呼び出し回数のみ確認**。
- 性能: 同一カメラのショット画面で、イベント無し 112 → 有り 133 draw call（+21: イベントの小道具は +6 = ボンネット・エンジン・ハザード・蒸気・リング+影パス。残りは追加の車 1 台と NPC 1 人）。三角形 +約 2.2k。perf.mjs 25秒 640x360（イベントは 60s までは出ない）: draw call 平均 120〜121、最大 243〜249、三角形 約 155〜158k。**同じ HEAD（変更なし）も 112〜120 とブレる**（swiftshader）ので悪化なし。`main.ts` 成功、game/ 46 ファイル 約 1.2MB。
- 注意: `?shot=tuner` の車の向きは東向き固定（`makeSpot(net, i, coastJ, 0, 44)`）。ヒント: 撮影時 `ev.announced = true` を立ててからキャプションを手で出している（そうしないと 3s で消える）。

**improve-batch2 記録 3（Sky-Ad Stunt Hauler: 街イベント2）**:
- 設計: Gemini 4 Carbon 作成 `gemini-brief3.md` §1/§3/§4/§5.2/§6/§7（概要 `gemini-brief2.md` §3 Event 2）。**gemini-brief2 の最後の項目。街イベントは Tuner + Hauler の2種**。ブリーフの `entities/Vehicle.js` 等は実リポジトリの平置き（`vehicles.js`/`world.js`…）に読み替え。
- 新ファイル（`src/ambient/`）: `StuntHaulerEvent.js`、`HaulerModel.js`（`buildHaulerModel`、ランプ定数 `RAMP_*`、`rampHeightAt`）、`HaulerArt.js`。
- 既存への変更: `vehicleModels.js` に `hauler` 車種（9.5m、cab のみ衝突円 `circles`/`circleR`、ランプは素通り）、`vehicles.js` に滞空 `airborne/vy/airTime/_fly`（重力・着地判定・車体ピッチは弾道に追従、空中の車は車同士の衝突を無視）、`onRampOf`（ランプ走行中は cab と衝突しない）、`spawnHauler`、`roadDriver.js` に `straight` オプション（交差点で常に直進、行き止まりのみ曲がる）、`world.js` に **`timeScale`**（`update(realDt)` 内で `dt = realDt*timeScale`。HUD/音/環境イベントのタイマーは実時間）と `ambient.drive/step` フック（`step` は物理サブステップごとにランプ面・発射・キューブ判定）、`AmbientDirector.js` に `def.aligned`（プレイヤーの進行方向±25°の道路のみ）、`hud.js`/`style.css` にキャプション色・`stunt`/`air` トースト、`minimap.js` にハウラーアイコン（12px 黄ウェッジ+マゼンタ菱形+白矢印、トラックの向き）、`AmbientAudio.js` にジングルと SFX、`shots.js` に `?shot=hauler`。
- 遊び方: トラックは 25km/h で直進する黄色フラットベッド（22°ランプ、緑シェブロンが上へスクロール）。ランプの7.2m×3.2m の上を後ろから登り、リップ（高さ2.75m）で発射。相対速度×tan22° の縦速度＋**絶対速度が 65km/h 以上なら +5.7m/s のリップブースト**。キューブ（3m、リップの12m先・高さ9m、1.4rad/s 回転・±0.35m ボブ、ローター4基・テザー）に当たる（60km/h 以上の発射なら判定を尊重、球 2.2m vs 箱）とシャード16個・**実時間 2.0 秒の 0.4 倍スロー＋サイドカメラ（中点から横 9.5m・高さ 6.8m・FOV52、空いている側を選ぶ）→0.45 秒で追従カメラへ戻す**・+$850・耐久100%・★加算なし。65km/h 未満や外れは着地時（滞空 0.45 秒以上）に +$100（1台につき1回）、キューブは残り再挑戦できる。運転席は施錠（F で `The cab is locked` とブザー）。プレイヤーから 250m 超で撤去、ディレクターのクールダウン 240 秒。
- 弾道（truck 座標系、ブーストの意味）: ブリーフの数式は静止トラック前提で、実際は 6.94m/s で動くため相対速度で再計算。`vy = vrel*tan22° + (65km/h 以上なら 5.7)`。65km/h（相対 11.1m/s）でキューブ中心付近 y≈8.0m、100km/h で 9.2m、150km/h でも 8.9m。45km/h は最高 3.4m で下をくぐり約 1.0 秒で着地（5.6m 先）。
- ディレクター: 初回は TUNER/HAULER 50/50（2000回の集計 970/1030）、その後は直前と別を 80%（集計 1584/2000、1595/2000）。1 件排他・0〜1★・ジョブ中は不可・前方 110〜160m（検証 124m）は従来どおり。
- 音: 100m 以内で 128BPM のジングル（8分音符32ステップ=7.5秒ループ、矩形リード+ベル倍音+F#2/F#3 バウンスベース、2600Hz ローパス、音量 (1-d/100)²、キューブ破壊で即フェード）、ガラス砕け+サブドロップ（90→32Hz 0.9秒）、F#maj9 チャイム、エア音、施錠ブザー。`world.emit('ambShatter'|'ambStunt'|'ambAir'|'ambLaunch'|'ambLocked')`。
- 検証（ブラウザ内、`/tmp/hv/check.mjs`、使い捨て）全 PASS: 45km/h で +$100・キューブ残存・星なし、2回目の滑空は +$0（1台1回）、85km/h（耐久35）で +$850・耐久100・★0・0.4倍が 120 フレーム=2.00 秒・カメラ 9.5m/6.8m/FOV52・シャード16個・イベント音3種、240m で存続/262m で撤去（トラック消滅、`timeScale` 1、クールダウン 240）、130m 超でキャプション/アイコンなし・125m で出る・キャプションは1回のみ・ジングルは 100m 以内のみ、シェブロンのスクロール、施錠、★3 でスポーン拒否、ミッション中不可、進行方向に揃った道路（124m）。**未検証: 実機の操作感・聴感（ヘッドレス。音は呼び出しのみ）、ローターは回転せず（キューブごと回る）、設計の「0.35秒のシアン発光パルス」は未実装。**
- ショット: `?shot=hauler`（コースト道路、0.18 秒時点で凍結した、キューブを突き破る深紅のクーペ・シャード16個（大2+放射14）・HUD の `STUNT SMASH! +$850 / VEHICLE REPAIRED 100%`・ミニマップのアイコン・背景にクレーンとビーチ）。**設計のカメラ（L+F*7.5+S*10.5+UP*5.8、FOV52）はトラックが画面外（レンズの後方下）になるため、ランプの後方 7.5m・街の中心側 10m・高さ 6.6m・FOV46 に変更**（`shots.js` の `FRAME`）。ミニマップのアイコンは車がトラックの 14m 先なのでプレイヤー矢印の真下に小さく重なる。**`shots.json` は 2-armored を撤去し 2-hauler に入れ替え**（start / hauler / chase / tuner。armored は★・警察・歩行者の見どころが chase と重なるため。`?shot=armored` 自体は残存）。4枚とも目視確認済み、shoot.mjs errors/外部リクエストなし。
- 性能: 同一カメラで イベント無し 170 → 有り 176 draw call（**+6**、トラック込みの測定値。イベント固有の小道具はシェブロン・キューブ・ローター・テザーの4。内訳の再計測はしていない。予算 +6 内）。三角形 +約0.7k。perf.mjs 25秒 640x360（イベントは 60s までは出ない）: draw call 平均 112、最大 251、三角形 約149k（前回 120〜121 / 243〜249 / 約155〜158k と同等、swiftshader の揺れ内）。`main.ts` 成功・2回出力一致。game/ 49 ファイル 約 1.2MB、`http` 参照なし。

**improve-batch2 記録 4（Harbor Contraband Run: 乗れるスピードボート + Harbor Patrol）**:
- 設計: Gemini 4 Carbon 作成 `/home/hatch/workspace/makefun-gta6/gemini-brief4.md`（全9節）。**ブリーフのパス（`vehicles/boatSystem.js`・`police/harborPatrol.js`・`core/playerController.js`・`ui/hud.js`・`audio/soundEngine.js`・`debug/screenshotModes.js` 等）は実リポジトリの平置きに読み替え**: `boatSystem.js` / `harborPatrol.js` / `contrabandMission.js`（新規）、`vehicles.js`・`police.js`・`player.js`・`hud.js`・`audio.js`・`shots.js`・`world.js`・`cityBuilder.js`・`scenery.js`・`missions.js`・`wanted.js`・`minimap.js` は既存を最小限の差分で拡張。
- 新ファイル（1ファイル1責務）: `boatSystem.js`（`Boat` 物理・3つの係留 Sunrunner・乗降・沈没・波跡・InstancedMesh 描画）、`boatModels.js`（Sunrunner/Patrol/ブイ/マーカー/泡のジオメトリ）、`shoreline.js`（地形高さ・桟橋/岸壁/貨物船/灯台の衝突・上陸地点・接地ガード）、`harborPatrol.js`（巡視艇 AI・水上逮捕）、`contrabandMission.js`（5状態 FSM・ブイ・報酬）、`boatAudio.js`（船外機シンセ・SFX）。`environment.js` に `seaHeight()/SEA_LEVEL` を export（海メッシュと同じうねりを船・ブイ・泡が使う。**実際の海面は y=-0.5+うねり**でブリーフの 0.0 ではない）。
- **ピア**: `cityLayout.js` が `layout.docks` に 3 本の `marina: true` ピア（x=-20/38/76、z 336..390、天面 0.45）と `layout.marina = {piers, slip}` を追加。docks に入れたので歩行範囲（bounds）と `groundHeightAt` が自動で効く。`scenery.js` の `addMarinaPier`（杉板・杭・クリート・係留ボラード、Pier 1 に灯と接触ボラード）と `addSmugglersSlip`（x=-340,z=372。2本の短い指状桟橋）を既存の結合メッシュに追加（draw call 増なし）。ミニマップのピアは #c89d6c。区画名 "Costa Marina Pier"。
- **ボート物理**（ブリーフ §3 の数値どおり）: 最高 34.0 m/s・後進 9.0・推力 22.0、抗力 0.42（>10 m/s）/0.85、船首ピッチ `clamp(v/34)*7.5°+sin(3.8t)*1.8°`、舵角 1.65 rad/s ×(0.35+0.65 v/34)、ロール `-steer*(v/34)*16°`（内傾）、横滑りは 2.2/s で減衰。Space = ハイドロトリム（クールダウン 6.0 秒、1.2 秒間推力 ×1.25・上限 42.5 m/s、v>8 で 1.8 m のホップ。空中は抗力なし）。船体 HP 250、衝突ダメージ `衝突速度×2.2`（0.35 秒クールダウン、`world.durability` を掛ける）、0 で停止→黒煙→4.0 秒かけて沈没→最寄りの桟橋/浜へ上陸＋$250（逮捕中は取らない）。係留艇は 0.08 m・1.4 Hz で上下動、60 秒後に再係留（沈没後 / 無人で 180 m 超離脱、プレイヤーが 30 m 以内なら待つ）。
- **接地ガード**: 浜（z < 348.0 = 地形高さ > -0.15 m）に当たると抗力 6.5/s＋沿岸法線（+z）へ押し戻し。桟橋・岸壁・外側埠頭・貨物船・灯台・内港のヨットは固体（ダメージあり）。**ビーチへ 30 m/s で突っ込んでも z 351.6 で止まり（街路に出ない）、ダメージ約 74**（ブリーフの目安 66）。巡視艇も同じ物理なので岸に乗り上げない（検証 z>349）。
- **乗降**: 3.2 m 以内（艇の外形矩形まで）で `[F] Board Sunrunner 28`。降りるのは桟橋/浜 6.0 m 以内（艇速 12 m/s 以下）で `[F] Step onto dry land`、上陸点に ground+0.5 m から落ちる（`p.jump=0.5`）。プレイヤーが海に入る手段はないため「wading 3.5 m」は 3.2 m の矩形距離に統一。救出・逮捕時は `boats.release` で艇を係留へ戻す。**セーブ**: 形式・バージョンは不変。ボート乗艇中の保存は Pier 1 の甲板位置・徒歩として書く（`save.js` の 2 行）。
- **Contraband Drop**: Pier 1 の水色リング（半径 1.8、利用可能時のみ）に徒歩で入るか、Pier 1 の艇に F で乗ると開始。ブイ 4 個は Pier 1 から 140〜420 m・95 m 以上離して扇形 4 セクタに 1 個ずつ（シード固定）。BRIEF 2.0 秒（非ブロッキングのキャプション）→COLLECTING（取得半径 4.5 m）。1個目 ★1、2個目 ★2＋巡視艇 1（160 m 先の沖側）、4個目で RETURN（★3、2 隻目の巡視艇 150 m）。スリップ（Pier 1 から 320 m 西）の半径 6.0 に 8.0 m/s 未満で入ると納品。報酬 `$3,200 + 残秒×$25 + ($650: 船体≥200)`、★を 1 つ下げる（`Wanted.dropStar()` を追加）。失敗: 時間切れ、船体 0、BUSTED（`onPlayerDown`）、艇を降りて 25 秒超（`ABANDON` 表示）。完了/失敗後 45 秒のクールダウン。**他ミッションとの排他**: ジョブ中（`stepIndex>0` / `timeLeft` / Intercept / Armored）は開始不可、稼働中は `missions.update` が停止（マーカー非表示・`view`/`target` はこのジョブのもの）、`AmbientDirector.missionBusy` も参照する。
- **Harbor Patrol**: 艇に乗り ★2 以上で沖（z>385）に出ると、★2=1隻（最高 32.5 m/s、右舷に並走→接触）、★3〜5=2隻（36.0 m/s、左右から挟む）。艇同士の接触で衝突ダメージ 18〜35（1.6 秒クールダウン、`ramPolice` 加熱）。水上逮捕: 自艇 <2.5 m/s で巡視艇 9.0 m 以内 4.0 秒 → 標準 BUSTED（HUD の逮捕バーは陸上と共用、`Math.max`）。★が 2 未満になる/陸に上がると（ミッション外）消える。`wanted.update` の最寄り距離に巡視艇も含める。**未実装/簡略**: 「スポットライト」の光表現なし、巡視艇の沿岸道路への警察配置はなし（通常の陸の警察がそのまま道路網で動く）。
- **HUD/ミニマップ/音**: 艇では速度が KTS（m/s×1.944）、HULL バー（シアン→<35% 琥珀→<15% 深紅）、TRIM BOOST ピップ（Space、クールダウン中は灰）。上中央に `CONTRABAND DROP | ■■□□ 2/4 | 01:18（<20秒で赤）| +$650 CLEAN HULL`（船体 <200 で取り消し線）と放棄カウントダウン。Pier 1 の上に画面投影の `CONTRABAND DROP` ラベル。ミニマップ: ピアの棒、係留艇の白シェブロン、Pier 1 のシアンのリング、シアンのブイ菱形、スリップの金のアンカー付き破線リング、巡視艇の赤青点滅三角。音（`boatAudio.js`）: 58/61.5→185 Hz の鋸歯 2 基＋LPF 420→1900 Hz＋600〜1800 Hz のバンドパスノイズ、着水ドスン（vy<-2.5）、ソナー 2 連チャープ（880→1320 Hz）、巡視艇ホーン（310+370 Hz 220 ms、160 m 以内のスポーン）、トリムの風切り。
- **描画（draw call）**: Sunrunner IM（最大 3）・Patrol IM（2）・ストロボ IM（赤青、4）・泡 IM（160、V 字の腕＋ルースターテール）・ブイ IM（4）・マーカー IM（Pier 1 リング/スリップ）。**ピアは scenery の結合メッシュに入れたので +0**。アイドル時は Sunrunner IM（+1）と、利用可能時のマーカー（+1）、ピーク（巡視＋ブイ）は同一カメラの実測で **+6**（57 vs 51、予算 +6 内）。三角形 +約 2.5k。影は落とさない。
- **`?shot=harbor_chase`**（`shots.js`）: 190 フレームの決定論的な走行（W、最後 12 フレームだけ D）で Sunrunner を x≈60,z≈418 まで西へ走らせ、船体 92%（230/250）・ピッチ +7°・ロール 11°、COLLECTING 2/4・残り 1:18・★2・巡視艇を 19 m 後方の右舷に配置（足跡の泡が出る）。カメラはブリーフどおり `P+F*16.5−R*11+(0,4.6,0)`、注視点 `P−F*4+R*2.5+(0,1.4,0)`、FOV 52。**ブイだけ変更**: ブリーフの座標（機首の前 9.5 m・左 4.8 m）では前景にマストが真ん中を横切って船を隠し、「26 m 先」はカメラの背後になるため、`P+F*9+(右)*5` ではなく「進行方向 +1 m・右舷側 10 m」（画面左 1/3、ミニマップに被らない）に置いた。
- **スクショ差し替え**: `4-tuner.jpg` を撤去し `4-harbor.jpg`（harbor_chase）に入れ替え。構成は 1-start / 2-hauler / 3-chase / 4-harbor。理由: Tuner は街イベントで chase とカメラの見せ場（歩行者・交通）が重なり、ボートは新しい「第二の領域」を 1 枚で示せる。`?shot=tuner` 自体は残存。4枚とも Read で目視確認済み（ヒーロー: 青い海の上のプレーン、ブイ、巡視艇、桟橋、クレーン、スカイライン、KTS/HULL/TRIM、ミニマップに艇と桟橋）。
- 検証（`/tmp/hb/check.mjs`、ブラウザ内、使い捨て）52/52 PASS: 3 ピア・3 艇・0.08 m の上下動、3.2 m で乗艇プロンプト・遠方でなし・F で乗艇、34.0 m/s に 2.5 秒・65.6 KTS・ピッチ最大 9°（7.5+1.8 のチョップ）・ロール約 14〜16°、トリム 42.5 m/s・ホップ 1.6 m・クールダウン 6 秒、ビーチ衝突で街路に出ない・ダメージ 74・降りられる・100 m 沖では降りられない、リング→BRIEF→COLLECTING、ブイ 4 個が 140〜420 m（実測 185〜346）・間隔≥95、各ブイの ★/巡視艇の段階、スリップ 320 m・8 m/s 超では不可、**納品 $4,850（3,200+40×25+650）・★−1・IDLE+クールダウン 45・ブイ撤去**、時間切れ/船体 0/沈没（+$250、桟橋/浜に上陸）/再係留/放棄 25 秒の失敗、★2 で 1 隻（32.5）・★3 で 2 隻（36.0）、水上逮捕 4.0 秒で BUSTED→徒歩でリスポーン、★低下で巡視艇消滅、巡視艇の接地ガード。**未検証: 実機の操作感・聴感（ヘッドレス。音は呼び出しのみ）、`renderer.info.render.calls <= 117`（ブリーフ値）は海だけの画面で 57。市街と並べた最悪ケースの手動計測はしていない（perf の最大は 251 で従来と同じ）。**
- 性能（perf.mjs 25秒 640x360）: draw call 平均 96（前回 112）、最大 251（前回 251）、三角形 約 146k（前回 149k）。`main.ts` 成功・2回出力一致。game/ 55 ファイル 約 1.3 MB、`http` 参照なし。
- 既知の見た目の課題: ボートの船体は低ポリで船首が丸い、ルースターテールは小さい（遠景から見ると V の腕が白い筋に見える程度）。乗艇中の人は描画しない（DOM のみ）。

**improve-batch3 記録 1（Costa Air-1 Tactical Pursuit: 警察ヘリ + サーチライト + Spike-Pod + Scanner Ghost）**:
- 設計: Gemini 4 Carbon 作成 `/home/hatch/workspace/makefun-gta6/gemini-brief5.md`（全8節）。ブリーフのパス（`systems/WantedSystem.js` 等）は実リポジトリの平置きに読み替え。新ファイル `src/airpursuit.js`（1ファイル1責務: ヘリ・ビーム・Pod・6状態機械・LOS・Cold Swap・ペイアウト・`?shot=airpursuit` の配置）。既存の `wanted.js`/`vehicles.js`/`hud.js`/`audio.js`/`main.js`/`minimap.js` は最小差分。
- **前回（23:00 JST）セッションが残したもの**: 中断時点で未コミットの `airpursuit.js`（約1012行）と 5 ファイルの差分が実装済み。状態機械・サーチライト・Pod・ペイアウト・HUD・音・ショット配置まで一通り入っていたが、shots.json に air エントリなし、検証・スクショ撮り直し・記録は未了だった。**破棄せずそのまま引き継いで監査・完成**。
- **今セッションの監査と修正**（ブリーフ §2〜§7 と数値を1行ずつ照合。ゲート 3★×4.0s、INBOUND 220m/42m/s/+58m、TRACKING オフセット28m・高度42/36/30・速度34/40/46・加速18、スルー 22/30/38°/s、コーン13°、lockTimer +1.0/−0.75・1.5sでLOCKED、LOS 2.0s/110m・LOCKED 95m、星減衰凍結、Pod 9.0s/0.65/0.85/強制18s・1.4sテレグラフ・5.6×1.4m・22s、SEARCHING 22+3.5t・0.55rad/s・18s、RTB 150s・+9m/s・48m/s・280m/8s・25sクールダウン、パンク 0.62/0.55/0.48/9.0s、ペイアウト 650/1200/2000+150+100×4 は全て実装済みで一致）。見つけた不足/誤りを修正:
  - `airpursuit.js`: ① 逮捕時に `rtbCooldown` が（ヘリが既に INACTIVE のとき）0 に戻らなかった → fx 分岐で 0 に。② **INBOUND が 42m/s 固定だと、Vesper 最高速 51m/s に永遠に追いつけない**（INBOUND のまま燃料切れ）→ `max(42, 目標速度+6)` に（ブリーフからの逸脱、理由は上記）。③ SEARCHING のビーム掃引半径が 9m でディスク半径（約9.3m）と同じため、最後に見失った地点に立つプレイヤーは常に照らされ Cold Swap が成立しない → 掃引半径 `sweepR=16m` に。④ 落下中の「路面 3.2m 点滅リング」が空中のポッドにしか付いていなかった → 同じジオメトリの InstancedMesh を 6 インスタンス（0-2=ポッド、3-5=路面の着地マーカー、点滅）に拡張（**draw call は 1 のまま**、ブリーフの「最大3」からの逸脱）。⑤ SEARCHING の減衰 1.25 倍の重複する警察距離判定を整理（`wanted.update` 側が既に視認範囲外のみに適用）。⑥ `?shot=airpursuit` が 2 回読み込みで一致しなかった（空ドーム/太陽がカメラ配置後に未更新、CSS アニメ、ミニマップの警察点滅が `performance.now`）→ カメラ後に `env.update(0, …)`、CSS アニメ/トランジション停止、ミニマップに `extras.now`（Air-1 の固定時計）。
  - `wanted.js`: `airTarget` が `{x,z}` だけで期限が無く、コメントの `{x,z,at}` と不一致 → `age` を持たせ 2.5s（`AIR_PING_TTL`、1.0s ごとの再送の2.5倍）で破棄。
  - `vehicles.js`: `puncture()` が二重発動すると 0.62 倍の減速が重なり 9s タイマーが再始動した → 発動中は無視、ヨーキックを ±0.35 に clamp。
  - `audio.js`: ローターバスを「ランプ後に厳密に 0.000」へ固定（`setValueAtTime(0, t+0.11)`）、ドップラー量の有限値ガード。
  - `hud.js`: ミニマップのオーバーレイが `S/XM/ZM` を直書き（「minimap.js と揃える」コメント）→ `minimap.js` から `S`/`X_MAX`/`Z_MAX` を export して import（ズレ防止）、ローターアイコンを 1.45 倍（440px キャンバスを 236px 表示するので小さすぎた）。`minimap.js` は `extras.now` と定数 export のみ。
  - `main.js`: shot 分岐に `hud.update(0, world)`（最終状態の HUD を反映）、ミニマップに Air-1 固定時計。
- ショット `?shot=airpursuit`（`shots.json` の `3-air.jpg`）: シード固定、Vesper（ドリフト 11°、26m/s）、4★ VISUAL LOCK、LOCKED の Air-1（バンク −18°/ピッチ、P−R·9+U·21−F·12）、ビームが P+F·1.2 を捕捉、武装済み Pod 1 個（P−R·3.8−F·3.5）、パトカー 2 台、対向車 3 台、歩行者 4 人、カメラ FOV54・P+R·9.5+U·4.2+F·16.5、注視点 P−R·3+U·8.5−F·5。**ブリーフのカメラ寸法をそのまま採用**（画面外にならなかった）。2 回読み込みで **ピクセル完全一致（差分 0）**。**スクショ差し替え: `3-chase.jpg` を撤去して `3-air.jpg` に入れ替え**（★4+パトカー+ミニマップ+ミッションの見せ場が air の 1 枚に含まれ重複するため。構成は 1-start / 2-hauler / 3-air / 4-harbor。`?shot=chase` 自体は残存）。4枚とも Read で目視確認済み。
- 検証（ブラウザ内の使い捨て `/tmp/air1/dbg/check.mjs`、playwright + swiftshader）**38/38 PASS**: 3★ 3.8s では出ず 4.0s で INBOUND（220.0m・高度 58.0m・進行方向の後方）、TRACKING 突入 64.8m（≦65）、LOCKED まで 2.25s（TRACKING 7.8s→LOCKED 10.1s）で `airLock`（PA チャープ）、LOCKED 中 5s で evade 0（星減衰 0.0・`airFreeze`）、3★ の高度 42.0m・ディスク R=9.35m、LOS が実建物で遮断/空では通る、`_los` を遮蔽にして 1.8s では LOCKED のまま・2.0s で `AIR-1 SEARCHING 18s`・星減衰の凍結が解除、徒歩→別の民間車（Marlin、id≠tracked）で `DECOY CLOAK`（`coldSwap=1`、ピル表示）、カバーから出た後チョッパーが 22m まで近づいても再捕捉なし（8s）、SEARCHING 18s タイムアウト→ REFUEL_RTB・3★→2★、RTB 終了 → INACTIVE・`rtbCooldown` 25・クールダウン中は再出動なし、4★ LOCKED で強制ロール → Pod がヘリから 70.3m（≦75m）に落下・1.38s で武装（テレグラフ 1.4s）・着地マーカー実体あり・`airSpikeDrop` 音、Pod 命中 35.2→21.9 m/s（**0.622 倍**）、命中後のトップスピード上限（Vesper 最大 52 → 0.55 倍=28.6、実測 26.4）、`airPuncture` 音、9s ランフラットで 0 に戻り再び 47m/s まで加速、8m 以内を 22m/s で通過して `dodged=1`・命中なし、Scanner Ghost = **$1,200（4★）+$150（Cold Swap）+$100×2（dodge）= $1,550** で toast も 1550（実財布は +$120 の LOST THEM 込み）、**リロード後も所持金が保存値と一致**、ローターバス稼働時 `rotorLevel`=0.037→クリアで 0・`rotorGain.gain.value`=0・LFO 深度 0、逮捕で `rtbCooldown`=0、燃料 150s で REFUEL_RTB。`world.fx` 中は払い出しなし。**未検証: 実機の操作感・音の聴感（ヘッドレス）、実在の高架下・ガソリンスタンド屋根での遮蔽（街に高架は無く、遮蔽は建物ボックスのみ。`_los` を実建物で単体確認）**。
- 性能（同一カメラ ?shot=airpursuit、`renderer.info.render.calls`）: ベースライン（Air-1 全非表示=INACTIVE）109 → LOCKED+Pod 1 個 114、Pod 3 個でも 114（**+5**、予算 ≦+5 内）、INACTIVE は +0。三角形 約 0.7k。perf.mjs 25秒 640x360（3★ なので Air-1 稼働込み）: draw call 平均 115.4、最大 235、三角形 約 155.9k。**同日の HEAD（53c7c13、Air-1 なし）を worktree で測ると 平均 104.7、最大 265、約 149.5k**。差は Air-1 の +5 と swiftshader の揺れ内。
- `main.ts` 成功・2回出力一致、game/ 56 ファイル 約 1.4MB、シンボリックリンクなし、`http` 参照なし、shoot.mjs errors/外部リクエストなし。
- 既知の見た目/仕様: ビームは LOCKED で琥珀だが加算合成の弱い値のため淡い色（ほぼ白）に見える。ローターのブレード羽根はヘリ全体の向きに従う（個別に傾けない）。Cold Swap 後の SEARCHING で再び照らされるのは「ディスクの直撃」か「26m/s 超かつ 35m 以内」のみ。

## 操作
WASD 移動/運転、Shift 走る、**E 長押し（ストランデッドタナーの修理）**、Space ジャンプ/ハンドブレーキ（ボートではトリムブースト）、F 乗降（ボートの乗降を含む）、マウス視点（クリックでポインタロック）、Esc/P ポーズ。

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
