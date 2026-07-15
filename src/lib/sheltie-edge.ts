import type { BoardEdge, BoardEdgeStyle } from '@/types';

function endpointEquals(
  nodeA: string,
  handleA: string | null,
  nodeB: string,
  handleB: string | null,
): boolean {
  return nodeA === nodeB && handleA === handleB;
}

function hasSameDirection(a: BoardEdge, b: BoardEdge): boolean {
  return (
    endpointEquals(a.source, a.sourceHandle, b.source, b.sourceHandle) &&
    endpointEquals(a.target, a.targetHandle, b.target, b.targetHandle)
  );
}

export function hasSameUnorderedEndpoints(a: BoardEdge, b: BoardEdge): boolean {
  return (
    hasSameDirection(a, b) ||
    (endpointEquals(a.source, a.sourceHandle, b.target, b.targetHandle) &&
      endpointEquals(a.target, a.targetHandle, b.source, b.sourceHandle))
  );
}

export function addOrReplaceBoardEdge(edges: BoardEdge[], incoming: BoardEdge): BoardEdge[] | null {
  const index = edges.findIndex((edge) => hasSameUnorderedEndpoints(edge, incoming));
  if (index === -1) return [...edges, incoming];

  const existing = edges[index];
  const replacement: BoardEdge = {
    ...incoming,
    strokeWidth: existing.strokeWidth,
    lineStyle: existing.lineStyle,
    colorPreset: existing.colorPreset,
  };
  if (
    existing.id === replacement.id &&
    hasSameDirection(existing, replacement) &&
    existing.strokeWidth === replacement.strokeWidth &&
    existing.lineStyle === replacement.lineStyle &&
    existing.colorPreset === replacement.colorPreset
  ) {
    return null;
  }

  const next = [...edges];
  next[index] = replacement;
  return next;
}

export function updateBoardEdgeStyle(
  edges: BoardEdge[],
  edgeId: string,
  style: Partial<BoardEdgeStyle>,
): BoardEdge[] | null {
  const index = edges.findIndex((edge) => edge.id === edgeId);
  if (index === -1) return null;

  const current = edges[index];
  const updated = { ...current, ...style };
  if (
    updated.strokeWidth === current.strokeWidth &&
    updated.lineStyle === current.lineStyle &&
    updated.colorPreset === current.colorPreset
  ) {
    return null;
  }

  const next = [...edges];
  next[index] = updated;
  return next;
}

export function reverseBoardEdge(edges: BoardEdge[], edgeId: string): BoardEdge[] | null {
  const index = edges.findIndex((edge) => edge.id === edgeId);
  if (index === -1) return null;

  const current = edges[index];
  const next = [...edges];
  next[index] = {
    ...current,
    source: current.target,
    sourceHandle: current.targetHandle,
    target: current.source,
    targetHandle: current.sourceHandle,
  };
  return next;
}
