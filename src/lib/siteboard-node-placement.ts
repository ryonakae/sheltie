import { getNodeFrameHeight, getNodeFrameRect } from '@/lib/siteboard-node-frame';
import { type BoardNode, isWebPageNode } from '@/types';

type Axis = 'x' | 'y';

interface ResolveDraggedNodePositionParams {
  nodes: BoardNode[];
  movingNode: BoardNode;
  proposedX: number;
  proposedY: number;
  gap: number;
  zoom: number;
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

function conflictsWithGap(
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
  zoom: number,
): number {
  const movingFrameHeight = getNodeFrameHeight(movingNode, zoom);
  const intervals = blockers.flatMap((blocker) => {
    const blockerRect = getNodeFrameRect(blocker, zoom);

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
          start: blockerRect.left - gap - movingNode.width,
          end: blockerRect.right + gap,
        },
      ];
    }

    const horizontalOverlap = rangesOverlapWithGap(
      proposedX,
      proposedX + movingNode.width,
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

export function resolveDraggedNodePosition({
  nodes,
  movingNode,
  proposedX,
  proposedY,
  gap,
  zoom,
}: ResolveDraggedNodePositionParams): ResolvedDraggedNodePosition {
  const blockers = getBlockingNodes(nodes, movingNode);
  const movingFrameHeight = getNodeFrameHeight(movingNode, zoom);
  const hasConflict = blockers.some((blocker) => {
    const blockerRect = getNodeFrameRect(blocker, zoom);
    return conflictsWithGap(
      proposedX,
      proposedY,
      movingNode.width,
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

  const resolvedX = resolveAxisCoordinate(
    'x',
    blockers,
    movingNode,
    proposedX,
    proposedY,
    gap,
    zoom,
  );
  const resolvedY = resolveAxisCoordinate(
    'y',
    blockers,
    movingNode,
    proposedX,
    proposedY,
    gap,
    zoom,
  );
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
