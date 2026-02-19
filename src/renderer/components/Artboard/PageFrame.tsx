import { useCallback, useEffect, useRef, useState } from 'react';

import type { Page } from '../../types/tab';
import { PageResizeHandle } from './PageResizeHandle';
import { PageTitleBar } from './PageTitleBar';

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface PageFrameProps {
  page: Page;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent, direction: ResizeDirection) => void;
  onUrlChange: (url: string, title: string) => void;
}

export function PageFrame({
  page,
  isActive,
  onActivate,
  onClose,
  onDragStart,
  onResizeStart,
  onUrlChange,
}: PageFrameProps) {
  const webviewRef = useRef<Electron.WebviewTag>(null);
  const [localTitle, setLocalTitle] = useState(page.title);

  // webview のナビゲーションイベントを購読して URL とタイトルをストアに同期
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleNavigate = () => {
      const url = webview.getURL();
      let hostname = url;
      try {
        hostname = new URL(url).hostname;
      } catch {
        // URL パース失敗時はそのまま使用
      }
      setLocalTitle(hostname);
      onUrlChange(url, hostname);
    };

    const handleTitleUpdate = (e: Electron.PageTitleUpdatedEvent) => {
      setLocalTitle(e.title);
    };

    webview.addEventListener('did-navigate', handleNavigate);
    webview.addEventListener('did-navigate-in-page', handleNavigate);
    webview.addEventListener('page-title-updated', handleTitleUpdate);

    return () => {
      webview.removeEventListener('did-navigate', handleNavigate);
      webview.removeEventListener('did-navigate-in-page', handleNavigate);
      webview.removeEventListener('page-title-updated', handleTitleUpdate);
    };
  }, [onUrlChange]);

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
        isActive ? 'ring-2 ring-blue-400' : 'ring-1 ring-gray-300',
      ].join(' ')}
      style={{ left: page.x, top: page.y, width: page.width }}
      data-page-id={page.id}
      onMouseDown={onActivate}
    >
      <PageTitleBar
        title={localTitle}
        url={page.url}
        width={page.width}
        height={page.height}
        onClose={onClose}
        onMouseDown={handleTitleBarMouseDown}
      />

      <div className="relative overflow-hidden rounded-b-lg bg-white">
        <webview
          ref={webviewRef}
          src={page.url}
          partition="persist:artboard"
          style={{ width: page.width, height: page.height, display: 'block' }}
        />
      </div>

      {/* リサイズハンドル（8方向） */}
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDirection[]).map((dir) => (
        <PageResizeHandle key={dir} direction={dir} onMouseDown={handleResizeStart} />
      ))}
    </div>
  );
}

export type { ResizeDirection };
