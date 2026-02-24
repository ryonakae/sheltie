# 開発ガイドライン

## プロジェクト概要

Siteboard は Electron + React + TypeScript + Tailwind CSS v4 で構築されたデスクトップアプリケーションです。Electron Forge と Vite を使ったモダンなビルド構成を採用しています。


## 開発コマンド

```bash
npm start          # 開発モードで起動（Electron Forge + Vite HMR）
npm run lint       # ESLint によるコード検査
npm run lint:fix   # ESLint 自動修正
npm run format     # Prettier によるフォーマット
npm run typecheck  # TypeScript の型チェック
npm run package    # アプリをパッケージング
npm run make       # インストーラー生成
```

テストフレームワークは現在導入されていません。


## アーキテクチャ

Electron の 3 プロセス構造に沿って `src/` が分割されています：

```
src/
├── main/        # Electron メインプロセス (Node.js)
│   ├── index.ts # BaseWindow + mainView（React SPA）の初期化、IPC ハンドラー登録
│   │             # mainView のみで webpreferences.webviewTag: true でレンダリング制御
│   │             # テーマ初期化（getTheme で保存済み値を読み込み、nativeTheme 同期）
│   │             # OS テーマ変更監視（nativeTheme.on('updated')）でテーマ更新を mainView へ送信
│   └── store.ts # プロジェクト状態の永続化（ElectronStore）、マイグレーション処理
│               # テーマ設定の永続化（getTheme、setTheme IPC ハンドラー）
├── preload/     # サンドボックス内のブリッジ
│   └── index.ts # Main ↔ Renderer 間のセキュアな IPC 設定（api、windowControls、themeApi 公開）
├── shared/
│   └── types.ts # ProjectStoreApi、WindowControlsInfo、ThemeApi などの共有型定義
└── renderer/    # React レンダラープロセス (ブラウザ環境)
    ├── main.tsx # React エントリーポイント
    ├── App.tsx  # ルートコンポーネント（Zustand でプロジェクト状態管理）
    ├── index.html
    ├── index.css
    ├── types/
    │   ├── tab.ts # Project 型（pages[]、viewport を含む）、Page、Viewport、ProjectState の定義
    │   └── electron.d.ts # <webview> タグの React JSX 型定義
    ├── lib/
    │   └── theme.ts # テーマ管理ユーティリティ（applyThemeToDocument で document root に dark/light クラス設定）
    ├── store/
    │   ├── tab-store.ts # Zustand ストア（useProjectStore、ページ管理アクション含む）
    │   ├── tab-persistence.ts # プロジェクト状態の永続化ロジック
    │   └── theme-store.ts # Zustand テーマストア（isDark, mode, setMode, initialize 含む）
    ├── hooks/
    │   ├── useWindowControlsInset.ts # ウィンドウコントロール領域（タイトルバー）のインセット計算
    │   ├── useArtboardPan.ts # パン操作（canvas transform 変更）
    │   ├── useArtboardZoom.ts # ズーム操作（canvas transform 変更）
    │   ├── usePageDrag.ts # ページドラッグ（位置変更、最前面制御）
    │   └── usePageResize.ts # ページリサイズ（幅・高さ変更）
    └── components/
        ├── Canvas/
        │   ├── Canvas.tsx # キャンバス全体（Sidebar + Artboard）、サイドバー幅変更時に resize イベント発火
        │   ├── Sidebar.tsx # サイドバーコンポーネント（ページ一覧、AddPageForm）
        │   ├── AddPageForm.tsx # ページ追加フォーム
        │   └── ResizeHandle.tsx # サイドバーリサイズハンドル
        ├── Artboard/
        │   ├── Artboard.tsx # キャンバス管理・操作制御（zoom/pan/drag/resize、pointer-events 制御）
        │   ├── InteractionOverlay.tsx # 操作中のカーソル制御（透明オーバーレイ）
        │   ├── PageFrame.tsx # ページフレーム（<webview> タグ、リサイズハンドル、タイトルバー）
        │   ├── PageTitleBar.tsx # ページタイトルバー（URL・タイトル表示）
        │   └── PageResizeHandle.tsx # リサイズハンドル（8方向）
        ├── TabBar/
        │   ├── TabBar.tsx # タブバー全体（openIds に基づく開いているプロジェクト表示、useWindowControlsInset で macOS/Windows タイトルバー対応、ThemeToggle を配置）
        │   ├── TabItem.tsx # 個別プロジェクトタブ（ドラッグ可能）
        │   └── ThemeToggle.tsx # テーマ切り替えボタン（light/dark/system 選択、HeroUI Dropdown）
        └── HomeScreen/
            ├── HomeScreen.tsx # プロジェクト一覧画面（カードグリッド）
            ├── ProjectCard.tsx # プロジェクトカード（HeroUI Card）
            ├── RenameModal.tsx # プロジェクト名変更モーダル（HeroUI Modal）
            └── DeleteDialog.tsx # 削除確認用ダイアログ（HeroUI AlertDialog）
```

**削除予定**:
- `src/main/page-view-manager.ts`: WebContentsView ライフサイクル管理（mainView のみになったため不要）
- `src/renderer/utils/page-bounds.ts`: WebContentsView 座標変換（`<webview>` DOM レンダリングに移行したため不要）

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
- `useWindowControlsInset` で macOS トラフィックライト、Windows/Linux のコントロール領域に対応（`-webkit-app-region` スタイルで実装）

**Canvas**: サイドバーとアートボードを管理
- **Sidebar**: ページ一覧表示、ページ追加フォーム（AddPageForm）、ページごとに削除ボタン付き
- **ResizeHandle**: サイドバー幅調整可能（リサイズ中は DOM 直接操作でパフォーマンス最適化）
- **Artboard**: キャンバス領域に複数の webview を配置、ドラッグ・リサイズ・ズーム・パン対応

**Artboard**: ページレンダリング・ビューポート管理・操作制御
- 各ページを `<webview>` タグで DOM に描画（React コンポーネント化）
- canvas 要素に transform (translate + scale) を設定してズーム・パン実装
- ドラッグでページ移動、リサイズでサイズ変更（`updatePagePosition`/`updatePageSize` で Zustand 状態更新）
- マウスホイール or トラックパッドでズーム・パン（`updateViewport` で Zustand 状態更新）
- ページをクリックで最前面に（`bringPageToFront` で Zustand z-index 制御）
- 操作モード制御：`isInteracting` フラグで webview の `pointer-events` を制御
  - 操作中 (`isInteracting: true`): canvas に `pointer-events: auto`、webview に `pointer-events: none` → React が入力受け取り
  - 操作終了 (`isInteracting: false`): canvas に `pointer-events: none`、webview に `pointer-events: auto` → webview がクリック可能
- webview イベント (`did-navigate`, `page-title-updated`) で URL・タイトル更新をリッスン

**状態管理**: Zustand による共有状態管理
- **useProjectStore** (`tab-store.ts`):
  - **プロジェクト管理アクション**: `createProject`, `openProject`, `closeProject`, `deleteProject`, `renameProject`, `setActive`, `reorderOpenProjects`, `updateSidebarWidth`
  - **ページ管理アクション**: `addPage`, `removePage`, `updatePagePosition`, `updatePageSize`, `updatePageUrl`, `updateViewport`, `bringPageToFront`
  - **Selectors**: `selectActiveProject`, `selectIsHome`
  - 起動時に `tab-persistence.ts` で保存済み状態を復元（localStorage ベース）
  - プロジェクトライフサイクル: `createProject` で新規作成、`openProject` で開く（既開いていれば activeId 更新）、`closeProject` でタブバーから閉じる（openIds から除去）、`deleteProject` で削除（projects + openIds 両方から除去）
- **useThemeStore** (`theme-store.ts`):
  - **状態**: `mode` (ThemeMode: 'system'|'light'|'dark'), `isDark` (boolean)
  - **アクション**: `initialize()` (起動時、保存済みテーマを読み込み document に反映)、`setMode(mode)` (IPC で theme:set を実行し OS 同期)
  - 起動時に `main.tsx` で `setupThemeListener()` でリスナー登録、`initialize()` でテーマ適用

### データ構造

**Page インターフェース** (`src/renderer/types/tab.ts:6-13`)
- `id`: ページの一意識別子（UUID）
- `url`: ロード URL
- `title`: webview のドキュメントタイトルまたはホスト名
- `x, y, width, height`: キャンバス上の位置・サイズ
- `createdAt`: 作成タイムスタンプ

**Viewport インターフェース** (`src/renderer/types/tab.ts:15-18`)
- `zoom`: ズームレベル（初期値 1）
- `panX, panY`: パンオフセット（ピクセル）

**Project インターフェース** の拡張
- `pages: Page[]`: プロジェクト内のページ配列
- `viewport: Viewport`: プロジェクトのビューポート状態
- （既存）`id, title, sidebarWidth, createdAt`

### ビルドパイプライン

3 つの独立した Vite 設定がそれぞれのプロセスをビルドします：

| 設定ファイル | 対象 | 出力 |
|---|---|---|
| `vite.main.config.ts` | メインプロセス | `.vite/build/main.js` |
| `vite.preload.config.ts` | Preload スクリプト | `.vite/build/preload.js` |
| `vite.renderer.config.mts` | React SPA | `.vite/renderer/` |

### セキュリティ設定

メインプロセスでは Electron のセキュリティベストプラクティスを適用しています：
- **Context Isolation**: 有効（メインプロセス API へのアクセスを制限）
- **Node.js 統合**: 無効（レンダラープロセスでの Node.js API アクセスを防止）
- **Sandbox**: 有効（mainView をサンドボックス化）
- **webviewTag**: 有効（mainView 内で `<webview>` タグを使用してウェブページをレンダリング）
- **WebView パーティション**: `persist:artboard` パーティション使用（複数の webview が同じセッションで cookie/storage 共有）

### IPC チャネル

**Renderer → Main**:
- `project-state:load` / `project-state:save`: プロジェクト状態永続化
- `theme:load`: 保存済みテーマモード取得
- `theme:set`: テーマモード設定（OS と同期、`shouldUseDarkColors` 返す）

**Main → Renderer**:
- `save-before-close`: ウィンドウクローズ前に状態保存
- `theme:changed`: OS テーマ変更時に isDark フラグを送信（`ThemeToggle` や document 反映に使用）

IPC は必ず Preload スクリプト経由で実装してください。全 API は `src/shared/types.ts` で `ProjectStoreApi`, `ThemeApi` インターフェースとして定義されています。


## コーディング規約

- **コンポーネント**: Hero UI v3 を優先使用し、不足時のみ独自実装。 `heroui-react` スキル、 `heroui-react` MCP を使用すること
- **スタイリング**: Tailwind CSS v4 を使用。クラス順序は `eslint-plugin-better-tailwindcss` が自動整列するため、lint に従うこと
- **TypeScript**: `strict: true`、未使用変数・パラメータはエラーになる
- **Lint, Format**: 実装完了時に `npm run lint`, `npm run format:check`, `npm run typecheck` を実行し、エラーが出ないようにすること
- **状態管理**: グローバル共有状態は Zustand を使用。コンポーネントローカル状態は `useState` で十分
- **DOM 操作**: サイドバー幅調整のような高頻度アップデートはレンダリング外で行い、確定時のみ dispatch で同期


## 主要ライブラリ

| ライブラリ | 目的 |
|---|---|
| `zustand` | グローバル状態管理（プロジェクト・ページ状態、ビューポート設定） |
| `@dnd-kit/react` | 開いているプロジェクトのドラッグ&ドロップ並び替え（React 19 対応） |
| `@gravity-ui/icons` | House, Plus, Xmark などのアイコン |
| `heroui-react` | UI コンポーネント（Button, Card, Modal, AlertDialog など） |


## Claude Code on the Web

- **GitHub CLI (`gh`) の認証**: `GITHUB_TOKEN` 環境変数が利用可能。`gh` コマンド実行時はこのトークンで認証できる
  例: `$ GITHUB_TOKEN="ghp_xxxxx" gh pr create --title "PR Title" --body "PR Body"`
