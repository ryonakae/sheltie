# スクリーンショットシステム

Siteboard の Webview スクリーンショット撮影・永続化・差し替えタイミングの正本。表示モードや状態管理は `siteboard-runtime.md` を参照。

実装の主入口:

- `src/hooks/siteboard/useScreenshotCaptureQueue.ts`（撮影キュー・永続化）
- `src/hooks/siteboard/useNativeRevealController.ts`（macOS の opacity フェード）
- `src-tauri/src/commands/webview/screenshots.rs`（Rust 側）

## 永続化

PNG ファイルとして保存する（macOS のみ）。保存先 `~/Library/Application Support/com.siteboard.app/screenshots/{projectId}/{pageId}.png`。`projectId` はローカルワークスペース上の `Project.id`、`pageId` は node id（webpage 系 Webview IPC では歴史的に `pageId` 命名）。

**撮影時**:

1. Rust `save_webview_screenshot(label, pageId, projectId, hideAfterSnapshotRequest?)` → WKWebView スナップショット要求。`hideAfterSnapshotRequest=true` の時は要求直後に同じコマンド内で Webview を hide
2. JS で `convertFileSrc(filePath) + '?t=Date.now()'` のアセット URL を `<img src>` に設定
3. `Image.decode()` でデコード完了を待ち、既存 screenshot は新 URL 準備まで差し替えない
4. `onScreenshotPresented(pageId, url)` で表示可能スクショとして登録し、`screenshotReadyRef.current[pageId] = true`

**起動時復元 / lazy restore**:

- 起動時: `setupProjectPersistence()` が `_restoreState()` 直後・`_setLoaded()` 前に「保存状態で open だった tab」だけ `get_existing_screenshot_paths(projectId, pageIds)` を実行し、`tab-store.webviewRuntime.screenshotUrlsByNodeId` へ preload
- lazy: `useSiteboardDisplayEngine` の `projectId + webpage node ids` 依存 effect が、runtime cache にまだ無い page を対象に同じコマンドを実行し、local state と store の両方へ反映
- 復元 URL は `convertFileSrc(filePath) + '?t=restored'`。in-memory に既に URL がある page は上書きしない
- いずれも完了後に `computeDisplayModes()` を再実行して正しいモード判定に収束させる

**削除**: ページ削除時に `cleanupPageArtifacts()` → `delete_screenshot(pageId, projectId)` でファイルも削除。

**Tauri 設定**: `tauri.conf.json` の `app.security.assetProtocol.enable = true` と scope `$APPDATA/screenshots/**`、`Cargo.toml` の `tauri` feature に `protocol-asset`。

## 撮影タイミング

撮影は目的の違う 2 系統に分かれる。

### ① 鮮度キャプチャ（保存スクショを最新に保つ・Webview は native 維持）

`useSiteboardNodeRuntime.scheduleFreshnessCapture(nodeId, reason)` に集約。`reason` 別の遅延は `FRESHNESS_CAPTURE_DELAY_MS`、node 単位で latest-wins。

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
- `object-fill` で揃えることで、撮影直後はピクセル一致、zoom/resize 中は若干歪むが crop ずれより目立たない。WKWebView 側 frame の device-pixel snap（`siteboard-runtime.md` の Webview 生成・破棄 参照）と合わせて初めて両者が同じ矩形を共有する

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
