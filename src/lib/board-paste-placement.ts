import { getNodeFrameRect } from '@/lib/sheltie-node-frame';
import { resolveNonOverlappingGroupOffset } from '@/lib/sheltie-node-placement';
import type { BoardNode, Viewport } from '@/types';

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getViewportWorldRect(
  viewport: Viewport,
  containerWidth: number,
  containerHeight: number,
): WorldRect {
  return {
    x: -viewport.panX / viewport.zoom,
    y: -viewport.panY / viewport.zoom,
    width: containerWidth / viewport.zoom,
    height: containerHeight / viewport.zoom,
  };
}

function rectsIntersect(a: WorldRect, b: WorldRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function getNodesFrameBounds(
  nodes: ReadonlyArray<Pick<BoardNode, 'type' | 'x' | 'y' | 'width' | 'height'>>,
): WorldRect | null {
  if (nodes.length === 0) return null;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    const rect = getNodeFrameRect(node);
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export interface ResolvePastePlacementParams {
  existingNodes: BoardNode[];
  pastedNodes: BoardNode[];
  sourceNodeIds: readonly string[];
  lastPastedNodeIds: readonly string[];
  viewportRect: WorldRect;
  gap: number;
}

export function resolvePastePlacement({
  existingNodes,
  pastedNodes,
  sourceNodeIds,
  lastPastedNodeIds,
  viewportRect,
  gap,
}: ResolvePastePlacementParams): Array<{ nodeId: string; x: number; y: number }> {
  const pastedBounds = getNodesFrameBounds(pastedNodes);
  if (!pastedBounds) return [];

  const lastPastedIdSet = new Set(lastPastedNodeIds);
  const sourceIdSet = new Set(sourceNodeIds);
  const lastPastedBounds = getNodesFrameBounds(
    existingNodes.filter((node) => lastPastedIdSet.has(node.id)),
  );
  const sourceBounds = getNodesFrameBounds(
    existingNodes.filter((node) => sourceIdSet.has(node.id)),
  );

  let targetX: number;
  let targetY: number;
  if (lastPastedBounds && rectsIntersect(lastPastedBounds, viewportRect)) {
    targetX = lastPastedBounds.x + gap;
    targetY = lastPastedBounds.y + gap;
  } else if (sourceBounds && rectsIntersect(sourceBounds, viewportRect)) {
    targetX = sourceBounds.x + gap;
    targetY = sourceBounds.y + gap;
  } else if (rectsIntersect(pastedBounds, viewportRect)) {
    // Cut / 削除済みの元座標が見えているなら、その場所へ「戻す」
    targetX = pastedBounds.x;
    targetY = pastedBounds.y;
  } else {
    targetX = viewportRect.x + (viewportRect.width - pastedBounds.width) / 2;
    targetY = viewportRect.y + (viewportRect.height - pastedBounds.height) / 2;
  }

  const anchorDx = targetX - pastedBounds.x;
  const anchorDy = targetY - pastedBounds.y;
  const anchoredNodes = pastedNodes.map((node) => ({
    ...node,
    x: node.x + anchorDx,
    y: node.y + anchorDy,
  }));
  const { dx, dy } = resolveNonOverlappingGroupOffset(existingNodes, anchoredNodes, gap);

  return anchoredNodes.map((node) => ({ nodeId: node.id, x: node.x + dx, y: node.y + dy }));
}
