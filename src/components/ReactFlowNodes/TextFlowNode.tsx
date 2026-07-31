import {
  NodeToolbar,
  Position,
  type NodeProps,
  type ResizeDragEvent,
  type ResizeParams,
} from '@xyflow/react';
import { memo, useCallback } from 'react';

import { TextNode } from '@/components/Node/TextNode';
import { NodeWidthResizeControls } from '@/components/ReactFlowNodes/NodeWidthResizeControls';
import { SelectionFrameOverlay } from '@/components/ReactFlowNodes/SelectionFrameOverlay';
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

  const handleRevertToAutoWidth = useCallback(() => {
    nodeProps.onWidthModeChange(id, 'auto');
  }, [id, nodeProps]);

  return (
    <div className="nopan relative size-full">
      <NodeToolbar isVisible={!!selected && nodeProps.isActive} position={Position.Top}>
        <TextNodeToolbar node={nodeProps.node} onStyleChange={nodeProps.onStyleChange} />
      </NodeToolbar>

      <TextNode {...nodeProps} node={{ ...nodeProps.node, x: 0, y: 0 }} />

      {selected && <SelectionFrameOverlay />}

      {nodeProps.isActive && (
        <NodeWidthResizeControls
          nodeId={id}
          minWidth={TEXT_NODE_MIN_WIDTH}
          onResize={handleResize}
          onResizeEnd={handleResizeEnd}
          onDoubleClickRevert={handleRevertToAutoWidth}
        />
      )}
    </div>
  );
});
