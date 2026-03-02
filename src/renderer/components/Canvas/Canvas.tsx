import { useCallback, useEffect, useRef, useState } from 'react';

import { animate, useReducedMotion } from 'motion/react';

import { selectActiveProject, useProjectStore } from '@/renderer/store/tab-store';
import { DEFAULT_PAGE_HEIGHT, DEFAULT_PAGE_WIDTH, type Page } from '@/renderer/types/tab';
import { Artboard } from '@/renderer/components/Artboard/Artboard';
import { ResizeHandle } from '@/renderer/components/Canvas/ResizeHandle';
import { Sidebar } from '@/renderer/components/Canvas/Sidebar';

const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 384;
const SIDEBAR_DEFAULT_WIDTH = 240;
const PAGE_CHROME_HEIGHT = 48;

/** 現在のビューポート中央のワールド座標を起点とした、ページの配置位置を算出する */
function getViewportCenterPos(
  viewportZoom: number,
  viewportPanX: number,
  viewportPanY: number,
): { x: number; y: number } | null {
  const artboard = document.querySelector<HTMLElement>('[data-artboard-container]');
  if (!artboard) return null;

  const rect = artboard.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || viewportZoom <= 0) return null;

  // ビューポート中央のワールド座標（ページ左上を起点とするため半サイズ分ずらす）
  const centerWorldX = (rect.width / 2 - viewportPanX) / viewportZoom;
  const centerWorldY = (rect.height / 2 - viewportPanY) / viewportZoom;
  return {
    x: centerWorldX - DEFAULT_PAGE_WIDTH / 2,
    y: centerWorldY - DEFAULT_PAGE_HEIGHT / 2,
  };
}

export function Canvas() {
  const activeProject = useProjectStore(selectActiveProject);
  const activeId = useProjectStore((s) => s.activeId);
  const updateSidebarWidth = useProjectStore((s) => s.updateSidebarWidth);
  const addPage = useProjectStore((s) => s.addPage);
  const updateViewport = useProjectStore((s) => s.updateViewport);
  const viewport = activeProject?.viewport;
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [centeredPageId, setCenteredPageId] = useState<string | null>(null);

  const sidebarRef = useRef<HTMLElement>(null);
  const isResizing = useRef(false);
  const dragInfo = useRef({ startX: 0, startWidth: 0 });
  const centeringAnimationRef = useRef<Array<{ stop: () => void }>>([]);
  const activeIdRef = useRef<string | null>(null);
  const prefersReducedMotion = useReducedMotion();

  const sidebarWidth = activeProject?.sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH;

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    dragInfo.current = {
      startX: e.clientX,
      startWidth: sidebarRef.current?.offsetWidth ?? 0,
    };
    document.body.style.userSelect = 'none';
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (sidebarRef.current) {
      sidebarRef.current.style.width = `${SIDEBAR_DEFAULT_WIDTH}px`;
    }
    updateSidebarWidth(activeId, SIDEBAR_DEFAULT_WIDTH);
  }, [updateSidebarWidth, activeId]);

  const handleSelectPage = useCallback((pageId: string) => {
    setSelectedPageId(pageId);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedPageId(null);
  }, []);

  const handleCenteredPage = useCallback((pageId: string) => {
    setCenteredPageId(pageId);
  }, []);

  const handleCenteredPageHandled = useCallback(() => {
    setCenteredPageId(null);
  }, []);

  const cancelCentering = useCallback(() => {
    centeringAnimationRef.current.forEach((animation) => animation.stop());
    centeringAnimationRef.current = [];
  }, []);

  useEffect(() => cancelCentering, [cancelCentering]);

  /**
   * ページ追加後にビューポートをアニメーションしてページを中央・フィット表示する。
   * ズームとパンを同時にアニメーションし、常にアニメーションが発火する（isFullyVisible チェックなし）。
   */
  const centerOnNewPage = useCallback(
    (page: Pick<Page, 'id' | 'x' | 'y' | 'width' | 'height'>, onComplete?: () => void) => {
      const artboard = document.querySelector<HTMLElement>('[data-artboard-container]');
      if (!artboard || !viewport) return;
      const rect = artboard.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const pageHeightWithChrome = page.height + PAGE_CHROME_HEIGHT;
      // ページ全体がビューポートに 80% フィットするズームを計算（最大 1 倍）
      const targetZoom = Math.min(
        (rect.width * 0.8) / page.width,
        (rect.height * 0.8) / pageHeightWithChrome,
        1,
      );
      // ページ中心がビューポート中心に来るパンを計算
      const targetPanX = rect.width / 2 - (page.x + page.width / 2) * targetZoom;
      const targetPanY = rect.height / 2 - (page.y + pageHeightWithChrome / 2) * targetZoom;

      cancelCentering();
      const currentId = activeIdRef.current ?? activeId;

      if (prefersReducedMotion) {
        if (currentId)
          updateViewport(currentId, { zoom: targetZoom, panX: targetPanX, panY: targetPanY });
        onComplete?.();
        return;
      }

      let completed = false;
      const latestState = { x: viewport.panX, y: viewport.panY, zoom: viewport.zoom };
      const updateAll = () => {
        if (!currentId) return;
        updateViewport(currentId, {
          zoom: latestState.zoom,
          panX: latestState.x,
          panY: latestState.y,
        });
      };
      const handleComplete = () => {
        if (completed) return;
        completed = true;
        if (!currentId) return;
        centeringAnimationRef.current = [];
        updateViewport(currentId, { zoom: targetZoom, panX: targetPanX, panY: targetPanY });
        onComplete?.();
      };

      const DURATION = 0.4;
      const EASE = [0.215, 0.61, 0.355, 1] as const;
      const xControls = animate(viewport.panX, targetPanX, {
        duration: DURATION,
        ease: EASE,
        onUpdate: (v: number) => {
          latestState.x = v;
          updateAll();
        },
        onComplete: handleComplete,
      });
      const yControls = animate(viewport.panY, targetPanY, {
        duration: DURATION,
        ease: EASE,
        onUpdate: (v: number) => {
          latestState.y = v;
          updateAll();
        },
        onComplete: handleComplete,
      });
      const zoomControls = animate(viewport.zoom, targetZoom, {
        duration: DURATION,
        ease: EASE,
        onUpdate: (v: number) => {
          latestState.zoom = v;
          updateAll();
        },
        onComplete: handleComplete,
      });

      centeringAnimationRef.current = [xControls, yControls, zoomControls];
    },
    [activeId, updateViewport, viewport, cancelCentering, prefersReducedMotion],
  );

  /** FloatingToolbar の＋ボタンから呼ばれる: 空フレームをキャンバス中央に追加してセンタリング */
  const handleAddEmptyPage = useCallback(() => {
    const centerPos = getViewportCenterPos(
      viewport?.zoom ?? 1,
      viewport?.panX ?? 0,
      viewport?.panY ?? 0,
    );
    const created = addPage(
      activeId,
      undefined,
      centerPos
        ? { x: centerPos.x, y: centerPos.y, width: DEFAULT_PAGE_WIDTH, height: DEFAULT_PAGE_HEIGHT }
        : undefined,
    );
    if (created) {
      handleSelectPage(created.id);
      centerOnNewPage(created, () => handleCenteredPage(created.id));
    }
  }, [addPage, activeId, viewport, centerOnNewPage, handleSelectPage, handleCenteredPage]);

  useEffect(() => {
    if (!selectedPageId) return;
    const exists = activeProject?.pages.some((page) => page.id === selectedPageId) ?? false;
    if (!exists) {
      // effect 内での直接 setState を避けるため非同期で実行
      queueMicrotask(() => setSelectedPageId(null));
    }
  }, [selectedPageId, activeProject?.pages]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const { startX, startWidth } = dragInfo.current;
      const delta = e.clientX - startX;
      const newWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + delta));
      if (sidebarRef.current) {
        sidebarRef.current.style.width = `${newWidth}px`;
      }
    };

    const handleMouseUp = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.userSelect = '';
      if (sidebarRef.current) {
        updateSidebarWidth(activeId, sidebarRef.current.offsetWidth);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [updateSidebarWidth, activeId]);

  return (
    <div className="flex flex-1 overflow-hidden">
      <Sidebar
        ref={sidebarRef}
        initialWidth={sidebarWidth}
        selectedPageId={selectedPageId}
        onSelectPage={handleSelectPage}
        onCentered={handleCenteredPage}
      />
      <ResizeHandle onMouseDown={handleMouseDown} onDoubleClick={handleDoubleClick} />
      <Artboard
        selectedPageId={selectedPageId}
        onSelectPage={handleSelectPage}
        onClearSelection={handleClearSelection}
        centeredPageId={centeredPageId}
        onCenteredPageHandled={handleCenteredPageHandled}
        onAddPage={handleAddEmptyPage}
      />
    </div>
  );
}
