import {
  PAGE_RESIZE_CORNER_SIZE,
  PAGE_RESIZE_HANDLE_OFFSET,
  PAGE_RESIZE_HANDLE_SIZE,
} from '@/renderer/constants';

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface PageResizeHandleProps {
  direction: ResizeDirection;
  onMouseDown: (e: React.MouseEvent, direction: ResizeDirection) => void;
}

const CURSOR_MAP: Record<ResizeDirection, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize',
};

const EDGE_SIZE = PAGE_RESIZE_HANDLE_SIZE;
const EDGE_OFFSET = PAGE_RESIZE_HANDLE_OFFSET;
const CORNER_SIZE = PAGE_RESIZE_CORNER_SIZE;

/** ハンドルの位置スタイル（calc() でズームに関係なく一定のヒット領域を確保） */
const POSITION_STYLE: Record<ResizeDirection, React.CSSProperties> = {
  n: { top: 0, left: EDGE_OFFSET, right: EDGE_OFFSET, height: EDGE_SIZE },
  s: {
    bottom: 0,
    left: EDGE_OFFSET,
    right: EDGE_OFFSET,
    height: EDGE_SIZE,
  },
  e: { top: EDGE_OFFSET, bottom: EDGE_OFFSET, right: 0, width: EDGE_SIZE },
  w: { top: EDGE_OFFSET, bottom: EDGE_OFFSET, left: 0, width: EDGE_SIZE },
  ne: { top: 0, right: 0, width: CORNER_SIZE, height: CORNER_SIZE },
  nw: { top: 0, left: 0, width: CORNER_SIZE, height: CORNER_SIZE },
  se: { bottom: 0, right: 0, width: CORNER_SIZE, height: CORNER_SIZE },
  sw: { bottom: 0, left: 0, width: CORNER_SIZE, height: CORNER_SIZE },
};

export function PageResizeHandle({ direction, onMouseDown }: PageResizeHandleProps) {
  return (
    <div
      className="absolute z-20"
      style={{ ...POSITION_STYLE[direction], cursor: CURSOR_MAP[direction] }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onMouseDown(e, direction);
      }}
    />
  );
}
