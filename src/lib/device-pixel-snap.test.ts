import { describe, expect, it } from 'vitest';

import { snapRectToDevicePixels, snapToDevicePixels } from './device-pixel-snap';

describe('snapToDevicePixels', () => {
  it('dpr=1 では整数 px に丸める', () => {
    expect(snapToDevicePixels(10.4, 1)).toBe(10);
    expect(snapToDevicePixels(10.6, 1)).toBe(11);
  });

  it('dpr=2 では 0.5 px グリッドに丸める', () => {
    expect(snapToDevicePixels(10.2, 2)).toBe(10);
    expect(snapToDevicePixels(10.3, 2)).toBe(10.5);
    expect(snapToDevicePixels(10.74, 2)).toBe(10.5);
    expect(snapToDevicePixels(10.76, 2)).toBe(11);
  });

  it('dpr=3 では 1/3 px グリッドに丸める', () => {
    expect(snapToDevicePixels(1, 3)).toBeCloseTo(1, 10);
    expect(snapToDevicePixels(1.2, 3)).toBeCloseTo(1.3333333333, 9);
  });

  it('dpr が 0 以下なら 1 として扱う', () => {
    expect(snapToDevicePixels(10.4, 0)).toBe(10);
    expect(snapToDevicePixels(10.6, -2)).toBe(11);
  });
});

describe('snapRectToDevicePixels', () => {
  it('left/top と right/bottom を grid に snap し width/height を再計算する', () => {
    const snapped = snapRectToDevicePixels({ x: 10.2, y: 20.7, width: 100.4, height: 50.6 }, 2);
    // left = round(10.2 * 2) / 2 = round(20.4)/2 = 20/2 = 10
    // right = round((10.2 + 100.4) * 2)/2 = round(221.2)/2 = 221/2 = 110.5
    // width = 110.5 - 10 = 100.5
    expect(snapped.x).toBe(10);
    expect(snapped.width).toBe(100.5);
    // top = round(20.7 * 2)/2 = round(41.4)/2 = 41/2 = 20.5
    // bottom = round((20.7+50.6)*2)/2 = round(142.6)/2 = 143/2 = 71.5
    // height = 71.5 - 20.5 = 51
    expect(snapped.y).toBe(20.5);
    expect(snapped.height).toBe(51);
  });

  it('幅/高さを single snap した値と right edge が一致する', () => {
    // snap(left)+snap(width) ではなく snap(right) ベースでないとエッジが 1 device px ずれるケース
    const rect = { x: 10.49, y: 0, width: 100.02, height: 0 };
    const dpr = 2;
    const snapped = snapRectToDevicePixels(rect, dpr);
    const expectedRight = Math.round((rect.x + rect.width) * dpr) / dpr;
    expect(snapped.x + snapped.width).toBeCloseTo(expectedRight, 10);
  });

  it('dpr=1 では完全整数 px の矩形を返す', () => {
    const snapped = snapRectToDevicePixels({ x: 0.6, y: 0.6, width: 99.5, height: 49.4 }, 1);
    expect(Number.isInteger(snapped.x)).toBe(true);
    expect(Number.isInteger(snapped.y)).toBe(true);
    expect(Number.isInteger(snapped.width)).toBe(true);
    expect(Number.isInteger(snapped.height)).toBe(true);
  });
});
