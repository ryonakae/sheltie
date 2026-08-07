import { describe, expect, it } from 'vitest';

import { DRAG_REPOSITION_GAP } from '@/constants';
import { getNodeFrameRect } from '@/lib/sheltie-node-frame';
import { conflictsWithGap } from '@/lib/sheltie-node-placement';
import type { BoardEdge, BoardNode } from '@/types';

import { buildAltDragDuplicate } from './alt-drag-duplicate';

function webpage(id: string, x: number, y: number, overrides: Partial<BoardNode> = {}): BoardNode {
  return {
    id,
    type: 'webpage',
    title: 'Example',
    url: 'https://example.com/deep',
    addedUrl: 'https://example.com/',
    x,
    y,
    width: 100,
    height: 100,
    ...overrides,
  } as BoardNode;
}

function sticky(id: string, x: number, y: number, overrides: Partial<BoardNode> = {}): BoardNode {
  return {
    id,
    type: 'stickynote',
    title: 'note',
    url: '',
    content: 'hello',
    colorIndex: 3,
    fontSizePreset: 2,
    x,
    y,
    width: 100,
    height: 100,
    ...overrides,
  } as BoardNode;
}

function edge(overrides: Partial<BoardEdge> = {}): BoardEdge {
  return {
    id: 'e1',
    source: 'a',
    sourceHandle: 'right',
    target: 'b',
    targetHandle: 'left',
    strokeWidth: 6,
    lineStyle: 'dashed',
    colorPreset: 'success',
    ...overrides,
  };
}

function sequentialIds(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `new-${counter}`;
  };
}

describe('buildAltDragDuplicate', () => {
  it('元ノードの内容を引き継いだ複製を新 ID で作り、元ノードは結果に含めない', () => {
    const nodes = [webpage('a', 0, 0), sticky('b', 500, 500)];

    const result = buildAltDragDuplicate({
      nodes,
      edges: [],
      draggedNodeIds: ['b'],
      droppedPositionByNodeId: { b: { x: 700, y: 700 } },
      createId: sequentialIds(),
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: 'new-1',
      type: 'stickynote',
      content: 'hello',
      colorIndex: 3,
      fontSizePreset: 2,
      width: 100,
      height: 100,
      x: 700,
      y: 700,
    });
  });

  it('webpage の url / addedUrl / title を保持する', () => {
    const result = buildAltDragDuplicate({
      nodes: [webpage('a', 0, 0)],
      edges: [],
      draggedNodeIds: ['a'],
      droppedPositionByNodeId: { a: { x: 900, y: 900 } },
      createId: sequentialIds(),
    });

    expect(result.nodes[0]).toMatchObject({
      url: 'https://example.com/deep',
      addedUrl: 'https://example.com/',
      title: 'Example',
    });
  });

  it('複数ノードでも webpage が重なるなら群ごとスライドして相対位置を保つ', () => {
    // Webview は重ねられないので、複数ノードの複製でも webpage の重なりは許さない
    const nodes = [
      webpage('w', 0, 0, { width: 393, height: 852 }),
      sticky('s', 500, 0),
      { ...sticky('t', 500, 300), type: 'text' } as BoardNode,
    ];

    const result = buildAltDragDuplicate({
      nodes,
      edges: [],
      draggedNodeIds: ['w', 's', 't'],
      droppedPositionByNodeId: {
        w: { x: 30, y: 30 },
        s: { x: 530, y: 30 },
        t: { x: 530, y: 330 },
      },
      createId: sequentialIds(),
    });

    const [w, s, t] = result.nodes;
    const wRect = getNodeFrameRect(w);
    const originalRect = getNodeFrameRect(nodes[0]);
    expect(
      conflictsWithGap(
        wRect.left,
        wRect.top,
        wRect.width,
        wRect.height,
        originalRect.left,
        originalRect.top,
        originalRect.width,
        originalRect.height,
        DRAG_REPOSITION_GAP,
      ),
    ).toBe(false);
    // 群の相対レイアウトは崩さない
    expect(s.x - w.x).toBe(500);
    expect(t.y - w.y).toBe(300);
  });

  it('複数ノードでも webpage が絡まなければドロップ位置のまま重ねられる', () => {
    const nodes = [sticky('a', 0, 0), sticky('b', 200, 0)];

    const result = buildAltDragDuplicate({
      nodes,
      edges: [],
      draggedNodeIds: ['a', 'b'],
      droppedPositionByNodeId: { a: { x: 10, y: 10 }, b: { x: 210, y: 10 } },
      createId: sequentialIds(),
    });

    expect(result.nodes.map((node) => ({ x: node.x, y: node.y }))).toEqual([
      { x: 10, y: 10 },
      { x: 210, y: 10 },
    ]);
  });

  it('単独ドラッグは既存 webpage と gap 未満なら補正する', () => {
    const nodes = [webpage('a', 0, 0)];

    const result = buildAltDragDuplicate({
      nodes,
      edges: [],
      draggedNodeIds: ['a'],
      droppedPositionByNodeId: { a: { x: 50, y: 50 } },
      createId: sequentialIds(),
    });

    expect(result.nodes[0].x === 50 && result.nodes[0].y === 50).toBe(false);
  });

  it('単独ドラッグで衝突しないならドロップ位置をそのまま使う', () => {
    const nodes = [webpage('a', 0, 0)];

    const result = buildAltDragDuplicate({
      nodes,
      edges: [],
      draggedNodeIds: ['a'],
      droppedPositionByNodeId: { a: { x: 1000, y: 1000 } },
      createId: sequentialIds(),
    });

    expect(result.nodes[0]).toMatchObject({ x: 1000, y: 1000 });
  });

  it('ドラッグ対象内で閉じたエッジだけを複製し、スタイルを引き継ぐ', () => {
    const nodes = [webpage('a', 0, 0), webpage('b', 500, 0), webpage('c', 1000, 0)];
    const edges = [edge({ id: 'inside' }), edge({ id: 'outside', source: 'a', target: 'c' })];

    const result = buildAltDragDuplicate({
      nodes,
      edges,
      draggedNodeIds: ['a', 'b'],
      droppedPositionByNodeId: { a: { x: 0, y: 500 }, b: { x: 500, y: 500 } },
      createId: sequentialIds(),
    });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: 'new-1',
      target: 'new-2',
      sourceHandle: 'right',
      targetHandle: 'left',
      strokeWidth: 6,
      lineStyle: 'dashed',
      colorPreset: 'success',
    });
    expect(result.edges[0].id).not.toBe('inside');
  });

  it('sourceIdByNewId で新旧 ID の対応を返す', () => {
    const nodes = [webpage('a', 0, 0), sticky('b', 500, 500)];

    const result = buildAltDragDuplicate({
      nodes,
      edges: [],
      draggedNodeIds: ['a', 'b'],
      droppedPositionByNodeId: { a: { x: 0, y: 1000 }, b: { x: 500, y: 1500 } },
      createId: sequentialIds(),
    });

    expect(result.sourceIdByNewId).toEqual({ 'new-1': 'a', 'new-2': 'b' });
  });

  it('ドラッグ対象が空なら空の結果を返す', () => {
    const result = buildAltDragDuplicate({
      nodes: [webpage('a', 0, 0)],
      edges: [],
      draggedNodeIds: [],
      droppedPositionByNodeId: {},
      createId: sequentialIds(),
    });

    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});
