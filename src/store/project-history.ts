import type { BoardEdge, BoardNode } from '@/types';

export const HISTORY_LIMIT = 100;

export interface ProjectSnapshot {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

export interface ProjectHistory {
  past: ProjectSnapshot[];
  future: ProjectSnapshot[];
}

export function cloneNodes(nodes: BoardNode[]): BoardNode[] {
  return nodes.map((node) => ({ ...node }));
}

export function cloneEdges(edges: BoardEdge[]): BoardEdge[] {
  return edges.map((edge) => ({ ...edge }));
}

export function cloneSnapshot(snapshot: {
  nodes: BoardNode[];
  edges: BoardEdge[];
}): ProjectSnapshot {
  return { nodes: cloneNodes(snapshot.nodes), edges: cloneEdges(snapshot.edges) };
}

/** past へスナップショットを積み、HISTORY_LIMIT を超えた古い分を切り捨てた配列を返す */
export function appendCappedSnapshot(
  past: ProjectSnapshot[],
  snapshot: { nodes: BoardNode[]; edges: BoardEdge[] },
): ProjectSnapshot[] {
  const nextPast = [...past, cloneSnapshot(snapshot)];
  if (nextPast.length > HISTORY_LIMIT) {
    nextPast.splice(0, nextPast.length - HISTORY_LIMIT);
  }
  return nextPast;
}

/** 編集操作時に呼ぶ。past へ現在状態を積み、future（Redo 用）を破棄した履歴を返す */
export function pushHistory(
  history: ProjectHistory,
  snapshot: { nodes: BoardNode[]; edges: BoardEdge[] },
): ProjectHistory {
  return {
    past: appendCappedSnapshot(history.past, snapshot),
    future: [],
  };
}
