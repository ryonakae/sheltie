import { describe, expect, it } from 'vitest';

import type { BoardNode } from '@/types';

import { getNodeBounds, resolveCenteredViewport, resolveFitViewport } from './siteboard-viewport';

function text(x: number, y: number, width: number, height: number): BoardNode {
  return { type: 'text', x, y, width, height } as BoardNode;
}

describe('getNodeBounds', () => {
  it('ノードが無ければ null', () => {
    expect(getNodeBounds([])).toBeNull();
  });

  it('単一ノードはそのフレーム矩形を返す', () => {
    const bounds = getNodeBounds([text(10, 20, 100, 50)]);
    expect(bounds).toMatchObject({
      left: 10,
      top: 20,
      right: 110,
      bottom: 70,
      width: 100,
      height: 50,
      centerX: 60,
      centerY: 45,
    });
  });

  it('複数ノードは外接矩形を返す', () => {
    const bounds = getNodeBounds([text(0, 0, 100, 50), text(200, 100, 50, 50)]);
    expect(bounds).toMatchObject({
      left: 0,
      top: 0,
      right: 250,
      bottom: 150,
      width: 250,
      height: 150,
      centerX: 125,
      centerY: 75,
    });
  });
});

describe('resolveCenteredViewport', () => {
  it('ノードが無ければ原点 viewport（zoom はそのまま）', () => {
    expect(resolveCenteredViewport([], 1000, 800, 0.8)).toEqual({ x: 0, y: 0, zoom: 0.8 });
  });

  it('単一ノードの中心が viewport 中心に来るよう x/y を返す', () => {
    // bounds.centerX = 50, centerY = 25, zoom = 1
    // x = 500 - 50 = 450, y = 400 - 25 = 375
    const target = resolveCenteredViewport([text(0, 0, 100, 50)], 1000, 800, 1);
    expect(target).toEqual({ x: 450, y: 375, zoom: 1 });
  });

  it('zoom が掛かると中心座標も zoom 倍だけずれる', () => {
    // bounds.centerX = 50, zoom = 2 → x = 500 - 100 = 400
    const target = resolveCenteredViewport([text(0, 0, 100, 50)], 1000, 800, 2);
    expect(target).toEqual({ x: 400, y: 350, zoom: 2 });
  });
});

describe('resolveFitViewport', () => {
  it('ノードが無ければ null', () => {
    expect(resolveFitViewport([], 1000, 800)).toBeNull();
  });

  it('小さなコンテンツは maxZoom (1.5) ぴったりまで拡大できる', () => {
    // 100x50 × 1.5 = 150x75、available = (1000-128)x(800-128) = 872x672 → 余裕で fit
    const target = resolveFitViewport([text(0, 0, 100, 50)], 1000, 800);
    expect(target?.zoom).toBe(1.5);
  });

  it('viewport より遥かに大きなコンテンツは minZoom (0.25) に張り付く', () => {
    // 4000x3000 はどのズームでも available をはみ出すため、最終的に low = minZoom が残る
    const target = resolveFitViewport([text(0, 0, 4000, 3000)], 1000, 800);
    expect(target?.zoom).toBe(0.25);
  });

  it('中間サイズでは padding を考慮した最大の zoom を返す', () => {
    // 700x300 → 横が available=872 にちょうど収まる zoom = 872/700 ≒ 1.2457
    const target = resolveFitViewport([text(0, 0, 700, 300)], 1000, 800);
    expect(target?.zoom).toBeGreaterThan(1.0);
    expect(target?.zoom).toBeLessThan(1.5);
    // 横方向で律速されるので width * zoom ≒ available width
    expect((target?.zoom ?? 0) * 700).toBeCloseTo(872, 0);
  });

  it('options.maxZoom で上限を抑えられる', () => {
    const target = resolveFitViewport([text(0, 0, 100, 50)], 1000, 800, { maxZoom: 1.0 });
    expect(target?.zoom).toBe(1.0);
  });

  it('options.paddingPx を変えると有効領域が変わる', () => {
    // padding=0 → available=1000x800、padding=200 → available=600x400
    // 700x300 は padding=0 で全領域 fit、padding=200 では横律速
    const tight = resolveFitViewport([text(0, 0, 700, 300)], 1000, 800, { paddingPx: 0 });
    const loose = resolveFitViewport([text(0, 0, 700, 300)], 1000, 800, { paddingPx: 200 });
    expect(tight?.zoom ?? 0).toBeGreaterThan(loose?.zoom ?? 0);
  });
});
