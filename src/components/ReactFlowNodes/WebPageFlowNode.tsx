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

import { WebPageNode } from '@/components/Node/WebPageNode';
import { WebPageNodeBottomBar } from '@/components/Node/WebPageNodeBottomBar';
import { WebPageNodeTopBar } from '@/components/Node/WebPageNodeTopBar';
import { selectionHandleBaseStyle } from '@/components/ReactFlowNodes/selectionChromeStyles';
import { SelectionFrameOverlay } from '@/components/ReactFlowNodes/SelectionFrameOverlay';
import {
  PAGE_MIN_HEIGHT,
  PAGE_MIN_WIDTH,
  WEB_PAGE_BOTTOM_BAR_HEIGHT,
  WEB_PAGE_TOP_BAR_HEIGHT,
} from '@/constants';
import { getNodeChromeHeight } from '@/lib/siteboard-node-frame';
import { isNodeEmpty, isNodeMoved } from '@/types';

import type { WebPageFlowNodeData } from './types';

/**
 * React Flow 用の WebPageNode ラッパー。
 * - nopan: ノード上でのパンを無効化
 * - React Flow がノード位置を管理するため node の x/y を 0 にオーバーライドする
 * - WebPageNode 本体に bar shell を持たせ、NodeToolbar は透明な操作レイヤとして重ねる
 * - NodeResizeControl を 8 個明示配置し、corner handle は付箋ノードと同じ交点基準で描画する
 */
export const WebPageFlowNode = memo(function WebPageFlowNode({ id, data, selected }: NodeProps) {
  const { nodeProps, layoutZoom, onResizeStart, onResize, onResizeEnd } =
    data as unknown as WebPageFlowNodeData;
  const toolbarWidth = `calc(${nodeProps.displayWidth}px * var(--canvas-zoom, 1))`;

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

  return (
    <div className="nopan relative size-full">
      <NodeToolbar
        isVisible
        position={Position.Top}
        offset={-WEB_PAGE_TOP_BAR_HEIGHT}
        className="pointer-events-none"
        style={{ width: toolbarWidth, maxWidth: toolbarWidth }}
      >
        <WebPageNodeTopBar
          title={nodeProps.title}
          url={nodeProps.node.url}
          isMoved={isNodeMoved(nodeProps.node)}
          canGoBack={isNodeEmpty(nodeProps.node) ? false : nodeProps.canGoBack}
          canGoForward={isNodeEmpty(nodeProps.node) ? false : nodeProps.canGoForward}
          onGoBack={isNodeEmpty(nodeProps.node) ? undefined : () => nodeProps.onGoBack(id)}
          onGoForward={isNodeEmpty(nodeProps.node) ? undefined : () => nodeProps.onGoForward(id)}
          onReload={isNodeEmpty(nodeProps.node) ? undefined : () => nodeProps.onReload(id)}
          onPinUrl={isNodeMoved(nodeProps.node) ? () => nodeProps.onPinUrl(id) : undefined}
          hideNavigationControls={nodeProps.hideTopNavControls}
        />
      </NodeToolbar>

      <WebPageNode {...nodeProps} node={{ ...nodeProps.node, x: 0, y: 0 }} />

      <NodeToolbar
        isVisible
        position={Position.Bottom}
        offset={-WEB_PAGE_BOTTOM_BAR_HEIGHT}
        className="pointer-events-none"
        style={{ width: toolbarWidth, maxWidth: toolbarWidth }}
      >
        <WebPageNodeBottomBar
          width={nodeProps.displayWidth}
          height={nodeProps.displayHeight}
          hidePresetControls={nodeProps.hideBottomPresetControls}
          onResizePreset={(width, height) => nodeProps.onResizePreset(id, width, height)}
        />
      </NodeToolbar>

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
