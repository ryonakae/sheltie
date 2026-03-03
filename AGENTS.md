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
│       │   └── webview.rs # create_page_webview（initialization_script で SPA URL 変更検出スクリプト注入 / on_navigation / on_document_title_changed 登録: \x01 プレフィックスで SPA ナビゲーション検出）/ reload_page_webview（url パラメータを受け取り webview.navigate() でナビゲート）/ go_back_page_webview・go_forward_page_webview（eval で history.back/forward()）/ get_navigation_state_page_webview（macOS のみ with_webview + objc2::msg_send! で canGoBack/canGoForward 取得、非 macOS は {false, false}）
├── src/                # React フロントエンド
│   ├── renderer/       # React SPA
│   │   ├── main.tsx    # React エントリーポイント
│   │   ├── App.tsx     # ルートコンポーネント（Zustand でプロジェクト状態管理）。`<Toast.Provider placement="bottom" />` を末尾に配置（トースト通知）
│   │   ├── types/
│   │   │   ├── tab.ts  # Project 型（pages[]、viewport を含む）、Page、Viewport、ProjectState、webviewLabel、isPageMoved()、isPageEmpty()
│   │   │   └── electron.d.ts # (削除予定）
│   │   ├── lib/
│   │   │   ├── theme.ts # テーマ管理ユーティリティ（applyThemeToDocument: dark/light クラス・data-theme 属性・color-scheme を同期）
│   │   │   ├── tauri-bridge.ts # Tauri IPC ブリッジ層（api / themeApi / webviewApi / getPlatformInfo）
│   │   │   └── url-utils.ts # URL 正規化ユーティリティ（normalizeUrl: scheme 補完・バリデーション）
│   │   ├── store/
│   │   │   ├── tab-store.ts # Zustand ストア（setPageWebviewLabel / setPageUrl / pinPageUrl アクション）
│   │   │   ├── tab-persistence.ts # プロジェクト状態の永続化ロジック
│   │   │   └── theme-store.ts # Zustand テーマストア
│   │   ├── hooks/
│   │   │   ├── useWindowControlsInset.ts # getPlatformInfo() 非同期に更新
│   │   │   ├── useArtboardPan.ts # パン操作（onPanMove コールバック）。backgroundRef で背景グリッドを同期
│   │   │   ├── useArtboardZoom.ts # ズーム・パン操作（MIN_ZOOM=0.5, MAX_ZOOM=1.5）。backgroundRef で背景グリッドを同期
│   │   │   ├── usePageDrag.ts # ページドラッグ
│   │   │   └── usePageResize.ts # ページリサイズ
│   │   └── components/
│   │       ├── Canvas/ # キャンバス管理
│   │       ├── Artboard/ # ページレンダリング・操作制御
│   │       │   ├── PageFrame.tsx # プレースホルダー div + Tauri Webview（canvasZoom prop で Webview 作成直後に setZoom 適用。url 空時は Webview 作成スキップ・PageUrlForm 表示。onUrlSubmit prop で空フレームへの初回 URL 設定）
│   │       │   ├── PageUrlForm.tsx # 空フレーム内の URL 入力フォーム（ズーム対応: calc(base / var(--canvas-zoom, 1))）
│   │       │   ├── Artboard.tsx # InteractionType 型 / computeDisplayModes（DOM 属性直接更新＋命令的 Webview 制御＋native 復帰時 setZoom） / computeInteractionModes（pan/zoom 中毎フレーム判定・PRE_DISPLAY_MARGIN_PX=50px・ズーム変更時 setZoom 一括適用） / scheduleInteractionUpdate（rAF スロットリング） / checkPreCapture＋EagerCapture（プリキャプチャ） / 定期リフレッシュ（SCREENSHOT_REFRESH_INTERVAL_MS=2000ms、pan/zoom 中も撮影可能）/ onAddPage prop・handleUrlSubmit（setPageUrl 経由で空フレームに URL を設定）/ ResizeObserver で containerRef のサイズ変化を監視し computeDisplayModes() を呼び出す（window resize より汎用的、サイドバー幅変更にも対応）
│   │       │   └── PageTitleBar.tsx # PageTopBar（ChevronLeft/ChevronRight で戻る/進むボタン → タイトルスパン → リロード・ピン留め・閉じるボタンの順。onReload / onPinUrl は optional、空フレーム時 disabled。ピン留めボタンは isMoved && onPinUrl 条件でリロードボタン右に表示。canGoBack/canGoForward/onGoBack/onGoForward props でナビゲーション制御）/ PageBottomBar（デバイスプリセット・サイズ表示）に分割。isMoved prop でページ移動を (Moved) 表示。ツールバーのボーダーは上下のみ（border-t / border-b）。左右ボーダーは外側 PageFrame の outline に任せる
│   │       ├── Canvas/
│   │       │   └── FloatingToolbar.tsx # キャンバス下端中央のフローティングツールバー（＋ボタンで空フレーム追加。z-40、外側 pointer-events-none / 内側 pointer-events-auto）
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
- 各タブはホバー時に閉じるボタン（×）を表示（`motion` の `variants` パターン、CSS `group` は使用しない）
- アクティブタブは `border-b-transparent bg-surface` で識別（アンダーラインなし、背景色で強調）。非アクティブは `border-b-transparent text-muted`
- ホームボタンはアクティブ時に `HouseFill` アイコン、非アクティブ時に `House` アイコンを使用
- `useWindowControlsInset` で macOS トラフィックライト、Windows/Linux のコントロール領域に対応（`data-tauri-drag-region` 属性で実装）

**Canvas**: サイドバーとアートボードを管理
- **Sidebar**: ページ一覧表示、ページごとに削除ボタン付き。`isPageMoved()` で (Moved) インジケーター表示。ページクリックで `onSelectPage` 呼び出し + `ensureFrameVisible`（`motion` アニメーション 260ms easeOutCubic、`useReducedMotion` 対応）でページをビューポート内に移動。ホバー状態管理は CSS `group` パターンから `motion` の `variants`（`whileHover="hover"`）パターンに移行。ページ追加ロジック（AddPageForm）は削除済み（FloatingToolbar に移設）
- **FloatingToolbar**: キャンバス下端中央に配置。＋ボタンで `handleAddEmptyPage` を呼び出し、空フレームをキャンバス中央に追加する
- **ResizeHandle**: サイドバー幅調整可能（リサイズ中は DOM 直接操作でパフォーマンス最適化）
- **Artboard**: キャンバス領域に複数の Tauri Webview を配置、ドラッグ・リサイズ・ズーム・パン対応
- **選択状態管理**: `Canvas` が `selectedPageId` / `centeredPageId` ステートを保持し、`Sidebar` と `Artboard` に props 経由で連携
- **ページ追加フロー**: FloatingToolbar の＋ボタン → `handleAddEmptyPage`（Canvas）→ `addPage`（url 省略）→ 空フレームがキャンバス中央に配置 → `PageUrlForm` で URL 入力・submit → `setPageUrl`（`url` + `addedUrl` + `title` を同時設定）→ `page.url` 変化で `PageFrame` effect が再実行して Webview 作成
- **`getViewportCenterPos` / `centerOnNewPage`**: Canvas に実装。`data-artboard-container` を使ってビューポート中央座標を算出し、ズーム込み 400ms アニメーションで新規ページにフィット。`prefersReducedMotion` 対応

**Artboard**: ページレンダリング・ビューポート管理・操作制御
- `ArtboardProps`: `selectedPageId`, `onSelectPage`, `onClearSelection`, `centeredPageId`, `onCenteredPageHandled`, `onAddPage` を受け取る。`navStates: Record<string, NavigationState>` を useState で管理し、`refreshNavigationState(pageId)` で同一値なら参照を維持しつつ更新。`handleGoBack`/`handleGoForward` で IPC 経由のナビゲーション操作
- **再レンダー最適化**: `PageFrame` / `StickyNoteFrame` は `React.memo` でラップ。コールバック props はすべて `(pageId: string, ...) => void` シグネチャに統一（`onGoBack`, `onGoForward`, `onActivate`, `onReload`, `onPinUrl`, `onClose`, `onDragStart`, `onResizeStart`, `onResizePreset` など）。`Artboard.tsx` の `pages.map()` 内ではインラインアロー関数を排除し、`useCallback` で生成した安定した関数参照を直接渡す。コンポーネント内部で `useCallback` + `page.id` バインドのローカルハンドラーを生成して子要素に渡す
- 各ページを `<div data-webview-placeholder>` + Tauri Webview で DOM に描画
- canvas 要素に transform (translate + scale) を設定してズーム・パン実装
- ドラッグでページ移動、リサイズでサイズ変更（`updatePagePosition`/`updatePageSize` で Zustand 状態更新）
- `centeredPageId` が設定されると対象ページの `computeDisplayModes` と `captureScreenshot` を rAF 後に実行
- ボトムバー（`PageBottomBar`）のデバイスプリセットボタン（モバイル・タブレット・PC）でワンクリック高さ・幅変更
- マウスホイール or トラックパッドで操作（`updateViewport` で Zustand 状態更新）:
  - `Ctrl/Cmd + ホイール`: マウスカーソル中心にズーム
  - `ホイール（修飾キーなし）`: キャンバスをパン（スクロール移動）
- ページをクリックで選択（`onSelectPage` で Canvas が selectedPageId を管理）・ドラッグでページ移動。`bringPageToFront` は tab-store に定義があるが現在は Artboard から直接呼ばれていない
- 操作モード制御：`InteractionType` (`'pan' | 'zoom' | 'drag' | 'resize'`) で操作タイプを分類
  - **ページ操作（drag / resize）**: 開始時に全 Webview を `hideAll()` で非表示。操作完了時に `computeDisplayModes()` で座標同期、DOM 属性更新、命令的 Webview 制御で再表示
  - **キャンバス操作（pan / zoom）**: 開始時に `containerRectRef` へ container rect をキャッシュし `computeInteractionModes()` を即時実行。pan/zoom 中は `scheduleInteractionUpdate()` が rAF（1フレーム1回）で `computeInteractionModes()` を呼び出し、アートボード端から `NATIVE_SAFE_MARGIN_PX=50px` 以上離れているページは native 維持（`updateAllBounds()` で位置同期）、端から 50px 以内またはアートボード外はスクリーンショット準備済みなら screenshot、それ以外は hidden に切り替え。操作終了時に `computeDisplayModes()` で最終判定
  - 操作中の遷移ルール（`computeInteractionModes`）: `native → screenshot/hidden` は許可。`screenshot/hidden → native` は禁止（show() 遅延によるフリッカー回避、操作終了後の `computeDisplayModes()` で復帰）
  - `activeInteractionsRef` (`Set<InteractionType>`) で複数操作の同時性を管理（ホイール debounce と他操作の競合防止）
  - blur 時は `activeInteractionsRef.current.clear()` で全操作タイプを一括クリア（旧: 'drag' のみクリアするバグあり）
- アートボードコンテナは `data-artboard-container` 属性を付与（`Sidebar` の `getViewportCenterPos` がページ追加時の配置計算に使用）
- アートボード背景のドットグリッドは `--artboard-dot-scale` / `--artboard-bg-x` / `--artboard-bg-y` CSS Custom Property で制御。`useArtboardPan` / `useArtboardZoom` の `backgroundRef` 経由でパン・ズームに追従（React 再レンダリング不要）
- **Screenshot Clipping**: Webview がアートボード端から `NATIVE_SAFE_MARGIN_PX=50px` 以内に差し掛かると screenshot モードに切り替え（CSS `overflow:hidden` でクリッピング可能）。完全にアートボード外なら hidden。状態遷移は `DisplayMode` (`'native' | 'screenshot' | 'hidden'`) で管理。ヒステリシス 4px で境界振動防止（native 判定: `pr.left >= cr.left + NATIVE_SAFE_MARGIN_PX - HYSTERESIS_PX` 等）。**プリキャプチャ機能**（`checkPreCapture()`, `PRE_CAPTURE_MARGIN_PX = 50px`, `CAPTURE_MIN_INTERVAL_MS = 1000ms`）: ページ矩形がキャンバス端から 50px 以内に入った瞬間にスクリーンショットを撮り直し、`screenshot` モード遷移時に最新の画像を表示。エッジトリガー方式でゾーン外→内の遷移時のみ発火し、過剰撮影を防止。**Eager Capture**: `computeDisplayModes()` で native モードだが `screenshotReadyRef` が false のページを自動撮影開始。**定期リフレッシュ**（`SCREENSHOT_REFRESH_INTERVAL_MS = 2000ms`）: 2秒ごとに native モードのページのスクリーンショットを自動更新し、Webview 内スクロール等による画像の陳腐化を防止。pan/zoom 中は native Webview が表示されているため撮影可能（drag/resize 中のみスキップ）。**命令的制御**: `computeDisplayModes()` で `wrapper.setAttribute('data-display-mode', ...)` と `webviewApi.show()/hide()` を直接実行し、React state Bailout（前フレームと同じモードなら effect が発火しない）の罠を回避
- Webview イベント（`navigate`, `document-title-changed`）で URL・タイトル更新をリッスン。SPA の `history.pushState`/`replaceState` は `on_navigation` では検出できないため、`initialization_script` で注入したスクリプトが `document.title` に `\x01` プレフィックスを付与して `on_document_title_changed` 経由で Rust に通知し、`page-navigated-{pageId}` イベントとして emit する

**状態管理**: Zustand による共有状態管理
- **useProjectStore** (`tab-store.ts`):
  - **プロジェクト管理アクション**: `createProject`, `openProject`, `closeProject`, `deleteProject`, `renameProject`, `setActive`, `reorderOpenProjects`, `updateSidebarWidth`
  - **ページ管理アクション**: `addPage`（`url` 省略可能・省略時は空フレーム `url=''`。`options?: {x,y,width,height}` で配置指定可能、戻り値 `Page | null`）, `setPageUrl`（空フレームへの初回 URL 設定・`url`/`addedUrl`/`title` を同時更新）, `pinPageUrl`（現在の `page.url` を `page.addedUrl` に上書きしリロード先を更新）, `removePage`, `updatePagePosition`, `updatePageSize`, `updatePageUrl`, `updatePageTitle`, `updateViewport`, `bringPageToFront`, `setPageWebviewLabel`
  - **Selectors**: `selectActiveProject`, `selectIsHome`
  - 起動時に `tab-persistence.ts` で保存済み状態を復元（tauri-plugin-store ベース）
  - プロジェクトライフサイクル: `createProject` で新規作成、`openProject` で開く（既開いていれば activeId 更新）、`closeProject` でタブバーから閉じる（openIds から除去）、`deleteProject` で削除（projects + openIds 両方から除去）
  - `addPage` は `findNonOverlappingPosition` で既存ページと重複しない位置を自動計算（最大60ステップの縦方向探索 + 横方向スキャン）
  - `setPageWebviewLabel` で Tauri Webview ラベル記録（ランタイム専用、永続化禁止）
- **useThemeStore** (`theme-store.ts`):
  - **状態**: `mode` (ThemeMode: 'system'|'light'|'dark'), `isDark` (boolean)
  - **アクション**: `initialize()` (起動時、保存済みテーマを読み込み document に反映)、`setMode(mode)` (invoke で theme:set を実行し OS 同期)
  - 起動時に `main.tsx` で `setupThemeListener()` でイベントリスナー登録、`initialize()` でテーマ適用

### データ構造

**DisplayMode 型** (`src/renderer/types/tab.ts`)
- `'native'`: Webview が完全にアートボード内 → ネイティブ Webview を表示
- `'screenshot'`: Webview が一部アートボード外 → スクリーンショット画像（DOM `<img>`）で代替表示
- `'hidden'`: 完全にアートボード外、またはドラッグ/リサイズ中 → 両方非表示

**Page インターフェース** (`src/renderer/types/tab.ts`)
- `id`: ページの一意識別子（UUID）
- `url`: ロード URL（ナビゲーションで変化する現在 URL）
- `addedUrl?`: ページ追加時の URL（リロードボタンで戻る先。`addPage` で設定、永続化あり）
- `title`: Webview のドキュメントタイトルまたはホスト名
- `x, y, width, height`: キャンバス上の位置・サイズ
- `createdAt`: 作成タイムスタンプ
- `webviewLabel?`: Tauri Webview ラベル（ランタイム専用、永続化しない）

**isPageEmpty()** (`src/renderer/types/tab.ts`): `page.url === ''` で空フレーム（URL 未設定）かどうかを判定するヘルパー関数。`PageFrame` で Webview 作成スキップ判定に使用。

**isPageMoved()** (`src/renderer/types/tab.ts`): ページが追加時 URL から別ページに遷移したかを判定するヘルパー関数。`new URL(str).href` で比較し末尾スラッシュ等の正規化差異を吸収する。`PageTitleBar` と `Sidebar` で共通使用。

**Viewport インターフェース** (`src/renderer/types/tab.ts:14-18`)
- `zoom`: ズームレベル（初期値 1）
- `panX, panY`: パンオフセット（ピクセル）

**SizePreset インターフェース** (`src/renderer/types/tab.ts`)
- `label`: プリセット名（'モバイル'、'タブレット'、'PC'）
- `width`: 推奨幅（ピクセル）
- `height`: 推奨高さ（ピクセル）
- SIZE_PRESETS 定数で 3 種類の標準デバイスサイズを定義
- `DEFAULT_PAGE_WIDTH = 375`, `DEFAULT_PAGE_HEIGHT = 812`（モバイルファースト。旧: 1280x800）

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
  - `core:window:allow-start-dragging`: `data-tauri-drag-region` 属性でのウィンドウドラッグを有効化（タブバー等で必須）
  - `core:webview:allow-set-webview-zoom`: `webviewApi.setZoom()` でビューポートズーム補正を可能にする
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
- `reload_page_webview`: Webview を指定 URL にナビゲート（`url: String` を受け取り `webview.navigate()` で追加時 URL に戻す）
- `go_back_page_webview`: `eval("history.back()")` で前のページに戻る
- `go_forward_page_webview`: `eval("history.forward()")` で次のページに進む
- `get_navigation_state_page_webview`: canGoBack/canGoForward を取得（macOS のみ `with_webview + objc2::msg_send!` で正確に取得、非 macOS は `{false, false}` を返す）
- `capture_webview_screenshot`: WKWebView スナップショットを base64 PNG Data URL として取得（macOS のみ）

**Backend → Renderer** (emit):
- `theme:changed`: OS テーマ変更時に isDark フラグを送信

**Webview 操作 API** (`src/renderer/lib/tauri-bridge.ts` の `webviewApi`):
- `create()`: Webview 作成（IPC）
- `updateBounds()`: 位置・サイズ更新（`getWebviewHandle()` で同期取得、IPC 不要）
- `updateAllBounds()`: 複数 Webview の位置・サイズを一括更新（show/hide なし、操作中のリアルタイム同期用）
- `show()`, `hide()`, `destroy()`: 表示制御（IPC 不要）
- `hideAll()`, `showAllWithBounds()`: 一括操作（複数 Webview の効率的な制御）
- `setZoom(label, scaleFactor)`: Webview のページズームを設定（CSS `transform: scale()` と乖離するビューポートを補正）
- `reload(pageId, url)`: Webview を追加時 URL にナビゲート（IPC 経由で `reload_page_webview` を呼び出す。`page.addedUrl ?? page.url` を渡す）
- `goBack(pageId)` / `goForward(pageId)`: 前後のページに移動（IPC 経由）
- `getNavigationState(pageId)`: `NavigationState { can_go_back, can_go_forward }` を取得（IPC 経由）
- `captureScreenshot()`: Webview スクリーンショット取得（base64 Data URL、失敗時は null）
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
- **タイトルバー制御**: macOS/Windows のコントロール領域は `data-tauri-drag-region` 属性で指定（`-webkit-app-region: drag` の代わり）。Tauri v2 では属性が子要素に自動継承されないため、コンテナ要素ごとに明示的に設定。ネイティブの `<button>` 等は自動的にドラッグが抑制される
- **Webview 非同期制御**: Webview 作成は React StrictMode の二重マウントによる create/destroy 競合の対象。`PageFrame.tsx` で `isCreatingRef` フラグを使用して二重 create IPC を防止。`webviewApi` メソッドはすべて try-catch で保護し、Webview 未作成・既破棄時は no-op。詳細は MEMORY.md の「非同期制御パターン（Webview 作成）」を参照
- **Screenshot Clipping**: Webview がアートボード端にかかる時、ネイティブ Webview を hide してスクリーンショット画像（DOM `<img>`）に切り替える。CSS の `overflow:hidden` でクリッピング可能。`DisplayMode` で状態遷移管理。ヒステリシス（HYSTERESIS_PX = 4px）で境界近辺での振動防止。`computeDisplayModes()` 内で DOM 属性を直接更新し、命令的に Webview show/hide を実行することで React state Bailout の罠を回避。`captureScreenshot` のガードは drag/resize 中のみ（pan/zoom 中は native Webview が表示されているため撮影可能）。詳細は MEMORY.md の「Screenshot Clipping の実装パターン」を参照
- **usePageResize の Webview なしフレーム対応**: `usePageResize` はリサイズ中に `state.webviewEl`（Webview プレースホルダー）を直接 DOM 更新するが、付箋など Webview を持たないフレームでは `state.webviewEl` が null になる。その場合は `state.frameEl.style.height` を直接更新してリサイズ中のサイズ変化を反映する（`else` ブランチで実装）


## 主要ライブラリ

| ライブラリ | 目的 |
|---|---|
| `zustand` | グローバル状態管理（プロジェクト・ページ状態、ビューポート設定） |
| `@dnd-kit/react` | 開いているプロジェクトのドラッグ&ドロップ並び替え（React 19 対応） |
| `@gravity-ui/icons` | House, Plus, Xmark などのアイコン |
| `heroui-react` | UI コンポーネント（Button, Card, Modal, AlertDialog, Toast など）。`toast()` 関数でトースト通知（`Toast.Provider` を `App.tsx` ルートに配置） |
| `@tauri-apps/api` | Tauri フロントエンド API（invoke, event など） |
| `@tauri-apps/plugin-store` | Tauri プロジェクト状態永続化 |
| `motion` (Motion for React) | アニメーション（`motion` コンポーネント、`animate()` 関数、`useReducedMotion`）。`MotionConfig` で全体設定（reducedMotion: "user", duration: 0.22） |


## Claude Code on the Web

- **GitHub CLI (`gh`) の認証**: `GITHUB_TOKEN` 環境変数が利用可能。`gh` コマンド実行時はこのトークンで認証できる
  例: `$ GITHUB_TOKEN="ghp_xxxxx" gh pr create --title "PR Title" --body "PR Body"`
