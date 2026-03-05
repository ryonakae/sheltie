# ドメインモデル

主な型定義は `src/types/index.ts`（`ThemeMode`・ドメインモデル・ヘルパー関数をすべて集約）。

## 型

- `DisplayMode = 'native' | 'screenshot' | 'hidden'`
- `PageType = 'webpage' | 'stickynote'`
- `Page`
  - 基本: `id`, `url`, `title`, `x`, `y`, `width`, `height`, `createdAt`
  - 任意: `type`, `addedUrl`, `content`, `colorIndex`, `webviewLabel`
- `Viewport`: `zoom`, `panX`, `panY`
- `Project`: `id`, `title`, `sidebarWidth`, `createdAt`, `pages`, `viewport`
- `ProjectState`: `projects`, `openIds`, `activeId`
- `ProjectStore`（`tab-store.ts` 内部）
  - `ProjectState` + actions + ランタイム状態
  - ランタイム状態: `isLoaded`, `pageHistories`
- `ProjectPageHistory`（`tab-store.ts` 内部）
  - `past`: 直前までの `Page[]` スナップショット配列
  - `future`: Redo 用の `Page[]` スナップショット配列

## ヘルパー

- `isPageEmpty(page)`: `page.url === ''` で空フレーム判定。
- `isStickyNote(page)`: 付箋判定。
- `isWebPage(page)`: Web ページ判定（`type` 未定義は webpage 扱い）。
- `isPageMoved(page)`: `addedUrl` と現在 `url` の差分判定。

## 主要定数

`src/constants/project.ts`

- `HOME_ID = '__home__'`
- `DEFAULT_VIEWPORT = { zoom: 1, panX: 0, panY: 0 }`
- `DEFAULT_PAGE_WIDTH = 375`
- `DEFAULT_PAGE_HEIGHT = 812`
- `SIZE_PRESETS = [モバイル, タブレット, PC]`

`src/constants/siteboard.ts`

- ズーム: `MIN_ZOOM = 0.2`, `MAX_ZOOM = 1.5`
- しきい値: `HYSTERESIS_PX = 4`, `NATIVE_SAFE_MARGIN_PX = 50`

`src/hooks/siteboard/types.ts`

- `RESIZE_CURSOR_MAP`: 8 方向の `ResizeDirection` → CSS cursor 値のマップ

`src/store/tab-store.ts`

- `PAGE_HISTORY_LIMIT = 100`（プロジェクトごとのページ履歴保持上限）

## 不変条件

- `webviewLabel` はランタイム専用で永続化しない。
- 付箋ページは `PageType` と `content` / `colorIndex` を利用する。
- 空フレーム（`url === ''`）は Webview 未作成状態を許容する。
- `pageHistories` はランタイム専用で永続化しない（`_restoreState` で必ず初期化）。
- Undo/Redo は `activeId` のプロジェクトにのみ適用し、`HOME_ID` では no-op。
- ページ配列を更新する操作は基本的に履歴へ記録するが、付箋の自動高さ調整は `updatePageSizeWithoutHistory` を使って履歴を積まない。
