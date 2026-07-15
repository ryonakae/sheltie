import { BaseEdge, EdgeToolbar, getBezierPath, useStore, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';

import { DEFAULT_EDGE_STYLE } from '@/constants';

import {
  EDGE_SELECTION_ENDPOINT_COLOR,
  ROTATION_BY_POSITION,
  getArrowGeometry,
  getEdgeColor,
  getEdgeDashArray,
  getEdgeToolbarAnchor,
  getSelectionEndpointGeometry,
} from './arrowGeometry';
import { ArrowToolbar } from './ArrowToolbar';

import type { ArrowFlowEdge } from './types';

interface EdgeSelectionEndpointsProps {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

const EdgeSelectionEndpoints = memo(function EdgeSelectionEndpoints({
  sourceX,
  sourceY,
  targetX,
  targetY,
}: EdgeSelectionEndpointsProps) {
  const zoom = useStore((state) => state.transform[2]);
  const { radius, strokeWidth } = getSelectionEndpointGeometry(zoom);

  return (
    <>
      <circle
        data-edge-selection-endpoint="source"
        cx={sourceX}
        cy={sourceY}
        r={radius}
        fill="#fff"
        stroke={EDGE_SELECTION_ENDPOINT_COLOR}
        strokeWidth={strokeWidth}
        pointerEvents="none"
      />
      <circle
        data-edge-selection-endpoint="target"
        cx={targetX}
        cy={targetY}
        r={radius}
        fill="#fff"
        stroke={EDGE_SELECTION_ENDPOINT_COLOR}
        strokeWidth={strokeWidth}
        pointerEvents="none"
      />
    </>
  );
});

/**
 * 終端矢じりを SVG polygon として自前で描くベジェエッジ。
 * 選択中も線の見た目は変えず、始点・終点リングと上部ツールバーだけを追加する。
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
  const [edgePath, centerX] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const toolbarAnchor = getEdgeToolbarAnchor(edgePath, {
    x: centerX,
    y: Math.min(sourceY, targetY),
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

      {selected ? (
        <EdgeSelectionEndpoints
          sourceX={sourceX}
          sourceY={sourceY}
          targetX={targetX}
          targetY={targetY}
        />
      ) : null}

      {data ? (
        <EdgeToolbar
          edgeId={id}
          x={toolbarAnchor.x}
          y={toolbarAnchor.y}
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
