# ドメインモデル

主な型定義は `src/types/index.ts`、状態管理の実装は `src/store/tab-store.ts` が正本。

## 型

- `DisplayMode = 'native' | 'screenshot' | 'hidden'`
- `BoardNodeType = 'webpage' | 'stickynote'`
- `BoardNode`
  - 基本: `id`, `title`, `url`, `x`, `y`, `width`, `height`
  - 任意: `type`, `addedUrl`, `content`, `colorIndex`, `webviewLabel`
- `WebPageNode`
  - `BoardNode` を拡張した webpage 専用補助型
  - `type` は `'webpage' | undefined`
- `StickyNoteNode`
  - `BoardNode` を拡張した付箋専用補助型
  - `type` は `'stickynote'`
- `Viewport`: `zoom`, `panX`, `panY`
- `SiteboardDocumentNode`
  - `.siteboard` に保存される node の union 型
  - `webpage` は `id`, `type`, `title`, `url`, `addedUrl?`, `x`, `y`, `width`, `height`
  - `stickynote` は `id`, `type`, `title`, `content`, `colorIndex`, `x`, `y`, `width`, `height`
- `SiteboardDocumentV1`
  - `schemaVersion: 1`
  - `title`
  - `nodes`
- `Project`
  - ローカルワークスペース用
  - `id`, `title`, `nodes`, `sidebarWidth`, `viewport`, `lastOpenedAt`, `filePath?`, `lastSavedDocument`
- `ProjectState`
  - `projects`, `openIds`, `activeId`
- `ProjectStore`（`tab-store.ts` 内部）
  - `ProjectState` + actions + ランタイム状態
  - ランタイム状態: `isLoaded`, `nodeHistories`
- `ProjectNodeHistory`（`tab-store.ts` 内部）
  - `past`: 直前までの `BoardNode[]` スナップショット配列
  - `future`: Redo 用の `BoardNode[]` スナップショット配列

## `.siteboard` とローカル状態の境界

- `.siteboard` は共有用ドキュメント形式
  - 保存する: `schemaVersion`, `title`, `nodes`
  - 保存しない: ローカル project id, `filePath`, `sidebarWidth`, `viewport`, `lastOpenedAt`, `webviewLabel`
- ローカル状態は再起動復元用
  - `nodes` に加えて `filePath`, `sidebarWidth`, `viewport`, `lastOpenedAt`, `lastSavedDocument` を保持する
  - 未保存編集もローカルから復元する
  - Tauri Store の project state key は `projectStateV2` を使用する。旧 key は migration せず読み捨てる

## 未保存変更の判定

- 未保存判定は current project の `.siteboard` 相当内容（`title`, `nodes`）と `lastSavedDocument` の差分で行う
- `viewport`, `sidebarWidth`, `lastOpenedAt`, `filePath` の差分は未保存確認の対象に含めない
- 新規未保存プロジェクトは作成時点の空 document を `lastSavedDocument` として持つ
- `restoreProjectFromLastSaved` は `title` と `nodes` を `lastSavedDocument` に戻し、対応する `nodeHistories` も破棄する
- `.siteboard` 未保存かつ clean なプロジェクトは、タブクローズまたはアプリ終了時にローカル state から削除する

## ヘルパー

- `isNodeEmpty(node)`: `node.url === ''` で空フレーム判定
- `isStickyNoteNode(node)`: `node.type === 'stickynote'` の型ガード
- `isWebPageNode(node)`: webpage 判定の型ガード（`type` 未定義も webpage 扱い）
- `isNodeMoved(node)`: `addedUrl` と現在 `url` の差分判定

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

- `RESIZE_CURSOR_MAP`: 8 方向の `ResizeDirection` -> CSS cursor 値のマップ

`src/store/tab-store.ts`

- `NODE_HISTORY_LIMIT = 100`（プロジェクトごとの node 履歴保持上限）

## 不変条件

- `webviewLabel` はランタイム専用で永続化しない
- 付箋ノードは `type: 'stickynote'` と `content` / `colorIndex` を利用する
- 空フレーム（`url === ''`）は Webview 未作成状態を許容する
- `nodeHistories` はランタイム専用で永続化しない（`_restoreState` で必ず初期化）
- ローカル project state は現行 `ProjectState` のみ復元対象とし、旧 shape は migration しない
- Undo/Redo は `activeId` のプロジェクトにのみ適用し、`HOME_ID` では no-op
- node 配列を更新する操作は基本的に履歴へ記録するが、付箋の自動高さ調整は `updateNodeSizeWithoutHistory` を使って履歴を積まない
- 同一 `filePath` の `.siteboard` を複数のローカル project に関連付けない
- `.siteboard` の `schemaVersion` は整数で管理し、現行実装は `1` のみ受け入れる
- `lastSavedDocument` はローカル state 専用であり、`.siteboard` へは書き出さない
