# Siteboard ランタイム仕様

この文書は Siteboard の表示制御と Webview ランタイムの正本。
対象実装は主に以下。

- `src/components/Siteboard/Siteboard.tsx`
- `src/hooks/siteboard/useSiteboardDisplayEngine.ts`
- `src/hooks/siteboard/useSiteboardViewportEngine.ts`
- `src/hooks/siteboard/useSiteboardNodeRuntime.ts`
- `src/components/Node/PageNode.tsx`

## 表示モード

`DisplayMode` は 3 種類。

- `native`: ネイティブ Webview を表示
- `screenshot`: スクリーンショット画像を表示
- `hidden`: 両方非表示

## しきい値・定数

- `NATIVE_SAFE_MARGIN_PX = 50`
- `HYSTERESIS_PX = 4`
- `SCREENSHOT_CLIPPING_ENABLED`（`useSiteboardDisplayEngine.ts` 内）

近接判定ではヒステリシスを使い、境界振動を防ぐ。

## 操作タイプ

`InteractionType = 'pan' | 'zoom' | 'drag' | 'resize'`

- `drag/resize`: 開始時に Webview を非表示化し、終了時に表示判定を再計算。
- `pan/zoom`: rAF 単位で `computeInteractionModes` を実行し、必要に応じて `native/screenshot/hidden` を切り替える。

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

これを回避するため、右クリック時に対象ページを screenshot/hidden モードに切り替え、メニュー表示中はそれを維持する。

**フロー**:
1. `handleContextMenuOpen(pageId)` — async 関数。`contextMenuPageIdRef` にセット、`cancelNativeReveal` でタイマーキャンセル。スクリーンショット未準備時（`screenshotReadyRef.current[pageId] === false`）はWebview が visible なうちに `captureScreenshot({ forceDuringInteraction: true })` で撮影を完了させてから hide する。撮影成功 → `newMode = 'screenshot'`、失敗（または未撮影）→ `newMode = 'hidden'`。`captureInFlightRef` で二重撮影を防止。
2. `Siteboard.tsx` の `handleNodeContextMenu` — WebPage ノードは `handleContextMenuOpen(pageId)` の Promise を `.then()` で待ち、さらに `requestAnimationFrame` を挟んでから `setContextMenu` を呼ぶ（白画面防止）。`requestAnimationFrame` を挟む理由: React 18 の自動バッチングにより `setDisplayModes`（スクリーンショット差し替え）と `setContextMenu`（メニュー表示）が同一レンダーサイクルに合流し、スクリーンショットのブラウザ描画完了前にメニューが表示される問題を防ぐため。付箋ノードは Webview なしのため即時表示。
3. `computeDisplayModes()` の override ロジック — `contextMenuPageIdRef` がセットされているページの `nextMode === 'native'` を `screenshot`/`hidden` に差し替え。
4. `handleContextMenuClose()` — ref をクリアし `computeDisplayModes()` で表示を復帰。
5. ページ削除ケース — `handleContextMenuCloseDisplay()` を先に呼んでロックを解除してから削除する。

付箋ノードは Webview を持たないため、コンテキストメニュー開時に `handleContextMenuOpen` は呼ばない（Siteboard.tsx の `isStickyNote(page)` チェックで分岐）。

## スクリーンショット撮影タイミング

- pan/zoom 操作開始時
- ナビゲーション後（遅延あり）
- 初回ロード完了時
- リサイズ終了時
- Webview 内スクロール完了時（`page-scroll-ended-{pageId}`）

## ちらつき回避（重要）

`screenshot -> native` への復帰時は以下を守る。

1. 先に `webviewApi.show()` を呼ぶ。
2. `requestAnimationFrame` で 1 フレーム待つ。
3. `data-display-mode='native'` と state 更新を行う。

即時に mode を戻すと OS 側描画が追いつかず、ちらつきが出る。

## Webview 生成・破棄の注意

- React StrictMode 二重マウント対策として、`PageNode` で作成競合をガードする。
- Webview API は例外時 no-op を許容する前提。
- 空フレーム（`url === ''`）は Webview を作成しない。

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

canGoBack / canGoForward の管理は楽観的更新とネイティブ API の OR マージを組み合わせる。

### 背景

- `get_navigation_state_page_webview`（WKBackForwardList）は SPA では常に `false` を返す（`history.pushState` が WKBackForwardList に反映されないため）
- `on_navigation` コールバックはナビゲーション**開始前**（`decidePolicyForNavigationAction`）に発火するため、このタイミングで問い合わせても WKBackForwardList は未更新

### 実装方針

- `refreshNavigationState`: ネイティブ API が `true` を返した値は採用し、`false` の場合は既存の楽観的更新値を維持（OR マージ）
- `handleGoBack`: 実行後に `can_go_forward=true` を即座に楽観的更新 → 300ms 後にネイティブ API で再問い合わせ
- `handleGoForward`: 実行後に `can_go_back=true` を即座に楽観的更新 → 300ms 後にネイティブ API で再問い合わせ
- `handleNavigated`: `navigatedCountRef` で呼び出し回数を管理し、初回（初期ロード）はスキップ。2 回目以降かつ goBack/goForward 操作中でなければ `can_go_back=true, can_go_forward=false` を即座に設定 → 300ms 後にリトライ
- ページ削除時は `navigatedCountRef` のエントリーも合わせてクリア

## 変更時チェックリスト

- 表示モード変更時: `computeDisplayModes` と `computeInteractionModes` の両方を確認。
- しきい値変更時: pan/zoom 中と終了時で振動・ちらつきがないか確認。
- イベント変更時: Rust emit と JS listener の名前一致を確認。
- viewport insets を変更する場合: zoom 変化後の svh/lvh/vh/dvh の各単位が論理サイズと一致することを確認。
- HTML 要素をネイティブ Webview の上に重ねる場合: 対象ページを screenshot/hidden モードに切り替えてから表示する（`handleContextMenuOpen` パターンを参照）。
