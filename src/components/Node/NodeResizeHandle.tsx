import { RESIZE_CURSOR_MAP, type NodeResizeDirection } from '@/hooks/siteboard/types';
import { zoomPx } from '@/lib/canvas-zoom';

interface NodeResizeHandleProps {
  direction: NodeResizeDirection;
  onMouseDown: (e: React.MouseEvent, direction: NodeResizeDirection) => void;
}

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
  // e/w はネイティブ Webview がエッジを覆うため外側に -4px 拡張して幅を 16px 確保
  e: {
    top: zoomPx(12),
    bottom: zoomPx(12),
    right: zoomPx(-4),
    width: zoomPx(16),
  },
  w: {
    top: zoomPx(12),
    bottom: zoomPx(12),
    left: zoomPx(-4),
    width: zoomPx(16),
  },
  // コーナーも外側に -4px 拡張して overflow-hidden によるクリッピング外に出す
  ne: {
    top: zoomPx(-4),
    right: zoomPx(-4),
    width: zoomPx(16),
    height: zoomPx(16),
  },
  nw: {
    top: zoomPx(-4),
    left: zoomPx(-4),
    width: zoomPx(16),
    height: zoomPx(16),
  },
  se: {
    bottom: zoomPx(-4),
    right: zoomPx(-4),
    width: zoomPx(16),
    height: zoomPx(16),
  },
  sw: {
    bottom: zoomPx(-4),
    left: zoomPx(-4),
    width: zoomPx(16),
    height: zoomPx(16),
  },
};

export function NodeResizeHandle({ direction, onMouseDown }: NodeResizeHandleProps) {
  return (
    <div
      className="absolute z-20"
      style={{ cursor: RESIZE_CURSOR_MAP[direction], ...POSITION_STYLE[direction] }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onMouseDown(e, direction);
      }}
    />
  );
}
