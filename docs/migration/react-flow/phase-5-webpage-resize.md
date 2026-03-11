# フェーズ 5: WebPageNode のリサイズを React Flow ネイティブに移行

## 目的

WebPageNode のリサイズを `NodeResizeControl` に切り替える。
Display Engine（リサイズ開始/終了時の Webview 制御）との接続も含む。

## 背景: 現在のリサイズ実装の特殊性

`usePageResize.ts` は以下を行っている:

1. 8方向（n/s/e/w/ne/nw/se/sw）のリサイズハンドル
2. `zoom` で delta を割ってキャンバス座標系を維持
3. `frameEl.style.width/height` と `webviewEl` を DOM 直操作
4. `resolveMinHeight(node)`: chrome 高さを含む動的な最小高さ計算
5. リサイズ開始/終了時に `handlePageResizeStart` / `handlePageResizeEnd` を呼ぶ

React Flow の `NodeResizeControl` はリサイズ幅・高さを `onNodesChange` の `NodeDimensionChange` として通知するため、DOM 直操作は不要になる。

## 作業内容

### 1. WebPageFlowNode に NodeResizeControl を配置

```tsx
import { NodeResizeControl } from '@xyflow/react';

const RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;

export const WebPageFlowNode = memo(({ id, data }: NodeProps<WebPageFlowNodeData>) => {
  const minHeight = getNodeChromeHeight(data.node, data.zoom) + MIN_CONTENT_HEIGHT;

  return (
    <div>
      {RESIZE_DIRECTIONS.map((dir) => (
        <NodeResizeControl
          key={dir}
          position={dir}
          minWidth={MIN_NODE_WIDTH}
          minHeight={minHeight}
          onResizeStart={() => data.onResizeStart(id)}
          onResizeEnd={() => data.onResizeEnd(id)}
        />
      ))}
      <WebPageNodeTopBar className="drag-handle" ... />
      <div data-webview-placeholder ... />
      <WebPageNodeBottomBar ... />
    </div>
  );
});
```

> **注意**: `minHeight` は chrome 高さ（zoom に反比例）を含むため、zoom が変わると変わる。`data.zoom` を渡すか、カスタムノード内で `useStore` でズームを取得する方法を検討する。

### 2. リサイズイベントと Display Engine の接続

`NodeResizeControl` の `onResizeStart` / `onResizeEnd` コールバックを `WebPageFlowNode` の `data` 経由で渡す:

```ts
// Siteboard.tsx → boardNodesToFlowNodes() 内
data: {
  node,
  zoom: zoomRef.current,
  onResizeStart: handlePageResizeStart,   // Display Engine
  onResizeEnd: handlePageResizeEnd,       // Display Engine
  ...
}
```

### 3. onNodesChange でのリサイズ処理

```ts
case 'dimensions':
  if (change.dimensions) {
    const { width, height } = change.dimensions;
    if (isResizingRef.current) {
      // リサイズ中は履歴なし（ドラッグ中と同様）
      updateNodeSizeWithoutHistory(activeId, change.id, width, height);
    } else {
      // リサイズ完了時は履歴あり
      updateNodeSize(activeId, change.id, width, height);
    }
  }
  break;
```

`isResizingRef` の代わりに `resizingNodeId` を使う設計でもよい。

### 4. リサイズ中の表示サイズ（resizingSize）

現在の `resizingSize` state（リサイズ中に `displayWidth` / `displayHeight` として使われる）は、`NodeDimensionChange` から最新サイズを取得できるため、React Flow が内部で管理するサイズをそのまま使う形に変更できる。

### 5. リサイズプリセット（BottomBar）

BottomBar の「モバイル/タブレット/PC」ボタンは `handleResizePreset()` を呼ぶ。React Flow への移行後は:

```ts
const handleResizePreset = useCallback((nodeId: string, width: number, height: number) => {
  updateNodeSize(activeId, nodeId, width, height);
  // React Flow 内部状態も更新
  setNodes((nds) =>
    nds.map((n) =>
      n.id === nodeId
        ? { ...n, style: { ...n.style, width, height } }
        : n
    )
  );
}, [...]);
```

### 6. リサイズハンドルのスタイル

React Flow の `NodeResizeControl` はデフォルトのスタイルを持つが、既存の `NodeResizeHandle.tsx` のスタイル（`zoomPx()` によるズーム補正、ヒット領域）を踏襲するには `NodeResizeControl` に `className` を指定してカスタム CSS を当てる。

## 検証

- [ ] WebPageNode の8方向リサイズが動作する
- [ ] リサイズ中に Webview が screenshot モードに切り替わる
- [ ] リサイズ終了後に Webview が正しいサイズで native に復帰する
- [ ] リサイズ中の `displayWidth` / `displayHeight` が BottomBar に正しく表示される
- [ ] リサイズプリセットボタン（モバイル/タブレット/PC）が動作する
- [ ] 最小サイズの制限が動作する（chrome 高さを含む動的計算）
- [ ] Undo/Redo がリサイズ後のサイズ変更で動作する
- [ ] 付箋のリサイズが引き続き正常動作（回帰なし）
- [ ] `npm run typecheck` / `npm run lint` 通過

## 廃止予定（このフェーズで削除）

- `src/hooks/usePageResize.ts`
- `src/components/Node/NodeResizeHandle.tsx`
- `useSiteboardViewportEngine` 内のリサイズ関連コード
