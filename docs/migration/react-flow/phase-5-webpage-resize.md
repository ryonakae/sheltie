# フェーズ 5: WebPageNode のリサイズを React Flow ネイティブに移行

## 目的

WebPageNode のリサイズを React Flow の `NodeResizer` に切り替える。
Display Engine（リサイズ開始/終了時の Webview 制御）との接続も含む。

## 背景: 現在のリサイズ実装の特殊性

`usePageResize.ts` は以下を行っている:

1. 8方向（n/s/e/w/ne/nw/se/sw）のリサイズハンドル
2. `zoom` で delta を割ってキャンバス座標系を維持
3. `frameEl.style.width/height` と `webviewEl` を DOM 直操作
4. `resolveMinHeight(node)`: chrome 高さを含む動的な最小高さ計算
5. リサイズ開始前に `beforeResizeStart()` を async で await（スクリーンショット準備）

React Flow の `NodeResizer` はリサイズ座標を `onResize` / `onResizeEnd` コールバックで通知するため、DOM 直操作は不要になる。

## 設計方針（Phase 3 の教訓を踏まえた修正）

### NodeResizer vs NodeResizeControl

文書の旧案では `NodeResizeControl` を8方向分個別配置する方針だったが、**Phase 3（付箋）で `NodeResizer` の方が簡潔で実績あり**。WebPage も `NodeResizer` で統一する。
- `NodeResizer`: 全8方向を自動生成、`isVisible` で選択時のみ表示
- `NodeResizeControl`: 個別方向指定（不要な複雑さ）

### リアルタイム追従（controlled mode）

Phase 3 の Lesson #45 から、controlled mode では `onResize` コールバックで中間サイズを state に追跡しないとスナップバックが発生する。
**実装**: `stickyResizing` と同様の `webPageResizing: { nodeId, x, y, width, height } | null` state を追加し、`flowNodes` useMemo でリサイズ中のサイズを優先適用。

### Display Engine 接続（async 問題）

`usePageResize` は `beforeResizeStart()` を async で await してからリサイズ開始していた。`NodeResizer` の `onResizeStart` は同期コールバックのため await 不可。
**Phase 4 ドラッグと同じ fire-and-forget パターンを適用**:

```ts
onResizeStart={() => {
  void prepareInteractionStart('resize', id);
  handleInteractionChange(true, 'default', 'resize');
}}
```

## 作業内容

### 1. WebPageFlowNode に NodeResizer を配置

```tsx
export const WebPageFlowNode = memo(function WebPageFlowNode({ id, data, selected }: NodeProps) {
  const { nodeProps, onResize, onResizeEnd, onResizeStart, onResizeEndCallback, getZoom } =
    data as unknown as WebPageFlowNodeData;
  const zoom = getZoom();
  const minHeight = getNodeChromeHeight({ type: 'webpage' }, zoom) + MIN_CONTENT_HEIGHT;

  return (
    <div className="nopan">
      <NodeResizer
        isVisible={selected}
        minWidth={MIN_NODE_WIDTH}
        minHeight={minHeight}
        onResizeStart={onResizeStart}
        onResize={(_, params) => onResize(id, params)}
        onResizeEnd={(_, params) => onResizeEnd(id, params)}
      />
      <WebPageNode {...nodeProps} node={{ ...nodeProps.node, x: 0, y: 0 }} />
    </div>
  );
});
```

### 2. WebPageFlowNodeData 型拡張

```ts
export type WebPageFlowNodeData = {
  nodeProps: WebPageNodeProps;
  onResizeStart: () => void;
  onResize: (nodeId: string, params: ResizeParams) => void;
  onResizeEnd: (nodeId: string, params: ResizeParams) => void;
  getZoom: () => number;
};
```

### 3. Siteboard.tsx の統合

- `webPageResizing` state を追加（`stickyResizing` と同パターン）
- `handleWebPageResize` / `handleWebPageResizeEnd` コールバックを実装
- `flowNodes` useMemo で `webPageResizing` を優先適用
- `onResizeStart` で fire-and-forget + DisplayEngine 通知
- `onResizeEnd` で `updateNodeSize`（履歴あり）+ `setWebPageResizing(null)`

### 4. WebPageNode のリサイズハンドル削除

- `WebPageNode.tsx` から `NodeResizeHandle` の import と8方向レンダリングを削除
- `onResizeStart` prop を削除

### 5. e/w ハンドルの Webview 被り対策

現在の `NodeResizeHandle.tsx` は e/w ハンドルをノード外側に -4px 拡張して Webview に覆われないようにしている。`NodeResizer` ではハンドルの CSS カスタムで同等の対策が必要:

```css
/* NodeResizer の e/w ハンドルを外側に拡張 */
.react-flow__resize-control.handle.right,
.react-flow__resize-control.handle.left {
  width: 16px;
  transform: translateX(-50%); /* 外側に拡張 */
}
```

### 6. リサイズプリセット（BottomBar）

controlled mode では `flowNodes` useMemo がストアの値で上書きする。プリセットボタンは `updateNodeSize(activeId, nodeId, width, height)` でストアを更新するだけでよい（`flowNodes` が自動再計算される）。

### 7. useSiteboardViewportEngine / usePageResize の廃止

リサイズ処理が `NodeResizer` に移行したら:
- `usePageResize.ts` を削除
- `useSiteboardViewportEngine.ts` が空になるため削除

## 検証

- [ ] WebPageNode の8方向リサイズが動作する
- [ ] リサイズ中に Webview が screenshot モードに切り替わる（fire-and-forget で間に合う）
- [ ] リサイズ終了後に Webview が正しいサイズで native に復帰する
- [ ] リサイズ中の表示サイズがリアルタイムに追従する（スナップバックなし）
- [ ] e/w ハンドルが Webview に覆われずクリック可能
- [ ] リサイズプリセットボタン（モバイル/タブレット/PC）が動作する
- [ ] 最小サイズの制限が動作する（chrome 高さを含む動的計算）
- [ ] Undo/Redo がリサイズ後のサイズ変更で動作する
- [ ] 付箋のリサイズが引き続き正常動作（回帰なし）
- [ ] `npm run typecheck` / `npm run lint` 通過

## 廃止予定（このフェーズで削除）

- `src/hooks/usePageResize.ts`
- `src/components/Node/NodeResizeHandle.tsx`
- `src/hooks/siteboard/useSiteboardViewportEngine.ts`（空になるため）
