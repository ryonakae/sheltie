import { useCallback } from 'react';

import type { Page } from '../../types/tab';
import { PageResizeHandle } from './PageResizeHandle';
import { PageTitleBar } from './PageTitleBar';

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface PageFrameProps {
  page: Page;
  isActive: boolean;
  title: string;
  onActivate: () => void;
  onClose: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent, direction: ResizeDirection) => void;
}

export function PageFrame({
  page,
  isActive,
  title,
  onActivate,
  onClose,
  onDragStart,
  onResizeStart,
}: PageFrameProps) {
  const handleTitleBarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      onActivate();
      onDragStart(e);
    },
    [onActivate, onDragStart],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, direction: ResizeDirection) => {
      onActivate();
      onResizeStart(e, direction);
    },
    [onActivate, onResizeStart],
  );

  return (
    <div
      className={[
        'absolute flex flex-col rounded-lg shadow-lg',
        isActive ? 'ring-2 ring-focus' : 'ring-1 ring-border',
      ].join(' ')}
      style={{ left: page.x, top: page.y, width: page.width }}
      data-page-id={page.id}
      onMouseDown={onActivate}
    >
      <PageTitleBar
        title={title}
        url={page.url}
        width={page.width}
        height={page.height}
        onClose={onClose}
        onMouseDown={handleTitleBarMouseDown}
      />

      {/* WebContentsView がネイティブレイヤーでこの領域に表示される。
          透明プレースホルダーとして高さを確保する */}
      <div
        data-page-placeholder
        className="rounded-b-lg"
        style={{ width: page.width, height: page.height }}
      />

      {/* リサイズハンドル（8方向） */}
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDirection[]).map((dir) => (
        <PageResizeHandle key={dir} direction={dir} onMouseDown={handleResizeStart} />
      ))}
    </div>
  );
}

export type { ResizeDirection };
