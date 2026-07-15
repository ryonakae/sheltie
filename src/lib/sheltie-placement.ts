import { MAX_VERTICAL_SEARCH_STEPS, PAGE_GAP } from '@/constants';
import { getNodeFrameHeight, getNodeFrameRect, getNodeFrameWidth } from '@/lib/sheltie-node-frame';
import type { BoardNode } from '@/types';

export function isVerticalOverlapping(
  y: number,
  h: number,
  node: Pick<BoardNode, 'y' | 'height'>,
): boolean {
  return !(y + h <= node.y || node.y + node.height <= y);
}

export function isHorizontalOverlapping(
  x: number,
  w: number,
  node: Pick<BoardNode, 'x' | 'width'>,
): boolean {
  return !(x + w <= node.x || node.x + node.width <= x);
}

/**
 * 既存ノードと重ならない配置位置を探索する。
 * フレーム外周（getNodeFrameRect）基準で判定し、見つからなければ最下段の下に積む。
 */
export function findNonOverlappingPosition(
  nodes: BoardNode[],
  type: BoardNode['type'],
  x: number,
  y: number,
  width: number,
  height: number,
  options?: { keepY?: boolean },
): { x: number; y: number } {
  const existingRects = nodes.map((node) => getNodeFrameRect(node));
  const candidateFrameHeight = getNodeFrameHeight({ type, height });
  const candidateFrameWidth = getNodeFrameWidth({ type, width });

  if (nodes.length === 0) {
    return { x, y };
  }

  for (let step = 0; step <= MAX_VERTICAL_SEARCH_STEPS; step++) {
    const yCandidates = step === 0 ? [0] : [step * PAGE_GAP, -step * PAGE_GAP];
    for (const yOffset of yCandidates) {
      const candidateY = y + yOffset;
      if (options?.keepY) {
        const sameRowNodes = existingRects.filter((node) =>
          isVerticalOverlapping(candidateY, candidateFrameHeight, node),
        );
        let candidateX = x;
        while (true) {
          const overlapNodes = sameRowNodes.filter((node) =>
            isHorizontalOverlapping(candidateX, candidateFrameWidth, node),
          );
          if (overlapNodes.length === 0) {
            return { x: candidateX, y: candidateY };
          }

          const rightmost = Math.max(...overlapNodes.map((node) => node.x + node.width));
          candidateX = rightmost + PAGE_GAP;
        }
      }

      const sameRowNodes = existingRects.filter((node) =>
        isVerticalOverlapping(candidateY, candidateFrameHeight, node),
      );

      if (sameRowNodes.length === 0) {
        return { x, y: candidateY };
      }

      let candidateX = x;
      while (true) {
        const overlapNodes = sameRowNodes.filter((node) =>
          isHorizontalOverlapping(candidateX, candidateFrameWidth, node),
        );
        if (overlapNodes.length === 0) {
          return { x: candidateX, y: candidateY };
        }

        const rightmost = Math.max(...overlapNodes.map((node) => node.x + node.width));
        candidateX = rightmost + PAGE_GAP;
      }
    }
  }

  const fallbackY = Math.max(...existingRects.map((node) => node.bottom)) + PAGE_GAP;
  return { x, y: fallbackY };
}
