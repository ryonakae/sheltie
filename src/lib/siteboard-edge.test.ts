import { describe, expect, it } from 'vitest';

import { DEFAULT_EDGE_STYLE } from '@/constants';
import type { BoardEdge } from '@/types';

import { addOrReplaceBoardEdge, reverseBoardEdge, updateBoardEdgeStyle } from './siteboard-edge';

function edge(overrides: Partial<BoardEdge> = {}): BoardEdge {
  return {
    ...DEFAULT_EDGE_STYLE,
    id: 'edge-a-b',
    source: 'a',
    sourceHandle: 'right',
    target: 'b',
    targetHandle: 'left',
    ...overrides,
  };
}

describe('addOrReplaceBoardEdge', () => {
  it('同じ接続点のエッジが無ければ末尾へ追加する', () => {
    const existing = edge({ id: 'edge-c-d', source: 'c', target: 'd' });
    const incoming = edge();

    const next = addOrReplaceBoardEdge([existing], incoming);

    expect(next).toEqual([existing, incoming]);
  });

  it('同じエッジを再追加した場合は no-op にする', () => {
    const existing = edge();

    expect(addOrReplaceBoardEdge([existing], { ...existing })).toBeNull();
  });

  it('同じ2接続点へ逆向きに追加すると新しい向きだけ残して旧スタイルを継承する', () => {
    const existing = edge({
      id: 'old',
      strokeWidth: 6,
      lineStyle: 'dashed',
      colorPreset: 'danger',
    });
    const incoming = edge({
      id: 'new',
      source: 'b',
      sourceHandle: 'left',
      target: 'a',
      targetHandle: 'right',
    });

    const edges = [existing];
    const next = addOrReplaceBoardEdge(edges, incoming);

    expect(next).not.toBeNull();
    expect(next).not.toBe(edges);
    expect(next).toHaveLength(1);
    expect(next?.[0]).toEqual({
      ...incoming,
      strokeWidth: 6,
      lineStyle: 'dashed',
      colorPreset: 'danger',
    });
    expect(existing).toEqual(
      edge({ id: 'old', strokeWidth: 6, lineStyle: 'dashed', colorPreset: 'danger' }),
    );
  });

  it('同じノード間でも接続ハンドルが異なれば共存させる', () => {
    const existing = edge();
    const incoming = edge({
      id: 'edge-a-b-top-bottom',
      sourceHandle: 'top',
      targetHandle: 'bottom',
    });

    expect(addOrReplaceBoardEdge([existing], incoming)).toEqual([existing, incoming]);
  });
});

describe('updateBoardEdgeStyle', () => {
  it('指定したエッジのスタイルだけを部分更新する', () => {
    const existing = edge();

    const next = updateBoardEdgeStyle([existing], existing.id, {
      strokeWidth: 6,
      colorPreset: 'success',
    });

    expect(next?.[0]).toEqual({
      ...existing,
      strokeWidth: 6,
      colorPreset: 'success',
    });
    expect(existing).toEqual(edge());
  });

  it('対象が無い場合と同じ値の場合は no-op にする', () => {
    const existing = edge();

    expect(updateBoardEdgeStyle([existing], 'missing', { strokeWidth: 6 })).toBeNull();
    expect(updateBoardEdgeStyle([existing], existing.id, { strokeWidth: 3 })).toBeNull();
  });
});

describe('reverseBoardEdge', () => {
  it('IDとスタイルを維持してノードとハンドルの向きを反転する', () => {
    const existing = edge({ strokeWidth: 6, lineStyle: 'dashed', colorPreset: 'warning' });

    expect(reverseBoardEdge([existing], existing.id)?.[0]).toEqual({
      ...existing,
      source: 'b',
      sourceHandle: 'left',
      target: 'a',
      targetHandle: 'right',
    });
  });

  it('対象が無ければ no-op にする', () => {
    expect(reverseBoardEdge([edge()], 'missing')).toBeNull();
  });
});
