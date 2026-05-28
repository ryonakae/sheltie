# WKWebView プラットフォーム固有の注意

Siteboard の WKWebView（macOS）に固有のワークアラウンドと注意事項をまとめる。
表示モード遷移やスクリーンショット管理の全体像は `siteboard-runtime.md` を参照。

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

## TouchEvent グローバル未定義の罠

Tauri v2 の WKWebView 環境では、デスクトップ OS 上で `TouchEvent` グローバルが定義されていません。

**問題**:
- `event instanceof TouchEvent` をガード無しで実行すると `ReferenceError: TouchEvent is not defined` が発生
- この例外が `beginViewportInteraction` など上位関数を中断し、パン/ズーム操作中の webview hide/screenshot 切り替えが完全に機能しなくなる

**対策**:
- `resolveViewportInteractionType` 内で `typeof TouchEvent !== 'undefined'` ガードを必ず先行させる
- ピンチ判定は `typeof TouchEvent !== 'undefined' && event instanceof TouchEvent && event.touches.length >= 2` の順序で記述

```ts
// 正例
const resolveViewportInteractionType = useCallback(
  (event: MouseEvent | TouchEvent | null): 'pan' | 'zoom' =>
    event === null
      ? 'zoom'
      : 'deltaY' in event
        ? 'zoom'
        : typeof TouchEvent !== 'undefined' &&
            event instanceof TouchEvent &&
            event.touches.length >= 2
          ? 'zoom'
          : 'pan',
  [],
);
```

## handleMoveEnd の start 取りこぼし対応

React Flow の `onMoveStart` が火かない（ユーザー操作が high-latency 環境で遅延）場合、`moveInteractionTypeRef.current === null` のまま `onMoveEnd` に到達することがあります。

**対策**:
- `handleMoveEnd` 冒頭で `const type = moveInteractionTypeRef.current ?? 'pan';` で確実に type を確定
- `handleMove` もフォールバック機構を持ち、`moveInteractionTypeRef.current === null` なら `beginViewportInteraction` を呼んで type を立てる
- これらの fallback により、start が取りこぼされた場合でも `handleInteractionChange` が呼ばれ、最終的に `computeDisplayModes()` で webview 位置が正しく復帰する
