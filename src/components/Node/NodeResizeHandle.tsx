import { RESIZE_CURSOR_MAP, type NodeResizeDirection } from '@/hooks/siteboard/types';
import { zoomPx } from '@/lib/canvas-zoom';

interface NodeResizeHandleProps {
  direction: NodeResizeDirection;
  onMouseDown: (e: React.MouseEvent, direction: NodeResizeDirection) => void;
}

/** ハンドルの位置スタイル（calc() でズームに関係なく一定のヒット領域を確保） */
const POSITION_STYLE: Record<NodeResizeDirection, React.CSSProperties> = {
  n: {
    top: zoomPx(-8),
    left: zoomPx(8),
    right: zoomPx(8),
    height: zoomPx(16),
  },
  s: {
    bottom: zoomPx(-8),
    left: zoomPx(8),
    right: zoomPx(8),
    height: zoomPx(16),
  },
  e: {
    top: zoomPx(8),
    bottom: zoomPx(8),
    right: zoomPx(-8),
    width: zoomPx(16),
  },
  w: {
    top: zoomPx(8),
    bottom: zoomPx(8),
    left: zoomPx(-8),
    width: zoomPx(16),
  },
  // コーナー
  ne: {
    top: zoomPx(-8),
    right: zoomPx(-8),
    width: zoomPx(16),
    height: zoomPx(16),
  },
  nw: {
    top: zoomPx(-8),
    left: zoomPx(-8),
    width: zoomPx(16),
    height: zoomPx(16),
  },
  se: {
    bottom: zoomPx(-8),
    right: zoomPx(-8),
    width: zoomPx(16),
    height: zoomPx(16),
  },
  sw: {
    bottom: zoomPx(-8),
    left: zoomPx(-8),
    width: zoomPx(16),
    height: zoomPx(16),
  },
};

export function NodeResizeHandle({ direction, onMouseDown }: NodeResizeHandleProps) {
  return (
    <div
      className="absolute z-20"
      style={{
        cursor: RESIZE_CURSOR_MAP[direction],
        ...POSITION_STYLE[direction],
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onMouseDown(e, direction);
      }}
    />
  );
}
