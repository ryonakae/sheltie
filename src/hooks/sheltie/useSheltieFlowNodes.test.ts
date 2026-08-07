import { describe, expect, it } from 'vitest';

import { insertGhostFlowNodes } from '@/hooks/sheltie/useSheltieFlowNodes';
import type { BoardNode } from '@/types';

import type { Node } from '@xyflow/react';

function boardNode(id: string, x = 0, y = 0): BoardNode {
  return { id, type: 'stickynote', title: id, url: '', x, y, width: 100, height: 100 } as BoardNode;
}

function flowNode(id: string): Node {
  return { id, type: 'stickyNoteFlowNode', position: { x: 0, y: 0 }, data: {} };
}

describe('insertGhostFlowNodes', () => {
  it('ghost が無ければ元の配列をそのまま返す', () => {
    const boardFlowNodes = [flowNode('a'), flowNode('b')];
    expect(insertGhostFlowNodes(boardFlowNodes, [])).toBe(boardFlowNodes);
  });

  it('ghost を複製元ノードの直前に差し込む（配列順 = 重なり順を保つ）', () => {
    // a の上に b がある状態で b を alt ドラッグする。
    // ghost を先頭にまとめると ghost が a の下に潜って見えてしまう
    const result = insertGhostFlowNodes([flowNode('a'), flowNode('b')], [{ node: boardNode('b') }]);

    expect(result.map((node) => node.id)).toEqual(['a', 'ghost-b', 'b']);
  });

  it('複数ノードの alt ドラッグでもそれぞれの直前に入る', () => {
    const result = insertGhostFlowNodes(
      [flowNode('a'), flowNode('b'), flowNode('c')],
      [{ node: boardNode('a') }, { node: boardNode('c') }],
    );

    expect(result.map((node) => node.id)).toEqual(['ghost-a', 'a', 'b', 'ghost-c', 'c']);
  });

  it('ghost は複製元の store 座標に置き、操作を受け付けない', () => {
    const [ghost] = insertGhostFlowNodes(
      [flowNode('a')],
      [{ node: boardNode('a', 120, 340), screenshotUrl: 'asset://a.png' }],
    );

    expect(ghost).toMatchObject({
      id: 'ghost-a',
      type: 'ghost',
      position: { x: 120, y: 340 },
      draggable: false,
      selectable: false,
      focusable: false,
    });
    expect(ghost.data).toMatchObject({ screenshotUrl: 'asset://a.png' });
  });

  it('複製元が配列に無い ghost は捨てる', () => {
    const result = insertGhostFlowNodes([flowNode('a')], [{ node: boardNode('missing') }]);

    expect(result.map((node) => node.id)).toEqual(['a']);
  });
});
