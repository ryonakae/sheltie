import {
  NodeResizeControl,
  ResizeControlVariant,
  type ResizeDragEvent,
  type ResizeParams,
} from '@xyflow/react';

import { selectionHandleBaseStyle } from '@/components/ReactFlowNodes/selectionChromeStyles';

const RESIZE_LINE_POSITIONS = ['left', 'right'] as const;
const RESIZE_HANDLE_POSITIONS = ['top-left', 'bottom-left', 'top-right', 'bottom-right'] as const;

interface NodeWidthResizeControlsProps {
  nodeId: string;
  minWidth: number;
  onResize: (event: ResizeDragEvent, params: ResizeParams) => void;
  onResizeEnd: (event: ResizeDragEvent, params: ResizeParams) => void;
  /** テキストノードだけが使う、辺のダブルクリックで auto 幅へ戻す挙動 */
  onDoubleClickRevert?: () => void;
}

/**
 * 付箋 / テキストノードで共通の幅リサイズ操作。
 * 左右辺は不可視の Line、四隅は選択ハンドルとして描き、どちらも左右幅リサイズだけを扱う。
 * 高さは内容量に応じた自動調整に委譲する。
 */
export function NodeWidthResizeControls({
  nodeId,
  minWidth,
  onResize,
  onResizeEnd,
  onDoubleClickRevert,
}: NodeWidthResizeControlsProps) {
  const revertOverlay = onDoubleClickRevert ? (
    <div className="absolute inset-0" onDoubleClick={onDoubleClickRevert} />
  ) : null;

  return (
    <>
      {RESIZE_LINE_POSITIONS.map((position) => (
        <NodeResizeControl
          key={position}
          nodeId={nodeId}
          position={position}
          variant={ResizeControlVariant.Line}
          resizeDirection="horizontal"
          autoScale={false}
          minWidth={minWidth}
          style={{ opacity: 0 }}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
        >
          {revertOverlay}
        </NodeResizeControl>
      ))}
      {RESIZE_HANDLE_POSITIONS.map((position) => (
        <NodeResizeControl
          key={position}
          nodeId={nodeId}
          position={position}
          resizeDirection="horizontal"
          autoScale={false}
          minWidth={minWidth}
          style={selectionHandleBaseStyle}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
        >
          {revertOverlay}
        </NodeResizeControl>
      ))}
    </>
  );
}
