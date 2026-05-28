import { Position } from '@xyflow/react';

/**
 * ArrowEdge / ArrowConnectionLine 共通の矢印形状定数。
 * 完成エッジとドラッグ中の接続線で同じ見た目を保つために集約する。
 */
export const ARROW_LENGTH = 16;
export const ARROW_HALF_WIDTH = 10;
export const SOURCE_DOT_RADIUS = 6;
export const EDGE_STROKE_WIDTH = 3;

// 矢じり回転角（target の面から内側へ向ける）
export const ROTATION_BY_POSITION: Record<Position, number> = {
  [Position.Top]: 90,
  [Position.Right]: 180,
  [Position.Bottom]: 270,
  [Position.Left]: 0,
};
