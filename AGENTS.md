# 開発ガイドライン

## プロジェクト概要

Siteboard は Tauri v2 + React + TypeScript + Tailwind CSS v4 で構築されたデスクトップアプリケーションです。Rust バックエンド + Vite React フロントエンドを採用しています。


## 開発コマンド

```bash
npm run dev        # 開発モードで起動（Tauri CLI + Vite HMR）
npm run build      # アプリをビルド・パッケージング
npm run lint       # ESLint によるコード検査
npm run lint:fix   # ESLint 自動修正
npm run format     # Prettier によるフォーマット
npm run typecheck  # TypeScript の型チェック
```

テストフレームワークは現在導入されていません。


## アーキテクチャ

Tauri v2 の Rust バックエンド + React フロントエンド構成で実装されています：

```
├── src-tauri/          # Rust バックエンド
│   ├── Cargo.toml      # Rust 依存関係（tauri unstable, tauri-plugin-store）
│   ├── tauri.conf.json # Tauri 設定（titleBarStyle: Overlay, hiddenTitle: true; plugins は lib.rs で登録）
│   ├── capabilities/
│   │   └── default.json # パーミッション設定
│   └── src/
│       ├── main.rs     # Rust エントリーポイント
│       ├── lib.rs      # Builder 設定・コマンド登録
│       ├── commands/
│       │   ├── mod.rs  # モジュール定義
│       │   ├── store.rs # load_project_state / save_project_state / close_ready
│       │   ├── theme.rs # load_theme / set_theme / get_platform_info
│       │   └── webview.rs # create_page_webview（on_navigation / on_document_title_changed 登録）
├── src/                # React フロントエンド
│   ├── renderer/       # React SPA
│   │   ├── main.tsx    # React エントリーポイント
│   │   ├── App.tsx     # ルートコンポーネント（Zustand でプロジェクト状態管理）
│   │   ├── types/
│   │   │   ├── tab.ts  # Project 型（pages[]、viewport を含む）、Page、Viewport、ProjectState、webviewLabel
│   │   │   └── electron.d.ts # (削除予定）
│   │   ├── lib/
│   │   │   ├── theme.ts # テーマ管理ユーティリティ
│   │   │   └── tauri-bridge.ts # Tauri IPC ブリッジ層（api / themeApi / webviewApi / getPlatformInfo）
│   │   ├── store/
│   │   │   ├── tab-store.ts # Zustand ストア（setPageWebviewLabel アクション追加）
│   │   │   ├── tab-persistence.ts # プロジェクト状態の永続化ロジック
│   │   │   └── theme-store.ts # Zustand テーマストア
│   │   ├── hooks/
│   │   │   ├── useWindowControlsInset.ts # getPlatformInfo() 非同期に更新
│   │   │   ├── useArtboardPan.ts # パン操作
│   │   │   ├── useArtboardZoom.ts # ズーム・パン操作
│   │   │   ├── usePageDrag.ts # ページドラッグ
│   │   │   └── usePageResize.ts # ページリサイズ
│   │   └── components/
│   │       ├── Canvas/ # キャンバス管理
│   │       ├── Artboard/ # ページレンダリング・操作制御
│   │       │   ├── PageFrame.tsx # プレースホルダー div + Tauri Webview
│   │       │   ├── Artboard.tsx # hideAll / syncAllWebviewBounds 追加
│   │       │   └── PageTitleBar.tsx
│   │       ├── TabBar/ # data-tauri-drag-region で実装
│   │       └── HomeScreen/ # プロジェクト一覧
│   └── shared/
│       └── types.ts    # ThemeMode のみ（window.* グローバル宣言削除）
├── vite.config.mts     # Vite 設定（safari14 以上でビルド; BigInt リテラル対応に必須）
└── index.html          # プロジェクトルートに移動
```

### コンポーネント構成

**HomeScreen**: プロジェクト一覧画面（ホーム表示時）
- `HomeScreen.tsx`: プロジェクト一覧のカードグリッドレイアウト
- `ProjectCard.tsx`: 各プロジェクトをカード表示（Dropdown で操作メニュー提供）
- `RenameModal.tsx`: プロジェクト名変更用モーダル（HeroUI Modal）
- `DeleteDialog.tsx`: 削除確認用ダイアログ（HeroUI AlertDialog）

**TabBar**: 開いているプロジェクトのタブバー、ホームボタン、追加ボタン
- `openIds` に基づいて開いているプロジェクトのみ表示
- `@dnd-kit/react` を使用したドラッグ&ドロップ並び替え対応
- 各タブはホバー時に閉じるボタン（×）を表示
- `useWindowControlsInset` で macOS トラフィックライト、Windows/Linux のコントロール領域に対応（`data-tauri-drag-region` 属性で実装）

**Canvas**: サイドバーとアートボードを管理
- **Sidebar**: ページ一覧表示、ページ追加フォーム（AddPageForm）、ページごとに削除ボタン付き
- **ResizeHandle**: サイドバー幅調整可能（リサイズ中は DOM 直接操作でパフォーマンス最適化）
- **Artboard**: キャンバス領域に複数の Tauri Webview を配置、ドラッグ・リサイズ・ズーム・パン対応

**Artboard**: ページレンダリング・ビューポート管理・操作制御
- 各ページを `<div data-webview-placeholder>` + Tauri Webview で DOM に描画
- canvas 要素に transform (translate + scale) を設定してズーム・パン実装
- ドラッグでページ移動、リサイズでサイズ変更（`updatePagePosition`/`updatePageSize` で Zustand 状態更新）
- タイトルバーのデバイスプリセットボタン（モバイル・タブレット・PC）でワンクリック高さ・幅変更
- マウスホイール or トラックパッドで操作（`updateViewport` で Zustand 状態更新）:
  - `Ctrl/Cmd + ホイール`: マウスカーソル中心にズーム
  - `ホイール（修飾キーなし）`: キャンバスをパン（スクロール移動）
- ページをクリックで最前面に（`bringPageToFront` で Zustand z-index 制御）
- 操作モード制御：`isInteracting` フラグで Webview の `pointer-events` を制御
  - 操作中 (`isInteracting: true`): canvas に `pointer-events: auto`、Webview に `pointer-events: none` → React が入力受け取り
  - 操作終了 (`isInteracting: false`): canvas に `pointer-events: none`、Webview に `pointer-events: auto` → Webview がクリック可能
- Webview イベント（`navigate`, `document-title-changed`）で URL・タイトル更新をリッスン
- `hideAll()` で全 Webview を一括非表示、`syncAllWebviewBounds()` で位置・サイズ同期

**状態管理**: Zustand による共有状態管理
- **useProjectStore** (`tab-store.ts`):
  - **プロジェクト管理アクション**: `createProject`, `openProject`, `closeProject`, `deleteProject`, `renameProject`, `setActive`, `reorderOpenProjects`, `updateSidebarWidth`
  - **ページ管理アクション**: `addPage`, `removePage`, `updatePagePosition`, `updatePageSize`, `updatePageUrl`, `updateViewport`, `bringPageToFront`, `setPageWebviewLabel`
  - **Selectors**: `selectActiveProject`, `selectIsHome`
  - 起動時に `tab-persistence.ts` で保存済み状態を復元（tauri-plugin-store ベース）
  - プロジェクトライフサイクル: `createProject` で新規作成、`openProject` で開く（既開いていれば activeId 更新）、`closeProject` でタブバーから閉じる（openIds から除去）、`deleteProject` で削除（projects + openIds 両方から除去）
  - `setPageWebviewLabel` で Tauri Webview ラベル記録（ランタイム専用、永続化禁止）
- **useThemeStore** (`theme-store.ts`):
  - **状態**: `mode` (ThemeMode: 'system'|'light'|'dark'), `isDark` (boolean)
  - **アクション**: `initialize()` (起動時、保存済みテーマを読み込み document に反映)、`setMode(mode)` (invoke で theme:set を実行し OS 同期)
  - 起動時に `main.tsx` で `setupThemeListener()` でイベントリスナー登録、`initialize()` でテーマ適用

### データ構造

**Page インターフェース** (`src/renderer/types/tab.ts`)
- `id`: ページの一意識別子（UUID）
- `url`: ロード URL
- `title`: Webview のドキュメントタイトルまたはホスト名
- `x, y, width, height`: キャンバス上の位置・サイズ
- `createdAt`: 作成タイムスタンプ
- `webviewLabel?`: Tauri Webview ラベル（ランタイム専用、永続化しない）

**Viewport インターフェース** (`src/renderer/types/tab.ts:14-18`)
- `zoom`: ズームレベル（初期値 1）
- `panX, panY`: パンオフセット（ピクセル）

**SizePreset インターフェース** (`src/renderer/types/tab.ts:24-28`)
- `label`: プリセット名（'モバイル'、'タブレット'、'PC'）
- `width`: 推奨幅（ピクセル）
- `height`: 推奨高さ（ピクセル）
- SIZE_PRESETS 定数で 3 種類の標準デバイスサイズを定義

**Project インターフェース** の拡張
- `pages: Page[]`: プロジェクト内のページ配列
- `viewport: Viewport`: プロジェクトのビューポート状態
- （既存）`id, title, sidebarWidth, createdAt`

### ビルドパイプライン

**Tauri v2**: 統合ビルドシステム
- Rust バックエンド: `cargo tauri build`
- React フロントエンド: `vite.config.mts` で Vite ビルド（`safari14` ターゲット指定）
- 両方統合: `npm run dev` (開発) / `npm run build` (本番)
- 出力: プラットフォーム固有のバイナリ + インストーラー
- **注意**: `tauri-plugin-store` v2 は `tauri.conf.json` の `plugins` セクションに設定を書かない（lib.rs のみで登録）

### セキュリティ設定

Tauri v2 のセキュリティベストプラクティスを適用しています：
- **Sandbox**: デフォルト有効（すべての IPC は Rust コマンド経由でサンドボックス化）
- **コマンド実行**: `src-tauri/src/commands/` で Rust コマンド定義、権限制御
- **パーミッション**: `src-tauri/capabilities/default.json` で詳細制御
- **WebView**: `titleBarStyle: Overlay, hiddenTitle: true` で macOS トラフィックライト対応

### Tauri IPC

**Renderer → Backend** (invoke):
- `project_state_load`: プロジェクト状態読み込み
- `project_state_save`: プロジェクト状態保存
- `close_ready`: ウィンドウクローズ準備
- `load_theme`: 保存済みテーマモード取得
- `set_theme`: テーマモード設定（OS と同期、isDark 返す）
- `get_platform_info`: プラットフォーム情報取得（inset, os）
- `create_page_webview`: ページ用 Webview 作成

**Backend → Renderer** (emit):
- `theme:changed`: OS テーマ変更時に isDark フラグを送信

**Webview 操作 API** (`src/renderer/lib/tauri-bridge.ts` の `webviewApi`):
- `create()`: Webview 作成（IPC）
- `updateBounds()`: 位置・サイズ更新（`getWebviewHandle()` で同期取得、IPC 不要）
- `show()`, `hide()`, `destroy()`: 表示制御（IPC 不要）
- `hideAll()`, `showAllWithBounds()`: 一括操作（複数 Webview の効率的な制御）
- イベントリスナー登録: `onPageNavigated()`, `onPageTitleChanged()`

IPC は `src/renderer/lib/tauri-bridge.ts` に集約されています（api、themeApi、webviewApi、getPlatformInfo）。


## コーディング規約

- **コンポーネント**: Hero UI v3 を優先使用し、不足時のみ独自実装。 `heroui-react` スキル、 `heroui-react` MCP を使用すること
- **スタイリング**: Tailwind CSS v4 を使用。クラス順序は `eslint-plugin-better-tailwindcss` が自動整列するため、lint に従うこと
- **TypeScript**: `strict: true`、未使用変数・パラメータはエラーになる
- **インポート**: すべてのインポートで `@/` パスエイリアスを使用（`tsconfig.json` の `paths` と `vite.config.mts` で定義）。相対パス（`../`）は使用しない
- **Lint, Format**: 実装完了時に `npm run lint`, `npm run format:check`, `npm run typecheck` を実行し、エラーが出ないようにすること
- **状態管理**: グローバル共有状態は Zustand を使用。コンポーネントローカル状態は `useState` で十分
- **DOM 操作**: サイドバー幅調整のような高頻度アップデートはレンダリング外で行い、確定時のみ dispatch で同期
- **ズーム対応 UI**: アートボード内の UI 要素（ボーダー、パディング、アイコンサイズなど）はズーム値に応じて動的にスケーリング必要。実装方法: `--canvas-zoom` CSS Custom Property をルート canvas 要素に設定し、各 UI 要素は `calc(base-size / var(--canvas-zoom, 1))` で自動スケーリング。これにより、ズーム・パン時に React 再レンダリングを回避
- **タイトルバー制御**: macOS/Windows のコントロール領域は `data-tauri-drag-region` 属性で指定（`-webkit-app-region: drag` の代わり）
- **Webview 非同期制御**: Webview 作成は React StrictMode の二重マウントによる create/destroy 競合の対象。`PageFrame.tsx` で `isCreatingRef` フラグを使用して二重 create IPC を防止。`webviewApi` メソッドはすべて try-catch で保護し、Webview 未作成・既破棄時は no-op。詳細は MEMORY.md の「非同期制御パターン（Webview 作成）」を参照


## 主要ライブラリ

| ライブラリ | 目的 |
|---|---|
| `zustand` | グローバル状態管理（プロジェクト・ページ状態、ビューポート設定） |
| `@dnd-kit/react` | 開いているプロジェクトのドラッグ&ドロップ並び替え（React 19 対応） |
| `@gravity-ui/icons` | House, Plus, Xmark などのアイコン |
| `heroui-react` | UI コンポーネント（Button, Card, Modal, AlertDialog など） |
| `@tauri-apps/api` | Tauri フロントエンド API（invoke, event など） |
| `@tauri-apps/plugin-store` | Tauri プロジェクト状態永続化 |


## Claude Code on the Web

- **GitHub CLI (`gh`) の認証**: `GITHUB_TOKEN` 環境変数が利用可能。`gh` コマンド実行時はこのトークンで認証できる
  例: `$ GITHUB_TOKEN="ghp_xxxxx" gh pr create --title "PR Title" --body "PR Body"`
