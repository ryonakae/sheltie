import { useCallback, useEffect, useRef, useState } from 'react';

import { useShallow } from 'zustand/react/shallow';

import { selectActiveProject, useProjectStore } from '../../store/tab-store';
import { useArtboardPan } from '../../hooks/useArtboardPan';
import { useArtboardZoom } from '../../hooks/useArtboardZoom';
import { usePageDrag } from '../../hooks/usePageDrag';
import { usePageResize } from '../../hooks/usePageResize';
import { InteractionOverlay } from './InteractionOverlay';
import { PageFrame, type ResizeDirection } from './PageFrame';

export function Artboard() {
  const activeProject = useProjectStore(selectActiveProject);
  const activeId = useProjectStore((s) => s.activeId);
  const {
    updateViewport,
    updatePagePosition,
    updatePageSize,
    updatePageUrl,
    removePage,
    bringPageToFront,
  } = useProjectStore(
    useShallow((s) => ({
      updateViewport: s.updateViewport,
      updatePagePosition: s.updatePagePosition,
      updatePageSize: s.updatePageSize,
      updatePageUrl: s.updatePageUrl,
      removePage: s.removePage,
      bringPageToFront: s.bringPageToFront,
    })),
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // zoom と pan を ref で管理（DOM 直接操作用）
  const zoomRef = useRef(activeProject?.viewport.zoom ?? 1);
  const panXRef = useRef(activeProject?.viewport.panX ?? 0);
  const panYRef = useRef(activeProject?.viewport.panY ?? 0);

  // アクティブページ ID（最前面表示・ボーダー制御用）
  const [activePageId, setActivePageId] = useState<string | null>(null);

  // 操作中フラグ（InteractionOverlay の表示制御）
  const [interactionCursor, setInteractionCursor] = useState<string | null>(null);

  const handleInteractionChange = useCallback((active: boolean, cursor = 'default') => {
    setInteractionCursor(active ? cursor : null);
  }, []);

  // パン操作
  useArtboardPan({
    canvasRef,
    zoom: zoomRef,
    panX: panXRef,
    panY: panYRef,
    onPanEnd: useCallback(
      (px, py) => updateViewport(activeId, { panX: px, panY: py }),
      [updateViewport, activeId],
    ),
    onInteractionChange: useCallback(
      (active) => handleInteractionChange(active, 'grabbing'),
      [handleInteractionChange],
    ),
  });

  // ズーム操作
  useArtboardZoom({
    containerRef,
    canvasRef,
    zoom: zoomRef,
    panX: panXRef,
    panY: panYRef,
    onZoomEnd: useCallback(
      (z, px, py) => updateViewport(activeId, { zoom: z, panX: px, panY: py }),
      [updateViewport, activeId],
    ),
  });

  // ページドラッグ
  const { startDrag } = usePageDrag({
    zoom: zoomRef,
    onDragEnd: useCallback(
      (pageId, x, y) => updatePagePosition(activeId, pageId, x, y),
      [updatePagePosition, activeId],
    ),
    onInteractionChange: useCallback(
      (active) => handleInteractionChange(active, 'grabbing'),
      [handleInteractionChange],
    ),
  });

  // ページリサイズ
  const { startResize } = usePageResize({
    zoom: zoomRef,
    onResizeEnd: useCallback(
      (pageId, width, height) => updatePageSize(activeId, pageId, width, height),
      [updatePageSize, activeId],
    ),
    onInteractionChange: useCallback(
      (active) => handleInteractionChange(active, 'default'),
      [handleInteractionChange],
    ),
  });

  // 初回マウント時にキャンバスの transform を設定
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.style.transform = `translate(${panXRef.current}px, ${panYRef.current}px) scale(${zoomRef.current})`;
    }
  }, []);

  const pages = activeProject?.pages ?? [];

  const handleDragStart = useCallback(
    (e: React.MouseEvent, pageId: string) => {
      // PageFrame の onDragStart は pageId を受け取れないため wrapper を使う
      bringPageToFront(activeId, pageId);
      setActivePageId(pageId);
      startDrag(e, pageId);
    },
    [bringPageToFront, activeId, startDrag],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, pageId: string, direction: ResizeDirection) => {
      startResize(e, pageId, direction);
    },
    [startResize],
  );

  const handleUrlChange = useCallback(
    (pageId: string, url: string, title: string) => {
      updatePageUrl(activeId, pageId, url, title);
    },
    [updatePageUrl, activeId],
  );

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-gray-50"
      style={{
        backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* 操作中オーバーレイ */}
      {interactionCursor && <InteractionOverlay cursor={interactionCursor} />}

      {/* アートボードキャンバス（transform-origin: 0 0） */}
      <div
        ref={canvasRef}
        className="absolute"
        style={{ transformOrigin: '0 0', willChange: 'transform' }}
      >
        {pages.map((page) => (
          <PageFrame
            key={page.id}
            page={page}
            isActive={page.id === activePageId}
            onActivate={() => {
              setActivePageId(page.id);
              bringPageToFront(activeId, page.id);
            }}
            onClose={() => removePage(activeId, page.id)}
            onDragStart={(e) => handleDragStart(e, page.id)}
            onResizeStart={(e, direction) => handleResizeStart(e, page.id, direction)}
            onUrlChange={(url, title) => handleUrlChange(page.id, url, title)}
          />
        ))}
      </div>

      {/* ページが 0 件の場合のガイドメッセージ */}
      {pages.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-gray-400">
            サイドバーの「ページを追加」から URL を入力してください
          </p>
        </div>
      )}
    </div>
  );
}
