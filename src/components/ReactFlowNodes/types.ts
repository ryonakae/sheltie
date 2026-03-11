import type { StickyNoteNode, WebPageNode } from '@/types';

import type { NodeTypes } from '@xyflow/react';

// WebPageFlowNode のデータ型（元の BoardNode WebPage フィールドをそのまま保持）
export type WebPageFlowNodeData = WebPageNode;

// StickyNoteFlowNode のデータ型（元の BoardNode StickyNote フィールドをそのまま保持）
export type StickyNoteFlowNodeData = StickyNoteNode;

/**
 * React Flow の nodeTypes 定数。
 * コンポーネント内で定義すると毎レンダーで全ノードが再マウントされるため、
 * 必ずモジュールスコープで定義すること。
 */
export const nodeTypes: NodeTypes = {
  webPageFlowNode: () => null,
  stickyNoteFlowNode: () => null,
};
