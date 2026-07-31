# アーキテクチャ概要

## 全体構成

Sheltie は Tauri v2 の Rust バックエンドと React フロントエンドで構成される。

```text
src-tauri/
  src/main.rs
  src/lib.rs
  src/commands/{store,theme,webview}.rs
src/
  components/
  hooks/
  lib/
  screens/
  store/
  types/
```

## フロントエンド責務

- `App.tsx`: document window の表示名と、`isProjectDirty()` から導出した未保存状態を管理する。未保存状態の変更は直列化して window-local IPC へ送り、macOS ネイティブタブの `NSWindow.tab.accessoryView` に表示する edited indicator と同期する
- `screens/Project.tsx`: 1 document window の Sheltie 画面を統括する。新規ノード追加後のセンタリングと選択状態を管理する
- `components/Common/UnsavedChangesDialog.tsx`: HeroUI `AlertDialog` ベースの未保存変更確認ダイアログ。タブクローズとアプリ終了で共用する
- `components/Sheltie/Sheltie.tsx`: `<ReactFlowProvider>` + `<ReactFlow>` でビューポート管理。表示制御・ビューポート・ドラッグ・リサイズ・テキスト編集・コンテキストメニュー・flowNodes 構築をそれぞれ `hooks/sheltie/useSheltie*` フックへ委譲し、Sheltie.tsx 自身は配線と `onNodesChange`/`onEdgesChange`（選択状態・計測寸法・ドラッグ中座標の同期）に専念する。flowNodes 配列は `useSheltieFlowNodes` で構築する。store に保存された viewport は `setViewport()` で React Flow 実体へ再同期する
- `components/Sheltie/FloatingToolbar.tsx`: Web ページ/付箋/テキスト追加ボタン群
- `components/Sheltie/ZoomIndicator.tsx`: ズーム率表示ボタン。押下で `100% + 全ノード中央寄せ`
- `components/Node/WebPageNode.tsx`: webpage ノード本体 UI（フレーム（`bg-default` + `WEB_PAGE_FRAME_PADDING` 24px world 固定 + 角丸 16px world 固定 + 枠線 1px zoomPx）+ 内側に Webview placeholder。空のときは Globe アイコン + "Enter URL above" ヒントを表示。props インターフェース export）
- `components/Node/StickyNoteNode.tsx`: 付箋ノード専用 UI（角丸 16px world 固定、props インターフェース export）
- `components/Node/TextNode.tsx`: テキストノード専用 UI。Tiptap エディタ内蔵、編集/選択モード切り替え、透明背景
- `components/ReactFlowNodes/WebPageFlowNode.tsx`: React Flow 用 WebPageNode ラッパー（`nopan`、x/y=0 固定、`NodeToolbar` 2 段（ツールバー段=単独選択時のみ中央寄せ、タイトル段=常時左寄せ・`[Moved] Title` を truncate）+ フレーム padding 帯（24px world 固定）を `.node-drag-handle` として活用 + 8 方向 `NodeResizeControl`（フレーム外周基準）+ 上下左右 `Handle`（フレーム外周基準、青丸は単独選択時または接続中のpointer hover時に表示し、青丸中心の接続開始領域は単独選択中かつ接続開始前だけ有効））
- `components/ReactFlowNodes/WebPageToolbar.tsx`: WebPage のツールバー段 UI（`bg-zinc-800` の pill。通常は 戻る/進む/リロード、空ノード/URL 編集モード時は URL 入力欄+Open ボタンに差し替え | プリセット(Mobile/Tablet/PC) | サイズ表示 | Pin（isMoved 時のみ））
- `components/ReactFlowNodes/StickyNoteFlowNode.tsx`: React Flow 用 StickyNoteNode ラッパー（`nopan`、x/y=0 固定、ノード本体ドラッグ + `NodeToolbar` でスタイル UI、`NodeResizeControl` で幅リサイズ）
- `components/ReactFlowNodes/StickyNoteToolbar.tsx`: 付箋ノードのスタイルツールバー（フォントサイズ/色）
- `components/ReactFlowNodes/TextFlowNode.tsx`: React Flow 用 TextNode ラッパー（`nopan`、x/y=0 固定、`NodeToolbar` で書式設定 UI、`NodeResizeControl` で幅リサイズ）
- `components/ReactFlowNodes/TextNodeToolbar.tsx`: テキストノードの書式設定ツールバー（フォントサイズ/Bold/Italic/取り消し線/色）
- `components/ReactFlowNodes/types.ts`: React Flow ノード型定義（`WebPageFlowNodeData`, `StickyNoteFlowNodeData`, `TextFlowNodeData`）
- `components/ReactFlowNodes/nodeTypes.ts`: React Flow `nodeTypes` 定数（循環依存防止のため types.ts から分離）
- `components/ReactFlowEdges/ArrowEdge.tsx`: カスタムエッジ。永続化した太さ・実線/破線・テーマ追従色でベジェ path + 始点ドット + 終端矢じりを描く。選択時も線の見た目は変えず、画面サイズ固定の始点/終点リングと、ベジェ境界の左右中央・上端上部に `EdgeToolbar` を表示する
- `components/ReactFlowEdges/ArrowToolbar.tsx`: エッジ単独選択時のスタイルツールバー（太さ 3/6、実線/破線、方向反転、7色）。既存ノードツールバーと同じ外観でツールチップは持たない
- `components/ReactFlowEdges/ArrowConnectionLine.tsx`: ドラッグ中の接続線。標準 3px / 実線 / Default 色で、`fromX/fromY` を `Position` 方向に `handle 半径 / zoom` シフトして完成エッジと位置を揃える
- `components/ReactFlowEdges/arrowGeometry.ts`: 太さ別の矢印形状・破線パターン・色・選択端点リング・ベジェ境界計算と Handle サイズの共通定数/純関数
- `components/ReactFlowEdges/edgeTypes.ts`: React Flow `edgeTypes` 定数。既定の `default` を `ArrowEdge` で上書き
- `hooks/sheltie/*`: 表示制御・ノードランタイム・キーボード操作を分担。ドラッグ・パン・ズーム・リサイズはすべて React Flow に委譲。
- `store/tab-store.ts`: 単一 document window の node・edge・ビューポート状態と統合履歴（Undo/Redo）を管理。同じ2接続点のエッジ追加は後勝ちで向きを置換して旧スタイルを継承し、`updateEdgeStyle` / `reverseEdge` も履歴へ記録する。MCP batchは`applyMcpBoardBatch`だけを使い、全operationを1 history entryとして適用する
- `lib/mcp/renderer-bridge.ts`: window-local MCP requestを検証し、Zustand board read/batchとmounted editor adapterへdispatchしてcompletion envelopeを返す
- `lib/mcp/editor-adapter.ts`: Project/Sheltieが所有するselection、live viewport、cache-first screenshot、offscreen board captureをwindow-localに公開する。永続stateの正本にはしない
- `store/theme-store.ts`: テーマ状態
- `lib/edit-commands.ts`: キーボードと Edit メニューを共通編集コマンドへ束ねる
- `lib/file-commands.ts`: File メニューの `new-tab` / `new-window` / `open` / `save` / `save-as` を処理し、`.sheltie` の入出力と window-local な store 連携を担当する
- `lib/project-close.ts`: dirty 判定・保存/破棄確認・現在 window の close orchestration を担当する
- `lib/app-exit.ts`: macOS の custom `app.quit` から始まる集約 quit coordinator。各 document window の dirty 状態収集、集約ダイアログ、順次保存、最終 `complete_app_exit` を担当する
- `lib/project-display-name.ts`: `filePath` または `untitledIndex` から表示名を導出する
- `lib/error-dialog.ts`: ネイティブのエラーダイアログ表示を共通化する（`file-commands.ts` と `tab-persistence.ts` が使う）
- `components/Common/BoardErrorBoundary.tsx`: ボード描画の例外を局所化する。ツリー全体がアンマウントされるとメモリ上の未保存ボードへ到達できなくなるため、白画面にせずエラー表示に留める
- `main.tsx`: `edit-command` / `file-command` / `app-exit-requested` と app-exit coordinator listener を起動時に 1 回だけ登録する

## `.sheltie` とローカル状態

- `.sheltie` は共有用ドキュメント
  - `schemaVersion`, `nodes`, `edges` を保存する（`edges` は後方互換で省略可能）
  - `title` は保存しない
- Rust 側の document manager は各 window の `filePath` と `untitledIndex` を管理する
- renderer の Zustand store は現在の document の `nodes`, `viewport`, `lastSavedDocument`, `webviewRuntime` をメモリ上で保持する
- 起動時は window context を読み、`filePath` があれば `.sheltie` を読み込み、無ければ空 document を初期化する
- 読み込みまたはパースに失敗した場合は fail-closed にする。エラーダイアログを出して `closeReady()` で window を閉じ、`Project` を初期化しない。読み取り専用モードや回復用 Save As は提供しない
- 保存は同一ディレクトリの一時ファイルへ書いて `sync_all` 後に atomic rename する。上書き時は元ファイルの permissions を引き継ぐ（xattr / Finder タグは対象外）
- window close 時の未保存確認は renderer 側の HeroUI ダイアログで処理し、最終的な window 破棄だけ `close_ready` を使う
- `Cmd+Q` / app menu `Quit` は Rust の custom `app.quit` menu event から renderer coordinator を起動し、集約確認と順次保存の完了後に `complete_app_exit` でまとめて終了する
- 一般的な Mac アプリと同様、全ウインドウを閉じてもプロセスは終了しない。`setup.rs` の `RunEvent::ExitRequested` 受信時に `AppExitCoordinatorState` で `Cmd+Q` 起源かを判定し、それ以外の発火（最後の window クローズ等）は `api.prevent_exit()` で抑止する
- Dock アイコンクリックなどの `RunEvent::Reopen { has_visible_windows: false }` で document window が 1 枚も無い場合は新規 untitled を開く。最小化等で window 自体は残っているケースは OS の標準復帰に委ねる

## Sheltie と React Flow の協業

### ビューポート管理

- **React Flow**: ビューポート（pan/zoom）とノード位置の React state を管理
- **Zustand**: ノード内容（title, url, width, height 等）とプロジェクト状態を管理
- `handleViewportChange` で React Flow の viewport 変更を `zoomRef` と内部 ref に同期し、Zustand への更新は debounce を通して遅延更新する
- store 側の viewport が project 切り替え・centering・復元で変化した時は `setViewport()` で React Flow 実体へ反映する

### ノード位置管理

- React Flow が `.react-flow__node` の CSS transform でノード位置を管理し、Zustand はノード内容を管理する
- 位置の確定は React Flow の `onNodesChange` と各操作コールバック（ドラッグ終了・リサイズ終了）で Zustand に書き込む

実装規約の詳細は `coding-rules.md` の「React Flow」セクションを参照。

### 責務分離

- `useSheltieDisplayEngine`: `DisplayMode` 判定、Webview 表示/非表示、スクリーンショット管理
- `useSheltieNodeRuntime`: webpage ノード単位のナビゲーション状態・タイトル同期・スクリーンショット契機を管理
- `useSheltieKeyboard`: Delete/Backspace・Undo/Redo・ノード重なり順変更のショートカットを処理し、共通編集コマンドへ委譲

詳細仕様は `sheltie-runtime.md` を参照。

## バックエンド責務

- `lib.rs`: モジュール宣言と `pub use` の入口（実体は持たない）
- `mcp/mod.rs`: ローカル MCP endpoint・renderer event・timeout の共通定数と MCP module の入口
- `mcp/types.rs`: MCP toolの入出力、renderer request/response envelope、安定したerror codeの型契約。JSON fieldはrendererと共有するcamelCaseを正本にする
- `mcp/service.rs`: board toolsとbrowser toolsのrouter、schema/annotation、structured/text結果、image content block、session connection leaseを担当する。board内容は保持しない
- `mcp/broker.rs`: Phase 1のrenderer requestを扱う。document存在確認、document単位直列化、window-local event、10秒timeout、completion照合を担当する
- `mcp/page_automation/{protocol,actor}.rs`: Phase 2のtyped page operationとcompact snapshot契約、page単位の直列actor、request ID照合、navigation epochを管理する。異なるpageのactorは並行動作する
- `mcp/tools/browser.rs`: `documentId`と`pageNodeId`を検証し、WKWebViewのsemantic snapshot・DOM action・navigationをpage actorへ渡す
- `mcp/lifecycle.rs`: default-off設定、loopback listener、Host/Origin制限、session managerと全session shutdownを担当する
- `setup.rs`: `pub fn run()` 本体、`invoke_handler` 登録、menu event 配信
- `app_exit.rs`: `AppExitCoordinatorState` とアプリ終了の集約フロー
- `menus/{app,file,edit,view,theme}.rs` + `menus/{helpers,macos}.rs`: メニュー構築と `file-command` / `edit-command` / `view-command` / `theme-command` 配信
- `commands/store/document_manager.rs`: document window 状態機械（ラベル採番・untitled index・filePath 競合チェック）
- `commands/store/document_window.rs`: document window 生成・前面化・window context、終了/クローズ系コマンド
- `commands/store/file_io.rs`: `.sheltie` ファイルの load/save とパス正規化
- `commands/store/macos_tabs.rs`: macOS NSWindow 操作（タブ attach + window 設定）
- `commands/theme.rs`: テーマ設定、プラットフォーム情報
- `commands/webview/labels.rs`: child webview label の解決と namespacing
- `commands/webview/navigation.rs`: back/forward/reload とナビゲーション状態取得
- `commands/webview/page_automation.rs`: tested bridge script、固定dispatch式、呼び出し元Webviewを使うcompletion commandを担当する。一般用途のpage evaluation endpointは持たない
- `commands/webview/bounds.rs`: ページ Webview の生成・frame/opacity/batch 更新。生成時にsemantic bridgeを全frameへ注入し、full/SPA navigationをpage actorへ通知する
- `commands/webview/screenshots.rs`: スクリーンショット capture/save/delete/restore（低レベル変換は `snapshot.rs`）

IPC 契約は `tauri-ipc.md` を参照。

## ビルド

- 開発: `npm run dev`
- ビルド: `npm run build`
- Cargo バイナリターゲット: `src-tauri/Cargo.toml` の `Sheltie`（`src/main.rs`）。Cargo を直接実行する場合は `(cd src-tauri && cargo run --bin Sheltie)` を使う。

Tauri Plugin Store / Dialog は `tauri.conf.json` ではなく `src-tauri/src/setup.rs` の `pub fn run()` で登録する。

## テックスタック（フロントエンド依存関係）

| ライブラリ | 用途 |
|---|---|
| React 19 | UI フレームワーク |
| TypeScript | 型安全性 |
| Tailwind CSS v4 | スタイリング |
| HeroUI v3 | UI コンポーネントライブラリ |
| Zustand | 状態管理（プロジェクト・ノード・テーマ） |
| @xyflow/react v12 | React Flow（フェーズ 1 以降で採用。ビューポート管理 pan/zoom を担当） |
| Tiptap (@tiptap/react) | テキストノードのリッチテキストエディタ（ProseMirror ベース） |
| Framer Motion | アニメーション |
| Tauri v2 JS API | ネイティブ統合（IPC・Webview 管理） |

## 登録済み Tauri プラグイン

| プラグイン | 用途 | 備考 |
|---|---|---|
| `tauri-plugin-single-instance` | 多重起動防止と既存アプリへの open 集約 | document app の入口を 1 つにまとめる |
| `tauri-plugin-store` | プロジェクト状態の永続化 | |
| `tauri-plugin-dialog` | Open / Save / message ダイアログ | File メニューの `.sheltie` 入出力に利用 |
| `tauri-plugin-prevent-default` | メインウィンドウのデフォルトコンテキストメニュー無効化 | `Flags::CONTEXT_MENU` のみ指定。DevTools は維持。子 Webview（外部サイト）は対象外 |
| `tauri-plugin-log` | Rust ログを OS ログに転送 | `#[cfg(debug_assertions)]` でのみ登録（開発時のみ） |

## MCP サーバー基盤

- MCP SDK は `rmcp 2.2.0` を固定し、Tauri process 内で Streamable HTTP server を動かす。
- endpoint は `http://127.0.0.1:29978/mcp`。bind address、renderer event、timeout は `src-tauri/src/mcp/mod.rs` の定数を参照する。
- Rust側はtransport・session・document routing・timeout・tool response shapingを担当し、board state自体はrenderer/Zustandを正本とする。
- Board toolはrenderer brokerを通る。Browser toolは対象nodeをrendererで1回確認した後、page actorからchild WKWebViewへ直接dispatchする。
- `PageAutomationState`はsemantic action、coordinate/evaluate/upload/dialog、element/full-page captureを同じpage-local mutexで直列化する。native capture、bounded PNG処理、upload file readはactor/専用helperに置き、rendererへpage内容をmirrorしない。
- Viewport screenshot sourceの`native` / `screenshot` / `hidden`判定、nodeのCSS viewport寸法、cache取得はrenderer brokerを使う。非native Webviewを表示せず、element/full-page captureは`native`だけを許可する。native PNG寸法とCSS viewport寸法は別々に返し、coordinate操作時にdevice scaleを変換できるようにする。
- Browser actionはboardのUndo/Redo履歴とdocument dirty stateを変更しない。MCPからSave / Save Asも呼ばない。
- `StreamableHttpService`のsession managerをrunning server stateに保持し、disable時はlistener cancellationに加えて全sessionを明示closeする。service cloneはsession単位のleaseを共有し、最終dropでmenu connection countを減算する。
- MCP toolとrenderer間のJSON契約は`src-tauri/src/mcp/types.rs`に集約し、tool実装でad-hocなfield名を増やさない。

## アセットプロトコル

スクリーンショット画像をフロントエンドから読み込むために Tauri のアセットプロトコルを使用する。

- `Cargo.toml`: `tauri` の features に `"protocol-asset"` を追加（`unstable` と並記）
- `tauri.conf.json`: `app.security.assetProtocol.enable = true` と `scope` を設定する

`convertFileSrc` はアセットプロトコルが有効でないと動作しない。capabilities ではなくこの 2 箇所で設定する。

保存先とスコープは `sheltie-runtime.md` のスクリーンショット永続化セクションを参照。
