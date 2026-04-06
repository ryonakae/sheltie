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
  - document ごとの runtime-only state
  - `labelsByNodeId: Record<string, string>`
  - `screenshotUrlsByNodeId: Record<string, string>`
- `Viewport`: `zoom`, `panX`, `panY`
- `SiteboardDocumentNode`
  - `.siteboard` に保存される node の union 型
  - `webpage` は `id`, `type`, `title`, `url`, `addedUrl?`, `x`, `y`, `width`, `height`
  - `stickynote` は `id`, `type`, `title`, `content`, `colorIndex`, `x`, `y`, `width`, `height`
- `SiteboardDocumentV2`
  - `schemaVersion: 2`
  - `nodes`
- `Project`
  - 1 document window 分のローカル状態
  - `id`, `nodes`, `viewport`, `filePath?`, `untitledIndex`, `lastSavedDocument`
- `ProjectState`
  - document window ごとの単一 state
  - `project: Project | null`
- `ProjectStore`（`tab-store.ts` 内部）
  - 単一 document window の `ProjectState` + actions + ランタイム状態
  - ランタイム状態: `isLoaded`, `nodeHistory`, `webviewRuntime`
  - 初期化: `initializeProject`, `markProjectSaved`, `restoreProjectFromLastSaved`
  - ノード追加/削除: `addWebNode`, `setWebNodeUrl`, `removeNode`, `addStickyNoteNode`
  - ノード更新: `updateNodePosition`, `updateNodeSize`, `updateNodeBounds`, `updateNodeSizeWithoutHistory`, `updateWebNodeUrl`, `updateNodeTitle`, `updateStickyNoteContent`, `cycleStickyNoteColor`
  - 順序/選択: `bringNodeToFront`, `pinWebNodeUrl`, `updateViewport`
  - 履歴: `undoProject`, `redoProject`
  - runtime: `setWebNodeWebviewLabel`, `clearWebNodeWebviewLabel`, `hydrateProjectScreenshotUrls`, `setProjectScreenshotUrl`, `clearProjectScreenshotUrl`
- `ProjectNodeHistory`（`tab-store.ts` 内部）
  - `past`: 直前までの `BoardNode[]` スナップショット配列
  - `future`: Redo 用の `BoardNode[]` スナップショット配列

## `.siteboard` とローカル状態の境界

- `.siteboard` は共有用ドキュメント形式
- 保存する: `schemaVersion`, `nodes`
  - `title` は保存しない
  - `schemaVersion: 1` は読み込み互換用に受けるが、書き出しは `schemaVersion: 2` に統一する
  - 保存名は `.siteboard` の外側、つまりファイル名で表現する
- ローカル状態は document window の再起動復元用
  - `Project` は renderer のメモリ上で `nodes`, `filePath`, `viewport`, `untitledIndex`, `lastSavedDocument` を保持する
  - backend から受ける window context は `filePath` と `untitledIndex` のみ
  - 起動時は filePath があれば `.siteboard` を読み、無ければ空 document を作る
  - `webviewRuntime` と `nodeHistory` は runtime-only のため永続化しない

## 未保存変更の判定

- 未保存判定は current document の `.siteboard` 相当内容（`nodes`）と `lastSavedDocument` の差分で行う
- `viewport`, `filePath`, `untitledIndex` の差分は未保存確認の対象に含めない
- 新規未保存 document は作成時点の空 document を `lastSavedDocument` として持つ
- `restoreProjectFromLastSaved` は `nodes` を `lastSavedDocument` に戻し、対応する `nodeHistory` も破棄する

## ヘルパー

- `isNodeEmpty(node)`: `node.url === ''` で空フレーム判定
- `isStickyNoteNode(node)`: `node.type === 'stickynote'` の型ガード
- `isWebPageNode(node)`: webpage 判定の型ガード（`type` 未定義も webpage 扱い）
- `isNodeMoved(node)`: `addedUrl` と現在 `url` の差分判定

## React Flow ノード構成

### Node 型と Flow ノード

- `WebPageFlowNodeData = { nodeProps: WebPageNodeProps; layoutZoom; onResizeStart; onResize; onResizeEnd; getZoom }`
- `StickyNoteFlowNodeData = { nodeProps: StickyNoteNodeProps; onResize; onResizeEnd }`
- `BoardNode[]` から React Flow `Node[]` を作る正本は `Siteboard.tsx` の `flowNodes` `useMemo`
- Flow ノードの `position` には常に store 上の `{x, y}` を入れる
- ノード内部コンポーネントには `{ x: 0, y: 0 }` を渡し、実位置は親 `.react-flow__node` の transform に委譲する
- `width` / `height` は `Node.style` ではなく top-level prop に入れる
- `selected` と `measured` を明示して controlled mode の選択状態と初期化状態を安定させる

### React Flow インタラクション制御

- **viewport**: `panOnDrag={[1]}` + `panOnScroll={true}` + `zoomOnScroll={true}` + `zoomOnPinch={true}`。修飾なしホイールは pan、`CmdOrCtrl + ホイール` とピンチは zoom として扱う
- **viewport 同期**: `handleViewportChange` で store へ debounce 保存し、store 側の viewport 変更は `setViewport()` で React Flow に反映する
- **ドラッグ**: React Flow ネイティブ。WebPage は `WebPageNode` 本体内の上下 chrome shell に付けた `dragHandle: '.node-drag-handle'` だけでドラッグし、付箋はノード本体をドラッグ可能にする
- **リサイズ（StickyNote）**: React Flow `NodeResizeControl` は四隅ハンドルだけに絞り、選択枠の線は別オーバーレイで描く。手動変更は横幅のみ許可し、高さは本文から自動計測して `updateNodeSizeWithoutHistory` で反映する
- **リサイズ（WebPage）**: React Flow `NodeResizeControl` を 8 個明示配置し、line 4 本は不可視 hit area、corner handle 4 個は付箋ノードと同じく選択線の交点基準で描く。見えている上下バー面と操作 UI は `WebPageNode` 本体側に含める。`onResize` では中間の `x/y/width/height` を state に保持し、`onResizeEnd` では `updateNodeBounds` で最終の `x/y/width/height` を 1 回で store に確定する。Undo/Redo 履歴も 1 エントリにまとめる

## 主要定数

`src/constants/project.ts`

- `DEFAULT_VIEWPORT = { zoom: 1, panX: 0, panY: 0 }`
- `DEFAULT_PAGE_WIDTH = 393`
- `DEFAULT_PAGE_HEIGHT = 852`
- `WEB_PAGE_TOP_BAR_HEIGHT = 32`
- `WEB_PAGE_BOTTOM_BAR_HEIGHT = 32`
- `DEFAULT_STICKY_NOTE_WIDTH = 200`
- `DEFAULT_STICKY_NOTE_HEIGHT = 200`
- `STICKY_NOTE_HEADER_HEIGHT = 32`
- `SIZE_PRESETS = [モバイル, タブレット, PC]`

`src/constants/siteboard.ts`

- ズーム: `MIN_ZOOM = 0.2`, `MAX_ZOOM = 1.5`
- しきい値: `HYSTERESIS_PX = 4`, `NATIVE_SAFE_MARGIN_PX = 25`
- ドラッグ補正: `DRAG_REPOSITION_GAP = 20`

`src/store/tab-store.ts`

- `NODE_HISTORY_LIMIT = 100`（document ごとの node 履歴保持上限）

## 不変条件

- `BoardNode` は永続化対象だけを持ち、Webview 接続状態は含めない
- `webviewRuntime.labelsByNodeId[nodeId]` は「現在接続済みのネイティブ Webview がある」間だけ設定する。再マウント開始時に `clearWebNodeWebviewLabel` で外し、再生成完了後に `setWebNodeWebviewLabel` で付け直す。
- `webviewRuntime.screenshotUrlsByNodeId[nodeId]` は最後に表示可能だった screenshot の asset URL を保持し、同一セッション内の再マウントと起動直後の open tab preload で使い回す。node 削除時にだけ破棄する。
- 付箋ノードは `type: 'stickynote'` と `content` / `colorIndex` を利用する
- 空フレーム（`url === ''`）は Webview 未作成状態を許容する
- `nodeHistory` はランタイム専用で永続化しない
- `webviewRuntime` はランタイム専用で永続化しない
- Undo/Redo は現在の document window にのみ適用する
- node 配列を更新する操作は基本的に履歴へ記録するが、付箋の自動高さ調整は `updateNodeSizeWithoutHistory` を使って履歴を積まない
- ドラッグ終了時の重なり補正は webpage 優先で行う。webpage は他ノードと `20px` 未満まで近づけず、stickynote は webpage にだけ同じ制約を適用する
- 重なり補正・新規ノード自動配置・センタリング fallback は、content 高ではなくノード外枠を基準にする。chrome は `zoomPx` で画面 px が固定されるため、world 座標での外枠高さは current zoom に依存する
- WebPage / StickyNote のツールバー文字・ボタン・アイコンは node 内描画だが、`zoomPx()` と `scaleWithCanvasZoom` で画面上の大きさを固定する
- 同一 `filePath` の `.siteboard` を複数のローカル document に関連付けない
- `.siteboard` の `schemaVersion` は整数で管理し、現行実装は `2` を正本にする
- `lastSavedDocument` はローカル state 専用であり、`.siteboard` へは書き出さない

## Lessons Learned

### 44. untitled_index の動的割り当て（gap-filling）

ウィンドウ/タブを閉じた後に新規ウィンドウを開く際、以前は単調増加カウンター `next_untitled_index` を使って「名称未設定3」「名称未設定4」... と付与していた。修正により、現在の `windows` HashMap から使用中の untitled_index を BTreeSet で管理し、1 から順に最小の未使用番号を割り当てるように変更。これにより「名称未設定2」を閉じた後に新規ウィンドウを開くと「名称未設定3」ではなく「名称未設定2」が再利用される。

**実装:** `src-tauri/src/commands/store.rs` L103-118
**変更:**
- `DocumentManager` から `next_untitled_index: usize` フィールドを削除
- `reserve_window()` 内で毎回 `used: BTreeSet<usize>` を構築し、最小の未使用インデックスを検索
