# Tauri IPC 契約

実装の正本は `src-tauri/src/lib.rs` と `src/lib/tauri-bridge.ts`。
この文書は契約の読みやすい要約。

## Renderer -> Backend（invoke）

### プロジェクト状態

- `load_window_context` - 現在の document window に紐づく `filePath` / `untitledIndex` を読む
- `attach_pending_document_tab` - 現在 window が pending な macOS `New Tab` child なら、renderer 初期化完了後に host document window へ attach する
- `new_document_tab` - 現在の macOS document window が解決できた時だけ、その native tab group と同じ `tabbingIdentifier` を継承した untitled document を host 限定の explicit attach で追加する。standalone window へはフォールバックしない
- `new_document_window` - 新しい untitled standalone document window を開く
- `open_document_window(path)` - 対象 `.siteboard` 用の document window を開く。既に開いていればその window を前面化する
- `close_ready` - 現在の document window を破棄する
- `load_project_file(path)` - `.siteboard` ファイルを UTF-8 文字列として読む
- `save_project_file(path, contents)` - `.siteboard` ファイルを書き込み、実際の保存パスを返す

### テーマ

- `load_theme`
- `set_theme`
- `get_platform_info`

### Webview

- `create_page_webview(pageId, url, x, y, width, height, zoom)`
- `update_page_webview_bounds(label, x, y, width, height, zoom)`
- `batch_update_page_webview_bounds(entries[])` - 各 entry は `label, x, y, width, height, zoom`
- `batch_update_webview_positions(entries[])` - 各 entry は `label, x, y`
- `set_page_webview_opacity(label, opacity)`
- `reload_page_webview(label, url)`
- `go_back_page_webview(label)`
- `go_forward_page_webview(label)`
- `get_navigation_state_page_webview(label)`
- `capture_webview_screenshot(label)` - base64 Data URL を返す（内部用途のみ）
- `save_webview_screenshot(label, pageId, projectId, hideAfterSnapshotRequest?)` - PNG ファイルを保存しファイルパスを返す（macOS のみ）。`hideAfterSnapshotRequest=true` の時は snapshot 要求直後に同じ Rust コマンド内で Webview を hide する
- `get_existing_screenshot_paths(projectId, pageIds)` - 存在するスクリーンショットのパスを一括取得
- `delete_screenshot(pageId, projectId)` - スクリーンショットファイルを削除

## Backend -> Renderer（イベント）

- `page-navigated-{pageId}`: URL 変更通知
- `page-title-changed-{pageId}`: タイトル変更通知
- `page-scroll-ended-{pageId}`: Webview 内スクロール完了通知
- `edit-command`: メニューバー `Edit` 操作の編集コマンド通知（payload は `undo` / `redo` / `delete`）
- `file-command`: メニューバー `File` 操作のファイルコマンド通知（payload は `new-tab` / `new-window` / `open` / `save` / `save-as`）

## イベントリスニングの実装ルール

**IMPORTANT**: JS 側でイベントをリッスンする際は必ず `getCurrentWebviewWindow().listen()` を使う。`@tauri-apps/api/event` の グローバル `listen()` は使わない。

**理由**: `listen()` がアプリケーションレベルのグローバルリスナーの場合、`emit_to(label, ...)` で特定ウィンドウに向けたイベントも全ウィンドウの JS コンテキストで受信してしまう。複数の document window / native tab が存在する場合、1回のイベント送信に対して全ウィンドウのハンドラが発火し、重複実行（例: 新規タブ作成が N 倍）が発生する。

`getCurrentWebviewWindow().listen()` を使えば、自分宛のイベントのみ受信し、他のウィンドウの event は ignore される。

参考: `src/lib/tauri-bridge/events.ts`

## JS ブリッジ API

`src/lib/tauri-bridge.ts` は公開 facade で、内部実装は `src/lib/tauri-bridge/{project,theme,events,webview}.ts` に分割している。

### `api`

- `loadWindowContext`, `newDocumentTab`, `newDocumentWindow`, `openDocumentWindow`, `closeReady`
- `attachPendingDocumentTab`
- `loadProjectFile`, `saveProjectFile`
- `loadTheme`, `saveTheme`, `getPlatformInfo`
- `onEditCommand`
- `onFileCommand`

### `webviewApi`

- `create(nodeId, ...) -> label`
- `updateBounds(label, ...)`, `updateAllBounds(entries[])`, `updateAllPositions(entries[])`
- `show(label)`, `hide(label)`, `destroy(label)`, `hideAll(labels)`, `showAllWithBounds(entries[])`
- `setOpacity(label, opacity)`, `reload(label, url)`, `goBack(label)`, `goForward(label)`, `getNavigationState(label)`
- `captureScreenshot(label)`, `saveScreenshot(label, pageId, projectId, options?)`, `getExistingScreenshotPaths`, `deleteScreenshot`
- `onPageNavigated`, `onPageTitleChanged`, `onPageScrollEnded`

## メニュー連携

- `Edit` メニューは `src/lib/edit-commands.ts` と `src/main.tsx` を経由して renderer に流す
- `File` メニューは `src/lib/file-commands.ts` と `src/main.tsx` を経由して renderer に流す
- macOS の `File > New Tab` は現在 window の native tab group に untitled document を追加する
- macOS の document window は native tab group ごとに `tabbingIdentifier` を共有する。`File > New Window` は新しい standalone document window / group を作り、既存 window の tab bar 状態は変更しない
- `File > Open` は既存 window を置き換えず、対象 `.siteboard` 用の document window を開く
- `Save` は保存先 `filePath` 未設定時に `Save As` へフォールバックする
- `save_project_file` は常に拡張子を `.siteboard` に正規化する
- window-local な IPC では `main` のような固定 label を前提にしない

## プラットフォーム差分

- `capture_webview_screenshot` は現状 macOS のみ
- `get_navigation_state_page_webview` は macOS でネイティブ取得、非 macOS は `false/false`
- `set_page_webview_opacity` は macOS 以外では no-op

## 変更ルール

- コマンド名・引数・戻り値を変更したら、Rust 側・bridge 側・このドキュメントを同時更新する
- イベント名を変更したら listener 側（`WebPageNode` / runtime hooks / `main.tsx`）も同時更新する
- `edit-command` の payload 仕様や発火元を変更したら、`src-tauri/src/lib.rs`・`src/lib/tauri-bridge.ts`・`src/main.tsx`・`src/lib/edit-commands.ts` を同時更新する
- `file-command` の payload 仕様や発火元を変更したら、`src-tauri/src/lib.rs`・`src/lib/tauri-bridge.ts`・`src/main.tsx`・`src/lib/file-commands.ts` を同時更新する
- document window を増やす/閉じる/前面化する処理を変えたら、`src-tauri/src/lib.rs`・`src/lib/file-commands.ts`・`src/lib/project-close.ts` を同時更新する
## Multiwebview command context

- child webview から invoke される可能性がある command は `tauri::WebviewWindow` ではなく `tauri::Window` を受ける。
- `Window` は command を発火した webview の hosting document window を返すため、top-level webview / child webview のどちらから呼ばれても同じ window label を解決できる。
- child webview 対応 command で `WebviewWindow` を受けると `current webview is not a WebviewWindow` が発生するため使わない。
