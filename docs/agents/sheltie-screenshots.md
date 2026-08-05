# スクリーンショットシステム

Sheltie の Webview スクリーンショット撮影・永続化・差し替えタイミングの正本。表示モードや状態管理は `sheltie-runtime.md` を参照。

実装の主入口:

- `src/hooks/sheltie/useScreenshotCaptureQueue.ts`（撮影キュー・永続化）
- `src/hooks/sheltie/useNativeRevealController.ts`（macOS の opacity フェード）
- `src-tauri/src/commands/webview/screenshots.rs`（Rust 側）

## 永続化

PNGファイルとして保存する（macOSのみ）。保存先は`~/Library/Application Support/jp.brdr.app.sheltie/screenshots/{projectId}/{pageId}.png`、撮影時メタデータは同じ場所の`{pageId}.json`。`projectId`は`.sheltie`に保存した安定IDで、`Project.id`として読み戻す（文書に無い場合だけ新規生成する）。開くたびに再生成しないことで、lazy restoreがセッションを超えて機能する、`pageId`はnode ID（WebPage系Webview IPCでは歴史的に`pageId`命名）。sidecarのschemaは`{ schemaVersion: 1, capturedAt, capturedUrl }`で、`capturedAt`はRFC 3339とする。

**撮影時**:

1. Rust `save_webview_screenshot(label, pageId, projectId, capturedUrl, hideAfterSnapshotRequest?)` → WKWebViewスナップショット要求。`hideAfterSnapshotRequest=true`の時は要求直後に同じコマンド内でWebviewをhideし、PNGとsidecarを保存して`{ filePath, capturedAt, capturedUrl }`を返す
2. JSで`convertFileSrc(filePath) + '?t=Date.now()'`のasset URLと返却メタデータを1つの`ScreenshotCacheEntry`としてruntime storeへ設定し、`<img src>`にも反映する
3. `Image.decode()` でデコード完了を待ち、既存 screenshot は新 URL 準備まで差し替えない
4. `onScreenshotPresented(pageId, url)` で表示可能スクショとして登録し、`screenshotReadyRef.current[pageId] = true`

**lazy restore**:

- `useScreenshotCaptureQueue`の`projectId + WebPage node IDs`依存effectが、runtime cacheにまだ無いpageを対象に`get_existing_screenshot_paths(projectId, pageIds)`を実行し、local stateとstoreの両方へ反映する。`setupProjectPersistence()`はスクリーンショットをpreloadしない
- sidecarが無いlegacy PNGやsidecarが壊れているPNGは、ファイル更新時刻を`capturedAt`、`capturedUrl: null`として復元する
- sidecarの`capturedUrl`が現在のnode URLと異なるPNGは復元せず削除する。in-memory entryより古いdisk entryは上書きしない
- 復元URLは`convertFileSrc(filePath) + '?t=restored'`。復元後に`computeDisplayModes()`を再実行して正しいmode判定に収束させる

**GC**: 起動時に`prune_screenshot_cache`を1回だけ呼び、最終更新から30日を超えたproject directoryを削除する。開いていない`.sheltie`も正当に存在しうるため、開いている文書と照合して消す方式は採らない。

**削除**: ページ削除時に`cleanupPageArtifacts()` → `delete_screenshot(pageId, projectId)`でPNGとsidecarを両方削除する。

**Tauri 設定**: `tauri.conf.json`の`app.security.assetProtocol.enable = true`とscope`$APPDATA/screenshots/**`、`Cargo.toml`の`tauri` featureに`protocol-asset`。

## MCPからの一括取得

- `get_webpage_screenshots`は指定IDを検証した後、board順で全結果を返す。ID省略時は全WebPageが対象
- 現在`native`のpageだけ既存capture queueで再撮影を試みる。`screenshot` / `hidden`のWebviewを表示・移動・リサイズして撮影しない
- native撮影に失敗しても既存cacheがあれば返す。cacheが無いpageは`freshness: missing`として返し、call全体は失敗させない
- 返却用画像だけcanvasで最長辺1024px以下のPNGへ縮小する。保存済みPNGは書き換えない。asset取得・decode・encodeに失敗した場合は`screenshot_failed`

## MCPからのpage単体撮影

- `browser_screenshot`の`viewport`は現在modeが`native`ならWKWebView snapshotを1回取得し、失敗時だけ既存cacheへfallbackする。`screenshot` / `hidden`ではcacheだけを返し、Webviewを表示・移動・リサイズしない
- `element`はcurrent `snapshotId` / `elementRef`から得たviewport内CSS rectをnative scaleへ変換してcropする。target全体がviewport外なら`screenshot_target_not_visible`
- `fullPage`は同じpage actor内で最大64 tileを横・縦へscroll/captureし、actual `(x, y)` offsetで重複を除いてstitchする。全tileを保持せず、最終4096px / 16,777,216 pixels内のcanvasへ1枚ずつ縮小合成する。capture中にdocument/epoch/geometryが変われば`page_changed_during_capture`とし、成功・失敗にかかわらず元scroll位置へrestoreを試みる
- PNG headerのdimensionをdecode前に検査し、decode後も最長辺4096px、16,777,216 pixels、encoded PNG 8MiBを検査する。上限を超える出力はaspect ratioを維持して縮小し、収まらなければ`screenshot_too_large`
- `annotate: true`は対象rectへ薄い背景と色付き2px borderを合成する。cache fallbackではWebviewを表示して対象を再取得せず、`annotated: false`とwarningを返す
- 永続化cacheは入力として読むだけで、返却用crop/stitch/annotation/縮小結果を書き戻さない。base64はMCP image blockだけへ入れる

## MCPボード全景画像

- `get_board_screenshot`はboard stateをbounded Canvas 2Dへ直接描画し、visible viewport・selection・display mode・React Flow DOMを変更せずにPNG化する。DOM clone方式はWKWebViewで画像化Promiseが停止し得るため使わない
- 全nodeのframe外接矩形へ64 world pxのpaddingを加える。WebPageはframe chrome込みで計算し、出力はaspect ratioを維持して最長辺2048px以下とする
- subset指定時は指定nodeだけをboard順で残し、両endpointがsubsetに含まれるedgeだけを描画する
- WebPageのcache画像、付箋、Tiptapテキスト、edgeとarrowhead、現在themeの背景色をCanvasへ合成する。selection frame、handle、toolbarなど一時UIはboard stateに含まれないため描画しない
- WebPageはmounted済みcache URLだけを最大2秒で読み込む。hidden/native Webviewを表示・移動・撮影せず、cacheが無いかdecodeできないWebPage IDは`missingScreenshotNodeIds`へ返す
- Canvasと読み込んだ画像はrequest内だけで保持し、作成したobject URLは成功・失敗にかかわらず解放する

## 撮影タイミング

撮影は目的の違う 2 系統に分かれる。

### ① 鮮度キャプチャ（保存スクショを最新に保つ・Webview は native 維持）

`useSheltieNodeRuntime.scheduleFreshnessCapture(nodeId, reason)` に集約。`reason` 別の遅延は `FRESHNESS_CAPTURE_DELAY_MS`、node 単位で latest-wins。

- `navigation`: 1000ms（新コンテンツ描画待ち）。SPA URL 変更（`\x01`）とフルページ遷移開始の両方が対象
- `load`: 初回ロード相当（最初のタイトル変更）で即時
- `scroll`: Webview 内スクロール完了（`page-scroll-ended-{pageId}`）で即時

### ② 退避キャプチャ（native→screenshot/hidden に落とす直前の現フレーム押さえ）

- pan/zoom 開始時（保存済みがあれば stale を即表示しつつ `hideAfterSnapshotRequest=true` で原子 hide）
- drag / resize 開始時（毎回 fresh capture）
- resize 終了時（最終サイズの再撮影）
- 右クリックメニュー表示前（保存済みがなければ待機、あれば stale を表示しつつ fresh）
- ノードツールバーに被られた時（未スクショなら native 維持しつつ撮影を促す）

## スナップショット rect

- `take_wkwebview_snapshot`（`src-tauri/src/commands/webview/snapshot.rs`）では `takeSnapshotWithConfiguration: nil` ではなく `WKSnapshotConfiguration` を明示作成し `rect = webview.bounds` を指定する
- `nil` 指定だと WebKit がデフォルト rect（visible content rect）を使い、scrollbar inset 等で frame より 1pt 小さい PNG が返って CSS placeholder と 1 device px ずれる
- `WKSnapshotConfiguration` は `new` で +1 retain されるため、`takeSnapshotWithConfiguration:` 呼び出し後に明示 release する

## スクショ `<img>` の描画

- `WebPageNode.tsx` の `<img data-screenshot-img>` は `object-fill` で placeholder 全域に引き伸ばす（`object-cover` は使わない）
- 撮影 PNG のサイズは「撮った瞬間の WKWebView frame」と一致する一方、表示時の placeholder は zoom/resize の途中で異なるアスペクト比になりうる。`object-cover` だとアスペクト比差分で片軸クロップが起き、native ↔ screenshot 切替時のずれとして見える
- `object-fill` で揃えることで、撮影直後はピクセル一致、zoom/resize 中は若干歪むが crop ずれより目立たない。WKWebView 側 frame の device-pixel snap（`sheltie-runtime.md` の Webview 生成・破棄 参照）と合わせて初めて両者が同じ矩形を共有する

## ちらつき回避

`screenshot -> native`:

1. 先に `webviewApi.show()` を呼ぶ
2. macOS では必要に応じて `setOpacity(label, 0)` から始める
3. `requestAnimationFrame` で 1 フレーム待つ
4. `data-display-mode='native'` と state 更新

即時に mode を戻すと OS 側描画が追いつかずちらつきが出る。

`native -> screenshot`:

1. interaction-start で `save_webview_screenshot(..., hideAfterSnapshotRequest=true)` を先に投げる
2. `applyPreparedInteractionModes()` が stale screenshot または `hidden` を反映
3. fresh 完了後に `screenshotUrl` を差し替える

「スクショ要求と hide を分離しない」ことが重要。
