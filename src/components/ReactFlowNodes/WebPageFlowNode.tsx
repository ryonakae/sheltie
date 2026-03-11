import { memo } from 'react';

import { WebPageNode } from '@/components/Node/WebPageNode';

import type { WebPageFlowNodeData } from './types';
import type { NodeProps } from '@xyflow/react';

/**
 * React Flow 用の WebPageNode ラッパー。
 * - nodrag: React Flow のドラッグを無効化（既存 hook を使うため）
 * - nopan: ノード上でのパンを無効化
 * - React Flow がノード位置を管理するため node の x/y を 0 にオーバーライドする
 */
export const WebPageFlowNode = memo(function WebPageFlowNode({ data }: NodeProps) {
  const { nodeProps } = data as unknown as WebPageFlowNodeData;
  return (
    <div className="nopan">
      <WebPageNode {...nodeProps} node={{ ...nodeProps.node, x: 0, y: 0 }} />
    </div>
  );
});
