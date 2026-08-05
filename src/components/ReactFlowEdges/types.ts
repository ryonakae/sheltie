import type { BoardEdge, BoardEdgeStyle } from '@/types';

import type { Edge } from '@xyflow/react';

export type ArrowFlowEdgeData = {
  edge: BoardEdge;
  isActive: boolean;
  onStyleChange: (edgeId: string, style: Partial<BoardEdgeStyle>) => void;
  onReverse: (edgeId: string) => void;
};

export type ArrowFlowEdge = Edge<ArrowFlowEdgeData, 'default'>;
