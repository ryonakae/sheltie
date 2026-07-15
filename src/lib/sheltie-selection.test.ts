import { describe, expect, it } from 'vitest';

import { resolveActiveSelection, retainLiveSelectedIds } from './sheltie-selection';

describe('resolveActiveSelection', () => {
  it.each([
    { nodes: [], edges: [], activeNodeId: null, activeEdgeId: null },
    { nodes: ['node-a'], edges: [], activeNodeId: 'node-a', activeEdgeId: null },
    { nodes: [], edges: ['edge-a'], activeNodeId: null, activeEdgeId: 'edge-a' },
    { nodes: ['node-a', 'node-b'], edges: [], activeNodeId: null, activeEdgeId: null },
    { nodes: [], edges: ['edge-a', 'edge-b'], activeNodeId: null, activeEdgeId: null },
    { nodes: ['node-a'], edges: ['edge-a'], activeNodeId: null, activeEdgeId: null },
  ])('全選択が1要素のときだけactiveを返す %#', ({ nodes, edges, ...expected }) => {
    expect(resolveActiveSelection(nodes, new Set(edges))).toEqual(expected);
  });
});

describe('retainLiveSelectedIds', () => {
  it('存在する選択IDだけを残す', () => {
    expect(
      retainLiveSelectedIds(new Set(['edge-a', 'deleted']), new Set(['edge-a', 'edge-b'])),
    ).toEqual(new Set(['edge-a']));
  });

  it('選択エッジが全て無効なら空集合を返す', () => {
    expect(retainLiveSelectedIds(new Set(['deleted']), new Set(['edge-a']))).toEqual(new Set());
  });
});
