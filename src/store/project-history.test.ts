import { describe, expect, it } from 'vitest';

import type { BoardEdge, BoardNode } from '@/types';

import {
  appendCappedSnapshot,
  cloneNodes,
  HISTORY_LIMIT,
  type ProjectHistory,
  type ProjectSnapshot,
  pushHistory,
} from './project-history';

function sticky(id: string, x = 0): BoardNode {
  return { id, type: 'stickynote', x, y: 0, width: 100, height: 100 } as BoardNode;
}

function snapshot(nodeId: string): { nodes: BoardNode[]; edges: BoardEdge[] } {
  return { nodes: [sticky(nodeId)], edges: [] };
}

describe('cloneNodes', () => {
  it('新しい配列と新しい要素参照を返す（元を破壊しない）', () => {
    const original = [sticky('a')];
    const cloned = cloneNodes(original);
    expect(cloned).not.toBe(original);
    expect(cloned[0]).not.toBe(original[0]);
    expect(cloned[0]).toEqual(original[0]);
  });
});

describe('pushHistory', () => {
  it('past へ snapshot を積み、future を破棄する', () => {
    const history: ProjectHistory = {
      past: [snapshot('old')],
      future: [snapshot('redoable')],
    };
    const next = pushHistory(history, snapshot('current'));
    expect(next.past).toHaveLength(2);
    expect(next.future).toEqual([]);
    expect(next.past[1].nodes[0].id).toBe('current');
  });

  it('積んだ snapshot は deep clone され、後からの破壊に影響されない', () => {
    const live = snapshot('live');
    const next = pushHistory({ past: [], future: [] }, live);
    live.nodes[0].x = 999;
    expect(next.past[0].nodes[0].x).toBe(0);
  });
});

describe('appendCappedSnapshot', () => {
  it('HISTORY_LIMIT を超えたら古い分を切り捨てる', () => {
    const past: ProjectSnapshot[] = Array.from({ length: HISTORY_LIMIT }, (_, i) =>
      snapshot(`n${i}`),
    );
    const next = appendCappedSnapshot(past, snapshot('newest'));
    expect(next).toHaveLength(HISTORY_LIMIT);
    expect(next[next.length - 1].nodes[0].id).toBe('newest');
    // 最古（n0）が押し出されている
    expect(next[0].nodes[0].id).toBe('n1');
  });
});
