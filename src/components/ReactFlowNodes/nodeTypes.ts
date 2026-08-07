import { GhostFlowNode } from './GhostFlowNode';
import { StickyNoteFlowNode } from './StickyNoteFlowNode';
import { TextFlowNode } from './TextFlowNode';
import { WebPageFlowNode } from './WebPageFlowNode';

import type { NodeTypes } from '@xyflow/react';

/**
 * React Flow の nodeTypes 定数。
 * コンポーネント内で定義すると毎レンダーで全ノードが再マウントされるため、
 * 必ずモジュールスコープで定義すること。
 */
export const nodeTypes: NodeTypes = {
  webPageFlowNode: WebPageFlowNode,
  stickyNoteFlowNode: StickyNoteFlowNode,
  textFlowNode: TextFlowNode,
  ghost: GhostFlowNode,
};
