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
  MIN_ZOOM,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '@/constants';
import {
  getNodeChromeScreenHeight,
  getNodeFrameHeight,
  getNodeFrameRect,
} from '@/lib/siteboard-node-frame';
import { selectActiveProject, useProjectStore } from '@/store/tab-store';
import { type BoardNode } from '@/types';

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
  const addWebNode = useProjectStore((s) => s.addWebNode);
  const addStickyNoteNode = useProjectStore((s) => s.addStickyNoteNode);
  const removeNode = useProjectStore((s) => s.removeNode);
  const updateViewport = useProjectStore((s) => s.updateViewport);
  const viewport = activeProject?.viewport;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [centeredNodeId, setCenteredNodeId] = useState<string | null>(null);
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

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const handleRemoveNode = useCallback(
    (nodeId: string) => {
      removeNode(activeId, nodeId);
    },
    [removeNode, activeId],
  );

  const handleCenteredNode = useCallback((nodeId: string) => {
    setCenteredNodeId(nodeId);
  }, []);

  const handleCenteredNodeHandled = useCallback(() => {
    setCenteredNodeId(null);
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
  const centerOnNewNode = useCallback(
    (
      node: Pick<BoardNode, 'id' | 'type' | 'x' | 'y' | 'width' | 'height'>,
      onComplete?: () => void,
    ) => {
      const siteboard = document.querySelector<HTMLElement>('[data-siteboard-container]');
      if (!siteboard || !viewport) return;
      const rect = siteboard.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const chromeScreenHeight = getNodeChromeScreenHeight(node);
      const heightBudget = Math.max(1, rect.height * 0.8 - chromeScreenHeight);
      // ノード全体がビューポートに 80% フィットするズームを計算（最大 1 倍）
      const targetZoom = Math.max(
        MIN_ZOOM,
        Math.min((rect.width * 0.8) / node.width, heightBudget / node.height, 1),
      );
      const frameRect = getNodeFrameRect(node, targetZoom);
      // ノード中心がビューポート中心に来るパンを計算
      const targetPanX = rect.width / 2 - (node.x + node.width / 2) * targetZoom;
      const targetPanY = rect.height / 2 - (node.y + frameRect.height / 2) * targetZoom;

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
  const handleAddWebNode = useCallback(() => {
    const centerPos = getViewportCenterPos(
      viewport?.zoom ?? 1,
      viewport?.panX ?? 0,
      viewport?.panY ?? 0,
      DEFAULT_PAGE_WIDTH,
      getNodeFrameHeight({ type: 'webpage', height: DEFAULT_PAGE_HEIGHT }, viewport?.zoom ?? 1),
    );
    const created = addWebNode(
      activeId,
      undefined,
      centerPos
        ? { x: centerPos.x, y: centerPos.y, width: DEFAULT_PAGE_WIDTH, height: DEFAULT_PAGE_HEIGHT }
        : undefined,
      viewport?.zoom ?? 1,
    );
    if (created) {
      handleSelectNode(created.id);
      centerOnNewNode(created, () => handleCenteredNode(created.id));
    }
  }, [addWebNode, activeId, viewport, centerOnNewNode, handleSelectNode, handleCenteredNode]);

  /** FloatingToolbar の付箋ボタンから呼ばれる: 付箋をキャンバス中央に追加してセンタリング */
  const handleAddStickyNote = useCallback(() => {
    const centerPos = getViewportCenterPos(
      viewport?.zoom ?? 1,
      viewport?.panX ?? 0,
      viewport?.panY ?? 0,
      DEFAULT_STICKY_NOTE_WIDTH,
      getNodeFrameHeight(
        { type: 'stickynote', height: DEFAULT_STICKY_NOTE_HEIGHT },
        viewport?.zoom ?? 1,
      ),
    );
    const created = addStickyNoteNode(
      activeId,
      centerPos
        ? {
            x: centerPos.x,
            y: centerPos.y,
            width: DEFAULT_STICKY_NOTE_WIDTH,
            height: DEFAULT_STICKY_NOTE_HEIGHT,
          }
        : undefined,
      viewport?.zoom ?? 1,
    );
    if (created) {
      handleSelectNode(created.id);
      centerOnNewNode(created, () => handleCenteredNode(created.id));
    }
  }, [
    addStickyNoteNode,
    activeId,
    viewport,
    centerOnNewNode,
    handleSelectNode,
    handleCenteredNode,
  ]);

  useEffect(() => {
    if (!selectedNodeId) return;
    const exists = activeProject?.nodes.some((node) => node.id === selectedNodeId) ?? false;
    if (!exists) {
      // effect 内での直接 setState を避けるため非同期で実行
      queueMicrotask(() => setSelectedNodeId(null));
    }
  }, [selectedNodeId, activeProject?.nodes]);

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
        isVisible={isSidebarVisible}
        selectedNodeId={selectedNodeId}
        onSelectNode={handleSelectNode}
        onRemoveNode={handleRemoveNode}
        onCentered={handleCenteredNode}
      />
      {isSidebarVisible && (
        <ResizeHandle onMouseDown={handleMouseDown} onDoubleClick={handleDoubleClick} />
      )}
      <div className="absolute bottom-4 left-4 z-30">
        <AppButton
          size="sm"
          variant="ghost"
          tooltipMessage={isSidebarVisible ? 'サイドバーを非表示' : 'サイドバーを表示'}
          onPress={toggleSidebar}
          aria-label={isSidebarVisible ? 'サイドバーを非表示' : 'サイドバーを表示'}
          className={isSidebarVisible ? undefined : 'border border-border shadow-md'}
        >
          {isSidebarVisible ? <ChevronsCollapseHorizontal /> : <ChevronsExpandHorizontal />}
        </AppButton>
      </div>
      <Siteboard
        selectedNodeId={selectedNodeId}
        onSelectNode={handleSelectNode}
        onClearSelection={handleClearSelection}
        centeredNodeId={centeredNodeId}
        onCenteredNodeHandled={handleCenteredNodeHandled}
        onAddWebNode={handleAddWebNode}
        onAddStickyNote={handleAddStickyNote}
      />
    </div>
  );
}
