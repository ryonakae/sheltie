import ChevronsCollapseHorizontal from '@gravity-ui/icons/ChevronsCollapseHorizontal';
import ChevronsExpandHorizontal from '@gravity-ui/icons/ChevronsExpandHorizontal';
import { animate, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AppButton } from '@/components/Common/AppButton';
import { ResizeHandle } from '@/components/Project/ResizeHandle';
import { Sidebar } from '@/components/Project/Sidebar';
import { Siteboard } from '@/components/Siteboard/Siteboard';
import {
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  DEFAULT_STICKY_NOTE_HEIGHT,
  DEFAULT_STICKY_NOTE_WIDTH,
  CANVAS_CENTER_ANIMATION_DURATION_SEC,
  CANVAS_CENTER_ANIMATION_EASE,
  PAGE_CHROME_HEIGHT,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '@/constants';
import { selectActiveProject, useProjectStore } from '@/store/tab-store';
import { type Page } from '@/types';

/** 現在のビューポート中央のワールド座標を起点とした、指定サイズの要素の配置位置を算出する */
function getViewportCenterPos(
  viewportZoom: number,
  viewportPanX: number,
  viewportPanY: number,
  targetWidth: number,
  targetHeight: number,
): { x: number; y: number } | null {
  const siteboard = document.querySelector<HTMLElement>('[data-siteboard-container]');
  if (!siteboard) return null;

  const rect = siteboard.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || viewportZoom <= 0) return null;

  // ビューポート中央のワールド座標（要素左上を起点とするため半サイズ分ずらす）
  const centerWorldX = (rect.width / 2 - viewportPanX) / viewportZoom;
  const centerWorldY = (rect.height / 2 - viewportPanY) / viewportZoom;
  return {
    x: centerWorldX - targetWidth / 2,
    y: centerWorldY - targetHeight / 2,
  };
}

export function ProjectScreen() {
  const activeProject = useProjectStore(selectActiveProject);
  const activeId = useProjectStore((s) => s.activeId);
  const updateSidebarWidth = useProjectStore((s) => s.updateSidebarWidth);
  const addPage = useProjectStore((s) => s.addPage);
  const addStickyNote = useProjectStore((s) => s.addStickyNote);
  const removePage = useProjectStore((s) => s.removePage);
  const updateViewport = useProjectStore((s) => s.updateViewport);
  const viewport = activeProject?.viewport;
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [centeredPageId, setCenteredPageId] = useState<string | null>(null);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);

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

  const handleRemovePage = useCallback(
    (pageId: string) => {
      removePage(activeId, pageId);
    },
    [removePage, activeId],
  );

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

  const toggleSidebar = useCallback(() => {
    setIsSidebarVisible((prev) => !prev);
  }, []);

  /**
   * ページ追加後にビューポートをアニメーションしてページを中央・フィット表示する。
   * ズームとパンを同時にアニメーションし、常にアニメーションが発火する（isFullyVisible チェックなし）。
   */
  const centerOnNewPage = useCallback(
    (page: Pick<Page, 'id' | 'x' | 'y' | 'width' | 'height'>, onComplete?: () => void) => {
      const siteboard = document.querySelector<HTMLElement>('[data-siteboard-container]');
      if (!siteboard || !viewport) return;
      const rect = siteboard.getBoundingClientRect();
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

      const xControls = animate(viewport.panX, targetPanX, {
        duration: CANVAS_CENTER_ANIMATION_DURATION_SEC,
        ease: CANVAS_CENTER_ANIMATION_EASE,
        onUpdate: (v: number) => {
          latestState.x = v;
          updateAll();
        },
        onComplete: handleComplete,
      });
      const yControls = animate(viewport.panY, targetPanY, {
        duration: CANVAS_CENTER_ANIMATION_DURATION_SEC,
        ease: CANVAS_CENTER_ANIMATION_EASE,
        onUpdate: (v: number) => {
          latestState.y = v;
          updateAll();
        },
        onComplete: handleComplete,
      });
      const zoomControls = animate(viewport.zoom, targetZoom, {
        duration: CANVAS_CENTER_ANIMATION_DURATION_SEC,
        ease: CANVAS_CENTER_ANIMATION_EASE,
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
      DEFAULT_PAGE_WIDTH,
      DEFAULT_PAGE_HEIGHT,
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

  /** FloatingToolbar の付箋ボタンから呼ばれる: 付箋をキャンバス中央に追加してセンタリング */
  const handleAddStickyNote = useCallback(() => {
    const centerPos = getViewportCenterPos(
      viewport?.zoom ?? 1,
      viewport?.panX ?? 0,
      viewport?.panY ?? 0,
      DEFAULT_STICKY_NOTE_WIDTH,
      DEFAULT_STICKY_NOTE_HEIGHT,
    );
    const created = addStickyNote(
      activeId,
      centerPos
        ? {
            x: centerPos.x,
            y: centerPos.y,
            width: DEFAULT_STICKY_NOTE_WIDTH,
            height: DEFAULT_STICKY_NOTE_HEIGHT,
          }
        : undefined,
    );
    if (created) {
      handleSelectPage(created.id);
      centerOnNewPage(created, () => handleCenteredPage(created.id));
    }
  }, [addStickyNote, activeId, viewport, centerOnNewPage, handleSelectPage, handleCenteredPage]);

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
      isResizing.current = false;
      document.body.style.userSelect = '';
    };
  }, [updateSidebarWidth, activeId]);

  return (
    <div className="relative flex flex-1 overflow-hidden">
      <Sidebar
        ref={sidebarRef}
        initialWidth={isSidebarVisible ? sidebarWidth : 0}
        selectedPageId={selectedPageId}
        onSelectPage={handleSelectPage}
        onRemovePage={handleRemovePage}
        onCentered={handleCenteredPage}
      />
      {isSidebarVisible && (
        <ResizeHandle onMouseDown={handleMouseDown} onDoubleClick={handleDoubleClick} />
      )}
      <div className="absolute bottom-4 left-4 z-30">
        <AppButton
          size="sm"
          tooltipMessage={isSidebarVisible ? 'サイドバーを非表示' : 'サイドバーを表示'}
          onPress={toggleSidebar}
          aria-label={isSidebarVisible ? 'サイドバーを非表示' : 'サイドバーを表示'}
        >
          {isSidebarVisible ? <ChevronsCollapseHorizontal /> : <ChevronsExpandHorizontal />}
        </AppButton>
      </div>
      <Siteboard
        selectedPageId={selectedPageId}
        onSelectPage={handleSelectPage}
        onClearSelection={handleClearSelection}
        centeredPageId={centeredPageId}
        onCenteredPageHandled={handleCenteredPageHandled}
        onAddPage={handleAddEmptyPage}
        onAddStickyNote={handleAddStickyNote}
      />
    </div>
  );
}
