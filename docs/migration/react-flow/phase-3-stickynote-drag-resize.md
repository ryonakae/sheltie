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

- [x] 付箋のドラッグが正常動作する（React Flow ネイティブ）
- [x] 付箋のリサイズが動作する（最小サイズ 150x150）
- [x] 付箋の textarea 編集中にノードがドラッグされない
- [x] 付箋の色切り替えボタンがドラッグを発火させない
- [x] ドラッグ後に Zustand ストアの座標が更新される
- [x] Undo/Redo が付箋の位置/サイズ変更で動作する
- [x] **WebPageNode のドラッグ/リサイズは既存通り動作（回帰なし）**
- [x] `npm run typecheck` / `npm run lint` 通過

## 完了（2026-03-13）

### 実装内容

- `StickyNoteNode.tsx` リファクタリング:
  - `motion.div layout="position"` を `div` に変更（Framer Motion との位置競合を解消）
  - ルート要素に `size-full` を追加（NodeResizer のラッパーに追従するレスポンシブ化）
  - body エリアを `flex-1 w-full` に変更
  - content measure div を `width: '100%'` に変更

- `StickyNoteFlowNode.tsx` 改修:
  - `getZoom: () => number` を `data` から受け取り
  - `minHeight` を動的計算：`STICKY_NOTE_HEADER_HEIGHT / zoom + STICKY_NOTE_MIN_HEIGHT`
  - `onResizeEnd` で全体高さ → ボディ高さへ変換（ヘッダー分 `STICKY_NOTE_HEADER_HEIGHT / zoom` を引く）
  - ラッパーに `size-full` を追加

- `StickyNoteFlowNodeData` 型拡張:
  - `getZoom: () => number` を追加

- `Siteboard.tsx` 統合:
  - `rfMeasured` state を追加（React Flow の ResizeObserver 測定結果を保持）
  - `handleNodesChange` で `NodeDimensionChange` を追跡して `rfMeasured` を更新
  - `flowNodes` の両ノード型に `selected: node.id === selectedNodeId` を明示的に設定
  - 付箋 flow node の `style` プロパティを削除（NodeResizer がサイズ制御するため）
  - 各ノードに `measured: rfMeasured[node.id]` を付与
  - `getZoom` を `StickyNoteFlowNodeData` に渡す

### Lessons Learned（フェーズ 3B 修正）

**#40: React Flow controlled mode でのノード初期化**
- React Flow は ResizeObserver でノードを測定し `onNodesChange` で `dimensions` タイプの変更を通知する。
- 若し `handleNodesChange` が dimension 変更を無視すると、ノードが「未初期化」状態のままになり、ドラッグが機能しない。
- 解決策: `onNodesChange` で `dimensions` 変更を追跡し、`rfMeasured` state に保存。`flowNodes` の各ノードの `measured` プロパティに付与する。

**#41: Framer Motion `layout="position"` と React Flow の競合**
- React Flow はノード位置を `.react-flow__node` の CSS transform で管理する。
- `motion.div layout="position"` は位置変化を検知して逆方向へのスプリングアニメーション（レイアウトシフト補正）を適用する。
- 結果: ドラッグ方向が反転し、移動にスプリングアニメーションがつく。
- 解決策: React Flow ノードコンポーネント内では `layout` prop を使用しない。`motion.div layout="position"` は Canvas や外側の UI には使用可（ノード外）。

**#42: NodeResizer と内部コンテンツのサイズ同期**
- NodeResizer はラッパー（`.react-flow__node`）のサイズを制御する。
- 内部コンテンツが `width`/`height` を固定値で指定していると、ラッパーのリサイズに追従しない。
- 解決策: 内部コンポーネント（`StickyNoteNode`）のルート要素と body を `size-full` + `flex-1` でレスポンシブ化。

**#43: NodeResizer でのヘッダー高さ変換**
- `Page` ストアに保存される `node.height` はボディ高さ（`contentHeight`）。
- Flow node の全体高さ = `header(STICKY_NOTE_HEADER_HEIGHT / zoom) + body(node.height)`
- `NodeResizer` の `onResizeEnd` が返す `params.height` は **全体高さ** である。
- ストアに保存する際は ボディ高さ = `params.height - STICKY_NOTE_HEADER_HEIGHT / zoom` に変換してから `updateNodeSize()` を呼ぶ必要がある。

**#44: React Flow controlled mode での `selected` プロパティ明示**
- React Flow の controlled mode では `flowNodes` 配列の各ノードに `selected: boolean` を明示的に設定しないと、NodeResizer の `isVisible={selected}` が常に `false` になる。
- 結果: ノードを選択してもリサイズハンドルが表示されない。
- 解決策: `flowNodes` 構築時に `selected: node.id === selectedNodeId` を必ず設定する。

**#45: React Flow controlled mode でのリアルタイムリサイズ追従（フェーズ 3C 修正）**
- React Flow の controlled mode では `nodes` prop が単一の真実源。NodeResizer はドラッグ中に DOM を直接変更するが、`flowNodes` useMemo が再計算されるとストアの値（未更新）で上書きされ、元のサイズにスナップバックしていた。
- **根本原因**: `onResizeEnd` のみをコールバックとして使用していたため、ドラッグ中の中間状態が追跡されていなかった。
- 解決策:
  1. `StickyNoteFlowNodeData` に `onResize: (nodeId, params) => void` コールバックを追加（`onResizeEnd` と並行）。
  2. `StickyNoteFlowNode` の `NodeResizer` に `onResize={handleResize}` を付与。毎フレームの `ResizeParams { x, y, width, height }` を捕捉。
  3. `Siteboard.tsx` に `stickyResizing: { nodeId, x, y, width, height } | null` state を追加。`handleStickyNoteResize` でこれを更新。
  4. `flowNodes` useMemo で `stickyResizing` が `null` でなければそのデータを優先適用。位置・幅・高さ全てをリアルタイム反映。
  5. `handleStickyNoteResizeEnd` で `setStickyResizing(null)` を呼ぶことで中間状態をクリア。
- **上辺・左辺リサイズの位置追従**: `ResizeParams` の `x, y` はリサイズ後のノード位置を含む。位置も中間状態として保持し `flowNodes` の `position` に反映しないと、上辺・左辺からのリサイズで位置がずれる。

**#46: React Flow NodeResizer と独自フォーカス outline の競合（フェーズ 3D 修正）**
- React Flow 移行前は付箋に CSS `outline: isActive ? ... : 'none'` でフォーカス時の枠線を表示していた。
- React Flow の `NodeResizer` 移行後は `isVisible={selected}` で選択時に自動的に青いリサイズハンドル（8方向）を表示するようになった。
- 結果: 独自 `outline` と NodeResizer ハンドルが重複して表示される（二重フォーカス表示）。
- **解決策**: 独自 `outline` スタイルを削除。ノード選択の視覚的フィードバックを NodeResizer ハンドルのみに統一する。
- **背景**: React Flow では選択状態の UI 表現が NodeResizer に集約されるため、コンポーネント側での独自フォーカス表示は不要。

### 廃止済み

- 付箋に対する `usePageDrag` / `usePageResize` の呼び出し（WebPageNode 用はまだ維持）
- 付箋のルート `motion.div layout="position"` と CSS `width` / `height` スタイル（React Flow の `size-full` + `flex-1` で置き換え）
- 付箋の独自 8方向リサイズハンドル（`NodeResizeHandle` コンポーネント）
- 付箋の CSS `outline: isActive ? ... : 'none'`（NodeResizer のハンドル表示に統一）
