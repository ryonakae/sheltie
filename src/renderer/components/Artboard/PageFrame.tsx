import { useCallback, useEffect, useRef } from 'react';

import type { Page } from '@/renderer/types/tab';
import { PageResizeHandle } from '@/renderer/components/Artboard/PageResizeHandle';
import { PageTitleBar } from '@/renderer/components/Artboard/PageTitleBar';

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface PageFrameProps {
  page: Page;
  isActive: boolean;
  title: string;
  displayWidth: number;
  displayHeight: number;
  isInteracting: boolean;
  onActivate: () => void;
  onClose: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent, direction: ResizeDirection) => void;
  onNavigated: (pageId: string, url: string, title: string) => void;
  onTitleUpdated: (pageId: string, title: string) => void;
}

export function PageFrame({
  page,
  isActive,
  title,
  displayWidth,
  displayHeight,
  isInteracting,
  onActivate,
  onClose,
  onDragStart,
  onResizeStart,
  onNavigated,
  onTitleUpdated,
}: PageFrameProps) {
  const webviewRef = useRef<Electron.WebviewTag>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleDidNavigate = () => {
      onNavigated(page.id, webview.getURL(), webview.getTitle());
    };

    const handleDidNavigateInPage = (e: Electron.DidNavigateInPageEvent) => {
      // サブフレームのナビゲーションは無視する
      if (!e.isMainFrame) return;
      onNavigated(page.id, webview.getURL(), webview.getTitle());
    };

    const handleTitleUpdated = () => {
      onTitleUpdated(page.id, webview.getTitle());
    };

    webview.addEventListener('did-navigate', handleDidNavigate);
    webview.addEventListener('did-navigate-in-page', handleDidNavigateInPage);
    webview.addEventListener('page-title-updated', handleTitleUpdated);

    return () => {
      webview.removeEventListener('did-navigate', handleDidNavigate);
      webview.removeEventListener('did-navigate-in-page', handleDidNavigateInPage);
      webview.removeEventListener('page-title-updated', handleTitleUpdated);
    };
  }, [page.id, onNavigated, onTitleUpdated]);

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
      className="absolute flex flex-col shadow-lg"
      style={{
        left: page.x,
        top: page.y,
        width: page.width,
        borderRadius: 'calc(8px / var(--canvas-zoom, 1))',
        outline: isActive
          ? 'calc(2px / var(--canvas-zoom, 1)) solid var(--color-focus)'
          : 'calc(1px / var(--canvas-zoom, 1)) solid var(--color-border)',
        outlineOffset: 'calc(-1px / var(--canvas-zoom, 1))',
      }}
      data-page-id={page.id}
      onMouseDown={onActivate}
    >
      <PageTitleBar
        title={title}
        url={page.url}
        width={displayWidth}
        height={displayHeight}
        onClose={onClose}
        onMouseDown={handleTitleBarMouseDown}
      />

      {/* webview: 操作中（ドラッグ/ズーム/パン）は pointer-events: none でブラウザ入力をブロックし、
          React が入力を受け取れるようにする */}
      <webview
        ref={webviewRef}
        src={page.url}
        partition="persist:artboard"
        webpreferences="contextIsolation=yes"
        style={{
          width: page.width,
          height: page.height,
          pointerEvents: isInteracting ? 'none' : 'auto',
          display: 'flex',
          borderRadius: '0 0 calc(8px / var(--canvas-zoom, 1)) calc(8px / var(--canvas-zoom, 1))',
        }}
      />

      {/* リサイズハンドル（8方向） */}
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDirection[]).map((dir) => (
        <PageResizeHandle key={dir} direction={dir} onMouseDown={handleResizeStart} />
      ))}
    </div>
  );
}

export type { ResizeDirection };
