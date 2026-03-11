# フェーズ 2: Display Engine を React Flow イベントに接続

## 目的

Webview の show/hide/screenshot 制御（Display Engine）を、React Flow のビューポートイベントから駆動するように変更する。
コアロジック（`computeDisplayModes` / `computeInteractionModes` / スクリーンショット管理）は**一切変更しない**。変更するのは「誰がいつこれらを呼ぶか」だけ。

## 背景: 現在の呼び出し構造

現在、Display Engine のトリガーは `useSiteboardViewportEngine` 経由で行われている:

| イベント | 現在のトリガー | 置き換え先 |
|---|---|---|
| pan/zoom 開始 | `useSiteboardPan` / `useSiteboardZoom` の mousedown/wheel | `onMoveStart` |
| pan/zoom 中 | `scheduleInteractionUpdate` (rAF ループ) | `onMove` 内で rAF スケジュール |
| pan/zoom 終了 | mouseup / wheel timeout | `onMoveEnd` |
| ドラッグ開始 | `usePageDrag` の mousedown | `onNodeDragStart`（フェーズ4で対応） |
| リサイズ開始/終了 | `usePageResize` のハンドラー | `NodeResizeControl` イベント（フェーズ5で対応） |

## 作業内容

### 1. pan/zoom イベントの接続

```ts
// Siteboard.tsx

const handleMoveStart = useCallback((_event: ReactMouseEvent | TouchEvent, viewport: Viewport) => {
  const isPan = true; // zoom も onMoveStart で来る（viewport を比較して区別可能）
  void prepareInteractionStart(isPan ? 'pan' : 'zoom');
  handleInteractionChange(true, 'grabbing', isPan ? 'pan' : 'zoom');
}, [prepareInteractionStart, handleInteractionChange]);

const handleMove = useCallback((_event: ReactMouseEvent | TouchEvent, viewport: Viewport) => {
  // zoomRef を最新値に同期
  zoomRef.current = viewport.zoom;
  // Display Engine の rAF ループを駆動
  scheduleInteractionUpdate();
  // pan専用最適化（zoom変化なし）か zoom かを判定してバッチ更新
  computeInteractionModes();
}, [scheduleInteractionUpdate, computeInteractionModes]);

const handleMoveEnd = useCallback((_event: ReactMouseEvent | TouchEvent) => {
  handleInteractionChange(false);
  scheduleZoomRestoreAfterReflow();
}, [handleInteractionChange, scheduleZoomRestoreAfterReflow]);
```

### 2. zoom 操作か pan 操作かの区別

`onMoveStart` では pan と zoom が区別できない。Display Engine は操作タイプを `InteractionType`（`'pan'` / `'zoom'`）で受け取るが、React Flow では以下で区別できる:

- `onViewportChange` で前回の zoom と現在の zoom を比較する
- もしくは `InteractionType` を細かく区別せず `'pan' | 'zoom'` を統合して扱う形に Display Engine 側を緩和する

> **判断**: 現状の Display Engine は `pan` と `zoom` で挙動が異なる部分がある（`updateAllPositions` vs `updateAllBounds`）。`onViewportChange` の zoom 差分で判定するのが現実的。

### 3. containerRef の接続確認

`computeDisplayModes` / `computeInteractionModes` は `containerRef.current.getBoundingClientRect()` でビューポート矩形を取得する。`containerRef` を `<ReactFlow>` の外側コンテナ div に正しく渡せているかを確認する。

### 4. canvasRef の廃止

現在 `display-engine/dom.ts` の `getWebPageElements()` は `canvasRef.current` から `[data-node-id]` を検索している。React Flow に移行すると canvasRef がなくなるため、`containerRef` 内の `.react-flow__nodes` コンテナ、または `data-node-id` 属性が付いている要素を直接検索するように変更する。

```ts
// 変更前
const nodeEls = canvasRef.querySelectorAll('[data-node-id]');

// 変更後
const nodeEls = containerRef.querySelectorAll('[data-node-id]');
```

React Flow のカスタムノード内に `data-node-id` 属性を引き続き付与していれば、クエリはそのまま動作する。

### 5. `--canvas-zoom` の同期タイミング

フェーズ 1 で `onViewportChange` 内で `--canvas-zoom` を更新している。Display Engine の `computeInteractionModes` が呼ばれる時点で既に最新値が設定されていることを確認する。

## 検証

- [ ] pan 中に Webview が native → screenshot → hidden と遷移する
- [ ] zoom 中に display mode が正しく遷移する
- [ ] 操作終了後に Webview が native に復帰する（macOS: opacity フェードイン付き）
- [ ] スクリーンショットの撮影・キャッシュが動作する
- [ ] Webview の位置同期が pan 中にリアルタイムで追従する（`updateAllPositions` の batch IPC）
- [ ] zoom 中の Webview サイズ同期が動作する（`updateAllBounds` の batch IPC）
- [ ] `prepareInteractionStart` によるプリキャプチャが動作する
- [ ] 定期リフレッシュ（2000ms）が動作する
- [ ] macOS の白フラッシュ回避（opacity 遷移）が動作する

## 次フェーズへの依存

フェーズ 3 以降でドラッグ/リサイズを React Flow ネイティブに移行する際、`onNodeDragStart` / `onNodeDragStop` から `handleInteractionChange(true/false, ...)` を呼ぶことでこのフェーズで確立したパターンを再利用する。
