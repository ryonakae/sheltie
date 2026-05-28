# フェーズ 0: パッケージ導入 + アダプター層

## 目的

既存 UI に一切影響を与えずに `@xyflow/react` の基盤を準備する。

## 作業内容

### 1. パッケージインストール

```bash
npm install @xyflow/react
```

### 2. CSS 統合確認

`@xyflow/react/dist/style.css` を適切な箇所で import し、Tailwind CSS v4 との競合がないかを確認する。

### 3. アダプター層の新設

**新規ファイル: `src/lib/reactflow-adapter.ts`**

- `boardNodesToFlowNodes(nodes: BoardNode[], zoom: number): Node[]`
  - `BoardNode.x/y` → `Node.position.{ x, y }`
  - `BoardNode.width/height` → `Node.style.{ width, height }`
  - `BoardNode.type` → React Flow の `type` 文字列（`'webPageFlowNode'` / `'stickyNoteFlowNode'`）
  - `data` フィールドに元の `BoardNode` 全体を格納
- `applyFlowChangesToStore(changes: NodeChange[], store)` — `NodeChange[]` → Zustand アクション呼び出し
  - `NodePositionChange` (dragging=false) → `updateNodePosition()`
  - `NodeDimensionChange` → `updateNodeSize()` / `updateNodeSizeWithoutHistory()`
  - `NodeSelectionChange` → `onSelectNode()` / `onClearSelection()`
  - `NodeRemoveChange` → `removeNode()`

**新規ファイル: `src/components/ReactFlowNodes/types.ts`**

- `WebPageFlowNodeData` 型（`BoardNode` の WebPage フィールドを持つ）
- `StickyNoteFlowNodeData` 型
- `nodeTypes` 定数をコンポーネント外で定義（React Flow の必須要件: コンポーネント内で定義すると毎レンダーで全ノードが再マウントされる）

```ts
// コンポーネントの外で定義すること
export const nodeTypes = {
  webPageFlowNode: WebPageFlowNode,
  stickyNoteFlowNode: StickyNoteFlowNode,
};
```

## 検証

- [ ] `npm run typecheck` 通過
- [ ] `npm run lint` 通過
- [ ] 既存の動作に変化なし（まだ UI に何も追加していない）

## 次フェーズへの依存

フェーズ 1 では `boardNodesToFlowNodes()` と `nodeTypes` をそのまま使う。
