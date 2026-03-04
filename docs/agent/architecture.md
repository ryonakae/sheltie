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
- `useSiteboardKeyboard`: Delete/Backspace キーで選択中ノードを削除（input/textarea/contentEditable 内はスキップ）。

詳細仕様は `siteboard-runtime.md` を参照。

## バックエンド責務

- `commands/store.rs`: プロジェクト状態の読み書き。
- `commands/theme.rs`: テーマ設定、プラットフォーム情報。
- `commands/webview.rs`: ページ Webview 作成、位置更新、ナビゲーション、スクリーンショット。

IPC 契約は `tauri-ipc.md` を参照。

## ビルド

- 開発: `npm run dev`
- ビルド: `npm run build`

Tauri Plugin Store は `tauri.conf.json` ではなく `src-tauri/src/lib.rs` で登録する。
