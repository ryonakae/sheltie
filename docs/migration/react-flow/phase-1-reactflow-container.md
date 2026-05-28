# フェーズ 1: ReactFlow コンテナに切り替え（pan/zoom のみ移行）

## 目的

独自 canvas（`canvasRef` + CSS transform）を `<ReactFlow>` に置き換える。
ノードの描画はラッパー経由で既存コンポーネントをそのまま使い、ドラッグ・リサイズは既存 hook のまま維持する。

pan/zoom の動作を先に検証できることがこのフェーズの価値。

## 作業内容

### 1. 薄いカスタムノードラッパーの作成

**新規ファイル: `src/components/ReactFlowNodes/WebPageFlowNode.tsx`**

```tsx
// 既存の WebPageNode をそのまま内包する薄いラッパー
export const WebPageFlowNode = memo(({ data }: NodeProps<WebPageFlowNodeData>) => {
  return (
    // nodrag: React Flow のドラッグを無効化（既存 hook を使うため）
    // nopan: ノード上でのパンを無効化
    <div className="nodrag nopan">
      <WebPageNode {...data.nodeProps} />
    </div>
  );
});
```

**新規ファイル: `src/components/ReactFlowNodes/StickyNoteFlowNode.tsx`**

```tsx
export const StickyNoteFlowNode = memo(({ data }: NodeProps<StickyNoteFlowNodeData>) => {
  return (
    <div className="nodrag nopan">
      <StickyNoteNode {...data.nodeProps} />
    </div>
  );
});
```

### 2. Siteboard.tsx の改修

`canvasRef` div を `<ReactFlowProvider>` + `<ReactFlow>` に置き換える。

```tsx
<ReactFlowProvider>
  <div ref={containerRef} data-siteboard-container className="...">
    <ReactFlow
      nodes={boardNodesToFlowNodes(nodes, zoomRef.current)}
      nodeTypes={nodeTypes}
      onNodesChange={handleNodesChange}
      onViewportChange={handleViewportChange}
      onMoveStart={handleMoveStart}
      onMoveEnd={handleMoveEnd}
      onMove={handleMove}
      defaultViewport={activeProject?.viewport
        ? { x: activeProject.viewport.panX, y: activeProject.viewport.panY, zoom: activeProject.viewport.zoom }
        : { x: 0, y: 0, zoom: 1 }
      }
      panOnDrag={[1, 2]}         // ミドルクリック + 右クリック or [1] のみ
      panOnScroll={false}        // ホイールはズームに使う
      zoomOnScroll={true}
      zoomOnPinch={true}
      zoomOnDoubleClick={false}
      minZoom={0.1}
      maxZoom={3}
      onlyRenderVisibleElements={false}  // Webview 対策: 仮想化を無効化
      nodesDraggable={false}             // フェーズ1ではまだ無効（既存 hook を使う）
      nodesConnectable={false}
      edgesFocusable={false}
      proOptions={{ hideAttribution: true }}
    >
      <FloatingToolbar ... />
      <ZoomIndicator zoom={uiZoom} onReset={handleResetZoom} />
    </ReactFlow>
  </div>
</ReactFlowProvider>
```

> **注意**: `panOnDrag={[1, 2]}` はミドルクリック(1) + 右クリック(2)。Space + 左クリックはカスタム実装が必要な場合がある（`panActivationKeyCode="Space"` prop で対応可能）。

### 3. ビューポート処理の差し替え

**廃止**: `useSiteboardPan.ts` / `useSiteboardZoom.ts`

**代替**: React Flow のイベントコールバックで処理する。

```ts
const handleViewportChange = useCallback((viewport: Viewport) => {
  // zoomRef を最新値に同期
  zoomRef.current = viewport.zoom;
  panXRef.current = viewport.x;
  panYRef.current = viewport.y;

  // --canvas-zoom CSS 変数を同期（zoomPx() が引き続き動作する）
  containerRef.current?.style.setProperty('--canvas-zoom', String(viewport.zoom));

  // ビューポートを永続化（debounce 付き）
  debouncedUpdateViewport({ zoom: viewport.zoom, panX: viewport.x, panY: viewport.y });
}, [...]);

const handleResetZoom = useCallback(() => {
  reactFlowInstance.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 300 });
}, [reactFlowInstance]);
```

### 4. useSiteboardViewportEngine の一時的な対応

`useSiteboardViewportEngine` は `startDrag` / `startResize` / `startStickyNoteResize` を `useSiteboardNodeRuntime` に提供している。フェーズ1では:
- pan/zoom 関連コードを削除
- drag/resize 関連コード（`usePageDrag`, `usePageResize` の呼び出し）はそのまま維持
- `applyCanvasTransform()` は不要になる（React Flow が transform を管理）

### 5. Space + ドラッグのパン操作

React Flow は `panActivationKeyCode` prop を提供している:

```tsx
<ReactFlow panActivationKeyCode="Space" panOnDrag={[0, 1]} ... />
```

これで Space を押しながら左クリックドラッグでパンが有効になる。

## 検証

- [ ] ホイールでズームが動作する
- [ ] ピンチでズームが動作する
- [ ] ミドルクリック + ドラッグでパンが動作する
- [ ] Space + ドラッグでパンが動作する
- [ ] ノードが正しい位置に描画される
- [ ] `zoomPx()` によるズーム補正 UI が正常（タイトルバーのサイズ等）
- [ ] ZoomIndicator の値が現在のズーム倍率と一致する
- [ ] ズームリセット（100%）が動作する
- [ ] ビューポートが閉じて開いて正しく復元される
- [ ] **ノードのドラッグが既存通り動作**（React Flow ネイティブではなく既存 hook）
- [ ] **ノードのリサイズが既存通り動作**
- [ ] WebPageNode の Webview が正しい位置に表示される
- [ ] `npm run typecheck` / `npm run lint` 通過

## 次フェーズへの依存

フェーズ 2 では `onMoveStart` / `onMove` / `onMoveEnd` を使って Display Engine を接続する。このフェーズで React Flow のイベントコールバック構造を確立しておく。

## 廃止予定（このフェーズで削除）

- `src/hooks/useSiteboardPan.ts`
- `src/hooks/useSiteboardZoom.ts`
- `useSiteboardViewportEngine` 内の `applyCanvasTransform()` および pan/zoom 処理
