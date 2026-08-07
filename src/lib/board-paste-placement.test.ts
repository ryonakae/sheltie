import { describe, expect, it } from 'vitest';

import { getNodeFrameRect } from '@/lib/sheltie-node-frame';
import { conflictsWithGap } from '@/lib/sheltie-node-placement';
import type { BoardNode } from '@/types';

import {
  getNodesFrameBounds,
  getViewportWorldRect,
  resolvePastePlacement,
  type WorldRect,
} from './board-paste-placement';

function webpage(id: string, x: number, y: number, width = 100, height = 100): BoardNode {
  return { id, type: 'webpage', x, y, width, height } as BoardNode;
}

function sticky(id: string, x: number, y: number, width = 100, height = 100): BoardNode {
  return { id, type: 'stickynote', x, y, width, height } as BoardNode;
}

const WIDE_VIEWPORT: WorldRect = { x: 0, y: 0, width: 2000, height: 2000 };

describe('getViewportWorldRect', () => {
  it('pan と zoom から world 座標の可視範囲を求める', () => {
    expect(getViewportWorldRect({ zoom: 2, panX: -100, panY: 50 }, 800, 600)).toEqual({
      x: 50,
      y: -25,
      width: 400,
      height: 300,
    });
  });
});

describe('getNodesFrameBounds', () => {
  it('空配列では null を返す', () => {
    expect(getNodesFrameBounds([])).toBeNull();
  });

  it('webpage はフレーム padding を含めた外枠で計算する', () => {
    expect(getNodesFrameBounds([webpage('w', 0, 0, 393, 852)])).toEqual({
      x: 0,
      y: 0,
      width: 425,
      height: 884,
    });
  });

  it('複数ノードの最小外接矩形を返す', () => {
    expect(
      getNodesFrameBounds([sticky('s', 0, 0, 100, 100), sticky('t', 300, 200, 50, 50)]),
    ).toEqual({ x: 0, y: 0, width: 350, height: 250 });
  });
});

describe('resolvePastePlacement', () => {
  it('直前ペーストしたノードが可視なら、そこから右下 gap 分ずらす', () => {
    const result = resolvePastePlacement({
      existingNodes: [sticky('last', 500, 500)],
      pastedNodes: [sticky('new', 0, 0)],
      sourceNodeIds: [],
      lastPastedNodeIds: ['last'],
      viewportRect: WIDE_VIEWPORT,
      gap: 20,
    });
    expect(result).toEqual([{ nodeId: 'new', x: 520, y: 520 }]);
  });

  it('元ノードが生きて可視なら、payload の座標ではなく現在位置を基準にする', () => {
    const result = resolvePastePlacement({
      existingNodes: [sticky('src', 800, 900)],
      pastedNodes: [sticky('new', 0, 0)],
      sourceNodeIds: ['src'],
      lastPastedNodeIds: [],
      viewportRect: WIDE_VIEWPORT,
      gap: 20,
    });
    expect(result).toEqual([{ nodeId: 'new', x: 820, y: 920 }]);
  });

  it('元ノードが viewport 外なら、可視な元座標にそのまま貼る', () => {
    const result = resolvePastePlacement({
      existingNodes: [sticky('src', 5000, 5000)],
      pastedNodes: [sticky('new', 10, 10)],
      sourceNodeIds: ['src'],
      lastPastedNodeIds: [],
      viewportRect: { x: 0, y: 0, width: 1000, height: 1000 },
      gap: 20,
    });
    expect(result).toEqual([{ nodeId: 'new', x: 10, y: 10 }]);
  });

  it('基準がどれも可視でなければ viewport 中央へ寄せる', () => {
    const result = resolvePastePlacement({
      existingNodes: [],
      pastedNodes: [sticky('new', 5000, 5000)],
      sourceNodeIds: [],
      lastPastedNodeIds: [],
      viewportRect: { x: 0, y: 0, width: 1000, height: 800 },
      gap: 20,
    });
    expect(result).toEqual([{ nodeId: 'new', x: 450, y: 350 }]);
  });

  it('直前ペーストと元ノードが両方可視なら直前ペーストを優先する', () => {
    const result = resolvePastePlacement({
      existingNodes: [sticky('src', 100, 100), sticky('last', 500, 500)],
      pastedNodes: [sticky('new', 0, 0)],
      sourceNodeIds: ['src'],
      lastPastedNodeIds: ['last'],
      viewportRect: WIDE_VIEWPORT,
      gap: 20,
    });
    expect(result).toEqual([{ nodeId: 'new', x: 520, y: 520 }]);
  });

  it('webpage が既存 webpage と gap 未満なら右下対角へスライドする', () => {
    const existing = webpage('a', 0, 0);
    const result = resolvePastePlacement({
      existingNodes: [existing],
      pastedNodes: [webpage('new', 50, 50)],
      sourceNodeIds: [],
      lastPastedNodeIds: [],
      viewportRect: WIDE_VIEWPORT,
      gap: 20,
    });

    expect(result).toEqual([{ nodeId: 'new', x: 170, y: 170 }]);
    // スライド後は gap 制約を満たす
    const placed = getNodeFrameRect(webpage('new', result[0].x, result[0].y));
    const blocker = getNodeFrameRect(existing);
    expect(
      conflictsWithGap(
        placed.left,
        placed.top,
        placed.width,
        placed.height,
        blocker.left,
        blocker.top,
        blocker.width,
        blocker.height,
        20,
      ),
    ).toBe(false);
  });

  it('付箋どうしは重なりを許容してスライドしない', () => {
    const result = resolvePastePlacement({
      existingNodes: [sticky('a', 0, 0)],
      pastedNodes: [sticky('new', 10, 10)],
      sourceNodeIds: [],
      lastPastedNodeIds: [],
      viewportRect: WIDE_VIEWPORT,
      gap: 20,
    });
    expect(result).toEqual([{ nodeId: 'new', x: 10, y: 10 }]);
  });

  it('付箋が既存 webpage に重なる場合はスライドする', () => {
    const result = resolvePastePlacement({
      existingNodes: [webpage('a', 0, 0)],
      pastedNodes: [sticky('new', 10, 10)],
      sourceNodeIds: [],
      lastPastedNodeIds: [],
      viewportRect: WIDE_VIEWPORT,
      gap: 20,
    });
    expect(result).toEqual([{ nodeId: 'new', x: 170, y: 170 }]);
  });

  it('複数ノードはスライド後も相対レイアウトを保つ', () => {
    const result = resolvePastePlacement({
      existingNodes: [webpage('a', 0, 0)],
      pastedNodes: [webpage('n1', 0, 0), sticky('n2', 200, 0)],
      sourceNodeIds: [],
      lastPastedNodeIds: [],
      viewportRect: WIDE_VIEWPORT,
      gap: 20,
    });
    expect(result[1].x - result[0].x).toBe(200);
    expect(result[1].y - result[0].y).toBe(0);
  });
});
