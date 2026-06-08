# Siteboard ランタイム仕様

Siteboard の表示制御と Webview ランタイムの正本。実装の主入口:

- `src/components/Siteboard/Siteboard.tsx`
- `src/hooks/siteboard/useSiteboardDisplayEngine.ts`
  - `display-engine/dom.ts`（DOM 操作）
  - `display-engine/mode.ts`（DisplayMode 計算）
  - `display-engine/state-machine.ts`（per-node / mode / dialog 系 state の reducer + selector）
- `src/hooks/siteboard/useSiteboardNodeRuntime.ts`
- `src/components/Node/WebPageNode.tsx`

## 表示モードと背面スクショ方式

`DisplayMode = 'native' | 'screenshot' | 'hidden'`

- `native`: ネイティブ Webview を表示
- `screenshot`: Webview を隠し、背面のスクリーンショット画像を表示
- `hidden`: 両方非表示

ネイティブ Webview は OS レベルで最前面に描画されるため、HTML のスクショは常に Webview の**背面**に置く。`WebPageNode` は `screenshotUrl` がある限り `<img data-screenshot-img>` を常時マウントし、`hidden` のときだけ表示を消す。

- `native -> screenshot`: スクショ準備完了を確認してから Webview を hide
- `screenshot -> native`: Webview を先に show してから screenshot を消す（順序必須）
- `handleScreenshotPresented(nodeId, url)` が「URL のスクショが DOM に反映され描画機会を得た」合図。`ensureScreenshotReady()` はこの通知まで待ってから resolve

## 状態管理

per-node / mode / dialog 系の状態は `display-engine/state-machine.ts` の `DisplayEngineState` に集約され、`useSiteboardDisplayEngine` が `stateRef + dispatch` 経由で更新する。フィールドと役割:

| フィールド | 役割 |
|---|---|
| `activeInteractions` | 同時進行する `InteractionType` のセット |
| `contextMenuNodeId` | 右クリックメニュー対象 |
| `unsavedDialogOpen` | 未保存確認ダイアログ表示中 |
| `resizingNodeId` | リサイズ中ノード |
| `settlingIds` | 位置補正アニメ中ノード |
| `toolbarOccludedIds` | 前パスのノードツールバー被り集合 |
| `forceHiddenIds` | 操作開始直後の強制 hidden ノード |
| `nativeHiddenByCaptureIds` | snapshot 要求直後に native 側で hide したノード |
| `captureRetryIds` | 取り損ねた capture の再試行待ち |

read は `hasAnyInteraction` / `isPanOrZoomActive` / `isDragOrResizeActive` / `isContextMenuTarget` / `isSettling` / `isInOccludedSet` / `isForceHidden` / `isNativeHiddenByCapture` / `hasPendingCaptureRetry` の selector を使う。`mode.ts` の `isToolbarOccluded(nodeId, nodeRect, toolbarRects)` は別物（純粋判定）。

## しきい値・定数

`src/constants.ts` 参照。主要なもの:

- `NATIVE_SAFE_MARGIN_PX = 25`、`NATIVE_SAFE_MARGIN_BOTTOM_PX = 96`（フローティングツールバー + ツールチップ分）。`src/lib/siteboard-viewport.ts:resolveFitViewport` でも、対象ノードに `webpage` が含まれていれば padding の下限としてこの定数（+ `HYSTERESIS_PX`）が適用され、Zoom to Fit／ノード追加直後の表示が screenshot に降格しないようになっている
- `PRE_DISPLAY_MARGIN_PX = 50`、`HYSTERESIS_PX = 4`
- `WEBVIEW_REVEAL_DELAY_MS = 100`
- `FRESHNESS_CAPTURE_DELAY_MS = { navigation: 1000, load: 0, scroll: 0 }`
- `SCREENSHOT_CLIPPING_ENABLED`（`useScreenshotCaptureQueue.ts` 内）

近接判定はヒステリシスで境界振動を防ぐ。

## 操作タイプ

`InteractionType = 'pan' | 'zoom' | 'drag' | 'resize'`

### 操作中の Webview 表示制御ポリシー

- `pan/zoom` 開始時は可視 `WebPage` の `native` を即座に降ろし、保存済みスクショがあれば `screenshot`、なければ `hidden` に切り替える
- 同時に fresh capture をバックグラウンドで開始し、完了後は操作中でも `stale -> fresh` / `hidden -> fresh` に差し替える
- fresh capture の開始と native hide は `save_webview_screenshot(label, pageId, ..., hideAfterSnapshotRequest=true)` を 1 Rust コマンド内で直列化し、JS 側の `saveScreenshot()` / `hide()` race を避ける
- `computeDisplayModes()` は操作中（`hasAnyInteraction(stateRef.current)`）に即リターンする

### プリキャプチャ戦略

- `pan/zoom/drag/resize` 開始時に `prepareInteractionStart(type)` を呼ぶ
- 保存済みスクショがあるページは stale を即利用し、fresh 完了後に差し替える
- 保存済みスクショがないページは `hidden` を許容し、fresh 完了後に `hidden -> screenshot`
- interaction-start capture が失敗したページは current interaction 中は `hidden` のまま維持し、終了後の native 復帰後に 1 回だけ retry する

## pan/zoom 判定

React Flow の `onMoveStart/onMove/onMoveEnd` は pan/zoom を区別しない。`Siteboard.tsx` の `resolveViewportInteractionType` で event 型から **開始時点で** 操作種別を即時判定する:

- `event == null` → プログラマティック操作 → `'zoom'`
- `'deltaY' in event && (event.metaKey || event.ctrlKey)` → `'zoom'`
- `'deltaY' in event` → `'pan'`
- ピンチ（`TouchEvent.touches.length >= 2`）→ `'zoom'`（Tauri WKWebView では `TouchEvent` グローバル未定義ガードが必須。詳細は `wkwebview-internals.md`）
- その他（ミドルドラッグ、1指 TouchEvent 等）→ `'pan'`

`handleMoveStart` 内で `resolveViewportInteractionType` → `prepareInteractionStart` → `handleInteractionChange` の順で呼ぶ（fire-and-forget。実装は `Siteboard.tsx:handleMoveStart` / `beginViewportInteraction` 参照）。`handleMove` は `onMoveStart` 取りこぼし時のフォールバック。

### 操作中カーソル

全画面 cursor overlay は持たない。pan/zoom/drag のカーソルは React Flow とブラウザ既定に委譲し、リサイズカーソルは各 `NodeResizeControl` の class と `src/index.css` で管理する。

### zoom 終了後の native 復帰

`handleMoveEnd` で `type='zoom'` を渡すと、`handleInteractionChange(false, 'zoom')` 内で `scheduleZoomRestoreAfterReflow()` が自動で走り、zoom 後リフロー完了後に Webview 座標を復帰させる。`type='pan'` では呼ばない。

## viewport の store 同期

- `Siteboard.tsx` の `handleViewportChange` で React Flow の viewport を `zoomRef` に同期し、rAF で `uiZoom` を更新する
- `uiZoom` は `flowNodes` 外枠高さと resize control `minHeight` に使う reactive な layout 用 zoom の正本。`zoomRef` は resize 中の content height 逆算など即時計算用
- project 切り替え / 新規ノード追加後 centering / 右下 viewport controls / 起動時復元では store 側 `viewport` が先に変わるため、`reactFlowInstanceRef.current.setViewport(storeViewport, { duration: 0 })` で React Flow に再同期する。差分がなければ `setViewport()` をスキップして無限ループを避ける
- container `ResizeObserver` は `computeDisplayModes()` を同期実行せず rAF 1 フレームに集約する（observer callback 内 DOM mutation を避け、zoom 中の `ResizeObserver loop completed` warning を抑制）

## 右下 viewport controls

- `全体表示` / `100%` の 2 ボタンを `Siteboard.tsx` が描画する
- `全体表示`: `getNodeFrameRect(node, zoom)` で全ノード外枠 union を zoom ごとに再計算し、`64px` padding を残して最大倍率で収まる viewport を二分探索で求める
- `100%`: zoom を `1` に固定し、同じ union の中心を viewport 中央に置く。全体が収まらなくても zoom は変えない
- ノード 0 件時は `全体表示` を disabled、`100%` は `{ x: 0, y: 0, zoom: 1 }` に戻す
- `setViewport()` の duration は通常 `240ms`、reduced motion 時 `0ms`。zoom が変わる操作では `cancelZoomRestore()` と `scheduleZoomRestoreAfterReflow()` を既存 reset zoom と同じタイミングで呼ぶ

## drag 終了後の重なり補正

- React Flow ネイティブドラッグで `Siteboard.tsx` の `draggingNodePositions` state に一時位置を持ち、`onNodeDragStop` 後にのみ store 座標を確定する
- ドロップ位置が禁止された重なりを作る場合、`x` または `y` の単軸だけを動かして再配置する（最短移動優先、補正後の余白 `DRAG_REPOSITION_GAP = 20`）
- webpage は他の全ノードとの重なりを禁止、stickynote は webpage に対してのみ同じ制約
- 重なり判定はノード外枠全体を基準にする（webpage は `top bar + content + bottom bar`、stickynote は `header + content`）。`zoomPx` で画面上固定 px の bar/header は world 座標で `screenPx / zoom` で計算する
- webpage の補正が発生した時は `settling` 扱いにし、`computeDisplayModes()` が `native` 復帰を抑制する。`WebPageNode` は drop 座標から補正後座標までを translate アニメーションで戻し、完了後に settling を解除して `native` 復帰を再判定する。Reduced Motion ではアニメーション待ちをせず次フレームで解除

## ノード外枠基準の配置計算

- 新規ノード追加・センタリング・可視判定 fallback は drag 補正と同じ zoom-aware な外枠矩形を使う
- 一方で **ネイティブ Webview の bounds 更新や safe area 判定は placeholder 矩形を使う**。外枠判定と Webview 実表示判定は責務を分ける
- WebPage の placeholder はフレーム padding（上下左右 24px world 固定）の内側だけを指す

## 遷移ルール

- **操作中（drag/resize を除く）は全ノードを強制的に `screenshot/hidden` へ遷移** — `applyPreparedInteractionModes()` が初期状態を確定
- `pan/zoom` 中は rAF 単位で `computeInteractionModes()` が `screenshot/hidden` を再判定し、`native` への遷移は許可しない
- 操作終了（`!hasAnyInteraction(stateRef.current)`）で `computeDisplayModes()` が最終判定・native 復帰を再開
- `drag/resize` 中は display mode 更新を抑え、リサイズ終了後に最終表示を確定
- コンテキストメニュー表示中（`stateRef.current.contextMenuNodeId` 一致）、未保存確認ダイアログ表示中（visible webpage node 全体）、ノードツールバー被り中の webpage は `native` 復帰を抑制する

## コンテキストメニューと Webview 制御

コンテキストメニューは `@tauri-apps/api/menu` の `Menu.new()` + `popup()` で macOS ネイティブメニューとして表示する。Webview との z-index 競合は起きないが、「メニュー表示中に Webview が操作可能になる」のを防ぐためスクショ差し替えは維持する。

**フロー**:

1. `handleContextMenuOpen(pageId)` — まず `cancelNativeReveal` で復帰タイマーを止める
2. 保存済みスクショがあれば stale を即利用しつつ fresh capture をバックグラウンドで要求
3. 保存済みスクショがなければ `ensureScreenshotReady()` で PNG 保存 + DOM 描画完了まで待つ
4. 準備完了後に `dispatch({ type: 'CONTEXT_MENU_OPEN', nodeId })`、`newMode = 'screenshot'`（capture 不能時は `hidden`）に更新して Webview を hide
5. `Siteboard.tsx` の `handleNodeContextMenu` が `await handleContextMenuOpen(pageId)` 後に `menu.popup()` を呼ぶ（メニューが閉じるまで await でブロック）
6. `computeDisplayModes()` の override — `stateRef.current.contextMenuNodeId` 一致ページの `nextMode === 'native'` を `screenshot`/`hidden` に差し替え
7. `popup()` resolve 後に `handleContextMenuCloseDisplay()` が `dispatch({ type: 'CONTEXT_MENU_CLOSE' })` を呼んで表示を復帰
8. ページ削除時は `action` コールバック内で `handleContextMenuCloseDisplay()` を先に呼んでロックを解除してから削除

付箋ノードは Webview を持たないため `handleContextMenuOpen` は呼ばない（`Siteboard.tsx` で node type 分岐）。

## ノードツールバーと Webview 制御

選択時のツールバー（付箋/テキスト/Webページの `NodeToolbar position={Position.Top}`、単独選択のみ）は HTML 要素のため、近接する Webpage の Webview に被ると OS レイヤー最前面の Webview の下に潜る。これを防ぐためツールバーに被る Webpage は `screenshot` に降格する。

- ツールバー root に `data-node-toolbar={nodeId}` を付与する（`StickyNoteToolbar` / `TextNodeToolbar` / `WebPageToolbar`）。常時表示のタイトル段は対象外
- `computeDisplayModes()` は `getSelectionToolbarRects()` で全ツールバー矩形を取得し、各 placeholder 矩形と `rectsOverlap()` で交差判定する（自ノードのツールバーは `ownerId === page.id` で除外）
- 被られたページが `native` の場合、**被り開始時（前パスで未被り）に webview がまだ native(可視) のうちに** `ensureScreenshotReady()` で fresh 撮影を要求してから降格する（`handleContextMenuOpen` と同じ「撮影 → hide」順序。hide 後の webview はスナップショット不可で stale 固着するため必須）
- 被り状態は `stateRef.current.toolbarOccludedIds`（前パスの被り集合）で管理し、被り開始の 1 回だけ撮影を発火する
- 選択変化では `selectedNodeIds` 依存 effect が `requestAnimationFrame` 後に `computeDisplayModes()` を呼び、ツールバー DOM 反映後の矩形で再判定する

## 未保存確認ダイアログと Webview 制御

未保存確認ダイアログ（タブクローズ / アプリ終了）は `App` 直下の HTML overlay のため、native Webview を背面化しないと dialog/backdrop が下に潜る。dialog 表示前に active な Siteboard が coordinator 経由で表示ロックを受け、**閉じる対象 project ではなく「今見えている Siteboard」基準**で visible webpage node を `screenshot/hidden` に切り替える。

- 保存済み screenshot がある node は stale を即利用しつつ fresh をバックグラウンド更新
- 保存済み screenshot がない node だけ fresh 完了を待ち、失敗時は `hidden` fallback を許容
- dialog 表示中は `computeDisplayModes()` が `nextMode === 'native'` を `screenshot/hidden` に差し替える
- dialog close 後は通常の `computeDisplayModes()` に戻して native 復帰を再開
- アプリ終了で dirty project が連続して確認される場合、coordinator が exit を 1 tick 遅延し、次の dialog open が直後に来たら native 復帰を打ち消す

### `Cmd+Q` / `Quit` の集約確認

- `Cmd+W` / window close は window 単位の未保存確認
- `Cmd+Q` / メニュー `Quit` は macOS app menu の custom `app.quit` から renderer に `app-exit-requested` を送る
- focused document window が coordinator となり全 document window の dirty 状態を集約し、**確認ダイアログは 1 回だけ**表示する
- `保存`: dirty document を順番に保存。`Save As` が必要な document はその window を focus してダイアログを開く。途中で `Save As` キャンセル / 保存失敗が起きたら Quit 全体を中止（window は 1 枚も閉じない）
- `保存せず終了`: 全 document window をまとめて destroy

## スクリーンショット

撮影キュー / 永続化 / 撮影タイミング / ちらつき回避の詳細は `siteboard-screenshots.md` を参照。

## hidden モードの役割

`hidden` は常用モードではなく、`native` も `screenshot` も安全に使えない瞬間の退避先（offscreen / live Webview 未接続かつ screenshot 未準備 / capture 失敗時）。interaction 中は `hidden` を増やさず、可能な限り stale/fresh screenshot を優先する。

## Webview 生成・破棄

- React StrictMode 二重マウント対策として `useWebPageWebviewLifecycle` が作成競合をガードする
- タブ切替で `ProjectScreen` が再マウントされ Webview の create/destroy が短時間で連続しうる。owner token と pending destroy Promise で直列化し、旧 cleanup が新 Webview を閉じないようにする
- Webview API は例外時 no-op を許容する前提
- 空フレーム（`url === ''`）は Webview を作成しない
- Webview の create/destroy は URL 同期から切り離す（`node.url` 更新では再生成しない）
- `Siteboard.tsx` は mount 直後の `useLayoutEffect` で `data-siteboard-container` に `--canvas-zoom` を seed する。`zoomPx()` 前提のフレーム枠線太さを Webview 作成前に確定させ、初回 `placeholder.getBoundingClientRect()` が fallback zoom `1` を読まないようにする
- macOS の child WKWebView は host `contentView` 座標系で配置される一方、renderer の `getBoundingClientRect()` は `contentLayoutRect` 基準。`commands/webview.rs` では `contentLayoutRect` と host view 高さの差分を top inset として求め、`create_page_webview` / `update_page_webview_bounds` / `batch_update_webview_positions` の `y` に加算してから child Webview へ渡す
- `webviewApi.create` / `webviewApi.updateBounds` に渡す `(x, y, width, height)` は呼び出し直前に `snapRectToDevicePixels(rect, window.devicePixelRatio || 1)`（`src/lib/device-pixel-snap.ts`）で device pixel grid に snap する。WKWebView の `NSView.frame` は最終的に backingAlignedRect に snap されるため、subpixel な値をそのまま渡すと CSS placeholder の subpixel rendering 結果と 1 device px ずれて、native ↔ screenshot 切替時の位置/サイズずれとして見える。`width` のみ snap だと right edge がずれるため、left/top と right/bottom を独立に snap してから差分で width/height を再計算する

### labelsByNodeId を正本にする

- `webviewLabel` は `BoardNode` に持たず `tab-store.webviewRuntime.labelsByNodeId` に保持する。「ライブな Webview が接続中」の印として扱い、アンマウント開始時に store から解除する。label が無いページは `native` に戻さず `screenshot` または `hidden` を使う
- 既存 Webview への後続操作（`updateBounds`、`setOpacity`、`reload`、`goBack/Forward`、`saveScreenshot`）はすべて `labelsByNodeId` の `label` を正本として呼ぶ。`pageId` から引き直さない
- 初回 `getNavigationState` も store 反映待ちに依存せず、`onWebviewCreated(nodeId, label)` で受け取った label をそのまま使う
- Rust コマンド側は `tauri::Window` を host context として受け、child webview 配下から呼ばれても同じ document window 上の Webview を解決する
- label 登録後の native bounds 再同期は `useSiteboardNodeRuntime` から直接 `computeDisplayModes()` を呼ばず、`useSiteboardDisplayEngine` が `webviewLabelsByNodeId` の安定キー変化を検知して 2 フレーム後に実行する（最新 render の closure で `placeholder` 矩形と label の両方を読み、`updateBounds()` まで確実に到達させる）

### screenshotUrl の runtime cache

- `screenshotUrl` も `BoardNode` には持たず、`tab-store.webviewRuntime.screenshotUrlsByNodeId` に runtime cache として保持する。タブ再マウントや起動直後の open tab 復元で `useSiteboardDisplayEngine` の初期 state seed に使う
- `page-navigated-{pageId}` を受けたら `runtimeUrlRef` と store の `url` を同期し、更新で `reload` を再発火させない
- URL 変更は `WebPageNode` の navigate effect が `runtimeUrlRef !== node.url` の時だけ `reload_page_webview(label, url)` を呼ぶ

## WKWebView プラットフォーム固有

スクロール完了通知、CSS Viewport Units（svh/lvh）の補正、TouchEvent 未定義ガード、handleMoveEnd 取りこぼし対応は `wkwebview-internals.md` を参照。

## ナビゲーション状態管理（`useSiteboardNodeRuntime`）

`canGoBack` / `canGoForward` は `nodeId` 単位の runtime model で管理する。

**背景**:

- `get_navigation_state_page_webview`（WKBackForwardList）は SPA では常に `false`（`history.pushState` が WKBackForwardList に反映されないため）
- `on_navigation` コールバックはナビゲーション**開始前**（`decidePolicyForNavigationAction`）に発火するため、このタイミングで問い合わせても WKBackForwardList は未更新

**実装方針**:

- `refreshNavigationState`: ネイティブ API 結果は `nativeState` に保存し、表示用 state は `nativeState || history depth` で再計算
- `handleGoBack`: `pendingAction[nodeId]='back'` を立て `forwardDepth` を楽観的に +1、300ms 後に action クリアして再問い合わせ
- `handleGoForward`: 同様に `pendingAction[nodeId]='forward'`、`backDepth` を楽観的に +1
- `handleNavigated`: `currentUrl` と `pendingAction[nodeId]` から `backDepth / forwardDepth` を調整（通常遷移は `backDepth + 1, forwardDepth = 0`、戻る/進むは深度を増減）
- スクショ撮影待ち（`1000ms`）と nav 再問い合わせ待ち（`300ms`）はどちらも `nodeId` 単位で timer 管理し、削除・unmount 時に必ず clear

## 変更時チェックリスト

- 表示モード変更時: `computeDisplayModes`・`computeInteractionModes`・`applyPreparedInteractionModes` の役割分担（操作外・操作中・準備フェーズ）を確認
- 操作中の表示制御を変更した時: `hasAnyInteraction(stateRef.current)` で guard してる部分が機能してるか確認。`computeDisplayModes` が操作中に呼ばれても即リターンすること
- プリキャプチャ戦略を変更した時: `prepareInteractionStart` が各タイプで正しく呼ばれ、完了後に `stateRef.current.forceHiddenIds` の遷移が正しいか確認
- スクショ切替を変更した時: `ensureScreenshotReady` と `handleScreenshotPresented` の待機条件が崩れていないか確認
- `webviewLabel` の扱いを変えた時: 再マウント直後に `native` が選ばれず、保存済みなら `screenshot`、未保存なら `hidden` に落ちるか確認
- しきい値変更時: pan/zoom 中と終了時で振動・ちらつきがないか確認
- イベント変更時: Rust emit と JS listener の名前一致を確認
- viewport insets を変更する場合: zoom 変化後の svh/lvh/vh/dvh の各単位が論理サイズと一致するか確認
- HTML 要素をネイティブ Webview の上に重ねる場合: 対象ページを screenshot/hidden に切り替えてから表示する（`handleContextMenuOpen` パターン参照）
- per-node / mode / dialog 系の新フラグを追加する時: `display-engine/state-machine.ts` の reducer + selector に追加し、`stateRef + dispatch` 経由で読み書きする
