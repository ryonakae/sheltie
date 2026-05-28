import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';

import {
  ARROW_HALF_WIDTH,
  ARROW_LENGTH,
  ROTATION_BY_POSITION,
  SOURCE_DOT_RADIUS,
} from './arrowGeometry';

/**
 * 終端矢じりを SVG polygon として自前で描くベジェエッジ。
 * 色を React 側で selected から決定するため、marker defs を共有する場合に発生する
 * 「path の stroke は変わるが marker の fill が変わらない」問題を回避する。
 */
export const ArrowEdge = memo(function ArrowEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  selected,
  style,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // HeroUI v3 のテーマ変数を直接参照することで light/dark モードに自動追従する
  const color = selected ? 'var(--accent)' : 'var(--border)';
  const rotation = ROTATION_BY_POSITION[targetPosition];

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{ ...style, stroke: color }} interactionWidth={40} />
      <circle
        cx={sourceX}
        cy={sourceY}
        r={SOURCE_DOT_RADIUS}
        style={{ fill: color, pointerEvents: 'none' }}
      />
      <polygon
        points={`0,0 ${-ARROW_LENGTH},${-ARROW_HALF_WIDTH} ${-ARROW_LENGTH},${ARROW_HALF_WIDTH}`}
        transform={`translate(${targetX} ${targetY}) rotate(${rotation})`}
        strokeLinejoin="round"
        style={{ fill: color, stroke: color, pointerEvents: 'none' }}
      />
    </>
  );
});
