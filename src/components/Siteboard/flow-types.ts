import type {
  StickyNoteNode as StickyNoteNodeModel,
  WebPageNode as WebPageNodeModel,
} from '@/types';

import type { Edge, Node } from '@xyflow/react';

export interface PositionCorrectionAnimationData {
  token: number | null;
  fromX: number | null;
  fromY: number | null;
  toX: number | null;
  toY: number | null;
}

// ハンドラは SiteboardNodeHandlersContext 経由で取得するため data には含めない。
// data を node のみに絞ることで buildFlowNode が生成するオブジェクトの参照安定性を高め、
// ReactFlow の内部 shallow comparison による不要な再レンダリングを防ぐ。
export interface WebPageFlowNodeData extends Record<string, unknown> {
  node: WebPageNodeModel;
}

export interface StickyNoteFlowNodeData extends Record<string, unknown> {
  node: StickyNoteNodeModel;
}

export type SiteboardWebPageFlowNode = Node<WebPageFlowNodeData, 'webpage'>;
export type SiteboardStickyNoteFlowNode = Node<StickyNoteFlowNodeData, 'stickynote'>;
export type SiteboardFlowNode = SiteboardWebPageFlowNode | SiteboardStickyNoteFlowNode;
export type SiteboardFlowEdge = Edge<{ label?: string }>;
