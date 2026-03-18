# ドメインモデル

主な型定義は `src/types/index.ts`、状態管理の実装は `src/store/tab-store.ts` が正本。

## 型

- `DisplayMode = 'native' | 'screenshot' | 'hidden'`
- `BoardNodeType = 'webpage' | 'stickynote'`
- `BoardNode`
  - 基本: `id`, `title`, `url`, `x`, `y`, `width`, `height`
  - `height` は content / Webview 本体の高さ。ノード外枠全体の高さではない
  - 任意: `type`, `addedUrl`, `content`, `colorIndex`
- `WebPageNode`
  - `BoardNode` を拡張した webpage 専用補助型
  - `type` は `'webpage' | undefined`
- `StickyNoteNode`
  - `BoardNode` を拡張した付箋専用補助型
  - `type` は `'stickynote'`
- `ProjectWebviewRuntime`
  - project ごとの runtime-only state
  - `labelsByNodeId: Record<string, string>`
  - `screenshotUrlsByNodeId: Record<string, string>`
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
  - ランタイム状態: `isLoaded`, `nodeHistories`, `webviewRuntime`
  - runtime action: `setWebNodeWebviewLabel`, `clearWebNodeWebviewLabel`, `hydrateProjectScreenshotUrls`, `setProjectScreenshotUrl`, `clearProjectScreenshotUrl`
- `ProjectNodeHistory`（`tab-store.ts` 内部）
  - `past`: 直前までの `BoardNode[]` スナップショット配列
  - `future`: Redo 用の `BoardNode[]` スナップショット配列

## `.siteboard` とローカル状態の境界

- `.siteboard` は共有用ドキュメント形式
  - 保存する: `schemaVersion`, `title`, `nodes`
  - 保存しない: ローカル project id, `filePath`, `sidebarWidth`, `viewport`, `lastOpenedAt`, Webview runtime label
- ローカル状態は再起動復元用
  - `nodes` に加えて `filePath`, `sidebarWidth`, `viewport`, `lastOpenedAt`, `lastSavedDocument` を保持する
  - 未保存編集もローカルから復元する
  - Tauri Store の project state key は `projectStateV2` を使用する。旧 key は migration せず読み捨てる
  - `webviewRuntime` と `nodeHistories` は runtime-only のため復元しない

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

## React Flow アダプター（`src/lib/reactflow-adapter.ts`）

### Node 型と Flow ノード

- `WebPageFlowNodeData = { nodeProps: WebPageNodeProps; onResizeStart, onResize, onResizeEnd, getZoom }`
- `StickyNoteFlowNodeData = { nodeProps: StickyNoteNodeProps; onResize, onResizeEnd, getZoom, onColorCycle, colorIndex }`
- Flow ノードの `x`, `y` は常に 0 に設定（実位置は親 `.react-flow__node` の transform で管理）
- Flow ノードの `style` には `width/zoom`, `height/zoom` でズーム補正を適用

### `boardNodesToFlowNodes(nodes: BoardNode[], zoom: number): Node[]`

`BoardNode[]` を React Flow の `Node[]` に変換する。`Siteboard.tsx` の `useMemo` で直接構築（別関数にはしない。理由：ノード型定義の循環依存を避けるため）。

- `BoardNode.x/y` → `Node.position.{x: 0, y: 0}`（位置は親 `.react-flow__node` の transform で管理）
- `BoardNode.width/height` → `Node.style.{width: ... / zoom, height: ... / zoom}`（ズーム値で逆スケーリングし、CSS calc で寸法を正規化）
- `BoardNode.type === 'stickynote'` → `Node.type = 'stickyNoteFlowNode'`（そうでなければ `'webPageFlowNode'`）
- `Node.data` に `{ nodeProps: ... }` を格納（WebPageFlowNode / StickyNoteFlowNode が `node.data.nodeProps` で受け取る）
- `Node` に `draggable={false}` / `selectable={false}` を設定し、React Flow ネイティブ操作を無効化

### React Flow インタラクション制御

フェーズ 1：
- pan/zoom は React Flow ネイティブ（`panActivationKeyCode="Space"` + `panOnDrag={[0, 1]}`）
- ホイール = React Flow ズーム（`zoomOnScroll={true}`）
- `onViewportChange` で `--canvas-zoom` CSS 変数を更新し、UI スケーリングと `zoomPx()` を同期

フェーズ 3-5（現在）：
- **ドラッグ**: React Flow ネイティブ（`nodesDraggable={true}` + `onNodeDragStart` / `onNodeDragStop`）。`dragHandle: '.node-drag-handle'` でタイトルバーのみに限定
- **リサイズ（StickyNote・WebPage）**: React Flow `NodeResizer` コンポーネント（`isVisible={selected}` で選択時のみ表示）。`onResizeEnd` コールバックで ストア更新

## 主要定数

`src/constants/project.ts`

- `HOME_ID = '__home__'`
- `DEFAULT_VIEWPORT = { zoom: 1, panX: 0, panY: 0 }`
- `DEFAULT_PAGE_WIDTH = 375`
- `DEFAULT_PAGE_HEIGHT = 812`
- `WEB_PAGE_TOP_BAR_HEIGHT = 32`
- `WEB_PAGE_BOTTOM_BAR_HEIGHT = 32`
- `DEFAULT_STICKY_NOTE_HEIGHT = 200`
- `STICKY_NOTE_HEADER_HEIGHT = 32`
- `SIZE_PRESETS = [モバイル, タブレット, PC]`

`src/constants/siteboard.ts`

- ズーム: `MIN_ZOOM = 0.2`, `MAX_ZOOM = 1.5`
- しきい値: `HYSTERESIS_PX = 4`, `NATIVE_SAFE_MARGIN_PX = 25`
- ドラッグ補正: `DRAG_REPOSITION_GAP = 20`

`src/hooks/siteboard/types.ts`

- `RESIZE_CURSOR_MAP`: 8 方向の `ResizeDirection` -> CSS cursor 値のマップ

`src/store/tab-store.ts`

- `NODE_HISTORY_LIMIT = 100`（プロジェクトごとの node 履歴保持上限）

## 不変条件

- `BoardNode` は永続化対象だけを持ち、Webview 接続状態は含めない
- `webviewRuntime.labelsByNodeId[nodeId]` は「現在接続済みのネイティブ Webview がある」間だけ設定する。再マウント開始時に `clearWebNodeWebviewLabel` で外し、再生成完了後に `setWebNodeWebviewLabel` で付け直す。
- `webviewRuntime.screenshotUrlsByNodeId[nodeId]` は最後に表示可能だった screenshot の asset URL を保持し、同一セッション内の再マウントと起動直後の open tab preload で使い回す。node 削除時にだけ破棄する。
- 付箋ノードは `type: 'stickynote'` と `content` / `colorIndex` を利用する
- 空フレーム（`url === ''`）は Webview 未作成状態を許容する
- `nodeHistories` はランタイム専用で永続化しない（`_restoreState` で必ず初期化）
- `webviewRuntime` はランタイム専用で永続化しない（`_restoreState` と project 削除時に必ず破棄）
- ローカル project state は現行 `ProjectState` のみ復元対象とし、旧 shape は migration しない
- Undo/Redo は `activeId` のプロジェクトにのみ適用し、`HOME_ID` では no-op
- node 配列を更新する操作は基本的に履歴へ記録するが、付箋の自動高さ調整は `updateNodeSizeWithoutHistory` を使って履歴を積まない
- ドラッグ終了時の重なり補正は webpage 優先で行う。webpage は他ノードと `20px` 未満まで近づけず、stickynote は webpage にだけ同じ制約を適用する
- 重なり補正・新規ノード自動配置・センタリング fallback は、content 高ではなくノード外枠を基準にする。chrome は `zoomPx` で画面 px が固定されるため、world 座標での外枠高さは current zoom に依存する
- 同一 `filePath` の `.siteboard` を複数のローカル project に関連付けない
- `.siteboard` の `schemaVersion` は整数で管理し、現行実装は `1` のみ受け入れる
- `lastSavedDocument` はローカル state 専用であり、`.siteboard` へは書き出さない
