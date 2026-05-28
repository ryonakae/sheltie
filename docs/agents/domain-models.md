# ドメインモデル

主な型定義は `src/types/index.ts`、状態管理の実装は `src/store/tab-store.ts` が正本。

## 型

- `DisplayMode = 'native' | 'screenshot' | 'hidden'`
- `BoardNodeType = 'webpage' | 'stickynote' | 'text'`
- `BoardNode`
  - 基本: `id`, `title`, `url`, `x`, `y`, `width`, `height`
  - `height` は content / Webview 本体の高さ。ノード外枠全体の高さではない
  - 任意: `type`, `addedUrl`, `content`, `colorIndex`, `tiptapContent`, `fontSizePreset`, `fontWeight`, `italic`, `strikethrough`, `textColorIndex`, `widthMode`
- `WebPageNode`
  - `BoardNode` を拡張した webpage 専用補助型
  - `type` は `'webpage' | undefined`
- `StickyNoteNode`
  - `BoardNode` を拡張した付箋専用補助型
  - `type` は `'stickynote'`
- `TextNode`
  - `BoardNode` を拡張したテキストノード専用補助型
  - `type` は `'text'`
  - `tiptapContent?: object`（Tiptap JSON ドキュメント）、`fontSizePreset?: TextNodeFontSizePreset`（0=S, 1=M, 2=L, 3=XL）、`fontWeight`、`italic`、`strikethrough`、`textColorIndex`、`widthMode`（`'auto' | 'fixed'`）
- `BoardEdge`
  - `id`, `source`, `sourceHandle`, `target`, `targetHandle`
  - WebPageNode 同士の接続を表現する。他のノード種別は接続対象外
- `SiteboardDocumentEdge`
  - `.siteboard` に保存されるエッジ形式。`BoardEdge` と同じフィールド
- `TextNodeFontSizePreset = 0 | 1 | 2 | 3`
- `ProjectWebviewRuntime`
  - document ごとの runtime-only state
  - `labelsByNodeId: Record<string, string>`
  - `screenshotUrlsByNodeId: Record<string, string>`
- `Viewport`: `zoom`, `panX`, `panY`
- `SiteboardDocumentNode`
  - `.siteboard` に保存される node の union 型
  - `webpage` は `id`, `type`, `title`, `url`, `addedUrl?`, `x`, `y`, `width`, `height`
  - `stickynote` は `id`, `type`, `title`, `content`, `colorIndex`, `x`, `y`, `width`, `height`
  - `text` は `id`, `type`, `title`, `tiptapContent?`, `fontSizePreset`, `fontWeight`, `italic`, `strikethrough`, `textColorIndex`, `widthMode`, `x`, `y`, `width`, `height`
- `SiteboardDocumentV2`
  - `schemaVersion: 2`
  - `nodes`, `edges?`（後方互換: `edges` が無い場合は空配列として扱う）
- `Project`
  - 1 document window 分のローカル状態
  - `id`, `nodes`, `edges`, `viewport`, `filePath?`, `untitledIndex`, `lastSavedDocument`
- `ProjectState`
  - document window ごとの単一 state
  - `project: Project | null`
- `ProjectStore`（`tab-store.ts` 内部）
  - 単一 document window の `ProjectState` + actions + ランタイム状態
  - ランタイム状態: `isLoaded`, `history`, `webviewRuntime`
  - 初期化: `initializeProject`, `markProjectSaved`, `restoreProjectFromLastSaved`
  - ノード追加/削除: `addWebNode`, `setWebNodeUrl`, `changeWebNodeUrl`, `removeNode`, `addStickyNoteNode`, `addTextNode`
  - ノード更新: `updateNodePosition`, `updateNodeSize`, `updateNodeBounds`, `updateNodeSizeWithoutHistory`, `updateWebNodeUrl`, `updateNodeTitle`, `updateStickyNoteContent`, `cycleStickyNoteColor`, `updateTextNodeContent`, `updateTextNodeStyle`, `updateTextNodeWidthMode`
  - エッジ: `addEdge`, `removeEdges`, `reverseEdge`（`removeNode` 時に関連エッジも自動削除。`reverseEdge` は同方向の重複が既にあれば no-op）
  - 順序/選択: `bringNodeToFront`, `sendNodeToBack`, `bringNodeForward`, `sendNodeBackward`, `pinWebNodeUrl`, `updateViewport`
  - 履歴: `undoProject`, `redoProject`
  - runtime: `setWebNodeWebviewLabel`, `clearWebNodeWebviewLabel`, `hydrateProjectScreenshotUrls`, `setProjectScreenshotUrl`, `clearProjectScreenshotUrl`
- `ProjectHistory`（`tab-store.ts` 内部）
  - `past`: 直前までの `ProjectSnapshot` 配列（`{ nodes: BoardNode[]; edges: BoardEdge[] }`）
  - `future`: Redo 用の `ProjectSnapshot` 配列
  - ノードとエッジを統合スナップショットとして管理し、Undo/Redo で両方が同時に復元される

## `.siteboard` とローカル状態の境界

- `.siteboard` は共有用ドキュメント形式
- 保存する: `schemaVersion`, `nodes`, `edges`
  - `title` は保存しない
  - `schemaVersion: 1` は読み込み互換用に受けるが、書き出しは `schemaVersion: 2` に統一する
  - 保存名は `.siteboard` の外側、つまりファイル名で表現する
- ローカル状態は document window の再起動復元用
  - `Project` は renderer のメモリ上で `nodes`, `filePath`, `viewport`, `untitledIndex`, `lastSavedDocument` を保持する
  - backend から受ける window context は `filePath` と `untitledIndex` のみ
  - 起動時は filePath があれば `.siteboard` を読み、無ければ空 document を作る
  - `webviewRuntime` と `nodeHistory` は runtime-only のため永続化しない

## 未保存変更の判定

- 未保存判定は current document の `.siteboard` 相当内容（`nodes`, `edges`）と `lastSavedDocument` の差分で行う
- `viewport`, `filePath`, `untitledIndex` の差分は未保存確認の対象に含めない
- 新規未保存 document は作成時点の空 document を `lastSavedDocument` として持つ
- `restoreProjectFromLastSaved` は `nodes` と `edges` を `lastSavedDocument` に戻し、対応する `history` も破棄する

## ヘルパー

- `isNodeEmpty(node)`: `node.url === ''` で空フレーム判定
- `isStickyNoteNode(node)`: `node.type === 'stickynote'` の型ガード
- `isTextNode(node)`: `node.type === 'text'` の型ガード
- `isWebPageNode(node)`: webpage 判定の型ガード（`type` 未定義も webpage 扱い。`stickynote` と `text` を除外）
- `isNodeMoved(node)`: `addedUrl` と現在 `url` の差分判定

## React Flow ノード構成

### Node 型と Flow ノード

- `WebPageFlowNodeData = { nodeProps: WebPageNodeProps; layoutZoom; onResizeStart; onResize; onResizeEnd; getZoom }`
- `StickyNoteFlowNodeData = { nodeProps: StickyNoteNodeProps; onResize; onResizeEnd }`
- `TextFlowNodeData = { nodeProps: TextNodeProps & { onStyleChange }; onResize; onResizeEnd }`
- `BoardNode[]` から React Flow `Node[]` を作る正本は `Siteboard.tsx` の `flowNodes` `useMemo`

実装規約（position / width / height の渡し方、インタラクション制御）は `coding-rules.md` の「React Flow」セクションを参照。

## 主要定数

`src/constants/project.ts`

- `DEFAULT_VIEWPORT = { zoom: 1, panX: 0, panY: 0 }`
- `DEFAULT_PAGE_WIDTH = 393`
- `DEFAULT_PAGE_HEIGHT = 852`
- `WEB_PAGE_TOP_BAR_HEIGHT = 32`
- `WEB_PAGE_BOTTOM_BAR_HEIGHT = 32`
- `DEFAULT_STICKY_NOTE_WIDTH = 200`
- `DEFAULT_STICKY_NOTE_HEIGHT = 200`
- `DEFAULT_TEXT_NODE_WIDTH = 200`
- `DEFAULT_TEXT_NODE_HEIGHT = 32`
- `STICKY_NOTE_HEADER_HEIGHT = 32`
- `SIZE_PRESETS = [モバイル, タブレット, PC]`

`src/constants/siteboard.ts`

- ズーム: `MIN_ZOOM = 0.25`, `MAX_ZOOM = 1.5`, `ZOOM_STEPS = [0.25, 0.5, 1.0, 1.5]`（キーボードショートカットのステップ値）
- しきい値: `HYSTERESIS_PX = 4`, `NATIVE_SAFE_MARGIN_PX = 25`
- ドラッグ補正: `DRAG_REPOSITION_GAP = 20`
- テキストノード: `TEXT_NODE_MIN_WIDTH = 40`, `TEXT_NODE_FONT_SIZE_PRESETS = [12, 16, 24, 36]`, `TEXT_NODE_COLORS`（黒・白・グレー・赤・青・緑の6色）

`src/store/tab-store.ts`

- `HISTORY_LIMIT = 100`（document ごとの統合履歴保持上限）

## 不変条件

- `BoardNode` は永続化対象だけを持ち、Webview 接続状態は含めない
- `webviewRuntime.labelsByNodeId[nodeId]` は「現在接続済みのネイティブ Webview がある」間だけ設定する。再マウント開始時に `clearWebNodeWebviewLabel` で外し、再生成完了後に `setWebNodeWebviewLabel` で付け直す。
- `webviewRuntime.screenshotUrlsByNodeId[nodeId]` は最後に表示可能だった screenshot の asset URL を保持し、同一セッション内の再マウントと起動直後の open tab preload で使い回す。node 削除時にだけ破棄する。
- 付箋ノードは `type: 'stickynote'` と `content` / `colorIndex` を利用する
- テキストノードは `type: 'text'` と `tiptapContent` / `fontSizePreset` / `fontWeight` / `italic` / `strikethrough` / `textColorIndex` / `widthMode` を利用する
- 空フレーム（`url === ''`）は Webview 未作成状態を許容する
- `history` はランタイム専用で永続化しない
- `webviewRuntime` はランタイム専用で永続化しない
- Undo/Redo は現在の document window にのみ適用する
- node / edge 配列を更新する操作は基本的に履歴へ記録するが、付箋の自動高さ調整は `updateNodeSizeWithoutHistory` を使って履歴を積まない
- ドラッグ終了時の重なり補正は webpage 優先で行う。webpage は他ノードと `20px` 未満まで近づけず、stickynote は webpage にだけ同じ制約を適用する
- 重なり補正・新規ノード自動配置・センタリング fallback は、content 高ではなくノード外枠を基準にする。chrome は `zoomPx` で画面 px が固定されるため、world 座標での外枠高さは current zoom に依存する
- WebPage / StickyNote のツールバー文字・ボタン・アイコンは node 内描画だが、`zoomPx()` と `scaleWithCanvasZoom` で画面上の大きさを固定する
- 同一 `filePath` の `.siteboard` を複数のローカル document に関連付けない
- `.siteboard` の `schemaVersion` は整数で管理し、現行実装は `2` を正本にする
- `lastSavedDocument` はローカル state 専用であり、`.siteboard` へは書き出さない

