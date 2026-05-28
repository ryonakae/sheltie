import {
  Handle,
  NodeResizeControl,
  Position,
  ResizeControlVariant,
  useConnection,
  type NodeProps,
  type ResizeDragEvent,
  type ResizeParams,
} from '@xyflow/react';
import { memo, useCallback, useState } from 'react';

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

  // 接続ドラッグ中かどうか。useConnection の toNode はハンドル近接時のみ更新されるため、
  // 「ノード本体に乗っている間ずっと吸着候補を見せる」用途には使えない。代わりに
  // inProgress だけ取得し、ホバー判定は自前で持つ。
  const connectionInProgress = useConnection((conn) => conn.inProgress);
  const [isPointerOver, setIsPointerOver] = useState(false);
  const showHandles = selected || (connectionInProgress && isPointerOver);

  const handlePointerEnter = useCallback(() => setIsPointerOver(true), []);
  const handlePointerLeave = useCallback(() => setIsPointerOver(false), []);

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

  // pointerEvents は常に 'auto'。非選択ノードでも接続ドラッグの接続先として認識させるため、
  // ヒットテストを無効化せず opacity のみで見た目を切り替える。
  //
  // 構造: Handle 自身は透明な 16x16 のヒット領域。視覚的な丸は Handle の子として「外側の辺の中点」
  // に絶対配置する。React Flow の端点計算は Handle の外側の辺（Right なら x+width など）を使うため、
  // ここに丸の中心を揃えることで「線の始点 = 丸の中心」が一致する。
  // サイズ・offset は --canvas-zoom で zoom-invariant にする。
  const handleSize = 'calc(16px / var(--canvas-zoom, 1))';
  // Handle box は半分（8px）だけ外側に出るようアンカーをずらす。
  // React Flow 既定 transform translate(±50%, ±50%) と組み合わせると、
  // Handle の外側の辺がノード端から 16px 外側に来る = 丸の中心位置。
  const handleAnchorOffset = 'calc(-8px / var(--canvas-zoom, 1))';
  const handleHitStyleBase = {
    width: handleSize,
    height: handleSize,
    background: 'transparent',
    border: 'none',
    borderRadius: 0,
    minWidth: 0,
    minHeight: 0,
  } satisfies React.CSSProperties;
  const handleHitStyleByPosition: Record<Position, React.CSSProperties> = {
    [Position.Top]: { ...handleHitStyleBase, top: handleAnchorOffset },
    [Position.Right]: { ...handleHitStyleBase, right: handleAnchorOffset },
    [Position.Bottom]: { ...handleHitStyleBase, bottom: handleAnchorOffset },
    [Position.Left]: { ...handleHitStyleBase, left: handleAnchorOffset },
  };
  const dotVisualStyleBase = {
    position: 'absolute',
    width: handleSize,
    height: handleSize,
    backgroundColor: '#3b82f6',
    border: 'calc(2px / var(--canvas-zoom, 1)) solid #fff',
    borderRadius: '50%',
    opacity: showHandles ? 1 : 0,
    transition: 'opacity 0.15s',
    pointerEvents: 'none',
  } satisfies React.CSSProperties;
  // Handle 内側で、外側の辺の中点に丸の中心を揃える
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

  return (
    <div
      className="nopan relative size-full"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <WebPageNode {...nodeProps} node={{ ...nodeProps.node, x: 0, y: 0 }} />

      <Handle
        type="source"
        position={Position.Top}
        id="top"
        style={handleHitStyleByPosition[Position.Top]}
      >
        <div style={dotVisualStyleByPosition[Position.Top]} />
      </Handle>
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={handleHitStyleByPosition[Position.Right]}
      >
        <div style={dotVisualStyleByPosition[Position.Right]} />
      </Handle>
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={handleHitStyleByPosition[Position.Bottom]}
      >
        <div style={dotVisualStyleByPosition[Position.Bottom]} />
      </Handle>
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        style={handleHitStyleByPosition[Position.Left]}
      >
        <div style={dotVisualStyleByPosition[Position.Left]} />
      </Handle>

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
