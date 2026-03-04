import type { NodeResizeDirection } from '@/hooks/siteboard/types';
import { zoomPx } from '@/lib/canvas-zoom';

interface NodeResizeHandleProps {
  direction: NodeResizeDirection;
  onMouseDown: (e: React.MouseEvent, direction: NodeResizeDirection) => void;
}

const CURSOR_CLASS_MAP: Record<NodeResizeDirection, string> = {
  n: 'cursor-ns-resize',
  s: 'cursor-ns-resize',
  e: 'cursor-ew-resize',
  w: 'cursor-ew-resize',
  ne: 'cursor-nesw-resize',
  nw: 'cursor-nwse-resize',
  se: 'cursor-nwse-resize',
  sw: 'cursor-nesw-resize',
};

/** ハンドルの位置スタイル（calc() でズームに関係なく一定のヒット領域を確保） */
const POSITION_STYLE: Record<NodeResizeDirection, React.CSSProperties> = {
  n: {
    top: 0,
    left: zoomPx(12),
    right: zoomPx(12),
    height: zoomPx(12),
  },
  s: {
    bottom: 0,
    left: zoomPx(12),
    right: zoomPx(12),
    height: zoomPx(12),
  },
  e: {
    top: zoomPx(12),
    bottom: zoomPx(12),
    right: 0,
    width: zoomPx(12),
  },
  w: {
    top: zoomPx(12),
    bottom: zoomPx(12),
    left: 0,
    width: zoomPx(12),
  },
  ne: {
    top: 0,
    right: 0,
    width: zoomPx(12),
    height: zoomPx(12),
  },
  nw: {
    top: 0,
    left: 0,
    width: zoomPx(12),
    height: zoomPx(12),
  },
  se: {
    bottom: 0,
    right: 0,
    width: zoomPx(12),
    height: zoomPx(12),
  },
  sw: {
    bottom: 0,
    left: 0,
    width: zoomPx(12),
    height: zoomPx(12),
  },
};

export function NodeResizeHandle({ direction, onMouseDown }: NodeResizeHandleProps) {
  return (
    <div
      className={`absolute z-20 ${CURSOR_CLASS_MAP[direction]}`}
      style={POSITION_STYLE[direction]}
      onMouseDown={(e) => {
        e.stopPropagation();
        onMouseDown(e, direction);
      }}
    />
  );
}
