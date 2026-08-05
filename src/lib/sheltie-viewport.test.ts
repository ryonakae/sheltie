import { describe, expect, it } from 'vitest';

import {
  HYSTERESIS_PX,
  NATIVE_SAFE_MARGIN_BOTTOM_PX,
  NATIVE_SAFE_MARGIN_PX,
  WEB_PAGE_FRAME_PADDING,
} from '@/constants';
import type { BoardNode } from '@/types';

import {
  getNodeBounds,
  resolveCenteredViewport,
  resolveFitViewport,
  resolveInitialViewport,
} from './sheltie-viewport';

function text(x: number, y: number, width: number, height: number): BoardNode {
  return { type: 'text', x, y, width, height } as BoardNode;
}

function webpage(x: number, y: number, width: number, height: number): BoardNode {
  return { type: 'webpage', x, y, width, height } as BoardNode;
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

describe('resolveFitViewport - padding object', () => {
  it('padding を全方向同値の object で渡しても数値指定と同じ結果', () => {
    const byNumber = resolveFitViewport([text(0, 0, 700, 300)], 1000, 800, { paddingPx: 100 });
    const byObject = resolveFitViewport([text(0, 0, 700, 300)], 1000, 800, {
      padding: { top: 100, right: 100, bottom: 100, left: 100 },
    });
    expect(byObject).toEqual(byNumber);
  });

  it('非対称 padding では center が available 領域の中央に来る', () => {
    // bottom だけ厚い padding → 縦方向の available 中心が viewport 中央より上
    // text(0,0,100,50) は十分小さいので maxZoom=1.5 まで拡大される
    // available 中心 Y = top + (vh - top - bottom)/2 = 0 + (800 - 0 - 200)/2 = 300
    // bounds.centerY = 25, zoom = 1.5 → y = 300 - 25*1.5 = 262.5
    const target = resolveFitViewport([text(0, 0, 100, 50)], 1000, 800, {
      padding: { top: 0, right: 0, bottom: 200, left: 0 },
    });
    expect(target?.zoom).toBe(1.5);
    expect(target?.y).toBeCloseTo(262.5, 5);
  });

  it('object padding の未指定方向は 0 として扱う', () => {
    // bottom のみ指定、他は 0 → top:0, right:0, left:0, bottom:200
    const explicit = resolveFitViewport([text(0, 0, 100, 50)], 1000, 800, {
      padding: { top: 0, right: 0, bottom: 200, left: 0 },
    });
    const partial = resolveFitViewport([text(0, 0, 100, 50)], 1000, 800, {
      padding: { bottom: 200 },
    });
    expect(partial).toEqual(explicit);
  });
});

describe('resolveInitialViewport', () => {
  it('ノードが無ければ null（呼び出し側で既定 viewport を維持する）', () => {
    expect(resolveInitialViewport([], 1000, 800)).toBeNull();
  });

  it('小さなコンテンツでも 100% を超えて拡大しない', () => {
    // resolveFitViewport 既定では 1.5 まで拡大されるが、初期表示は 100% 止まり
    const target = resolveInitialViewport([text(0, 0, 100, 50)], 1000, 800);
    expect(target?.zoom).toBe(1);
  });

  it('大きなコンテンツは全体が収まる zoom まで縮小する', () => {
    const fit = resolveFitViewport([text(0, 0, 4000, 3000)], 1000, 800);
    const initial = resolveInitialViewport([text(0, 0, 4000, 3000)], 1000, 800);
    expect(initial).toEqual(fit);
    expect(initial?.zoom ?? 1).toBeLessThan(1);
  });

  it('ノード群の中心が viewport 中央に来る（原点から離れた座標でも見切れない）', () => {
    // bounds.center = (2500, 2025)、zoom 1 で available 中心 (500, 400) に合わせる
    const target = resolveInitialViewport([text(2450, 2000, 100, 50)], 1000, 800);
    expect(target?.zoom).toBe(1);
    expect(target?.x).toBeCloseTo(500 - 2500, 5);
    expect(target?.y).toBeCloseTo(400 - 2025, 5);
  });
});

describe('resolveFitViewport - webpage native safe area', () => {
  // webpage を含むと padding を NATIVE_SAFE_MARGIN_(BOTTOM_)PX + HYSTERESIS_PX 以上に底上げする。
  // これにより display-engine の isFullyInsideNativeSafeArea を満たし、fit 直後に native のまま。

  it('webpage 単体では bottom 余白が NATIVE_SAFE_MARGIN_BOTTOM_PX で律速される', () => {
    // 縦長 webpage を狭い高さの viewport で fit
    // frame = 393 + WEB_PAGE_FRAME_PADDING*2 = 425, 852 + 32 = 884
    // 自動底上げ: top/left/right = max(64, 29) = 64、bottom = max(64, 100) = 100
    // available height = 900 - 64 - 100 = 736 → zoom = 736 / 884 ≒ 0.832
    const target = resolveFitViewport([webpage(0, 0, 393, 852)], 1400, 900);
    expect(target).not.toBeNull();
    const expectedZoom = 736 / 884;
    expect(target?.zoom).toBeCloseTo(expectedZoom, 3);
  });

  it('fit 結果で placeholder の画面矩形が display-engine の safe area を満たす', () => {
    // resolveFitViewport の出力を使って placeholder（webview 部分）の画面矩形を計算し、
    // isFullyInsideNativeSafeArea の条件（>= 21, bottom <= 808）を満たすことを確認する。
    const VW = 1400;
    const VH = 900;
    const node = webpage(0, 0, 393, 852);
    const target = resolveFitViewport([node], VW, VH);
    expect(target).not.toBeNull();
    const { x, y, zoom } = target!;
    const padding = WEB_PAGE_FRAME_PADDING;
    // placeholder world rect = node.{x,y,w,h}（frame の中の内側 padding 分内側）
    // 画面 rect = pan + world * zoom
    const placeholderLeft = x + (node.x + padding) * zoom;
    const placeholderRight = x + (node.x + padding + node.width) * zoom;
    const placeholderTop = y + (node.y + padding) * zoom;
    const placeholderBottom = y + (node.y + padding + node.height) * zoom;
    // isFullyInsideNativeSafeArea の境界（hysteresis 込み）を上書き再現
    expect(placeholderLeft).toBeGreaterThanOrEqual(NATIVE_SAFE_MARGIN_PX - HYSTERESIS_PX);
    expect(placeholderRight).toBeLessThanOrEqual(VW - NATIVE_SAFE_MARGIN_PX + HYSTERESIS_PX);
    expect(placeholderTop).toBeGreaterThanOrEqual(NATIVE_SAFE_MARGIN_PX - HYSTERESIS_PX);
    expect(placeholderBottom).toBeLessThanOrEqual(
      VH - NATIVE_SAFE_MARGIN_BOTTOM_PX + HYSTERESIS_PX,
    );
  });

  it('webpage と text の混在でも底上げが発動する', () => {
    // text のみと比べて webpage 混在では padding が広がるので zoom は同等以下
    const mixedZoom =
      resolveFitViewport([webpage(0, 0, 393, 852), text(0, 0, 100, 50)], 1400, 900)?.zoom ?? 0;
    const textOnlyZoom =
      resolveFitViewport([text(0, 0, 393, 852), text(0, 0, 100, 50)], 1400, 900)?.zoom ?? 0;
    expect(mixedZoom).toBeLessThan(textOnlyZoom);
  });

  it('text/sticky のみでは底上げが発動しない（従来挙動）', () => {
    // text 393x852（webpage と同じ寸法）+ paddingPx 0 → frame は素のサイズ
    // 自動底上げが効いた場合は available height = 900 - 100 = 800 で zoom = 800/852 ≒ 0.939 に
    // 落ちるはずなので、ここで >1 が観測できれば底上げが無効化されていることを示せる
    const target = resolveFitViewport([text(0, 0, 393, 852)], 1400, 900, { paddingPx: 0 });
    expect(target?.zoom).toBeCloseTo(900 / 852, 3);
    expect(target?.zoom ?? 0).toBeGreaterThan(1);
  });
});
