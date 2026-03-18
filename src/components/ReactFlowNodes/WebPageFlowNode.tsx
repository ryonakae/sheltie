import {
  NodeResizer,
  type NodeProps,
  type ResizeDragEvent,
  type ResizeParams,
} from '@xyflow/react';
import { memo, useCallback } from 'react';

import { WebPageNode } from '@/components/Node/WebPageNode';
import { PAGE_MIN_HEIGHT, PAGE_MIN_WIDTH } from '@/constants';
import { getNodeChromeHeight } from '@/lib/siteboard-node-frame';

import type { WebPageFlowNodeData } from './types';

/**
 * React Flow 用の WebPageNode ラッパー。
 * - nopan: ノード上でのパンを無効化
 * - React Flow がノード位置を管理するため node の x/y を 0 にオーバーライドする
 * - NodeResizer で8方向リサイズを提供（選択時のみ表示）
 */
export const WebPageFlowNode = memo(function WebPageFlowNode({ id, data, selected }: NodeProps) {
  const { nodeProps, onResizeStart, onResize, onResizeEnd, getZoom } =
    data as unknown as WebPageFlowNodeData;

  const zoom = getZoom();
  // chrome 高さ（TopBar + BottomBar）はズームに応じて変わるため動的に計算
  const minHeight = getNodeChromeHeight({ type: 'webpage' }, zoom) + PAGE_MIN_HEIGHT;

  const handleResizeStart = useCallback(() => {
    onResizeStart(id);
  }, [id, onResizeStart]);

  const handleResize = useCallback(
    (_event: ResizeDragEvent, params: ResizeParams) => {
      onResize(id, params);
    },
    [id, onResize],
  );

  const handleResizeEnd = useCallback(
    (_event: ResizeDragEvent, params: ResizeParams) => {
      onResizeEnd(id, params);
    },
    [id, onResizeEnd],
  );

  return (
    <div className="nopan size-full">
      <WebPageNode {...nodeProps} node={{ ...nodeProps.node, x: 0, y: 0 }} />
      {/* NodeResizer は WebPageNode より後に配置し stacking order を上にすることで
          size-full のコンテンツに覆われずポインターイベントを受け取れるようにする */}
      <NodeResizer
        isVisible={selected}
        minWidth={PAGE_MIN_WIDTH}
        minHeight={minHeight}
        onResizeStart={handleResizeStart}
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
      />
    </div>
  );
});
