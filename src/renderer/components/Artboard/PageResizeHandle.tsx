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

const Z = 'var(--canvas-zoom, 1)';

/** ハンドルの位置スタイル（calc() でズームに関係なく一定のヒット領域を確保） */
const POSITION_STYLE: Record<ResizeDirection, React.CSSProperties> = {
  n: { top: 0, left: `calc(8px / ${Z})`, right: `calc(8px / ${Z})`, height: `calc(4px / ${Z})` },
  s: {
    bottom: 0,
    left: `calc(8px / ${Z})`,
    right: `calc(8px / ${Z})`,
    height: `calc(4px / ${Z})`,
  },
  e: { top: `calc(8px / ${Z})`, bottom: `calc(8px / ${Z})`, right: 0, width: `calc(4px / ${Z})` },
  w: { top: `calc(8px / ${Z})`, bottom: `calc(8px / ${Z})`, left: 0, width: `calc(4px / ${Z})` },
  ne: { top: 0, right: 0, width: `calc(8px / ${Z})`, height: `calc(8px / ${Z})` },
  nw: { top: 0, left: 0, width: `calc(8px / ${Z})`, height: `calc(8px / ${Z})` },
  se: { bottom: 0, right: 0, width: `calc(8px / ${Z})`, height: `calc(8px / ${Z})` },
  sw: { bottom: 0, left: 0, width: `calc(8px / ${Z})`, height: `calc(8px / ${Z})` },
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
