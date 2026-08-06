import { getNodeFrameRect } from '@/lib/sheltie-node-frame';
import { conflictsWithGap } from '@/lib/sheltie-node-placement';
import type { BoardNode, Viewport } from '@/types';
import { isWebPageNode } from '@/types';

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

/**
 * 貼り付けノード群（元座標のまま）を剛体として平行移動したときの衝突判定。
 * Webview は重ねられないため webpage は既存全ノードと、付箋/テキストは既存 webpage とだけ gap 制約を持つ。
 */
function hasPlacementConflict(
  existingNodes: BoardNode[],
  pastedNodes: BoardNode[],
  dx: number,
  dy: number,
  gap: number,
): boolean {
  return pastedNodes.some((pasted) => {
    const pastedRect = getNodeFrameRect({ ...pasted, x: pasted.x + dx, y: pasted.y + dy });
    return existingNodes.some((existing) => {
      if (!isWebPageNode(pasted) && !isWebPageNode(existing)) return false;
      const existingRect = getNodeFrameRect(existing);
      return conflictsWithGap(
        pastedRect.left,
        pastedRect.top,
        pastedRect.width,
        pastedRect.height,
        existingRect.left,
        existingRect.top,
        existingRect.width,
        existingRect.height,
        gap,
      );
    });
  });
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

  let dx = targetX - pastedBounds.x;
  let dy = targetY - pastedBounds.y;
  // 既存ノードの範囲は有限なので、右下対角へ進み続ければ必ず衝突が消えて停止する
  while (hasPlacementConflict(existingNodes, pastedNodes, dx, dy, gap)) {
    dx += gap;
    dy += gap;
  }

  return pastedNodes.map((node) => ({ nodeId: node.id, x: node.x + dx, y: node.y + dy }));
}
