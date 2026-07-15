import { describe, expect, it } from 'vitest';

import type { BoardNode } from '@/types';

import { resolveDraggedNodePosition } from './sheltie-node-placement';

function webpage(id: string, x: number, y: number, width: number, height: number): BoardNode {
  return { id, type: 'webpage', x, y, width, height } as BoardNode;
}

function text(id: string, x: number, y: number, width: number, height: number): BoardNode {
  return { id, type: 'text', x, y, width, height } as BoardNode;
}

function sticky(id: string, x: number, y: number, width: number, height: number): BoardNode {
  return { id, type: 'stickynote', x, y, width, height } as BoardNode;
}

describe('resolveDraggedNodePosition', () => {
  it('衝突しない位置は提案位置をそのまま返す', () => {
    const moving = webpage('m', 0, 0, 100, 100);
    const result = resolveDraggedNodePosition({
      nodes: [moving, webpage('a', 1000, 1000, 100, 100)],
      movingNode: moving,
      proposedX: 200,
      proposedY: 0,
      gap: 10,
    });
    expect(result).toEqual({ x: 200, y: 0, corrected: false, axis: null });
  });

  it('text ノードどうしは衝突判定の対象外', () => {
    // text の blocker は webpage のみ。同じ text ノードが目の前にあっても素通り。
    const moving = text('m', 0, 0, 100, 50);
    const result = resolveDraggedNodePosition({
      nodes: [moving, text('a', 50, 0, 100, 50)],
      movingNode: moving,
      proposedX: 50,
      proposedY: 0,
      gap: 0,
    });
    expect(result.corrected).toBe(false);
  });

  it('text が webpage に重なる場合は補正される', () => {
    // webpage 'a' は frame 込みで 32+100+32 だが、ここは padding 0 をテストするため大きめで
    const moving = text('m', 0, 0, 50, 50);
    const result = resolveDraggedNodePosition({
      nodes: [moving, webpage('a', 100, 100, 200, 200)],
      movingNode: moving,
      proposedX: 150,
      proposedY: 150,
      gap: 0,
    });
    expect(result.corrected).toBe(true);
    expect(result.axis === 'x' || result.axis === 'y').toBe(true);
  });

  it('webpage は webpage を blocker として扱う', () => {
    const moving = webpage('m', 0, 0, 100, 100);
    const result = resolveDraggedNodePosition({
      nodes: [moving, webpage('a', 200, 0, 100, 100)],
      movingNode: moving,
      proposedX: 180, // 既存 webpage と重なる位置
      proposedY: 0,
      gap: 10,
    });
    expect(result.corrected).toBe(true);
  });

  it('移動中のノード自身は blocker から除外する', () => {
    const moving = webpage('m', 50, 50, 100, 100);
    const result = resolveDraggedNodePosition({
      nodes: [moving],
      movingNode: moving,
      proposedX: 60,
      proposedY: 60,
      gap: 10,
    });
    expect(result).toEqual({ x: 60, y: 60, corrected: false, axis: null });
  });

  it('x 方向の補正距離が短ければ x のみ動かす（y は維持）', () => {
    // blocker: 100..200。proposedX=190 → 右に少しずらせば抜ける。
    const moving = webpage('m', 0, 0, 50, 50);
    const result = resolveDraggedNodePosition({
      nodes: [webpage('a', 100, 100, 100, 100)],
      movingNode: moving,
      proposedX: 190,
      proposedY: 105,
      gap: 0,
    });
    // webpage frame は padding 16 → blocker frame: left=100, right=232
    // 補正後 x は blocker.right (232) または blocker.left - movingWidth(82) = 18 のどちらか近い方
    expect(result.axis).toBe('x');
    expect(result.y).toBe(105);
  });

  it('sticky は text と同じく webpage のみを blocker にする', () => {
    const moving = sticky('m', 0, 0, 100, 50);
    const result = resolveDraggedNodePosition({
      nodes: [moving, sticky('a', 50, 0, 100, 50)],
      movingNode: moving,
      proposedX: 50,
      proposedY: 0,
      gap: 0,
    });
    expect(result.corrected).toBe(false);
  });
});
