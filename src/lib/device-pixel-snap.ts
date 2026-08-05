export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

function resolveRatio(dpr: number): number {
  return dpr > 0 ? dpr : 1;
}

export function snapToDevicePixels(value: number, dpr: number): number {
  const ratio = resolveRatio(dpr);
  return Math.round(value * ratio) / ratio;
}

// WebView の native frame と CSS placeholder の描画位置を同じ device-pixel グリッドに
// 揃えるため、left/top と right/bottom を別々に snap し、width/height は差分から再計算する。
// width だけを snap すると right edge が 1 device px ずれるケースがある。
export function snapRectToDevicePixels(rect: RectLike, dpr: number): RectLike {
  const ratio = resolveRatio(dpr);
  const left = Math.round(rect.x * ratio) / ratio;
  const top = Math.round(rect.y * ratio) / ratio;
  const right = Math.round((rect.x + rect.width) * ratio) / ratio;
  const bottom = Math.round((rect.y + rect.height) * ratio) / ratio;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}
