import {
  Position,
  getBezierPath,
  useStore,
  type ConnectionLineComponentProps,
} from '@xyflow/react';

import {
  ARROW_HALF_WIDTH,
  ARROW_LENGTH,
  EDGE_STROKE_WIDTH,
  ROTATION_BY_POSITION,
  SOURCE_DOT_RADIUS,
  WEBPAGE_HANDLE_HIT_SIZE,
} from './arrowGeometry';

// React Flow がドラッグ中に渡す座標は「handle の幾何中心」だが、完成後の ArrowEdge は
// 「handle の外側の辺 = 丸の中心」を使う。Handle の中心から外側の辺までは HIT_SIZE / 2 CSS px。
// この差を Position 方向にシフトして見た目を連続させる。
const HANDLE_CENTER_TO_OUTER_EDGE_CSS = WEBPAGE_HANDLE_HIT_SIZE / 2;

function shiftOuter(x: number, y: number, position: Position, magnitude: number) {
  switch (position) {
    case Position.Top:
      return { x, y: y - magnitude };
    case Position.Right:
      return { x: x + magnitude, y };
    case Position.Bottom:
      return { x, y: y + magnitude };
    case Position.Left:
      return { x: x - magnitude, y };
  }
}

/**
 * ドラッグ中の接続線。完成後の ArrowEdge と同じ見た目（始点ドット + ベジェ + 終点矢じり）。
 * 色は未選択エッジと同じ var(--border) を使い、吸着後にエッジへ置き換わっても見た目が連続する。
 */
export function ArrowConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  toHandle,
}: ConnectionLineComponentProps) {
  const zoom = useStore((s) => s.transform[2]);
  const offset = HANDLE_CENTER_TO_OUTER_EDGE_CSS / zoom;

  const fromPoint = shiftOuter(fromX, fromY, fromPosition, offset);
  // toHandle 有り = 吸着中。吸着していないときは toX/toY が「カーソル位置」なのでシフトしない。
  const toPoint = toHandle ? shiftOuter(toX, toY, toPosition, offset) : { x: toX, y: toY };

  const [edgePath] = getBezierPath({
    sourceX: fromPoint.x,
    sourceY: fromPoint.y,
    sourcePosition: fromPosition,
    targetX: toPoint.x,
    targetY: toPoint.y,
    targetPosition: toPosition,
  });

  const color = 'var(--border)';
  const rotation = ROTATION_BY_POSITION[toPosition];

  return (
    <g>
      <path d={edgePath} fill="none" style={{ stroke: color, strokeWidth: EDGE_STROKE_WIDTH }} />
      <circle cx={fromPoint.x} cy={fromPoint.y} r={SOURCE_DOT_RADIUS} style={{ fill: color }} />
      <polygon
        points={`0,0 ${-ARROW_LENGTH},${-ARROW_HALF_WIDTH} ${-ARROW_LENGTH},${ARROW_HALF_WIDTH}`}
        transform={`translate(${toPoint.x} ${toPoint.y}) rotate(${rotation})`}
        strokeLinejoin="round"
        style={{ fill: color, stroke: color }}
      />
    </g>
  );
}
