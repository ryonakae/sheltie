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

- `screens/Home.tsx`: `.siteboard` 保存済みプロジェクト一覧。`lastOpenedAt` 降順で表示する
- `screens/Project.tsx`: Sidebar + Siteboard の統括
- `components/Project/Sidebar.tsx`: node 一覧（種別アイコン + タイトル/説明）
- `components/Common/ContextMenu.tsx`: createPortal で body 直下に fixed 配置するコンテキストメニュー
- `components/Common/UnsavedChangesDialog.tsx`: HeroUI `AlertDialog` ベースの未保存変更確認ダイアログ。タブクローズとアプリ終了で共用する
- `components/Siteboard/Siteboard.tsx`: 描画と hook 結線
- `components/Siteboard/FloatingToolbar.tsx`: Web ページ/付箋追加ボタン群
- `components/Siteboard/ZoomIndicator.tsx`: ズーム率表示ボタン
- `components/Siteboard/InteractionOverlay.tsx`: 操作中カーソル上書き用オーバーレイ
- `components/Node/WebPageNode*.tsx`: webpage ノード専用 UI
- `components/Node/StickyNoteNode.tsx`: 付箋ノード専用 UI
- `hooks/siteboard/*`: 表示制御・ビューポート・ノードランタイム・キーボード操作を分担
- `store/tab-store.ts`: プロジェクト・node・ビューポート状態と、プロジェクト単位 node 履歴（Undo/Redo）を管理
- `store/theme-store.ts`: テーマ状態
- `lib/edit-commands.ts`: キーボードと Edit メニューを共通編集コマンドへ束ねる
- `lib/file-commands.ts`: File メニューの `open` / `save` / `save-as` を処理し、`.siteboard` の入出力とローカル store 連携を担当する
- `lib/project-close.ts`: dirty 判定・保存/破棄確認・タブクローズ・アプリ終了時の close orchestration を担当する
- `main.tsx`: `edit-command` と `file-command` の listener を起動時に 1 回だけ登録する

## `.siteboard` とローカル状態

- `.siteboard` は共有用ドキュメント
  - `schemaVersion`, `title`, `nodes` のみ保存する
- Zustand + Tauri Store はローカルワークスペースの復元用
  - `nodes` に加えて `filePath`, `sidebarWidth`, `viewport`, `lastOpenedAt`, `lastSavedDocument` を保存する
  - project state は Tauri Store の `projectStateV2` key に保存し、旧 key は参照しない
- 起動時はローカル状態を復元し、`.siteboard` の自動再読込はしない
- タブクローズ時とアプリ終了時の未保存確認は renderer 側の HeroUI ダイアログで処理し、最終的なウィンドウ破棄だけ `close_ready` を使う

## Siteboard の責務分離

- `useSiteboardDisplayEngine`: `DisplayMode` 判定、Webview 表示/非表示、スクリーンショット管理
- `useSiteboardViewportEngine`: ズーム・パン・ドラッグ・リサイズの入力処理
- `useSiteboardNodeRuntime`: webpage ノード単位のナビゲーション状態・タイトル同期・スクリーンショット契機を管理
- `useSiteboardKeyboard`: Delete/Backspace・Undo/Redo のショートカットを処理し、共通編集コマンドへ委譲

詳細仕様は `siteboard-runtime.md` を参照。

## バックエンド責務

- `commands/store.rs`: ローカル project state と `.siteboard` ファイルの読み書き
- `commands/theme.rs`: テーマ設定、プラットフォーム情報
- `commands/webview.rs`: webpage Webview 作成、位置更新、ナビゲーション、スクリーンショット
- `src-tauri/src/lib.rs`: File / Edit メニュー構成、メニューイベントの `file-command` / `edit-command` 配信、Tauri プラグイン登録

IPC 契約は `tauri-ipc.md` を参照。

## ビルド

- 開発: `npm run dev`
- ビルド: `npm run build`

Tauri Plugin Store / Dialog は `tauri.conf.json` ではなく `src-tauri/src/lib.rs` で登録する。

## 登録済み Tauri プラグイン

| プラグイン | 用途 | 備考 |
|---|---|---|
| `tauri-plugin-store` | プロジェクト状態の永続化 | |
| `tauri-plugin-dialog` | Open / Save / message ダイアログ | File メニューの `.siteboard` 入出力に利用 |
| `tauri-plugin-prevent-default` | メインウィンドウのデフォルトコンテキストメニュー無効化 | `Flags::CONTEXT_MENU` のみ指定。DevTools は維持。子 Webview（外部サイト）は対象外 |

## アセットプロトコル

スクリーンショット画像をフロントエンドから読み込むために Tauri のアセットプロトコルを使用する。

- `Cargo.toml`: `tauri` の features に `"protocol-asset"` を追加（`unstable` と並記）
- `tauri.conf.json`: `app.security.assetProtocol.enable = true` と `scope` を設定する

`convertFileSrc` はアセットプロトコルが有効でないと動作しない。capabilities ではなくこの 2 箇所で設定する。

保存先とスコープは `siteboard-runtime.md` のスクリーンショット永続化セクションを参照。
