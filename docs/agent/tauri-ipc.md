# Tauri IPC 契約

実装の正本は `src-tauri/src/lib.rs` と `src/lib/tauri-bridge.ts`。
この文書は契約の読みやすい要約。

## Renderer -> Backend（invoke）

### プロジェクト状態

- `load_project_state`
- `save_project_state`
- `close_ready`
- `load_project_file(path)` - `.siteboard` ファイルを UTF-8 文字列として読む
- `save_project_file(path, contents)` - `.siteboard` ファイルを書き込み、実際の保存パスを返す

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
- `capture_webview_screenshot(pageId)` - base64 Data URL を返す（内部用途のみ）
- `save_webview_screenshot(pageId, projectId)` - PNG ファイルを保存しファイルパスを返す（macOS のみ）
- `get_existing_screenshot_paths(projectId, pageIds)` - 存在するスクリーンショットのパスを一括取得
- `delete_screenshot(pageId, projectId)` - スクリーンショットファイルを削除

## Backend -> Renderer（イベント）

- `page-navigated-{pageId}`: URL 変更通知
- `page-title-changed-{pageId}`: タイトル変更通知
- `page-scroll-ended-{pageId}`: Webview 内スクロール完了通知
- `edit-command`: メニューバー `Edit` 操作の編集コマンド通知（payload は `undo` / `redo` / `delete`）
- `file-command`: メニューバー `File` 操作のファイルコマンド通知（payload は `open` / `save` / `save-as`）

## JS ブリッジ API

### `api`

- `loadProjectState`, `saveProjectState`, `closeReady`
- `loadProjectFile`, `saveProjectFile`
- `loadTheme`, `saveTheme`, `getPlatformInfo`
- `onEditCommand`
- `onFileCommand`

### `webviewApi`

- `create`, `updateBounds`, `updateAllBounds`, `updateAllPositions`
- `show`, `hide`, `destroy`, `hideAll`, `showAllWithBounds`
- `setOpacity`, `reload`, `goBack`, `goForward`, `getNavigationState`
- `captureScreenshot`, `saveScreenshot`, `getExistingScreenshotPaths`, `deleteScreenshot`
- `onPageNavigated`, `onPageTitleChanged`, `onPageScrollEnded`

## メニュー連携

- `Edit` メニューは `src/lib/edit-commands.ts` と `src/main.tsx` を経由して renderer に流す
- `File` メニューは `src/lib/file-commands.ts` と `src/main.tsx` を経由して renderer に流す
- `Save` は保存先 `filePath` 未設定時に `Save As` へフォールバックする
- `save_project_file` は常に拡張子を `.siteboard` に正規化する

## プラットフォーム差分

- `capture_webview_screenshot` は現状 macOS のみ
- `get_navigation_state_page_webview` は macOS でネイティブ取得、非 macOS は `false/false`
- `set_page_webview_opacity` は macOS 以外では no-op

## 変更ルール

- コマンド名・引数・戻り値を変更したら、Rust 側・bridge 側・このドキュメントを同時更新する
- イベント名を変更したら listener 側（`WebPageNode` / runtime hooks / `main.tsx`）も同時更新する
- `edit-command` の payload 仕様や発火元を変更したら、`src-tauri/src/lib.rs`・`src/lib/tauri-bridge.ts`・`src/main.tsx`・`src/lib/edit-commands.ts` を同時更新する
- `file-command` の payload 仕様や発火元を変更したら、`src-tauri/src/lib.rs`・`src/lib/tauri-bridge.ts`・`src/main.tsx`・`src/lib/file-commands.ts` を同時更新する
