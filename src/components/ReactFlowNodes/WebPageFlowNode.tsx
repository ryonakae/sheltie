import {
  Handle,
  NodeResizeControl,
  NodeToolbar,
  Position,
  ResizeControlVariant,
  useConnection,
  type NodeProps,
  type ResizeDragEvent,
  type ResizeParams,
} from '@xyflow/react';
import { memo, useCallback, useState } from 'react';

import { WebPageNode } from '@/components/Node/WebPageNode';
import {
  WEBPAGE_HANDLE_DRAG_TARGET_SIZE,
  WEBPAGE_HANDLE_HIT_SIZE,
  WEBPAGE_HANDLE_VISUAL_DOT_SIZE,
} from '@/components/ReactFlowEdges/arrowGeometry';
import { selectionHandleBaseStyle } from '@/components/ReactFlowNodes/selectionChromeStyles';
import { SelectionFrameOverlay } from '@/components/ReactFlowNodes/SelectionFrameOverlay';
import { WebPageToolbar } from '@/components/ReactFlowNodes/WebPageToolbar';
import { PAGE_MIN_HEIGHT, PAGE_MIN_WIDTH } from '@/constants';
import { getNodeChromeHeight, getNodeChromeWidth } from '@/lib/sheltie-node-frame';

import type { WebPageFlowNodeData } from './types';

const FRAME_CHROME_WIDTH = getNodeChromeWidth({ type: 'webpage' });
const FRAME_CHROME_HEIGHT = getNodeChromeHeight({ type: 'webpage' });

/**
 * React Flow 用の WebPageNode ラッパー。
 * - ノード矩形 = フレーム外周（Webview の上下左右 24px の余白を含む）
 * - タイトル段 / ツールバー段は NodeToolbar でフレーム外側に配置（zoom-invariant）
 * - 接続ハンドル / リサイズハンドル / バウンディングボックスはフレーム外周基準
 */
export const WebPageFlowNode = memo(function WebPageFlowNode({ id, data, selected }: NodeProps) {
  const { nodeProps, toolbar, onResizeStart, onResize, onResizeEnd } =
    data as unknown as WebPageFlowNodeData;

  // 接続ドラッグ中かどうか。useConnection の toNode はハンドル近接時のみ更新されるため、
  // 「ノード本体に乗っている間ずっと吸着候補を見せる」用途には使えない。代わりに
  // inProgress だけ取得し、ホバー判定は自前で持つ。
  const connectionInProgress = useConnection((conn) => conn.inProgress);
  const [isPointerOver, setIsPointerOver] = useState(false);
  // 複数選択中は接続ハンドル・リサイズハンドルを出さない（単独選択時のみ表示）
  const showHandles = nodeProps.isActive || (connectionInProgress && isPointerOver);
  // 接続中は React Flow の elementFromPoint が親 Handle を直接検出できるようにする。
  const enableDragTarget = nodeProps.isActive && !connectionInProgress;

  const handlePointerEnter = useCallback(() => setIsPointerOver(true), []);
  const handlePointerLeave = useCallback(() => setIsPointerOver(false), []);

  const minWidth = PAGE_MIN_WIDTH + FRAME_CHROME_WIDTH;
  const minHeight = PAGE_MIN_HEIGHT + FRAME_CHROME_HEIGHT;

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
    },
    {
      key: 'right',
      position: 'right' as const,
      resizeDirection: 'horizontal' as const,
    },
    {
      key: 'bottom',
      position: 'bottom' as const,
      resizeDirection: 'vertical' as const,
    },
    {
      key: 'left',
      position: 'left' as const,
      resizeDirection: 'horizontal' as const,
    },
  ];
  const resizeHandleConfigs = [
    { key: 'top-left', position: 'top-left' as const },
    {
      key: 'top-right',
      position: 'top-right' as const,
    },
    {
      key: 'bottom-left',
      position: 'bottom-left' as const,
    },
    {
      key: 'bottom-right',
      position: 'bottom-right' as const,
    },
  ];

  const handleHitSize = `calc(${WEBPAGE_HANDLE_HIT_SIZE}px / var(--canvas-zoom, 1))`;
  const handleDragTargetSize = `calc(${WEBPAGE_HANDLE_DRAG_TARGET_SIZE}px / var(--canvas-zoom, 1))`;
  const handleVisualDotSize = `calc(${WEBPAGE_HANDLE_VISUAL_DOT_SIZE}px / var(--canvas-zoom, 1))`;
  const handleHitStyleBase = {
    width: handleHitSize,
    height: handleHitSize,
    background: 'transparent',
    border: 'none',
    borderRadius: 0,
    minWidth: 0,
    minHeight: 0,
    pointerEvents: connectionInProgress ? 'auto' : 'none',
  } satisfies React.CSSProperties;
  const handleHitStyleByPosition: Record<Position, React.CSSProperties> = {
    [Position.Top]: handleHitStyleBase,
    [Position.Right]: handleHitStyleBase,
    [Position.Bottom]: handleHitStyleBase,
    [Position.Left]: handleHitStyleBase,
  };
  const dragTargetStyleBase = {
    position: 'absolute',
    width: handleDragTargetSize,
    height: handleDragTargetSize,
    background: 'transparent',
    pointerEvents: enableDragTarget ? 'auto' : 'none',
  } satisfies React.CSSProperties;
  const dragTargetStyleByPosition: Record<Position, React.CSSProperties> = {
    [Position.Top]: {
      ...dragTargetStyleBase,
      top: 0,
      left: '50%',
      transform: 'translate(-50%, -50%)',
    },
    [Position.Right]: {
      ...dragTargetStyleBase,
      top: '50%',
      right: 0,
      transform: 'translate(50%, -50%)',
    },
    [Position.Bottom]: {
      ...dragTargetStyleBase,
      bottom: 0,
      left: '50%',
      transform: 'translate(-50%, 50%)',
    },
    [Position.Left]: {
      ...dragTargetStyleBase,
      top: '50%',
      left: 0,
      transform: 'translate(-50%, -50%)',
    },
  };
  const dotVisualStyleBase = {
    position: 'absolute',
    width: handleVisualDotSize,
    height: handleVisualDotSize,
    backgroundColor: '#3b82f6',
    border: 'calc(2px / var(--canvas-zoom, 1)) solid #fff',
    borderRadius: '50%',
    opacity: showHandles ? 1 : 0,
    transition: 'opacity 0.15s',
    pointerEvents: 'none',
  } satisfies React.CSSProperties;
  const dotVisualStyleByPosition: Record<Position, React.CSSProperties> = {
    [Position.Top]: {
      ...dotVisualStyleBase,
      top: 0,
      left: '50%',
      transform: 'translate(-50%, -50%)',
    },
    [Position.Right]: {
      ...dotVisualStyleBase,
      top: '50%',
      right: 0,
      transform: 'translate(50%, -50%)',
    },
    [Position.Bottom]: {
      ...dotVisualStyleBase,
      bottom: 0,
      left: '50%',
      transform: 'translate(-50%, 50%)',
    },
    [Position.Left]: {
      ...dotVisualStyleBase,
      top: '50%',
      left: 0,
      transform: 'translate(-50%, -50%)',
    },
  };

  // タイトル段の幅 = フレーム外周幅（画面上）= node 矩形 width * canvas-zoom
  // タイトル段は NodeToolbar 内（zoom-invariant 領域）にあるため、CSS 変数で画面上 px を表現する
  const titleMaxWidth = `calc((${nodeProps.node.width + FRAME_CHROME_WIDTH}px) * var(--canvas-zoom, 1))`;

  return (
    <div
      className="nopan relative size-full"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {/* ツールバー段（中央寄せ・単独選択時のみ表示） */}
      <NodeToolbar
        position={Position.Top}
        align="center"
        isVisible={!!selected && nodeProps.isActive}
        offset={30}
      >
        <WebPageToolbar
          nodeId={id}
          width={toolbar.displayWidth}
          height={toolbar.displayHeight}
          canGoBack={!toolbar.isEmpty && toolbar.canGoBack}
          canGoForward={!toolbar.isEmpty && toolbar.canGoForward}
          isMoved={toolbar.isMoved}
          isEmpty={toolbar.isEmpty}
          isEditingUrl={toolbar.isEditingUrl}
          currentUrl={toolbar.currentUrl}
          onGoBack={toolbar.onGoBack}
          onGoForward={toolbar.onGoForward}
          onReload={toolbar.onReload}
          onPinUrl={toolbar.onPinUrl}
          onResizePreset={toolbar.onResizePreset}
          onUrlSubmit={toolbar.onUrlSubmit}
        />
      </NodeToolbar>

      {/* タイトル段（左寄せ・常時表示・ドラッグ可能） */}
      <NodeToolbar position={Position.Top} align="start" isVisible offset={8}>
        <div
          className="flex cursor-default items-baseline overflow-hidden text-xs/none whitespace-nowrap text-muted select-none"
          style={{ maxWidth: titleMaxWidth }}
          onPointerDown={toolbar.onTitlePointerDown}
          onContextMenu={toolbar.onTitleContextMenu}
        >
          {toolbar.isMoved && <span className="shrink-0">[Moved]&nbsp;</span>}
          <span className="min-w-0 flex-1 truncate">{toolbar.title}</span>
        </div>
      </NodeToolbar>

      <WebPageNode {...nodeProps} node={{ ...nodeProps.node, x: 0, y: 0 }} />

      <Handle
        type="source"
        position={Position.Top}
        id="top"
        isConnectableStart={enableDragTarget}
        style={handleHitStyleByPosition[Position.Top]}
      >
        <div
          data-connection-handle-drag-target="top"
          style={dragTargetStyleByPosition[Position.Top]}
        />
        <div style={dotVisualStyleByPosition[Position.Top]} />
      </Handle>
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        isConnectableStart={enableDragTarget}
        style={handleHitStyleByPosition[Position.Right]}
      >
        <div
          data-connection-handle-drag-target="right"
          style={dragTargetStyleByPosition[Position.Right]}
        />
        <div style={dotVisualStyleByPosition[Position.Right]} />
      </Handle>
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        isConnectableStart={enableDragTarget}
        style={handleHitStyleByPosition[Position.Bottom]}
      >
        <div
          data-connection-handle-drag-target="bottom"
          style={dragTargetStyleByPosition[Position.Bottom]}
        />
        <div style={dotVisualStyleByPosition[Position.Bottom]} />
      </Handle>
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        isConnectableStart={enableDragTarget}
        style={handleHitStyleByPosition[Position.Left]}
      >
        <div
          data-connection-handle-drag-target="left"
          style={dragTargetStyleByPosition[Position.Left]}
        />
        <div style={dotVisualStyleByPosition[Position.Left]} />
      </Handle>

      {selected && <SelectionFrameOverlay />}
      {nodeProps.isActive && (
        <>
          {resizeLineConfigs.map(({ key, position, resizeDirection }) => (
            <NodeResizeControl
              key={key}
              nodeId={id}
              position={position}
              variant={ResizeControlVariant.Line}
              resizeDirection={resizeDirection}
              autoScale={false}
              minWidth={minWidth}
              minHeight={minHeight}
              style={resizeLineStyle}
              onResizeStart={handleResizeStart}
              onResize={handleResize}
              onResizeEnd={handleResizeEnd}
            />
          ))}
          {resizeHandleConfigs.map(({ key, position }) => (
            <NodeResizeControl
              key={key}
              nodeId={id}
              position={position}
              autoScale={false}
              minWidth={minWidth}
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
