import { getNodeFrameHeight, getNodeFrameRect, getNodeFrameWidth } from '@/lib/sheltie-node-frame';
import { type BoardNode, isWebPageNode } from '@/types';

type Axis = 'x' | 'y';

interface ResolveDraggedNodePositionParams {
  nodes: BoardNode[];
  movingNode: BoardNode;
  proposedX: number;
  proposedY: number;
  gap: number;
}

interface Interval {
  start: number;
  end: number;
}

export interface ResolvedDraggedNodePosition {
  x: number;
  y: number;
  corrected: boolean;
  axis: Axis | null;
}

function rangesOverlapWithGap(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
  gap: number,
): boolean {
  return !(endA + gap <= startB || endB + gap <= startA);
}

export function conflictsWithGap(
  leftA: number,
  topA: number,
  widthA: number,
  heightA: number,
  leftB: number,
  topB: number,
  widthB: number,
  heightB: number,
  gap: number,
): boolean {
  return !(
    leftA + widthA + gap <= leftB ||
    leftB + widthB + gap <= leftA ||
    topA + heightA + gap <= topB ||
    topB + heightB + gap <= topA
  );
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length <= 1) return intervals;

  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const next = sorted[index];
    const current = merged[merged.length - 1];

    if (next.start < current.end) {
      current.end = Math.max(current.end, next.end);
      continue;
    }

    merged.push(next);
  }

  return merged;
}

function findNearestAllowedCoordinate(initial: number, intervals: Interval[]): number {
  for (const interval of mergeIntervals(intervals)) {
    if (initial <= interval.start || initial >= interval.end) {
      continue;
    }

    const distanceToStart = Math.abs(initial - interval.start);
    const distanceToEnd = Math.abs(interval.end - initial);
    return distanceToEnd < distanceToStart ? interval.end : interval.start;
  }

  return initial;
}

function getBlockingNodes(nodes: BoardNode[], movingNode: BoardNode): BoardNode[] {
  if (isWebPageNode(movingNode)) {
    return nodes.filter((node) => node.id !== movingNode.id);
  }

  return nodes.filter((node) => node.id !== movingNode.id && isWebPageNode(node));
}

function resolveAxisCoordinate(
  axis: Axis,
  blockers: BoardNode[],
  movingNode: BoardNode,
  proposedX: number,
  proposedY: number,
  gap: number,
): number {
  const movingFrameWidth = getNodeFrameWidth(movingNode);
  const movingFrameHeight = getNodeFrameHeight(movingNode);
  const intervals = blockers.flatMap((blocker) => {
    const blockerRect = getNodeFrameRect(blocker);

    if (axis === 'x') {
      const verticalOverlap = rangesOverlapWithGap(
        proposedY,
        proposedY + movingFrameHeight,
        blockerRect.top,
        blockerRect.bottom,
        gap,
      );
      if (!verticalOverlap) return [];

      return [
        {
          start: blockerRect.left - gap - movingFrameWidth,
          end: blockerRect.right + gap,
        },
      ];
    }

    const horizontalOverlap = rangesOverlapWithGap(
      proposedX,
      proposedX + movingFrameWidth,
      blockerRect.left,
      blockerRect.right,
      gap,
    );
    if (!horizontalOverlap) return [];

    return [
      {
        start: blockerRect.top - gap - movingFrameHeight,
        end: blockerRect.bottom + gap,
      },
    ];
  });

  return findNearestAllowedCoordinate(axis === 'x' ? proposedX : proposedY, intervals);
}

/**
 * ノード群を剛体のまま平行移動したときの衝突判定。
 * Webview は重ねられないため webpage は既存全ノードと、付箋/テキストは既存 webpage とだけ
 * gap 制約を持つ。群の内部どうしは元のレイアウトが正しい前提で判定しない。
 */
function hasGroupPlacementConflict(
  existingNodes: BoardNode[],
  groupNodes: BoardNode[],
  dx: number,
  dy: number,
  gap: number,
): boolean {
  return groupNodes.some((groupNode) => {
    const groupRect = getNodeFrameRect({ ...groupNode, x: groupNode.x + dx, y: groupNode.y + dy });
    return existingNodes.some((existing) => {
      if (!isWebPageNode(groupNode) && !isWebPageNode(existing)) return false;
      const existingRect = getNodeFrameRect(existing);
      return conflictsWithGap(
        groupRect.left,
        groupRect.top,
        groupRect.width,
        groupRect.height,
        existingRect.left,
        existingRect.top,
        existingRect.width,
        existingRect.height,
        gap,
      );
    });
  });
}

/**
 * 配置したいノード群（既に希望位置にあるもの）を、既存ノードと重ならない位置まで
 * 右下対角へ gap 刻みでずらすオフセットを返す。群全体を同じだけ動かすので相対レイアウトは保たれる。
 * 既存ノードの範囲は有限なので、右下へ進み続ければ必ず衝突が消えて停止する。
 */
export function resolveNonOverlappingGroupOffset(
  existingNodes: BoardNode[],
  groupNodes: BoardNode[],
  gap: number,
): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  while (hasGroupPlacementConflict(existingNodes, groupNodes, dx, dy, gap)) {
    dx += gap;
    dy += gap;
  }
  return { dx, dy };
}

export function resolveDraggedNodePosition({
  nodes,
  movingNode,
  proposedX,
  proposedY,
  gap,
}: ResolveDraggedNodePositionParams): ResolvedDraggedNodePosition {
  const blockers = getBlockingNodes(nodes, movingNode);
  const movingFrameWidth = getNodeFrameWidth(movingNode);
  const movingFrameHeight = getNodeFrameHeight(movingNode);
  const hasConflict = blockers.some((blocker) => {
    const blockerRect = getNodeFrameRect(blocker);
    return conflictsWithGap(
      proposedX,
      proposedY,
      movingFrameWidth,
      movingFrameHeight,
      blockerRect.left,
      blockerRect.top,
      blockerRect.width,
      blockerRect.height,
      gap,
    );
  });

  if (!hasConflict) {
    return { x: proposedX, y: proposedY, corrected: false, axis: null };
  }

  const resolvedX = resolveAxisCoordinate('x', blockers, movingNode, proposedX, proposedY, gap);
  const resolvedY = resolveAxisCoordinate('y', blockers, movingNode, proposedX, proposedY, gap);
  const deltaX = Math.abs(resolvedX - proposedX);
  const deltaY = Math.abs(resolvedY - proposedY);

  if (deltaX <= deltaY) {
    return {
      x: resolvedX,
      y: proposedY,
      corrected: resolvedX !== proposedX,
      axis: resolvedX !== proposedX ? 'x' : null,
    };
  }

  return {
    x: proposedX,
    y: resolvedY,
    corrected: resolvedY !== proposedY,
    axis: resolvedY !== proposedY ? 'y' : null,
  };
}
