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

export interface BezierPathBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface EdgeToolbarAnchor {
  x: number;
  y: number;
}

const BEZIER_NUMBER_PATTERN = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const BEZIER_EPSILON = 1e-9;

function cubicValue(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const inverseT = 1 - t;
  return inverseT ** 3 * p0 + 3 * inverseT ** 2 * t * p1 + 3 * inverseT * t ** 2 * p2 + t ** 3 * p3;
}

function cubicExtremaParameters(p0: number, p1: number, p2: number, p3: number): number[] {
  const cubic = -p0 + 3 * p1 - 3 * p2 + p3;
  const quadratic = 3 * p0 - 6 * p1 + 3 * p2;
  const linear = -3 * p0 + 3 * p1;
  const a = 3 * cubic;
  const b = 2 * quadratic;
  const c = linear;

  if (Math.abs(a) < BEZIER_EPSILON) {
    if (Math.abs(b) < BEZIER_EPSILON) return [];
    const t = -c / b;
    return t > 0 && t < 1 ? [t] : [];
  }

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)].filter((t) => t > 0 && t < 1);
}

export function getBezierPathBounds(path: string): BezierPathBounds | null {
  if (!/^\s*M/i.test(path) || !/\bC/i.test(path)) return null;
  const values = path.match(BEZIER_NUMBER_PATTERN)?.map(Number);
  if (!values || values.length !== 8 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const [
    sourceX,
    sourceY,
    sourceControlX,
    sourceControlY,
    targetControlX,
    targetControlY,
    targetX,
    targetY,
  ] = values;
  const xValues = [sourceX, targetX];
  const yValues = [sourceY, targetY];
  for (const t of cubicExtremaParameters(sourceX, sourceControlX, targetControlX, targetX)) {
    xValues.push(cubicValue(sourceX, sourceControlX, targetControlX, targetX, t));
  }
  for (const t of cubicExtremaParameters(sourceY, sourceControlY, targetControlY, targetY)) {
    yValues.push(cubicValue(sourceY, sourceControlY, targetControlY, targetY, t));
  }

  return {
    minX: Math.min(...xValues),
    maxX: Math.max(...xValues),
    minY: Math.min(...yValues),
    maxY: Math.max(...yValues),
  };
}

export function getEdgeToolbarAnchor(path: string, fallback: EdgeToolbarAnchor): EdgeToolbarAnchor {
  const bounds = getBezierPathBounds(path);
  return bounds ? { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY } : fallback;
}

export function getSelectionEndpointGeometry(zoom: number): {
  radius: number;
  strokeWidth: number;
} {
  return {
    radius: EDGE_SELECTION_ENDPOINT_RADIUS_PX / zoom,
    strokeWidth: EDGE_SELECTION_ENDPOINT_STROKE_WIDTH_PX / zoom,
  };
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
export const EDGE_SELECTION_ENDPOINT_COLOR = '#3b82f6';
export const EDGE_SELECTION_ENDPOINT_RADIUS_PX = 7;
export const EDGE_SELECTION_ENDPOINT_STROKE_WIDTH_PX = 2;
export const EDGE_TOOLBAR_OFFSET_PX = 16;

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
