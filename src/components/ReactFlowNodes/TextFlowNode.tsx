import {
  NodeResizeControl,
  NodeToolbar,
  Position,
  ResizeControlVariant,
  type NodeProps,
  type ResizeDragEvent,
  type ResizeParams,
} from '@xyflow/react';
import { memo, useCallback } from 'react';

import { TextNode } from '@/components/Node/TextNode';
import { selectionHandleBaseStyle } from '@/components/ReactFlowNodes/selectionChromeStyles';
import { TextNodeToolbar } from '@/components/ReactFlowNodes/TextNodeToolbar';
import type { TextFlowNodeData } from '@/components/ReactFlowNodes/types';
import { TEXT_NODE_MIN_WIDTH } from '@/constants';

export const TextFlowNode = memo(function TextFlowNode({ id, data, selected }: NodeProps) {
  const { nodeProps, onResize, onResizeEnd } = data as unknown as TextFlowNodeData;

  const handleResize = useCallback(
    (_event: ResizeDragEvent, params: ResizeParams) => {
      onResize(id, {
        ...params,
        width: Math.max(params.width, TEXT_NODE_MIN_WIDTH),
        height: nodeProps.node.height,
      });
    },
    [id, nodeProps.node.height, onResize],
  );

  const handleResizeEnd = useCallback(
    (_event: ResizeDragEvent, params: ResizeParams) => {
      onResizeEnd(id, Math.max(params.width, TEXT_NODE_MIN_WIDTH), nodeProps.node.height);
    },
    [id, nodeProps.node.height, onResizeEnd],
  );

  const resizeLineConfigs = [
    { key: 'left', position: 'left' as const },
    { key: 'right', position: 'right' as const },
  ];
  const resizeHandleConfigs = [
    { key: 'top-left', position: 'top-left' as const },
    { key: 'bottom-left', position: 'bottom-left' as const },
    { key: 'top-right', position: 'top-right' as const },
    { key: 'bottom-right', position: 'bottom-right' as const },
  ];

  return (
    <div className="nopan relative size-full">
      <NodeToolbar isVisible={!!selected} position={Position.Top}>
        <TextNodeToolbar node={nodeProps.node} onStyleChange={nodeProps.onStyleChange} />
      </NodeToolbar>

      <TextNode {...nodeProps} node={{ ...nodeProps.node, x: 0, y: 0 }} />

      {nodeProps.isActive && nodeProps.node.widthMode === 'fixed' && (
        <>
          {resizeLineConfigs.map(({ key, position }) => (
            <NodeResizeControl
              key={key}
              nodeId={id}
              position={position}
              variant={ResizeControlVariant.Line}
              resizeDirection="horizontal"
              autoScale={false}
              minWidth={TEXT_NODE_MIN_WIDTH}
              style={{ opacity: 0 }}
              onResize={handleResize}
              onResizeEnd={handleResizeEnd}
            />
          ))}
          {resizeHandleConfigs.map(({ key, position }) => (
            <NodeResizeControl
              key={key}
              nodeId={id}
              position={position}
              resizeDirection="horizontal"
              autoScale={false}
              minWidth={TEXT_NODE_MIN_WIDTH}
              style={selectionHandleBaseStyle}
              onResize={handleResize}
              onResizeEnd={handleResizeEnd}
            />
          ))}
        </>
      )}
    </div>
  );
});
