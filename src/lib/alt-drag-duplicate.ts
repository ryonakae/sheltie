import { DRAG_REPOSITION_GAP } from '@/constants';
import {
  resolveDraggedNodePosition,
  resolveNonOverlappingGroupOffset,
} from '@/lib/sheltie-node-placement';
import type { BoardEdge, BoardNode } from '@/types';

export interface BuildAltDragDuplicateParams {
  nodes: BoardNode[];
  edges: BoardEdge[];
  draggedNodeIds: readonly string[];
  droppedPositionByNodeId: Record<string, { x: number; y: number }>;
  createId?: () => string;
}

export interface AltDragDuplicateResult {
  nodes: BoardNode[];
  edges: BoardEdge[];
  sourceIdByNewId: Record<string, string>;
}

/**
 * alt ドラッグのドロップ時に作る複製を組み立てる。
 * ドラッグしていた側が新ノードになり、元ノードは動かさないため既存エッジは元ノードに残る。
 */
export function buildAltDragDuplicate({
  nodes,
  edges,
  draggedNodeIds,
  droppedPositionByNodeId,
  createId = () => crypto.randomUUID(),
}: BuildAltDragDuplicateParams): AltDragDuplicateResult {
  const draggedIdSet = new Set(draggedNodeIds);
  const newIdBySourceId = new Map<string, string>();
  const sourceIdByNewId: Record<string, string> = {};

  let duplicates = nodes
    .filter((node) => draggedIdSet.has(node.id))
    .map((source) => {
      const newId = createId();
      newIdBySourceId.set(source.id, newId);
      sourceIdByNewId[newId] = source.id;
      const dropped = droppedPositionByNodeId[source.id] ?? { x: source.x, y: source.y };
      return { ...source, id: newId, x: dropped.x, y: dropped.y };
    });

  if (duplicates.length === 1) {
    // 単独ドラッグは通常ドラッグ終了と同じ最近傍 1 軸補正にそろえる
    const duplicate = duplicates[0];
    const resolved = resolveDraggedNodePosition({
      nodes,
      movingNode: duplicate,
      proposedX: duplicate.x,
      proposedY: duplicate.y,
      gap: DRAG_REPOSITION_GAP,
    });
    duplicates = [{ ...duplicate, x: resolved.x, y: resolved.y }];
  } else {
    // 複数同時は相対レイアウトを保つ必要があるので、ペーストと同じ剛体スライドで逃がす
    const { dx, dy } = resolveNonOverlappingGroupOffset(nodes, duplicates, DRAG_REPOSITION_GAP);
    if (dx !== 0 || dy !== 0) {
      duplicates = duplicates.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy }));
    }
  }

  const duplicatedEdges = edges.flatMap((edge) => {
    const source = newIdBySourceId.get(edge.source);
    const target = newIdBySourceId.get(edge.target);
    if (!source || !target) return [];
    return [{ ...edge, id: createId(), source, target }];
  });

  return { nodes: duplicates, edges: duplicatedEdges, sourceIdByNewId };
}
