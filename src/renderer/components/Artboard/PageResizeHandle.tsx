type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface PageResizeHandleProps {
  direction: ResizeDirection;
  onMouseDown: (e: React.MouseEvent, direction: ResizeDirection) => void;
}

const CURSOR_MAP: Record<ResizeDirection, string> = {
  n: 'n-resize',
  s: 's-resize',
  e: 'e-resize',
  w: 'w-resize',
  ne: 'ne-resize',
  nw: 'nw-resize',
  se: 'se-resize',
  sw: 'sw-resize',
};

/** ハンドルの位置スタイル */
const POSITION_STYLE: Record<ResizeDirection, React.CSSProperties> = {
  n: { top: 0, left: 8, right: 8, height: 4, cursor: 'n-resize' },
  s: { bottom: 0, left: 8, right: 8, height: 4, cursor: 's-resize' },
  e: { top: 8, bottom: 8, right: 0, width: 4, cursor: 'e-resize' },
  w: { top: 8, bottom: 8, left: 0, width: 4, cursor: 'w-resize' },
  ne: { top: 0, right: 0, width: 8, height: 8, cursor: 'ne-resize' },
  nw: { top: 0, left: 0, width: 8, height: 8, cursor: 'nw-resize' },
  se: { bottom: 0, right: 0, width: 8, height: 8, cursor: 'se-resize' },
  sw: { bottom: 0, left: 0, width: 8, height: 8, cursor: 'sw-resize' },
};

export function PageResizeHandle({ direction, onMouseDown }: PageResizeHandleProps) {
  return (
    <div
      className="absolute z-10"
      style={{ ...POSITION_STYLE[direction], cursor: CURSOR_MAP[direction] }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onMouseDown(e, direction);
      }}
    />
  );
}
