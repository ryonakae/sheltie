# Tauri IPC 契約

実装の正本は `src-tauri/src/lib.rs` と `src/lib/tauri-bridge.ts`。
この文書は契約の読みやすい要約。

## Renderer -> Backend（invoke）

### プロジェクト状態

- `load_project_state`
- `save_project_state`
- `close_ready`

### テーマ

- `load_theme`
- `set_theme`
- `get_platform_info`

### Webview

- `create_page_webview(pageId, url, x, y, width, height, zoom)`
- `update_page_webview_bounds(pageId, x, y, width, height, zoom)`
- `batch_update_page_webview_bounds(entries[])`
- `batch_update_webview_positions(entries[])`
- `set_page_webview_opacity(pageId, opacity)`
- `reload_page_webview(pageId, url)`
- `go_back_page_webview(pageId)`
- `go_forward_page_webview(pageId)`
- `get_navigation_state_page_webview(pageId)`
- `capture_webview_screenshot(pageId)`

## Backend -> Renderer（イベント）

- `page-navigated-{pageId}`: URL 変更通知
- `page-title-changed-{pageId}`: タイトル変更通知
- `page-scroll-ended-{pageId}`: Webview 内スクロール完了通知

## JS ブリッジ API（`webviewApi`）

- `create`, `updateBounds`, `updateAllBounds`, `updateAllPositions`
- `show`, `hide`, `destroy`, `hideAll`, `showAllWithBounds`
- `setOpacity`, `reload`, `goBack`, `goForward`, `getNavigationState`
- `captureScreenshot`
- `onPageNavigated`, `onPageTitleChanged`, `onPageScrollEnded`

## プラットフォーム差分

- `capture_webview_screenshot` は現状 macOS のみ。
- `get_navigation_state_page_webview` は macOS でネイティブ取得、非 macOS は `false/false`。
- `set_page_webview_opacity` は macOS 以外では no-op。

## 変更ルール

- コマンド名/引数/戻り値を変更したら、Rust 側・bridge 側・このドキュメントを同時更新する。
- イベント名を変更したら listener 側（`PageNode` / runtime hooks）も同時更新する。
