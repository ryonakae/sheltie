# 開発ガイドライン

## プロジェクト概要

Browser Artboard は Electron + React + TypeScript + Tailwind CSS v4 で構築されたデスクトップアプリケーションです。Electron Forge と Vite を使ったモダンなビルド構成を採用しています。


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
│   ├── index.ts # BaseWindow + WebContentsView 3層構成の初期化、IPC ハンドラー登録
│   │             # (bgView 背景、pageViews ページレンダリング、mainView React SPA)
│   ├── page-view-manager.ts # WebContentsView ライフサイクル管理クラス（生成・破棄・bounds 更新・z-order）
│   └── store.ts # プロジェクト状態の永続化（ElectronStore）、マイグレーション処理
├── preload/     # サンドボックス内のブリッジ
│   └── index.ts # Main ↔ Renderer 間のセキュアな IPC 設定（windowControls、pageViewApi 公開）
├── shared/
│   └── types.ts # ProjectStoreApi、WindowControlsInfo、PageViewApi、PageBounds など共有型定義
└── renderer/    # React レンダラープロセス (ブラウザ環境)
    ├── main.tsx # React エントリーポイント
    ├── App.tsx  # ルートコンポーネント（Zustand でプロジェクト状態管理、ホーム表示時の pageViewApi 制御）
    ├── index.html
    ├── index.css
    ├── types/
    │   └── tab.ts # Project 型（pages[]、viewport を含む）、Page、Viewport、ProjectState の定義
    ├── store/
    │   ├── tab-store.ts # Zustand ストア（useProjectStore、ページ管理アクション含む）
    │   └── tab-persistence.ts # プロジェクト状態の永続化ロジック
    ├── hooks/
    │   ├── useWindowControlsInset.ts # ウィンドウコントロール領域（タイトルバー）のインセット計算
    │   ├── useArtboardPan.ts # パン操作（transform 変更時に onTransformChange コールバック）
    │   ├── useArtboardZoom.ts # ズーム操作（transform 変更時に onTransformChange コールバック）
    │   ├── usePageDrag.ts # ページドラッグ（位置変更、最前面制御）
    │   └── usePageResize.ts # ページリサイズ（幅・高さ変更）
    ├── utils/
    │   └── page-bounds.ts # 座標変換ユーティリティ（TITLE_BAR_HEIGHT、RESIZE_INSET 定数、calcPageScreenBounds など）
    └── components/
        ├── Canvas/
        │   ├── Canvas.tsx # キャンバス全体（Sidebar + Artboard）、サイドバー幅変更時に resize イベント発火
        │   ├── Sidebar.tsx # サイドバーコンポーネント（ページ一覧、AddPageForm）
        │   ├── AddPageForm.tsx # ページ追加フォーム
        │   └── ResizeHandle.tsx # サイドバーリサイズハンドル
        ├── Artboard/
        │   ├── Artboard.tsx # 操作モード制御（mainView/pageViews z-order）、pageViewApi 統合、bounds 同期
        │   ├── InteractionOverlay.tsx # 操作中のカーソル制御（透明オーバーレイ）
        │   ├── PageFrame.tsx # ページフレーム（プレースホルダー div、リサイズハンドル）
        │   ├── PageTitleBar.tsx # ページタイトルバー（URL・タイトル表示）
        │   ├── PageResizeHandle.tsx # リサイズハンドル（8方向）
        │   └── InteractionOverlay.tsx # 操作中オーバーレイ
        ├── TabBar/
        │   ├── TabBar.tsx # タブバー全体（openIds に基づく開いているプロジェクト表示、useWindowControlsInset で macOS/Windows タイトルバー対応）
        │   └── TabItem.tsx # 個別プロジェクトタブ（ドラッグ可能）
        └── HomeScreen/
            ├── HomeScreen.tsx # プロジェクト一覧画面（カードグリッド）
            ├── ProjectCard.tsx # プロジェクトカード（HeroUI Card）
            ├── RenameModal.tsx # プロジェクト名変更モーダル（HeroUI Modal）
            └── DeleteDialog.tsx # 削除確認用ダイアログ（HeroUI AlertDialog）
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
- `useWindowControlsInset` で macOS トラフィックライト、Windows/Linux のコントロール領域に対応（`-webkit-app-region` スタイルで実装）

**Canvas**: サイドバーとアートボードを管理
- **Sidebar**: ページ一覧表示、ページ追加フォーム（AddPageForm）、ページごとに削除ボタン付き
- **ResizeHandle**: サイドバー幅調整可能（リサイズ中は DOM 直接操作でパフォーマンス最適化）
- **Artboard**: キャンバス領域に複数の webview を配置、ドラッグ・リサイズ・ズーム・パン対応

**Artboard**: ページレンダリング・ビューポート管理・操作モード制御
- 各ページを WebContentsView で描画（メインプロセス側 `PageViewManager` が生成・管理）
- キャンバス座標から画面座標への変換を `page-bounds.ts` ユーティリティで計算
- RAF を使って毎フレーム 1 回 `syncBounds()` で WebContentsView の bounds を一括更新
- ドラッグでページ移動、リサイズでサイズ変更（`updatePagePosition`/`updatePageSize` で Zustand 状態更新）
- マウスホイール or トラックパッドでズーム・パン、各操作後に `scheduleSyncBounds()` で bounds 再同期（`updateViewport` で Zustand 状態更新）
- ページをクリックで最前面に（`bringPageToFront` で Zustand z-index 制御 + IPC で `pageViewApi.bringToFront()` 呼び出し）
- 操作モード切り替え：ドラッグ/ズーム/パン 操作時は `mainView` が最上位（React が入力を受け取る）、操作終了時は `pageViews` が最上位（ウェブページが入力を受け取る）（`pageViewApi.setInteractionMode()` 経由）
- IPC の `page-view:navigated`/`page-view:title-updated` イベントで URL・タイトル更新をリッスン

**状態管理**: Zustand による共有状態管理（`useProjectStore` in `tab-store.ts`）
- **プロジェクト管理アクション**: `createProject`, `openProject`, `closeProject`, `deleteProject`, `renameProject`, `setActive`, `reorderOpenProjects`, `updateSidebarWidth`
- **ページ管理アクション**: `addPage`, `removePage`, `updatePagePosition`, `updatePageSize`, `updatePageUrl`, `updateViewport`, `bringPageToFront`
- **Selectors**: `selectActiveProject`, `selectIsHome`
- 起動時に `tab-persistence.ts` で保存済み状態を復元（localStorage ベース）
- プロジェクトライフサイクル: `createProject` で新規作成、`openProject` で開く（既開いていれば activeId 更新）、`closeProject` でタブバーから閉じる（openIds から除去）、`deleteProject` で削除（projects + openIds 両方から除去）

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

**PageBounds インターフェース** (`src/shared/types.ts`)
- `x, y, width, height`: WebContentsView の位置・サイズ（ウィンドウスクリーン座標系）

**ArtboardLayout インターフェース** (`src/shared/types.ts`)
- `offsetX`: artboard 領域の左端（= sidebarWidth）
- `offsetY`: artboard 領域の上端（= タブバー高さ）
- `areaWidth, areaHeight`: artboard 領域の幅・高さ（clipView の bounds として設定）

### PageViewManager と WebContentsView レイアウト

メインプロセス側 (`src/main/page-view-manager.ts`) で WebContentsView のライフサイクルを統括管理：

- **3 層構成**: contentView に bgView（背景）、clipView（ページ表示領域クリップ）、mainView（React SPA）を z-order で配置
  - bgView: ドットパターン背景（最下層、z-index=0）
  - clipView: pageViews のコンテナ（中層、bounds は artboard 領域に合わせて動的更新）
  - mainView: React SPA（最上層の時は操作受け取り、奥層の時は非表示）
- **z-order 動的切り替え**: 操作中は mainView が最上位（`addChildView(mainView)` で末尾移動）→入力 React が受け取り、操作終了時は clipView が最上位 → pageViews がクリック可能
- **bounds 一括更新**: レンダラーから `page-view:batch-update-bounds` IPC で all pages の bounds を毎フレーム同期
- **ナビゲーション検出**: 各 pageView の `did-navigate`/`page-title-updated` イベントをリッスン → mainView へ IPC 送信 → Artboard コンポーネントで Zustand 状態更新

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
- **Sandbox**: 有効（mainView・bgView・pageViews すべてサンドボックス化）
- **WebContentsView パーティション**: `persist:artboard` パーティション使用（各 pageView が同じセッションで cookie/storage 共有、独立した WebContents プロセス）

IPC は必ず Preload スクリプト経由で実装してください。PageViewApi は `pageViewApi.createPageView()` / `pageViewApi.batchUpdateBounds()` など、メインプロセス側 `PageViewManager` を操作するコマンドセットです。


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
