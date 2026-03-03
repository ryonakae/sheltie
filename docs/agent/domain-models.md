# ドメインモデル

主な型定義は `src/renderer/types/tab.ts`。

## 型

- `DisplayMode = 'native' | 'screenshot' | 'hidden'`
- `PageType = 'webpage' | 'stickynote'`
- `Page`
  - 基本: `id`, `url`, `title`, `x`, `y`, `width`, `height`, `createdAt`
  - 任意: `type`, `addedUrl`, `content`, `colorIndex`, `webviewLabel`
- `Viewport`: `zoom`, `panX`, `panY`
- `Project`: `id`, `title`, `sidebarWidth`, `createdAt`, `pages`, `viewport`
- `ProjectState`: `projects`, `openIds`, `activeId`

## ヘルパー

- `isPageEmpty(page)`: `page.url === ''` で空フレーム判定。
- `isStickyNote(page)`: 付箋判定。
- `isWebPage(page)`: Web ページ判定（`type` 未定義は webpage 扱い）。
- `isPageMoved(page)`: `addedUrl` と現在 `url` の差分判定。

## 主要定数

`src/renderer/constants/project.ts`

- `HOME_ID = '__home__'`
- `DEFAULT_VIEWPORT = { zoom: 1, panX: 0, panY: 0 }`
- `DEFAULT_PAGE_WIDTH = 375`
- `DEFAULT_PAGE_HEIGHT = 812`
- `SIZE_PRESETS = [モバイル, タブレット, PC]`

`src/renderer/constants/siteboard.ts`

- ズーム: `MIN_ZOOM = 0.2`, `MAX_ZOOM = 1.5`
- しきい値: `HYSTERESIS_PX = 4`, `NATIVE_SAFE_MARGIN_PX = 50`

## 不変条件

- `webviewLabel` はランタイム専用で永続化しない。
- 付箋ページは `PageType` と `content` / `colorIndex` を利用する。
- 空フレーム（`url === ''`）は Webview 未作成状態を許容する。
