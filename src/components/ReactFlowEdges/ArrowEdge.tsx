import { BaseEdge, EdgeToolbar, getBezierPath, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';

import { DEFAULT_EDGE_STYLE } from '@/constants';

import {
  EDGE_SELECTION_COLOR,
  EDGE_SELECTION_HALO_EXTRA_WIDTH,
  EDGE_SELECTION_HALO_OPACITY,
  ROTATION_BY_POSITION,
  getArrowGeometry,
  getEdgeColor,
  getEdgeDashArray,
} from './arrowGeometry';
import { ArrowToolbar } from './ArrowToolbar';

import type { ArrowFlowEdge } from './types';

/**
 * 終端矢じりを SVG polygon として自前で描くベジェエッジ。
 * 色を React 側で解決し、選択中も設定色を保ったまま背面の halo で選択を示す。
 */
export const ArrowEdge = memo(function ArrowEdge({
  id,
  source,
  sourceHandleId,
  sourceX,
  sourceY,
  sourcePosition,
  target,
  targetHandleId,
  targetX,
  targetY,
  targetPosition,
  selected,
  style,
  data,
}: EdgeProps<ArrowFlowEdge>) {
  const [edgePath, centerX, centerY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const edge = data?.edge ?? {
    ...DEFAULT_EDGE_STYLE,
    id,
    source,
    sourceHandle: sourceHandleId ?? null,
    target,
    targetHandle: targetHandleId ?? null,
  };
  const { strokeWidth, lineStyle, colorPreset } = edge;
  const { sourceDotRadius, arrowLength, arrowHalfWidth } = getArrowGeometry(strokeWidth);
  const strokeDasharray = getEdgeDashArray(strokeWidth, lineStyle);
  const color = getEdgeColor(colorPreset);
  const rotation = ROTATION_BY_POSITION[targetPosition];
  const arrowPoints = `0,0 ${-arrowLength},${-arrowHalfWidth} ${-arrowLength},${arrowHalfWidth}`;
  const canShowToolbar = !!selected && !!data?.isActive;

  return (
    <>
      {selected ? (
        <>
          <path
            d={edgePath}
            fill="none"
            stroke={EDGE_SELECTION_COLOR}
            strokeWidth={strokeWidth + EDGE_SELECTION_HALO_EXTRA_WIDTH}
            strokeDasharray={strokeDasharray}
            opacity={EDGE_SELECTION_HALO_OPACITY}
            pointerEvents="none"
          />
          <circle
            cx={sourceX}
            cy={sourceY}
            r={sourceDotRadius + EDGE_SELECTION_HALO_EXTRA_WIDTH / 2}
            fill={EDGE_SELECTION_COLOR}
            opacity={EDGE_SELECTION_HALO_OPACITY}
            pointerEvents="none"
          />
          <polygon
            points={arrowPoints}
            transform={`translate(${targetX} ${targetY}) rotate(${rotation})`}
            fill={EDGE_SELECTION_COLOR}
            stroke={EDGE_SELECTION_COLOR}
            strokeWidth={EDGE_SELECTION_HALO_EXTRA_WIDTH}
            strokeLinejoin="round"
            opacity={EDGE_SELECTION_HALO_OPACITY}
            pointerEvents="none"
          />
        </>
      ) : null}

      <BaseEdge
        id={id}
        path={edgePath}
        style={{ ...style, stroke: color, strokeWidth, strokeDasharray }}
        interactionWidth={40}
      />
      <circle
        cx={sourceX}
        cy={sourceY}
        r={sourceDotRadius}
        style={{ fill: color, pointerEvents: 'none' }}
      />
      <polygon
        points={arrowPoints}
        transform={`translate(${targetX} ${targetY}) rotate(${rotation})`}
        strokeLinejoin="round"
        style={{ fill: color, stroke: color, pointerEvents: 'none' }}
      />

      {data ? (
        <EdgeToolbar
          edgeId={id}
          x={centerX}
          y={centerY}
          alignX="center"
          alignY="bottom"
          isVisible={canShowToolbar}
        >
          <ArrowToolbar edge={edge} onStyleChange={data.onStyleChange} onReverse={data.onReverse} />
        </EdgeToolbar>
      ) : null}
    </>
  );
});
