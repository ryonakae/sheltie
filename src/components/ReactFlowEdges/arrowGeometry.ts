import { Position } from '@xyflow/react';

import { DEFAULT_EDGE_STYLE } from '@/constants';
import type { EdgeColorPreset, EdgeLineStyle, EdgeStrokeWidth } from '@/types';

/**
 * ArrowEdge / ArrowConnectionLine 共通の矢印形状定数。
 * 完成エッジとドラッグ中の接続線で同じ見た目を保つために集約する。
 */
const ARROW_GEOMETRY_BY_STROKE_WIDTH: Record<
  EdgeStrokeWidth,
  { sourceDotRadius: number; arrowLength: number; arrowHalfWidth: number }
> = {
  3: { sourceDotRadius: 6, arrowLength: 16, arrowHalfWidth: 10 },
  6: { sourceDotRadius: 8, arrowLength: 20, arrowHalfWidth: 12 },
};

export function getArrowGeometry(strokeWidth: EdgeStrokeWidth) {
  return ARROW_GEOMETRY_BY_STROKE_WIDTH[strokeWidth];
}

const EDGE_DASH_ARRAY_BY_STROKE_WIDTH: Record<EdgeStrokeWidth, string> = {
  3: '8 6',
  6: '12 8',
};

export function getEdgeDashArray(
  strokeWidth: EdgeStrokeWidth,
  lineStyle: EdgeLineStyle,
): string | undefined {
  return lineStyle === 'dashed' ? EDGE_DASH_ARRAY_BY_STROKE_WIDTH[strokeWidth] : undefined;
}

const EDGE_COLOR_BY_PRESET: Record<EdgeColorPreset, string> = {
  default: 'var(--color-separator-tertiary)',
  foreground: 'var(--foreground)',
  muted: 'var(--muted)',
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

export function getEdgeColor(colorPreset: EdgeColorPreset): string {
  return EDGE_COLOR_BY_PRESET[colorPreset];
}

export const EDGE_DEFAULT_COLOR = getEdgeColor(DEFAULT_EDGE_STYLE.colorPreset);
export const EDGE_SELECTION_COLOR = 'var(--accent)';
export const EDGE_SELECTION_HALO_EXTRA_WIDTH = 6;
export const EDGE_SELECTION_HALO_OPACITY = 0.35;
export const EDGE_TOOLBAR_OFFSET_PX = 8;

/**
 * WebPageFlowNode の Handle 形状（ズーム非依存の CSS px）。
 * - HIT_SIZE: 透明な当たり判定の一辺。ドラッグ開始のヒット領域を広くするため visual より大きく取る。
 * - VISUAL_DOT_SIZE: 視覚的な丸の直径。標準 3px エッジの始点ドットと見た目を揃える。
 * Handle の幾何中心から「外側の辺（= 丸の中心）」までの距離は HIT_SIZE / 2 になる前提で
 * ArrowConnectionLine のドラッグ中接続線も同じオフセットでシフトする。
 */
export const WEBPAGE_HANDLE_HIT_SIZE = 32;
export const WEBPAGE_HANDLE_VISUAL_DOT_SIZE = 16;

// 矢じり回転角（target の面から内側へ向ける）
export const ROTATION_BY_POSITION: Record<Position, number> = {
  [Position.Top]: 90,
  [Position.Right]: 180,
  [Position.Bottom]: 270,
  [Position.Left]: 0,
};
