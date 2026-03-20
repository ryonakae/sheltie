# アーキテクチャ概要

## 全体構成

Siteboard は Tauri v2 の Rust バックエンドと React フロントエンドで構成される。

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

- `screens/Project.tsx`: 1 document window の Siteboard 画面を統括する。新規ノード追加後のセンタリングと選択状態を管理する
- `components/Common/ContextMenu.tsx`: createPortal で body 直下に fixed 配置するコンテキストメニュー
- `components/Common/UnsavedChangesDialog.tsx`: HeroUI `AlertDialog` ベースの未保存変更確認ダイアログ。タブクローズとアプリ終了で共用する
- `components/Siteboard/Siteboard.tsx`: `<ReactFlowProvider>` + `<ReactFlow>` でビューポート管理。uiZoom/右下 viewport controls をコンポーネント state と helper で管理する。flowNodes を `useMemo` で直接構築。`draggingNodePositions` state でドラッグ中の一時位置管理。`onNodeDragStart`/`onNodeDragStop` でドラッグハンドラーを実装し、`onNodesChange` で選択状態・計測寸法・ドラッグ中座標を同期する。store に保存された viewport は `setViewport()` で React Flow 実体へ再同期する
- `components/Siteboard/FloatingToolbar.tsx`: Web ページ/付箋追加ボタン群
- `components/Siteboard/ZoomIndicator.tsx`: ズーム率表示ボタン。押下で `100% + 全ノード中央寄せ`
- `components/Node/WebPageNode*.tsx`: webpage ノード専用 UI（props インターフェース export）
- `components/Node/StickyNoteNode.tsx`: 付箋ノード専用 UI（props インターフェース export）
- `components/ReactFlowNodes/WebPageFlowNode.tsx`: React Flow 用 WebPageNode ラッパー（`nopan`、x/y=0 固定、`WebPageNode` 本体内の上下 chrome + node 内ツールバー + 上下 chrome の dragHandle + 8 方向 `NodeResizeControl`）
- `components/ReactFlowNodes/StickyNoteFlowNode.tsx`: React Flow 用 StickyNoteNode ラッパー（`nopan`、x/y=0 固定、ノード本体ドラッグ + sticky header 内の操作 UI）
- `components/ReactFlowNodes/types.ts`: React Flow ノード型定義（`WebPageFlowNodeData`, `StickyNoteFlowNodeData`）
- `components/ReactFlowNodes/nodeTypes.ts`: React Flow `nodeTypes` 定数（循環依存防止のため types.ts から分離）
- `hooks/siteboard/*`: 表示制御・ノードランタイム・キーボード操作を分担。ドラッグ・パン・ズーム・リサイズはすべて React Flow に委譲。
- `store/tab-store.ts`: 単一 document window の node・ビューポート状態と node 履歴（Undo/Redo）を管理
- `store/theme-store.ts`: テーマ状態
- `lib/edit-commands.ts`: キーボードと Edit メニューを共通編集コマンドへ束ねる
- `lib/file-commands.ts`: File メニューの `new` / `open` / `save` / `save-as` を処理し、`.siteboard` の入出力と window-local な store 連携を担当する
- `lib/project-close.ts`: dirty 判定・保存/破棄確認・window close・アプリ終了時の close orchestration を担当する
- `lib/project-display-name.ts`: `filePath` または `untitledIndex` から表示名を導出する
- `main.tsx`: `edit-command` と `file-command` の listener を起動時に 1 回だけ登録する

## `.siteboard` とローカル状態

- `.siteboard` は共有用ドキュメント
  - `schemaVersion`, `nodes` のみ保存する
  - `title` は保存しない
- Rust 側の document manager は各 window の `filePath` と `untitledIndex` を管理する
- renderer の Zustand store は現在の document の `nodes`, `viewport`, `lastSavedDocument`, `webviewRuntime` をメモリ上で保持する
- 起動時は window context を読み、`filePath` があれば `.siteboard` を読み込み、無ければ空 document を初期化する
- window close 時とアプリ終了時の未保存確認は renderer 側の HeroUI ダイアログで処理し、最終的なウィンドウ破棄だけ `close_ready` を使う

## Siteboard と React Flow の協業

### ビューポート管理

- **React Flow**: ビューポート（pan/zoom）とノード位置の React state を管理
- **Zustand**: ノード内容（title, url, width, height 等）とプロジェクト状態を管理
- `handleViewportChange` で React Flow の viewport 変更を `zoomRef` と内部 ref に同期し、Zustand への更新は debounce を通して遅延更新する
- store 側の viewport が project 切り替え・centering・復元で変化した時は `setViewport()` で React Flow 実体へ反映する

### ノード位置管理

- React Flow ノード（`<Node>`）の `position` は常に node の `{x, y}` を反映
- ノードコンポーネント（`StickyNoteNode`, `WebPageNode`）から `position: absolute` と `left/top` スタイルを削除（React Flow が `.react-flow__node` の CSS transform で管理するため不要）
- ノード位置の実際の変更は React Flow の `onNodesChange` と各操作コールバック（ドラッグ終了・リサイズ終了）で Zustand に書き込み
- React Flow の `onNodesChange` は `dimensions`・`select`・`position(dragging=true)` を処理し、controlled mode の整合を保つ

### 責務分離

- `useSiteboardDisplayEngine`: `DisplayMode` 判定、Webview 表示/非表示、スクリーンショット管理
- `useSiteboardNodeRuntime`: webpage ノード単位のナビゲーション状態・タイトル同期・スクリーンショット契機を管理
- `useSiteboardKeyboard`: Delete/Backspace・Undo/Redo のショートカットを処理し、共通編集コマンドへ委譲

詳細仕様は `siteboard-runtime.md` を参照。

## バックエンド責務

- `commands/store.rs`: ローカル document state と `.siteboard` ファイルの読み書き
- `commands/store.rs`: document window の生成・前面化・window context・`.siteboard` ファイルの読み書き
- `commands/theme.rs`: テーマ設定、プラットフォーム情報
- `commands/webview.rs`: webpage Webview 作成、位置更新、ナビゲーション、スクリーンショット。child webview label は親 document window ごとに namespacing する
- `src-tauri/src/lib.rs`: File / Edit メニュー構成、メニューイベントの `file-command` / `edit-command` 配信、Tauri プラグイン登録、document window の生成

IPC 契約は `tauri-ipc.md` を参照。

## ビルド

- 開発: `npm run dev`
- ビルド: `npm run build`

Tauri Plugin Store / Dialog は `tauri.conf.json` ではなく `src-tauri/src/lib.rs` で登録する。

## テックスタック（フロントエンド依存関係）

| ライブラリ | 用途 |
|---|---|
| React 19 | UI フレームワーク |
| TypeScript | 型安全性 |
| Tailwind CSS v4 | スタイリング |
| HeroUI v3 | UI コンポーネントライブラリ |
| Zustand | 状態管理（プロジェクト・ノード・テーマ） |
| @xyflow/react v12 | React Flow（フェーズ 1 以降で採用。ビューポート管理 pan/zoom を担当） |
| Framer Motion | アニメーション |
| Tauri v2 JS API | ネイティブ統合（IPC・Webview 管理） |

## 登録済み Tauri プラグイン

| プラグイン | 用途 | 備考 |
|---|---|---|
| `tauri-plugin-single-instance` | 多重起動防止と既存アプリへの open 集約 | document app の入口を 1 つにまとめる |
| `tauri-plugin-store` | プロジェクト状態の永続化 | |
| `tauri-plugin-dialog` | Open / Save / message ダイアログ | File メニューの `.siteboard` 入出力に利用 |
| `tauri-plugin-prevent-default` | メインウィンドウのデフォルトコンテキストメニュー無効化 | `Flags::CONTEXT_MENU` のみ指定。DevTools は維持。子 Webview（外部サイト）は対象外 |

## アセットプロトコル

スクリーンショット画像をフロントエンドから読み込むために Tauri のアセットプロトコルを使用する。

- `Cargo.toml`: `tauri` の features に `"protocol-asset"` を追加（`unstable` と並記）
- `tauri.conf.json`: `app.security.assetProtocol.enable = true` と `scope` を設定する

`convertFileSrc` はアセットプロトコルが有効でないと動作しない。capabilities ではなくこの 2 箇所で設定する。

保存先とスコープは `siteboard-runtime.md` のスクリーンショット永続化セクションを参照。
