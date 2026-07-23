# Tauri IPC 契約

実装の正本は `src-tauri/src/{setup.rs, app_exit.rs, menus/*, commands/*}` と `src/lib/tauri-bridge.ts`。
この文書は契約の読みやすい要約。

- 起動・menu 配線・`invoke_handler` 登録: `setup.rs`
- アプリ終了集約フロー: `app_exit.rs`
- メニュー構築（App/File/Edit/View/Theme）: `menus/`
- ドキュメントウィンドウ・ファイル IO: `commands/store/{document_manager,document_window,file_io,macos_tabs}.rs`
- Webview 関連 IPC: `commands/webview/{labels,navigation,bounds,page_automation,screenshots,snapshot}.rs`
- ダイアログ: `commands/dialog.rs`
- テーマ: `commands/theme.rs`

## Renderer -> Backend（invoke）

### プロジェクト状態

- `load_window_context` - 現在の document window に紐づく `filePath` / `untitledIndex` を読む
- `present_document_window` - renderer 初期化完了後（最初の paint 後）に呼び出され、`visible(false)` で生成された document window をユーザーに見せる。pending な macOS `New Tab` child の場合は host document window へ attach し、それ以外は `show` + `setFocus` する
- `set_document_edited(edited)` - 呼び出し元 document window の未保存表示を更新する。macOS では `NSWindow.setDocumentEdited:` に加え、`NSWindow.tab.accessoryView` へ 20pt 領域内の 4pt tertiary circle を設定・解除する。非 macOS では no-op
- `new_document_tab` - 現在の macOS document window が解決できた時だけ、その native tab group と同じ `tabbingIdentifier` を継承した untitled document を host 限定の explicit attach で追加する。standalone window へはフォールバックしない
- `new_document_window` - 新しい untitled standalone document window を開く
- `open_document_window(path)` - 対象 `.sheltie` 用の document window を開く。既に開いていればその window を前面化する
- `complete_app_exit(windowLabels)` - 集約済み app quit を確定し、対象 document window をまとめて destroy した後にアプリ終了を再開する
- `abort_app_exit` - 集約中の app quit を中止し、次の `Cmd+Q` / `Quit` を再度受け付ける
- `close_ready` - 現在の document window を破棄する
- `load_project_file(path)` - `.sheltie` ファイルを UTF-8 文字列として読む
- `save_project_file(path, contents)` - `.sheltie` ファイルを書き込み、実際の保存パスを返す。child Webview 作成後も呼べるよう command context は `Window` を使う
- `complete_mcp_renderer_request(response)` - Rustから対象document rendererへ送ったMCP requestを完了する。呼び出し元`Window.label()`がpending requestの`documentId`と一致する場合だけ受理し、unknown / late / 別windowの`requestId`は拒否する

### ダイアログ

- `show_unsaved_changes_dialog(params)` - macOS NSAlert をシートスタイル（`beginSheetModalForWindow:completionHandler:`）で表示する（macOS のみ、非 macOS は即 `"cancel"` を返す）。シートはウィンドウ上部からスライドダウンし、背景にオーバーレイが表示される。戻り値は `"save"` / `"discard"` / `"cancel"`。`params.kind` が `"window-close"` の場合は `projectTitle` を使い、`"app-exit"` の場合は `projectTitles[]` を使う。実装: `src-tauri/src/commands/dialog.rs`

### テーマ

- `load_theme`
- `set_theme`
- `get_platform_info`

テーマ切り替え UI はアプリメニュー `Sheltie > Settings > Theme` で提供する（CheckMenuItem ベース）。選択時に `theme-command` イベントを emit する。

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
- `unregister_page_automation_page(pageId)` - child Webviewを閉じる前にpage actorの実行中requestとqueueを`webview_not_ready`で終了する。呼び出し元`Window.label()`を`documentId`として使う
- `complete_page_automation_request(result)` - injected top frame専用。引数に`tauri::Webview`を受け、`requestId`、payloadの`documentId` / `pageNodeId`、呼び出し元window label / Webview labelがpending requestと一致した場合だけ完了する。一般用途のJavaScript評価には使わない

MCP element/full-page captureは公開Tauri commandを増やさず、page actorからmacOS内部helper `capture_page_webview_png`を呼ぶ。bridgeでCSS geometry/scroll完了を確認してから同じactor queue内でnative PNGを取得する。

## Backend -> Renderer（イベント）

- `page-navigated-{pageId}`: URL 変更通知
- `page-title-changed-{pageId}`: タイトル変更通知
- `page-scroll-ended-{pageId}`: Webview 内スクロール完了通知
- `app-exit-requested`: Rust の custom `app.quit` menu event が発火した時、focused document window に対して送る集約 quit 開始通知
- `edit-command`: メニューバー `Edit` 操作の編集コマンド通知（payload は `undo` / `redo` / `delete`）
- `file-command`: メニューバー `File` 操作のファイルコマンド通知（payload は `new-tab` / `new-window` / `open` / `save` / `save-as`）
- `view-command`: メニューバー `View` 操作のビューコマンド通知（payload は `fit-view` / `reset-zoom` / `zoom-in` / `zoom-out`）
- `theme-command`: ネイティブテーマメニュー（`show_theme_menu`）で選択されたテーマ通知（payload は `light` / `dark` / `system`）
- `mcp-lifecycle-changed`: Settingsの`Enable MCP Server` / `Disable MCP Server` actionがlatest intentとして成功した時、操作時点でfocusedだったdocument windowだけへ送る通知（payloadは`started` / `stopped`）。起動時の設定復元、stale intent、失敗時、focused document windowが無い場合は送らない
- `mcp-renderer-request`: Rust brokerが明示された`documentId`のwindowだけへ送るrequest。payloadは`{ requestId, command, params }`で、rendererは成功/失敗にかかわらず`complete_mcp_renderer_request`を1回呼ぶ

## Renderer <-> Renderer（window-local app quit coordination）

- `app-exit-state-request`: coordinator window が各 document window に dirty 判定を問い合わせる
- `app-exit-state-response`: 各 document window が `{ windowLabel, projectTitle, dirty }` を返す
- `app-exit-save-request`: coordinator window が特定 document window に保存実行を依頼する
- `app-exit-save-response`: 保存結果 `{ windowLabel, status }` を返す。`status` は `saved` / `cancelled` / `error`

## イベントリスニングの実装ルール

**IMPORTANT**: JS 側でイベントをリッスンする際は必ず `getCurrentWebviewWindow().listen()` を使う。`@tauri-apps/api/event` の グローバル `listen()` は使わない。

**理由**: `listen()` がアプリケーションレベルのグローバルリスナーの場合、`emit_to(label, ...)` で特定ウィンドウに向けたイベントも全ウィンドウの JS コンテキストで受信してしまう。複数の document window / native tab が存在する場合、1回のイベント送信に対して全ウィンドウのハンドラが発火し、重複実行（例: 新規タブ作成が N 倍）が発生する。

`getCurrentWebviewWindow().listen()` を使えば、自分宛のイベントのみ受信し、他のウィンドウの event は ignore される。

参考: `src/lib/tauri-bridge/events.ts`

## JS ブリッジ API

`src/lib/tauri-bridge.ts` は公開 facade で、内部実装は `src/lib/tauri-bridge/{project,theme,events,webview,types}.ts` に分割している。

### `api`

- `loadWindowContext`, `setDocumentEdited`, `newDocumentTab`, `newDocumentWindow`, `openDocumentWindow`, `closeReady`
- `completeAppExit`, `abortAppExit`
- `presentDocumentWindow`
- `loadProjectFile`, `saveProjectFile`
- `loadTheme`, `saveTheme`, `getPlatformInfo`
- `onAppExitRequested`
- `onMcpLifecycleChanged`
- `onMcpRendererRequest`
- `onEditCommand`
- `onFileCommand`
- `onViewCommand`

### `webviewApi`

- `create(nodeId, ...) -> label`
- `updateBounds(label, ...)`, `updateAllBounds(entries[])`, `updateAllPositions(entries[])`
- `show(label)`, `hide(label)`, `destroy(pageId, label)`, `hideAll(labels)`, `showAllWithBounds(entries[])`
- `setOpacity(label, opacity)`, `reload(label, url)`, `goBack(label)`, `goForward(label)`, `getNavigationState(label)`
- `captureScreenshot(label)`, `saveScreenshot(label, pageId, projectId, options?)`, `getExistingScreenshotPaths`, `deleteScreenshot`
- `onPageNavigated`, `onPageTitleChanged`, `onPageScrollEnded`

## メニュー連携

- `Edit` メニューは `src/lib/edit-commands.ts` と `src/main.tsx` を経由して renderer に流す
- `File` メニューは `src/lib/file-commands.ts` と `src/main.tsx` を経由して renderer に流す
- `View` メニューは `src/lib/view-commands.ts` と `src/main.tsx` を経由して renderer に流す。`fit-view`（Shift+1）はテキスト編集中に editable フォーカスをチェックしてスキップする
- SettingsのMCPセクションはdesired enablement stateを正本に、`MCP: Enabled / Disabled`見出し、`Enable / Disable MCP Server` action、enabled時だけ表示する`Connections: N`をRust側で同期する
- macOS の `File > New Tab` は現在 window の native tab group に untitled document を追加する
- macOS の document window は native tab group ごとに `tabbingIdentifier` を共有する。`File > New Window` は新しい standalone document window / group を作り、既存 window の tab bar 状態は変更しない
- `File > Open` は既存 window を置き換えず、対象 `.sheltie` 用の document window を開く
- `Save` は保存先 `filePath` 未設定時に `Save As` へフォールバックする
- `save_project_file` は常に拡張子を `.sheltie` に正規化する
- window-local な IPC では `main` のような固定 label を前提にしない
- MCP renderer requestはdocumentごとのasync mutexで直列化し、異なるdocumentだけを並行実行する。timeoutは10秒で、disable時はpending requestを`server_stopped`で全て終了する
- MCP lifecycle成功通知は`src/lib/mcp/lifecycle-notifications.ts`でHeroUI success toastへ変換し、`src/components/Common/AppToastProvider.tsx`の共通Providerで右上へテキストに応じた可変幅で表示する
- `Cmd+Q` / `Quit` は macOS app menu の既定 `Quit` を custom `app.quit` item に差し替え、その menu event から renderer 側 coordinator を起動する

## プラットフォーム差分

- `capture_webview_screenshot` は現状 macOS のみ
- `get_navigation_state_page_webview` は macOS でネイティブ取得、非 macOS は `false/false`
- `set_page_webview_opacity` は macOS 以外では no-op
- `set_document_edited` は macOS 以外では no-op

## 変更ルール

- コマンド名・引数・戻り値を変更したら、Rust 側・bridge 側・このドキュメントを同時更新する
- イベント名を変更したら listener 側（`WebPageNode` / runtime hooks / `main.tsx`）も同時更新する
- `edit-command` の payload 仕様や発火元を変更したら、`src-tauri/src/menus/edit.rs`・`src-tauri/src/setup.rs`・`src/lib/tauri-bridge.ts`・`src/main.tsx`・`src/lib/edit-commands.ts` を同時更新する
- `file-command` の payload 仕様や発火元を変更したら、`src-tauri/src/menus/file.rs`・`src-tauri/src/setup.rs`・`src/lib/tauri-bridge.ts`・`src/main.tsx`・`src/lib/file-commands.ts` を同時更新する
- `view-command` の payload 仕様や発火元を変更したら、`src-tauri/src/menus/view.rs`・`src-tauri/src/setup.rs`・`src/lib/tauri-bridge.ts`・`src/main.tsx`・`src/lib/view-commands.ts` を同時更新する
- `app-exit-requested` や `complete_app_exit` / `abort_app_exit` を変更したら、`src-tauri/src/app_exit.rs`・`src-tauri/src/commands/store/document_window.rs`・`src/lib/app-exit.ts`・`src/lib/tauri-bridge.ts`・`src/main.tsx` を同時更新する
- document window を増やす/閉じる/前面化する処理を変えたら、`src-tauri/src/commands/store/document_window.rs`・`src-tauri/src/commands/store/macos_tabs.rs`・`src/lib/file-commands.ts`・`src/lib/project-close.ts` を同時更新する
## Multiwebview command context

- document window に child webview が存在しうる command は `tauri::WebviewWindow` ではなく `tauri::Window` を受ける。
- `add_child()` で child webview を追加すると Tauri v2 の `get_webview_window()` / `webview_windows()` が document window を返さなくなる。`WebviewWindow` パラメータの解決はこの関数に依存するため、child webview が存在する状態で失敗し `current webview is not a WebviewWindow` が発生する。
- `Window` は `get_window()` で解決されるため child webview の有無に関わらず document window を返す。
- この制約は「child webview から invoke」に限らず、「child webview が存在する window から invoke」でも同様に適用される。`close_ready`、`save_project_file`、`set_document_edited` は document window の JS から呼ぶが、WebPageNode がある状態でも解決できるよう `Window` を使う。
- Semantic bridgeは`initialization_script_for_all_frames`でtop frameとdescendant frameへ入れる。descendantは`postMessage`でtop frameへ結果を返し、native completionを呼ぶのはtop frameだけとする。
- Phase 3のcoordinate/evaluate/upload/dialog/capture geometryも同じtyped bridgeとcompletion IPCを使う。任意scriptを受けるTauri commandや第二のcompletion routeを追加しない。
- `on_new_window`はpopupを`Deny`し、HTTP(S) URLを同じ`page-*` Webviewで開く。新しいpage nodeや外部browserを作らない。
- Remote `page-*` Webviewのcapabilityは`complete_page_automation_request`だけを許可する。`remote.urls`は`http://*:*` / `https://*:*`とし、default/non-default portの両方を対象にする。`http://*`だけではTauriのURLPatternがdefault portにしか一致しない。document UIのlocal capabilityと混ぜない。
