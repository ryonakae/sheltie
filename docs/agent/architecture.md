# アーキテクチャ概要

## 全体構成

Siteboard は Tauri v2 の Rust バックエンドと React フロントエンドで構成される。

```text
src-tauri/
  src/main.rs
  src/lib.rs
  src/commands/{store,theme,webview}.rs
src/
  renderer/
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
- `components/Siteboard/Siteboard.tsx`: 描画と hook 結線。
- `hooks/siteboard/*`: 表示制御・ビューポート・ノードランタイムを分担。
- `store/tab-store.ts`: プロジェクト・ページ・ビューポート状態。
- `store/theme-store.ts`: テーマ状態。

## Siteboard の責務分離

- `useSiteboardDisplayEngine`: `DisplayMode` 判定、Webview 表示/非表示、スクリーンショット管理。
- `useSiteboardViewportEngine`: ズーム・パン・ドラッグ・リサイズの入力処理。
- `useSiteboardNodeRuntime`: ページノード単位の Webview 生成/破棄とイベント処理。

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
