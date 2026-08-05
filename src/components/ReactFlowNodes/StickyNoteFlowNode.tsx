import {
  NodeToolbar,
  Position,
  type NodeProps,
  type ResizeDragEvent,
  type ResizeParams,
} from '@xyflow/react';
import { memo, useCallback } from 'react';

import { StickyNoteNode } from '@/components/Node/StickyNoteNode';
import { NodeWidthResizeControls } from '@/components/ReactFlowNodes/NodeWidthResizeControls';
import { SelectionFrameOverlay } from '@/components/ReactFlowNodes/SelectionFrameOverlay';
import { StickyNoteToolbar } from '@/components/ReactFlowNodes/StickyNoteToolbar';
import { STICKY_NOTE_MIN_HEIGHT, STICKY_NOTE_MIN_WIDTH } from '@/constants';

import type { StickyNoteFlowNodeData } from './types';

/**
 * React Flow 用の StickyNoteNode ラッパー。
 * - NodeResizeControl: 左右辺 + 四隅のハンドルだけを表示し、左右の幅リサイズとして扱う
 *   - 高さは入力内容の自動調整に委譲し、選択枠の線は軽量オーバーレイで描く
 * - nopan: パン操作がノード内で起動しないよう制御
 * - dragHandle 不使用: 付箋はノード本体全体をドラッグ可能にする
 */
export const StickyNoteFlowNode = memo(function StickyNoteFlowNode({
  id,
  data,
  selected,
}: NodeProps) {
  const { nodeProps, onResize, onResizeEnd } = data as unknown as StickyNoteFlowNodeData;

  const handleResize = useCallback(
    (_event: ResizeDragEvent, params: ResizeParams) => {
      onResize(id, {
        ...params,
        width: Math.max(params.width, STICKY_NOTE_MIN_WIDTH),
        height: Math.max(nodeProps.node.height, STICKY_NOTE_MIN_HEIGHT),
      });
    },
    [id, nodeProps.node.height, onResize],
  );

  const handleResizeEnd = useCallback(
    (_event: ResizeDragEvent, params: ResizeParams) => {
      const bodyHeight = Math.max(nodeProps.node.height, STICKY_NOTE_MIN_HEIGHT);
      onResizeEnd(id, Math.max(params.width, STICKY_NOTE_MIN_WIDTH), bodyHeight);
    },
    [id, nodeProps.node.height, onResizeEnd],
  );

  return (
    <div className="nopan relative size-full">
      <NodeToolbar isVisible={!!selected && nodeProps.isActive} position={Position.Top}>
        <StickyNoteToolbar node={nodeProps.node} onStyleChange={nodeProps.onStyleChange} />
      </NodeToolbar>

      <StickyNoteNode {...nodeProps} node={{ ...nodeProps.node, x: 0, y: 0 }} />
      {selected && <SelectionFrameOverlay />}
      {/* 左右辺と四隅は FigJam 風の見た目に寄せつつ、実際の操作は左右幅リサイズだけに制限する */}
      {/* 複数選択中（isActive=false）はリサイズハンドルを出さない */}
      {nodeProps.isActive && (
        <NodeWidthResizeControls
          nodeId={id}
          minWidth={STICKY_NOTE_MIN_WIDTH}
          onResize={handleResize}
          onResizeEnd={handleResizeEnd}
        />
      )}
    </div>
  );
});
