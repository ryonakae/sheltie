import { memo } from 'react';

import { StickyNoteNode } from '@/components/Node/StickyNoteNode';

import type { StickyNoteFlowNodeData } from './types';
import type { NodeProps } from '@xyflow/react';

/**
 * React Flow 用の StickyNoteNode ラッパー。
 * - nodrag / nopan: 既存 hook でドラッグ・パンを管理するため React Flow の機能を無効化
 * - React Flow がノード位置を管理するため node の x/y を 0 にオーバーライドする
 */
export const StickyNoteFlowNode = memo(function StickyNoteFlowNode({ data }: NodeProps) {
  const { nodeProps } = data as unknown as StickyNoteFlowNodeData;
  return (
    <div className="nopan">
      <StickyNoteNode {...nodeProps} node={{ ...nodeProps.node, x: 0, y: 0 }} />
    </div>
  );
});
