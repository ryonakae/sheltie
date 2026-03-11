# フェーズ 3: 付箋のドラッグ/リサイズを React Flow ネイティブに移行

## 目的

最もシンプルなノード（付箋）から React Flow のドラッグ/リサイズに切り替え、パターンを確立する。
WebPageNode（Webview あり）には触れないため、リスクが低く問題の切り分けがしやすい。

## 作業内容

### 1. StickyNoteFlowNode から `nodrag` を除去

フェーズ 1 で付与した `nodrag nopan` クラスを削除し、React Flow のドラッグを有効化する。

ただし付箋の**内部コンテンツ**（textarea、色切り替えボタン等）にはドラッグが伝播しないよう `nodrag nowheel` を維持する:

```tsx
export const StickyNoteFlowNode = memo(({ id, data }: NodeProps<StickyNoteFlowNodeData>) => {
  return (
    // root div は nodrag を外す（React Flow がドラッグを管理）
    <div>
      <NodeResizer minWidth={150} minHeight={150} />
      {/* テキストエリアや編集 UI には nodrag を付与 */}
      <textarea className="nodrag nowheel" ... />
      <button className="nodrag" onClick={handleColorCycle} ... />
    </div>
  );
});
```

### 2. NodeResizer でリサイズを実装

`@xyflow/react` の `NodeResizer` を使ってリサイズ UI を追加する:

```tsx
import { NodeResizer } from '@xyflow/react';

<NodeResizer
  minWidth={150}
  minHeight={150}
  isVisible={isSelected}  // 選択時のみリサイズハンドルを表示
/>
```

または `NodeResizeControl` でより細かいカスタマイズも可能。

### 3. onNodesChange でストアに反映

Siteboard.tsx の `handleNodesChange` を実装する:

```ts
const handleNodesChange: OnNodesChange = useCallback((changes) => {
  for (const change of changes) {
    switch (change.type) {
      case 'position':
        // ドラッグ終了時のみ（dragging=false）ストアに反映
        if (!change.dragging && change.position) {
          updateNodePosition(activeId, change.id, change.position.x, change.position.y);
        }
        break;
      case 'dimensions':
        if (change.dimensions) {
          // リサイズ中は履歴なし、完了時に履歴あり
          updateNodeSize(activeId, change.id, change.dimensions.width, change.dimensions.height);
        }
        break;
      case 'select':
        if (change.selected) {
          onSelectNode(change.id);
        } else {
          onClearSelection();
        }
        break;
      case 'remove':
        removeNode(activeId, change.id);
        break;
    }
  }

  // React Flow 内部状態にも反映（制御コンポーネントとして必要）
  setNodes((nds) => applyNodeChanges(changes, nds));
}, [activeId, updateNodePosition, updateNodeSize, onSelectNode, onClearSelection, removeNode]);
```

### 4. nodesDraggable の条件付き有効化

フェーズ 1 では `nodesDraggable={false}` にしていたが、付箋だけドラッグを有効にする。方法は2通り:

**方法 A**: ノード単位で `draggable` プロパティを設定（推奨）
```ts
// boardNodesToFlowNodes() 内で
{
  ...flowNode,
  draggable: isStickyNoteNode(node),  // 付箋のみ true
}
```

**方法 B**: `ReactFlow` 全体で `nodesDraggable={true}` にし、WebPageFlowNode の root に `nodrag` を維持

フェーズ 4 で WebPageNode のドラッグも有効化するまでは方法 A が安全。

### 5. ドラッグ中の表示（ズーム補正）

React Flow のドラッグはフロー座標系で行われるため、`--canvas-zoom` による表示は自動的に正しい。既存の `zoomPx()` はそのまま動作する。

## 検証

- [ ] 付箋のドラッグが正常動作する（React Flow ネイティブ）
- [ ] 付箋のリサイズが動作する（最小サイズ 150x150）
- [ ] 付箋の textarea 編集中にノードがドラッグされない
- [ ] 付箋の色切り替えボタンがドラッグを発火させない
- [ ] ドラッグ後に Zustand ストアの座標が更新される
- [ ] Undo/Redo が付箋の位置/サイズ変更で動作する
- [ ] **WebPageNode のドラッグ/リサイズは既存通り動作（回帰なし）**
- [ ] `npm run typecheck` / `npm run lint` 通過

## 廃止予定（このフェーズ以降不要）

- 付箋に対する `usePageDrag` / `usePageResize` の呼び出し（WebPageNode 用はまだ維持）
