import { DRAG_REPOSITION_GAP } from '@/constants';
import { resolveDraggedNodePosition } from '@/lib/sheltie-node-placement';
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

  // 単独ドラッグは通常ドラッグ終了と同じ重なり補正。複数同時は既存挙動に合わせて省略する
  if (duplicates.length === 1) {
    const duplicate = duplicates[0];
    const resolved = resolveDraggedNodePosition({
      nodes,
      movingNode: duplicate,
      proposedX: duplicate.x,
      proposedY: duplicate.y,
      gap: DRAG_REPOSITION_GAP,
    });
    duplicates = [{ ...duplicate, x: resolved.x, y: resolved.y }];
  }

  const duplicatedEdges = edges.flatMap((edge) => {
    const source = newIdBySourceId.get(edge.source);
    const target = newIdBySourceId.get(edge.target);
    if (!source || !target) return [];
    return [{ ...edge, id: createId(), source, target }];
  });

  return { nodes: duplicates, edges: duplicatedEdges, sourceIdByNewId };
}
