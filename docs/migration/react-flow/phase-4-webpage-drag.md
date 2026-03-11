# フェーズ 4: WebPageNode のドラッグを React Flow ネイティブに移行

## 目的

WebPageNode のドラッグを React Flow に切り替える。
ドラッグ後の位置補正（重なり検出 + アニメーション）や Display Engine への通知も含む。
リサイズは次フェーズ（フェーズ 5）で対応する。

## 背景: 現在のドラッグ実装の特殊性

`usePageDrag.ts` は以下の処理を行っている:

1. 3px の閾値を超えてから isDragging=true（クリックとの誤区別を防ぐ）
2. `beforeDragStart()` を async で await してスクリーンショット準備
3. `frameEl.style.left/top` を直接操作（DOM 直操作で即時反映）
4. mouseup 時に `updateNodePosition()` でストアに保存

React Flow のドラッグに移行する際、`beforeDragStart()` の async 待機は `onNodeDragStart` で行えないため、別の戦略が必要になる（後述）。

## 作業内容

### 1. WebPageFlowNode の dragHandle 設定

WebPageNode は TopBar からのみドラッグできるようにする（既存の挙動と同じ）:

```tsx
export const WebPageFlowNode = memo(({ id, data }: NodeProps<WebPageFlowNodeData>) => {
  return (
    // root div は nodrag を外す
    // ただし TopBar 以外は nodrag にする
    <div>
      {/* TopBar に drag-handle クラスを付与 */}
      <WebPageNodeTopBar className="drag-handle" ... />
      <div className="nodrag nopan" data-webview-placeholder ... />
      <WebPageNodeBottomBar className="nodrag" ... />
    </div>
  );
});
```

`<ReactFlow>` に `dragHandle=".drag-handle"` を設定する。

### 2. nodesDraggable の有効化

フェーズ 3 の方法 A（ノード単位 `draggable`）を使っている場合、WebPageNode 用ノードも `draggable: true` に変更する:

```ts
// boardNodesToFlowNodes() 内
{
  ...flowNode,
  draggable: true,  // 全ノードをドラッグ可能に（dragHandle で制限）
}
```

### 3. onNodeDragStart: Display Engine への通知

```ts
const handleNodeDragStart = useCallback(
  (_event: ReactMouseEvent, _node: Node) => {
    const nodeId = _node.id;

    // 位置補正アニメーション中なら中断
    clearPositionCorrectionAnimation(nodeId);

    // Display Engine に通知（スクリーンショット準備を fire-and-forget で開始）
    // 注意: async を await できないため、準備前は hide フォールバックが動作する
    void prepareInteractionStart('drag');
    handleInteractionChange(true, 'grabbing', 'drag');
  },
  [clearPositionCorrectionAnimation, prepareInteractionStart, handleInteractionChange],
);
```

> **スクリーンショット準備の非同期問題**: 現在の `beforeDragStart()` は async でスクリーンショットを撮影してから `isDragging=true` にする。React Flow では `onNodeDragStart` が同期的なため待機できない。
>
> **対策**: fire-and-forget で準備を開始し、準備が間に合わなかったノードは `forceHiddenInteractionNodeIdsRef`（既存の仕組み）で即座に `hidden` にする。定期リフレッシュ（2000ms）でキャッシュが常に最新であることが前提。

### 4. onNodeDragStop: 位置補正 + ストア更新

```ts
const handleNodeDragStop = useCallback(
  (_event: ReactMouseEvent, node: Node) => {
    const nodeId = node.id;
    const { x, y } = node.position;
    const movingNode = nodes.find((n) => n.id === nodeId);
    if (!movingNode) return;

    // 重なり検出 + 位置補正
    const resolvedPosition = resolveDraggedNodePosition({
      nodes,
      movingNode,
      proposedX: x,
      proposedY: y,
      gap: DRAG_REPOSITION_GAP,
      zoom: zoomRef.current,
    });

    // Display Engine に通知
    handleInteractionChange(false);

    if (resolvedPosition.corrected && isWebPageNode(movingNode)) {
      // 位置補正アニメーションをセット
      holdNodeDuringPositionSettle(nodeId);
      setPositionCorrectionAnimations((prev) => ({ ...prev, [nodeId]: { ... } }));
      updateNodePosition(activeId, nodeId, resolvedPosition.x, resolvedPosition.y);
    } else {
      updateNodePosition(activeId, nodeId, resolvedPosition.x, resolvedPosition.y);
    }

    // React Flow の内部状態も更新（補正後の位置に）
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId ? { ...n, position: { x: resolvedPosition.x, y: resolvedPosition.y } } : n
      )
    );
  },
  [...],
);
```

### 5. 位置補正アニメーションの Web Animations API

既存の Web Animations API（`frameEl.animate()`）は DOM 要素を直接アニメーションさせる。React Flow 環境では React Flow が各ノードの transform を管理しているため、Web Animations API と競合する可能性がある。

**対応**: アニメーション完了まで React Flow の位置を `fromX/fromY` に固定し、アニメーション完了後に `resolvedPosition` で `setNodes` を呼ぶ。`positionCorrectionAnimationToken` の仕組みは維持。

### 6. ドラッグ閾値

React Flow のデフォルトのドラッグ開始閾値は `nodeDragThreshold` prop（デフォルト: 1px）。既存実装の 3px に合わせるには:

```tsx
<ReactFlow nodeDragThreshold={3} ... />
```

## 検証

- [ ] WebPageNode が TopBar からのみドラッグできる
- [ ] ドラッグ中に Webview が hide される
- [ ] ドラッグ後の位置補正（重なり検出）が動作する
- [ ] 位置補正アニメーションが滑らかに動作する
- [ ] アニメーション完了後に Webview が正しい位置に復帰する
- [ ] ドラッグ閾値が機能する（クリックでドラッグが発火しない）
- [ ] Undo/Redo がドラッグ後の位置変更で動作する
- [ ] 付箋のドラッグが引き続き正常動作（回帰なし）
- [ ] `npm run typecheck` / `npm run lint` 通過

## 廃止予定（このフェーズで削除）

- `src/hooks/usePageDrag.ts`
- `useSiteboardViewportEngine` 内のドラッグ関連コード
