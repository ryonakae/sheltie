import { Position } from '@xyflow/react';

/**
 * ArrowEdge / ArrowConnectionLine 共通の矢印形状定数。
 * 完成エッジとドラッグ中の接続線で同じ見た目を保つために集約する。
 */
export const ARROW_LENGTH = 16;
export const ARROW_HALF_WIDTH = 10;
export const SOURCE_DOT_RADIUS = 6;
export const EDGE_STROKE_WIDTH = 3;

/**
 * WebPageFlowNode の Handle 形状（ズーム非依存の CSS px）。
 * - HIT_SIZE: 透明な当たり判定の一辺。ドラッグ開始のヒット領域を広くするため visual より大きく取る。
 * - VISUAL_DOT_SIZE: 視覚的な丸の直径。完成エッジの SOURCE_DOT_RADIUS と見た目を揃える。
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
