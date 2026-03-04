import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { PageNode } from '@/components/Node/PageNode';
import { StickyNoteNode } from '@/components/Node/StickyNoteNode';
import { FloatingToolbar } from '@/components/Siteboard/FloatingToolbar';
import { InteractionOverlay } from '@/components/Siteboard/InteractionOverlay';
import { LOW_ZOOM_HIDE_THRESHOLD } from '@/constants';
import { useSiteboardDisplayEngine } from '@/hooks/siteboard/useSiteboardDisplayEngine';
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
    updateViewport,
    updatePagePosition,
    updatePageSize,
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
      pinPageUrl: s.pinPageUrl,
      removePage: s.removePage,
      setPageUrl: s.setPageUrl,
      setPageWebviewLabel: s.setPageWebviewLabel,
      updatePagePosition: s.updatePagePosition,
      updatePageSize: s.updatePageSize,
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
    updateStickyNoteContent,
    cycleStickyNoteColor,
    computeDisplayModes,
    captureScreenshot,
  });

  const handleSiteboardMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (isPanMode.current) return;
      if ((e.target as HTMLElement).closest('[data-page-id]')) return;
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
              onClose={handleRemovePage}
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
              onClose={handleRemovePage}
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

      <motion.button
        type="button"
        className="absolute right-3 bottom-3 z-20 rounded-md border border-border bg-default px-2 py-1 text-xs text-foreground shadow-md"
        onClick={handleResetZoom}
        whileHover={{ y: -1, scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        aria-label="ズームを100%に戻す"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={Math.round(uiZoom * 100)}
            initial={{ opacity: 0.2, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
          >
            {Math.round(uiZoom * 100)}%
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
