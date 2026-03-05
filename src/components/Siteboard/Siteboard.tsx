import { useCallback, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { ContextMenu } from '@/components/Common/ContextMenu';
import { PageNode } from '@/components/Node/PageNode';
import { StickyNoteNode } from '@/components/Node/StickyNoteNode';
import { FloatingToolbar } from '@/components/Siteboard/FloatingToolbar';
import { InteractionOverlay } from '@/components/Siteboard/InteractionOverlay';
import { ZoomIndicator } from '@/components/Siteboard/ZoomIndicator';
import { LOW_ZOOM_HIDE_THRESHOLD } from '@/constants';
import { useSiteboardDisplayEngine } from '@/hooks/siteboard/useSiteboardDisplayEngine';
import { useSiteboardKeyboard } from '@/hooks/siteboard/useSiteboardKeyboard';
import { useSiteboardNodeRuntime } from '@/hooks/siteboard/useSiteboardNodeRuntime';
import { useSiteboardViewportEngine } from '@/hooks/siteboard/useSiteboardViewportEngine';
import { selectActiveProject, useProjectStore } from '@/store/tab-store';
import { isStickyNote } from '@/types';

interface SiteboardProps {
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  onClearSelection: () => void;
  centeredPageId?: string | null;
  onCenteredPageHandled?: () => void;
  onAddPage: () => void;
  onAddStickyNote: () => void;
}

export function Siteboard({
  selectedPageId,
  onSelectPage,
  onClearSelection,
  centeredPageId = null,
  onCenteredPageHandled,
  onAddPage,
  onAddStickyNote,
}: SiteboardProps) {
  const activeProject = useProjectStore(selectActiveProject);
  const activeId = useProjectStore((s) => s.activeId);

  const {
    undoActiveProject,
    redoActiveProject,
    updateViewport,
    updatePagePosition,
    updatePageSize,
    updatePageSizeWithoutHistory,
    updatePageUrl,
    updatePageTitle,
    removePage,
    setPageWebviewLabel,
    setPageUrl,
    pinPageUrl,
    updateStickyNoteContent,
    cycleStickyNoteColor,
  } = useProjectStore(
    useShallow((s) => ({
      cycleStickyNoteColor: s.cycleStickyNoteColor,
      redoActiveProject: s.redoActiveProject,
      pinPageUrl: s.pinPageUrl,
      removePage: s.removePage,
      setPageUrl: s.setPageUrl,
      setPageWebviewLabel: s.setPageWebviewLabel,
      undoActiveProject: s.undoActiveProject,
      updatePagePosition: s.updatePagePosition,
      updatePageSize: s.updatePageSize,
      updatePageSizeWithoutHistory: s.updatePageSizeWithoutHistory,
      updatePageTitle: s.updatePageTitle,
      updatePageUrl: s.updatePageUrl,
      updateStickyNoteContent: s.updateStickyNoteContent,
      updateViewport: s.updateViewport,
    })),
  );

  const pages = useMemo(() => activeProject?.pages ?? [], [activeProject?.pages]);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(activeProject?.viewport.zoom ?? 1);
  const panXRef = useRef(activeProject?.viewport.panX ?? 0);
  const panYRef = useRef(activeProject?.viewport.panY ?? 0);

  const {
    captureScreenshot,
    cancelZoomRestore,
    computeDisplayModes,
    computeInteractionModes,
    displayModes,
    handleContextMenuClose: handleContextMenuCloseDisplay,
    handleContextMenuOpen,
    handleInteractionChange,
    handlePageResizeEnd,
    handlePageResizeStart,
    interactionCursor,
    scheduleInteractionUpdate,
    scheduleZoomRestoreAfterReflow,
    screenshotUrls,
  } = useSiteboardDisplayEngine({
    pages,
    containerRef,
    canvasRef,
    zoomRef,
    centeredPageId,
    onCenteredPageHandled,
  });

  const getZoom = useCallback(() => zoomRef.current, [zoomRef]);

  const {
    handleResetZoom,
    isPanMode,
    resizingSize,
    startDrag,
    startResize,
    startStickyNoteResize,
    uiZoom,
  } = useSiteboardViewportEngine({
    containerRef,
    canvasRef,
    zoomRef,
    panXRef,
    panYRef,
    activeId,
    viewport: activeProject?.viewport,
    onInteractionChange: handleInteractionChange,
    onPageResizeStart: handlePageResizeStart,
    onPageResizeEnd: handlePageResizeEnd,
    scheduleInteractionUpdate,
    computeInteractionModes,
    computeDisplayModes,
    cancelZoomRestore,
    scheduleZoomRestoreAfterReflow,
    updateViewport,
    updatePagePosition,
    updatePageSize,
  });
  const hideCompactControls = Math.round(uiZoom * 100) <= Math.round(LOW_ZOOM_HIDE_THRESHOLD * 100);

  const {
    handleDragStart,
    handleGoBack,
    handleGoForward,
    handleNavigated,
    handlePinPageUrl,
    handleReloadPage,
    handleRemovePage,
    handleResizePreset,
    handleResizeStart,
    handleStickyNoteAutoHeightChange,
    handleStickyNoteColorCycle,
    handleStickyNoteContentChange,
    handleTitleUpdated,
    handleUrlSubmit,
    handleScrollEnded,
    handleWebviewCreated,
    handleWebviewLoaded,
    navStates,
  } = useSiteboardNodeRuntime({
    activeId,
    pages,
    selectedPageId,
    onSelectPage,
    onClearSelection,
    startDrag,
    startResize,
    updatePageUrl,
    updatePageTitle,
    removePage,
    setPageWebviewLabel,
    setPageUrl,
    pinPageUrl,
    updatePageSize,
    updatePageSizeWithoutHistory,
    updateStickyNoteContent,
    cycleStickyNoteColor,
    computeDisplayModes,
    captureScreenshot,
  });

  useSiteboardKeyboard({
    selectedPageId,
    onRemovePage: handleRemovePage,
    onUndo: undoActiveProject,
    onRedo: redoActiveProject,
  });

  const [contextMenu, setContextMenu] = useState<{ pageId: string; x: number; y: number } | null>(
    null,
  );

  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, pageId: string) => {
      e.preventDefault();
      onSelectPage(pageId);

      const page = pages.find((p) => p.id === pageId);
      if (page && !isStickyNote(page)) {
        // WebPage ノード: スクリーンショット撮影完了後にメニューを表示（未撮影時の白画面防止）
        // rAF でスクリーンショット差し替えの React レンダー＋ブラウザ描画を確定させてからメニューを表示
        void handleContextMenuOpen(pageId).then(() => {
          requestAnimationFrame(() => {
            setContextMenu({ pageId, x: e.clientX, y: e.clientY });
          });
        });
      } else {
        // 付箋ノード: Webview なし、即時表示
        setContextMenu({ pageId, x: e.clientX, y: e.clientY });
      }
    },
    [handleContextMenuOpen, onSelectPage, pages],
  );

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
    handleContextMenuCloseDisplay();
  }, [handleContextMenuCloseDisplay]);

  const handleContextMenuAction = useCallback(
    (actionId: string) => {
      if (actionId === 'remove' && contextMenu) {
        handleContextMenuCloseDisplay();
        handleRemovePage(contextMenu.pageId);
      }
    },
    [contextMenu, handleContextMenuCloseDisplay, handleRemovePage],
  );

  const handleSiteboardMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (isPanMode.current) return;
      if ((e.target as HTMLElement).closest('[data-page-id]')) return;
      setContextMenu(null);
      onClearSelection();
    },
    [isPanMode, onClearSelection],
  );

  return (
    <div
      ref={containerRef}
      data-siteboard-container
      className="relative flex-1 overflow-hidden siteboard-bg"
      onMouseDown={handleSiteboardMouseDown}
    >
      {interactionCursor && <InteractionOverlay cursor={interactionCursor} />}

      <div ref={canvasRef} className="absolute inset-0 origin-top-left will-change-transform">
        {pages.map((page) =>
          isStickyNote(page) ? (
            <StickyNoteNode
              key={page.id}
              page={page}
              isActive={page.id === selectedPageId}
              hideColorCycleButton={hideCompactControls}
              onActivate={onSelectPage}
              onContextMenu={handleNodeContextMenu}
              onDragStart={handleDragStart}
              onResizeStart={startStickyNoteResize}
              onContentChange={handleStickyNoteContentChange}
              onAutoHeightChange={handleStickyNoteAutoHeightChange}
              onColorCycle={handleStickyNoteColorCycle}
            />
          ) : (
            <PageNode
              key={page.id}
              page={page}
              isActive={page.id === selectedPageId}
              title={page.title}
              displayWidth={resizingSize?.pageId === page.id ? resizingSize.width : page.width}
              displayHeight={resizingSize?.pageId === page.id ? resizingSize.height : page.height}
              displayMode={displayModes[page.id] ?? 'native'}
              screenshotUrl={screenshotUrls[page.id] ?? null}
              hideTopNavControls={hideCompactControls}
              hideBottomPresetControls={hideCompactControls}
              canGoBack={navStates[page.id]?.can_go_back ?? false}
              canGoForward={navStates[page.id]?.can_go_forward ?? false}
              getZoom={getZoom}
              onGoBack={handleGoBack}
              onGoForward={handleGoForward}
              onActivate={onSelectPage}
              onReload={handleReloadPage}
              onPinUrl={handlePinPageUrl}
              onContextMenu={handleNodeContextMenu}
              onDragStart={handleDragStart}
              onResizeStart={handleResizeStart}
              onResizePreset={handleResizePreset}
              onNavigated={handleNavigated}
              onTitleUpdated={handleTitleUpdated}
              onWebviewCreated={handleWebviewCreated}
              onWebviewLoaded={handleWebviewLoaded}
              onScrollEnded={handleScrollEnded}
              onUrlSubmit={handleUrlSubmit}
            />
          ),
        )}
      </div>

      {pages.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-muted">下部のボタンから Web ページや付箋を追加してください</p>
        </div>
      )}

      <FloatingToolbar onAddPage={onAddPage} onAddStickyNote={onAddStickyNote} />

      <ZoomIndicator zoom={uiZoom} onReset={handleResetZoom} />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[{ id: 'remove', label: 'ノードを削除', variant: 'danger' }]}
          onAction={handleContextMenuAction}
          onClose={handleContextMenuClose}
        />
      )}
    </div>
  );
}
