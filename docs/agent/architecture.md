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

- `screens/Home.tsx`: プロジェクト一覧。
- `screens/Project.tsx`: Sidebar + Siteboard の統括。
- `components/Common/ContextMenu.tsx`: createPortal で body 直下に fixed 配置するコンテキストメニュー（クリック外・Escape・スクロールで閉じる）。
- `components/Siteboard/Siteboard.tsx`: 描画と hook 結線。
- `components/Siteboard/FloatingToolbar.tsx`: ページ/付箋追加ボタン群（右下固定）。
- `components/Siteboard/ZoomIndicator.tsx`: ズーム率表示ボタン（右下固定、クリックでズームリセット）。
- `components/Siteboard/InteractionOverlay.tsx`: 操作中カーソル上書き用オーバーレイ。
- `hooks/siteboard/*`: 表示制御・ビューポート・ノードランタイム・キーボード操作を分担。
- `store/tab-store.ts`: プロジェクト・ページ・ビューポート状態。
- `store/theme-store.ts`: テーマ状態。

## Siteboard の責務分離

- `useSiteboardDisplayEngine`: `DisplayMode` 判定、Webview 表示/非表示、スクリーンショット管理。
- `useSiteboardViewportEngine`: ズーム・パン・ドラッグ・リサイズの入力処理。
- `useSiteboardNodeRuntime`: ページノード単位の Webview 生成/破棄とイベント処理。
- `useSiteboardKeyboard`: Delete/Backspace・Undo/Redo のショートカットを処理し、共通編集コマンドへ委譲（input/textarea/contentEditable 内はスキップ）。
- `lib/edit-commands.ts`: キーボード操作と Tauri メニュー操作を共通の `undo` / `redo` / `delete` コマンドに統一する。

詳細仕様は `siteboard-runtime.md` を参照。

## バックエンド責務

- `commands/store.rs`: プロジェクト状態の読み書き。
- `commands/theme.rs`: テーマ設定、プラットフォーム情報。
- `commands/webview.rs`: ページ Webview 作成、位置更新、ナビゲーション、スクリーンショット。
- `src-tauri/src/lib.rs`: Edit メニュー（Undo/Redo/Delete）とメニューイベントの `edit-command` 配信を管理。

IPC 契約は `tauri-ipc.md` を参照。

## ビルド

- 開発: `npm run dev`
- ビルド: `npm run build`

Tauri Plugin Store は `tauri.conf.json` ではなく `src-tauri/src/lib.rs` で登録する。

## 登録済み Tauri プラグイン

| プラグイン | 用途 | 備考 |
|---|---|---|
| `tauri-plugin-store` | プロジェクト状態の永続化 | |
| `tauri-plugin-prevent-default` | メインウィンドウのデフォルトコンテキストメニュー無効化 | `Flags::CONTEXT_MENU` のみ指定。DevTools は維持。子 Webview（外部サイト）は対象外 |
