# Siteboard ランタイム仕様

この文書は Siteboard の表示制御と Webview ランタイムの正本。
対象実装は主に以下。

- `src/components/Siteboard/Siteboard.tsx`
- `src/hooks/siteboard/useSiteboardDisplayEngine.ts`
- `src/hooks/siteboard/useSiteboardViewportEngine.ts`
- `src/hooks/siteboard/useSiteboardNodeRuntime.ts`
- `src/components/Node/WebPageNode.tsx`

## 表示モード

`DisplayMode` は 3 種類。

- `native`: ネイティブ Webview を表示
- `screenshot`: Webview を隠し、背面に常駐したスクリーンショット画像を表示
- `hidden`: 両方非表示

## 背面スクショ方式

- HTML のスクリーンショット画像を Webview の**上**に重ねることはできない。ネイティブ Webview は OS レベルで最前面に描画されるため、スクショは常に Webview の**背面**に置く。
- `WebPageNode` は `screenshotUrl` がある限り `<img data-screenshot-img>` を常時マウントする。`display:none` を `screenshot` 時だけ切り替えるのではなく、`hidden` の時だけ隠す。
- `native -> screenshot` は「スクショ準備完了を確認してから Webview を hide」する。`screenshot -> native` は「Webview を先に show してから screenshot を消す」順序を守る。
- `handleScreenshotPresented(nodeId, url)` が「その URL のスクショが DOM に反映され、描画機会を得た」合図になる。`ensureScreenshotReady()` はこの通知まで待ってから resolve する。

## しきい値・定数

- `NATIVE_SAFE_MARGIN_PX = 25`
- `NATIVE_SAFE_MARGIN_BOTTOM_PX = 75`
- `PRE_DISPLAY_MARGIN_PX = 50`
- `HYSTERESIS_PX = 4`
- `WEBVIEW_REVEAL_DELAY_MS = 100`
- `SCREENSHOT_CLIPPING_ENABLED`（`useSiteboardDisplayEngine.ts` 内）

近接判定ではヒステリシスを使い、境界振動を防ぐ。

## 操作タイプ

`InteractionType = 'pan' | 'zoom' | 'drag' | 'resize'`

- すべての操作開始前に、対象ページの **fresh capture を毎回要求** する。
- 保存済みスクショがあるページは、それを即 `screenshot` として見せたまま fresh capture をバックグラウンドで取り直し、準備完了後に stale → fresh へ差し替える。
- 保存済みスクショがないページは、操作開始前に capture を待つ。capture 不能な場合のみ `hidden` を最後の退避先として使う。
- `pan/zoom` 中は rAF 単位で `computeInteractionModes` が `screenshot/hidden` を再判定する。操作中に `native` へ戻さない。

## drag 終了後の重なり補正

- React Flow ネイティブドラッグで `Siteboard.tsx` の `draggingNodePositions` state に一時位置を管理し、`onNodeDragStop` 後にのみ store 座標を確定する
- ドロップ位置が禁止された重なりを作る場合は、`x` または `y` の単軸だけを動かして再配置する
- 補正は最短移動を優先し、補正後の余白は `DRAG_REPOSITION_GAP = 20`
- webpage は他の全ノードとの重なりを禁止し、stickynote は webpage に対してのみ同じ制約を適用する
- 重なり判定は placeholder / content ではなくノード外枠全体を基準にする。webpage は `top bar + content + bottom bar`、stickynote は `header + content` を 1 つの矩形として扱う
- top bar / bottom bar / sticky header は `zoomPx` により画面上では固定 px のため、world 座標での外枠高さは current zoom に応じて `screenPx / zoom` で計算する
- webpage の補正が発生した時は `settling` 扱いにし、`computeDisplayModes()` が `native` 復帰を抑制する
- `WebPageNode` は drop 座標から補正後座標までを明示的な translate アニメーションで戻し、完了後に settling を解除して `native` 復帰を再判定する
- Reduced Motion ではアニメーション待ちをせず、次フレームで settling を解除する

## ノード外枠基準の配置計算

- 新規ノード追加時の自動配置も drag 補正と同じ zoom-aware な外枠矩形を使う
- センタリングや可視判定の fallback 計算も同じ外枠矩形を使い、DOM 実測がない場合でも content だけで過小評価しない
- 一方でネイティブ Webview の bounds 更新や safe area 判定は従来どおり placeholder 矩形を使う。外枠判定と Webview 実表示判定は責務を分ける

## pan 専用最適化

- pan 中で zoom が変わらない場合は `updateAllPositions` を使う。
- zoom 変化を伴う場合は `updateAllBounds` を使う。

この分岐を壊すと追従遅延が再発しやすい。

## 遷移ルール

- 操作中は `native -> screenshot/hidden` 遷移を許可。
- 操作中の `screenshot/hidden -> native` は抑制し、終了後の最終計算で復帰。
- コンテキストメニュー表示中のページは `native` への復帰を抑制（後述）。

## コンテキストメニューと Webview 制御

ネイティブ Webview は OS レベルで常に最前面に描画されるため、HTML の `createPortal` で body に fixed 配置したコンテキストメニューが Webview の下に隠れる。

これを回避するため、右クリック時に対象 webpage ノードを screenshot/hidden モードに切り替え、メニュー表示中はそれを維持する。

**フロー**:
1. `handleContextMenuOpen(pageId)` — async 関数。まず `cancelNativeReveal` で復帰タイマーを止める。
2. 保存済みスクショがある場合は、その stale screenshot を即利用しつつ fresh capture をバックグラウンドで要求する。
3. 保存済みスクショがない場合だけ `ensureScreenshotReady()` で「PNG 保存 + React 反映 + DOM 描画完了」まで待つ。
4. 準備完了後に `contextMenuPageIdRef` をセットし、`newMode = 'screenshot'`（capture 不能時のみ `hidden`）へ更新してから Webview を hide する。
5. `Siteboard.tsx` の `handleNodeContextMenu` — webpage ノードは `handleContextMenuOpen(pageId)` の Promise を `.then()` で待ち、さらに `requestAnimationFrame` を挟んでから `setContextMenu` を呼ぶ。これでメニューが「スクショ背面化」より先に表示されない。
6. `computeDisplayModes()` の override ロジック — `contextMenuPageIdRef` がセットされているページの `nextMode === 'native'` を `screenshot`/`hidden` に差し替え。
7. `handleContextMenuClose()` — ref をクリアし `computeDisplayModes()` で表示を復帰。
8. ページ削除ケース — `handleContextMenuCloseDisplay()` を先に呼んでロックを解除してから削除する。

付箋ノードは Webview を持たないため、コンテキストメニュー表示時に `handleContextMenuOpen` は呼ばない（`Siteboard.tsx` の node type 判定で分岐）。

## スクリーンショット永続化

スクリーンショットは PNG ファイルとしてディスクに保存する（macOS のみ）。

**保存先**: `~/Library/Application Support/com.siteboard.app/screenshots/{projectId}/{pageId}.png`

- `projectId` は `.siteboard` に保存される値ではなく、ローカルワークスペース上の `Project.id` を使う
- `pageId` は node id をそのまま使う。webpage 系 Webview IPC では歴史的理由で `pageId` 命名を維持している

**フロー（撮影時）**:
1. Rust `save_webview_screenshot(pageId, projectId)` → WKWebView スナップショット → PNG → ファイル保存 → ファイルパス返却
2. JS: `convertFileSrc(filePath) + '?t=Date.now()'` でアセット URL 生成 → `<img src>` に設定
3. `Image.decode()` でデコード完了を待つ
4. 既存 screenshot が表示中でも新 URL が準備できるまで差し替えない
5. `WebPageNode` の `onScreenshotPresented(pageId, url)` が呼ばれたら、その URL を表示可能なスクショとして扱う
6. `screenshotReadyRef.current[pageId] = true` をセット

**フロー（起動時復元）**:
1. `setupProjectPersistence()` が `_restoreState()` の直後、`_setLoaded()` の前に「保存状態で open だった tab」だけ `get_existing_screenshot_paths(projectId, pageIds)` を実行する
2. 戻り値を `convertFileSrc(filePath) + '?t=restored'` に変換し、`tab-store.webviewRuntime.screenshotUrlsByNodeId` へ preload する
3. `useSiteboardDisplayEngine` は初回 render の `screenshotUrls` / `screenshotReadyRef` / 仮 `displayModes` をこの runtime cache で seed し、stale screenshot を即表示する
4. Webview 作成後の `computeDisplayModes()` が既存ルールどおり `screenshot -> native` を最終決定する

**フロー（lazy restore）**:
1. `useSiteboardDisplayEngine` の `projectId + webpage node ids` 依存 effect は、runtime cache にまだ無い page だけを対象に `get_existing_screenshot_paths(projectId, pageIds)` を実行する
2. `convertFileSrc(filePath) + '?t=restored'` を local state と `tab-store.webviewRuntime.screenshotUrlsByNodeId` の両方へ反映する
3. 既に fresh capture などで in-memory URL がある page は上書きしない
4. `computeDisplayModes()` を再実行し、復元スクショを考慮した正しいモード判定に収束させる

**削除**: ページ削除時に `cleanupPageArtifacts()` → `delete_screenshot(pageId, projectId)` でファイルも削除。

**Tauri 設定**:
- `tauri.conf.json`: `app.security.assetProtocol.enable = true`, scope `$APPDATA/screenshots/**`
- `Cargo.toml`: `tauri` feature に `protocol-asset` を追加

## スクリーンショット撮影タイミング

- pan/zoom 操作開始時（毎回 fresh capture）
- drag 操作開始時（毎回 fresh capture）
- ナビゲーション後（遅延あり）
- 初回ロード完了時
- リサイズ開始時（毎回 fresh capture）
- リサイズ終了時（最終サイズの再撮影）
- 右クリックメニュー表示前（保存済みがなければ待機、あれば stale を表示しつつ fresh capture）
- Webview 内スクロール完了時（`page-scroll-ended-{pageId}`）

## hidden モードの役割

- `hidden` は常用モードではなく、`native` も `screenshot` も安全に使えない瞬間の退避先
- 主な用途は offscreen ノード、live Webview 未接続かつ screenshot 未準備、capture 失敗時
- interaction 中は `hidden` を増やさず、可能な限り stale/fresh screenshot を優先する

## ちらつき回避（重要）

`screenshot -> native` への復帰時は以下を守る。

1. 先に `webviewApi.show()` を呼ぶ。
2. macOS では必要に応じて `setOpacity(pageId, 0)` から始める。
3. `requestAnimationFrame` で 1 フレーム待つ。
4. `data-display-mode='native'` と state 更新を行う。

即時に mode を戻すと OS 側描画が追いつかず、ちらつきが出る。

`native -> screenshot` 側は逆に「Webview を先に hide しない」ことが重要。

1. スクショ未準備なら `ensureScreenshotReady()` を待つ。
2. `data-display-mode='screenshot'` を反映する。
3. 最後に Webview を hide する。

## Webview 生成・破棄の注意

- React StrictMode 二重マウント対策として、`WebPageNode` では `useWebPageWebviewLifecycle` が作成競合をガードする。
- タブ切替で `ProjectScreen` が再マウントされるため、同じ `pageId` の Webview は create/destroy が短時間で連続しうる。`useWebPageWebviewLifecycle` は owner token と pending destroy Promise で直列化し、旧 cleanup が新 Webview を閉じないようにする。
- Webview API は例外時 no-op を許容する前提。
- 空フレーム（`url === ''`）は Webview を作成しない。
- Webview の create/destroy は URL 同期から切り離し、`node.url` 更新では再生成しない。
- `webviewLabel` は `BoardNode` に持たず、`tab-store` の `webviewRuntime.labelsByNodeId` に保持する。「ライブな Webview が接続中」の印として扱い、アンマウント開始時に store から解除する。label が無いページは `native` に戻さず `screenshot` または `hidden` を使う。
- `screenshotUrl` も `BoardNode` には持たず、`tab-store` の `webviewRuntime.screenshotUrlsByNodeId` に runtime cache として保持する。タブ再マウントや起動直後の open tab 復元では、この cache を `useSiteboardDisplayEngine` の初期 state seed に使う。
- `page-navigated-{pageId}` を受けたら `runtimeUrlRef` と store の `url` を同期し、その更新で `reload` を再発火させない。
- 既存 Webview への URL 変更は `WebPageNode` の navigate effect が `runtimeUrlRef !== node.url` の時だけ `reload_page_webview` を呼ぶ。

## スクロール完了通知チャネル

`commands/webview.rs` の `initialization_script` は `document.title` プレフィックスを使う。

- `\x01`: SPA URL 変更（`page-navigated-{pageId}`）
- `\x02`: スクロール完了（`page-scroll-ended-{pageId}`）

新しい通知を増やす場合はプレフィックス衝突を避ける。

## CSS Viewport Units（svh/lvh）の補正

`_setLayoutMode: 2` + `_setViewScale: zoom` は `vh`/`dvh` のビューポートのみに効き、
`svh`/`lvh` は WebKit 内部の "unobscured size"（`frame.size`）を参照するため
zoom < 1 で物理フレームが縮小されると svh/lvh が物理サイズになってしまう。

**根本原因**:

`_setLayoutMode: 2` の内部で `_recalculateViewportSizes` が呼ばれ、
`_page->setMinimumUnobscuredSize(frame)` / `_page->setMaximumUnobscuredSize(frame)` が
物理フレームサイズで上書きされる。

**補正方法（`set_css_viewport_unit_sizes` 関数）**:

WebKit の内部計算:
```
minimumUnobscuredSize = frame - maximumViewportInset  → svh
maximumUnobscuredSize = frame - minimumViewportInset  → lvh
```

`inset = physical - logical`（zoom < 1 で負値）を min/max 両方に渡すことで:
```
unobscuredSize = physical - (physical - logical) = logical  ✓
```

**API 優先度（現行）**:

1. `_recalculateViewportSizesWithMinimumViewportInset:maximumViewportInset:throwOnInvalidInput:` を `throwOnInvalidInput: NO` で呼ぶ。
   WebKit 内部で `setFrameSize:` から使われるメソッドを直接呼び出すことで、macOS 26.2 以降で公開 API に追加された負値バリデーション（`NSInvalidArgumentException`）をスキップする。
2. 上記 selector が `respondsToSelector:` で見つからない場合のフォールバック: `setMinimumViewportInset:maximumViewportInset:`（macOS 13.0+）。inset が非負（zoom >= 1）の場合のみ呼ぶ。

**非採用**:
- `_setViewportSizeForCSSViewportUnits:` は `_setLayoutMode: 2` の再計算ロジックに上書きされるため無効
- `_setMinimumUnobscuredSizeOverride:` / `_setMaximumUnobscuredSizeOverride:` は macOS では未実装（iOS 専用）
- `_overrideLayoutParametersWithMinimumLayoutSize:...` も iOS 専用

**共通事項**:
- `create_page_webview` と `update_page_webview_bounds`（`update_bounds_impl`）の両方で呼び出す
- private selector 呼び出しは `run_objc_void_guarded` / `run_objc_bool_guarded` でラップし、OS 差分で例外が発生した場合は補正をスキップして継続する（クラッシュ回避）
- `objc2::exception::catch` の `Err(exception)` は `exception.as_ref().map(|e| format!("{e:?}"))` で NSException の name + reason を取得できる（追加の use 文・フィーチャー変更不要）
- `_setViewScale` に渡す `zoom` は有限正数へ正規化（`sanitize_zoom`）してから適用する（無効値による例外防止）

## ナビゲーション状態管理（`useSiteboardNodeRuntime`）

canGoBack / canGoForward は `nodeId` 単位の runtime model で管理する。

### 背景

- `get_navigation_state_page_webview`（WKBackForwardList）は SPA では常に `false` を返す（`history.pushState` が WKBackForwardList に反映されないため）
- `on_navigation` コールバックはナビゲーション**開始前**（`decidePolicyForNavigationAction`）に発火するため、このタイミングで問い合わせても WKBackForwardList は未更新

### 実装方針

- `refreshNavigationState`: ネイティブ API の結果はそのまま `nativeState` に保存し、表示用 state は `nativeState || history depth` で再計算する
- `handleGoBack`: `pendingAction[nodeId]='back'` を立て、`forwardDepth` を楽観的に +1 してから実行。300ms 後に action をクリアして再問い合わせする
- `handleGoForward`: `pendingAction[nodeId]='forward'` を立て、`backDepth` を楽観的に +1 してから実行。300ms 後に action をクリアして再問い合わせする
- `handleNavigated`: `currentUrl` と `pendingAction[nodeId]` を見て `backDepth / forwardDepth` を調整する。通常遷移は `backDepth + 1, forwardDepth = 0`、戻る/進むはそれぞれ深度を増減させる
- スクリーンショット撮影待ち (`1000ms`) と nav 再問い合わせ待ち (`300ms`) はどちらも `nodeId` 単位で timer を管理し、削除・unmount 時に必ず clear する

## 変更時チェックリスト

- 表示モード変更時: `computeDisplayModes` と `computeInteractionModes` の両方を確認。
- スクショ切替を変更した時: `ensureScreenshotReady` と `handleScreenshotPresented` の待機条件が崩れていないことを確認。
- `webviewLabel` の扱いを変えた時: 再マウント直後に `native` が選ばれず、保存済みスクリーンショットなら `screenshot`、未保存なら `hidden` へ落ちることを確認。
- しきい値変更時: pan/zoom 中と終了時で振動・ちらつきがないか確認。
- イベント変更時: Rust emit と JS listener の名前一致を確認。
- viewport insets を変更する場合: zoom 変化後の svh/lvh/vh/dvh の各単位が論理サイズと一致することを確認。
- HTML 要素をネイティブ Webview の上に重ねる場合: 対象ページを screenshot/hidden モードに切り替えてから表示する（`handleContextMenuOpen` パターンを参照）。
