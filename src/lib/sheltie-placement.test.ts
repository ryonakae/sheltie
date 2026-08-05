import { describe, expect, it } from 'vitest';

import type { BoardNode } from '@/types';

import { findNonOverlappingPosition } from './sheltie-placement';

// 配置探索は type/x/y/width/height のみ参照するため、テストでは最小形を BoardNode として扱う
function sticky(x: number, y: number, width: number, height: number): BoardNode {
  return { type: 'stickynote', x, y, width, height } as BoardNode;
}

function webpage(x: number, y: number, width: number, height: number): BoardNode {
  return { type: 'webpage', x, y, width, height } as BoardNode;
}

describe('findNonOverlappingPosition', () => {
  it('ノードが無ければ要求位置をそのまま返す', () => {
    expect(findNonOverlappingPosition([], 'stickynote', 10, 20, 100, 50)).toEqual({ x: 10, y: 20 });
  });

  it('重ならない位置はそのまま返す（keepY）', () => {
    const nodes = [sticky(0, 0, 100, 100)];
    expect(
      findNonOverlappingPosition(nodes, 'stickynote', 500, 0, 100, 50, { keepY: true }),
    ).toEqual({ x: 500, y: 0 });
  });

  it('横に重なる場合は右端 + PAGE_GAP までずらす（keepY、padding 0）', () => {
    const nodes = [sticky(0, 0, 100, 100)];
    // 既存の右端 100 + PAGE_GAP(100) = 200
    expect(findNonOverlappingPosition(nodes, 'stickynote', 0, 0, 100, 50, { keepY: true })).toEqual(
      { x: 200, y: 0 },
    );
  });

  it('WebサイトノードはフレームPadding(16*2)込みで重なり判定する', () => {
    // frame 幅 = 100 + 32 = 132 → 右端 132、ずらし先 132 + PAGE_GAP(100) = 232
    const nodes = [webpage(0, 0, 100, 100)];
    expect(findNonOverlappingPosition(nodes, 'webpage', 100, 0, 100, 100, { keepY: true })).toEqual(
      { x: 232, y: 0 },
    );
  });
});
