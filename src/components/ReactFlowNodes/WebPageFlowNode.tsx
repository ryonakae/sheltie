import {
  Handle,
  NodeResizeControl,
  Position,
  ResizeControlVariant,
  type NodeProps,
  type ResizeDragEvent,
  type ResizeParams,
} from '@xyflow/react';
import { memo, useCallback } from 'react';

import { WebPageNode } from '@/components/Node/WebPageNode';
import { selectionHandleBaseStyle } from '@/components/ReactFlowNodes/selectionChromeStyles';
import { SelectionFrameOverlay } from '@/components/ReactFlowNodes/SelectionFrameOverlay';
import { PAGE_MIN_HEIGHT, PAGE_MIN_WIDTH } from '@/constants';
import { getNodeChromeHeight } from '@/lib/siteboard-node-frame';

import type { WebPageFlowNodeData } from './types';

/**
 * React Flow 用の WebPageNode ラッパー。
 * - nopan: ノード上でのパンを無効化
 * - React Flow がノード位置を管理するため node の x/y を 0 にオーバーライドする
 * - WebPageNode 本体に top / bottom chrome と操作 UI を持たせる
 * - NodeResizeControl を 8 個明示配置し、corner handle は付箋ノードと同じ交点基準で描画する
 */
export const WebPageFlowNode = memo(function WebPageFlowNode({ id, data, selected }: NodeProps) {
  const { nodeProps, layoutZoom, onResizeStart, onResize, onResizeEnd } =
    data as unknown as WebPageFlowNodeData;

  // chrome 高さ（TopBar + BottomBar）はズームに応じて変わるため動的に計算
  const minHeight = getNodeChromeHeight({ type: 'webpage' }, layoutZoom) + PAGE_MIN_HEIGHT;

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
  const resizeLineStyle = { opacity: 0 } as const;
  const resizeHandleStyle = selectionHandleBaseStyle;
  const resizeLineConfigs = [
    {
      key: 'top',
      position: 'top' as const,
      resizeDirection: 'vertical' as const,
      className: 'siteboard-web-resize-line',
    },
    {
      key: 'right',
      position: 'right' as const,
      resizeDirection: 'horizontal' as const,
      className: 'siteboard-web-resize-line',
    },
    {
      key: 'bottom',
      position: 'bottom' as const,
      resizeDirection: 'vertical' as const,
      className: 'siteboard-web-resize-line',
    },
    {
      key: 'left',
      position: 'left' as const,
      resizeDirection: 'horizontal' as const,
      className: 'siteboard-web-resize-line',
    },
  ];
  const resizeHandleConfigs = [
    { key: 'top-left', position: 'top-left' as const, className: 'siteboard-web-resize-handle' },
    {
      key: 'top-right',
      position: 'top-right' as const,
      className: 'siteboard-web-resize-handle',
    },
    {
      key: 'bottom-left',
      position: 'bottom-left' as const,
      className: 'siteboard-web-resize-handle',
    },
    {
      key: 'bottom-right',
      position: 'bottom-right' as const,
      className: 'siteboard-web-resize-handle',
    },
  ];

  const handleStyle = {
    width: 'calc(10px / var(--canvas-zoom, 1))',
    height: 'calc(10px / var(--canvas-zoom, 1))',
    backgroundColor: '#3b82f6',
    border: 'calc(2px / var(--canvas-zoom, 1)) solid #fff',
    borderRadius: '50%',
    opacity: selected ? 1 : 0,
    transition: 'opacity 0.15s',
    pointerEvents: (selected ? 'auto' : 'none') as React.CSSProperties['pointerEvents'],
  } satisfies React.CSSProperties;

  return (
    <div className="nopan relative size-full">
      <WebPageNode {...nodeProps} node={{ ...nodeProps.node, x: 0, y: 0 }} />

      <Handle type="source" position={Position.Top} id="top" style={handleStyle} />
      <Handle type="source" position={Position.Right} id="right" style={handleStyle} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={handleStyle} />
      <Handle type="source" position={Position.Left} id="left" style={handleStyle} />

      {selected && <SelectionFrameOverlay />}
      {selected && (
        <>
          {resizeLineConfigs.map(({ key, position, resizeDirection, className }) => (
            <NodeResizeControl
              key={key}
              nodeId={id}
              position={position}
              variant={ResizeControlVariant.Line}
              resizeDirection={resizeDirection}
              className={className}
              autoScale={false}
              minWidth={PAGE_MIN_WIDTH}
              minHeight={minHeight}
              style={resizeLineStyle}
              onResizeStart={handleResizeStart}
              onResize={handleResize}
              onResizeEnd={handleResizeEnd}
            />
          ))}
          {resizeHandleConfigs.map(({ key, position, className }) => (
            <NodeResizeControl
              key={key}
              nodeId={id}
              position={position}
              className={className}
              autoScale={false}
              minWidth={PAGE_MIN_WIDTH}
              minHeight={minHeight}
              style={resizeHandleStyle}
              onResizeStart={handleResizeStart}
              onResize={handleResize}
              onResizeEnd={handleResizeEnd}
            />
          ))}
        </>
      )}
    </div>
  );
});
