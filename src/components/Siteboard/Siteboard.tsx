import { useCallback, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { ContextMenu } from '@/components/Common/ContextMenu';
import { StickyNoteNode } from '@/components/Node/StickyNoteNode';
import { WebPageNode } from '@/components/Node/WebPageNode';
import { FloatingToolbar } from '@/components/Siteboard/FloatingToolbar';
import { InteractionOverlay } from '@/components/Siteboard/InteractionOverlay';
import { ZoomIndicator } from '@/components/Siteboard/ZoomIndicator';
import { LOW_ZOOM_HIDE_THRESHOLD } from '@/constants';
import { useSiteboardDisplayEngine } from '@/hooks/siteboard/useSiteboardDisplayEngine';
import { useSiteboardKeyboard } from '@/hooks/siteboard/useSiteboardKeyboard';
import { useSiteboardNodeRuntime } from '@/hooks/siteboard/useSiteboardNodeRuntime';
import { useSiteboardViewportEngine } from '@/hooks/siteboard/useSiteboardViewportEngine';
import {
  selectActiveProject,
  selectActiveProjectWebviewRuntime,
  useProjectStore,
} from '@/store/tab-store';
import { isStickyNoteNode, isWebPageNode } from '@/types';

interface SiteboardProps {
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
  centeredNodeId?: string | null;
  onCenteredNodeHandled?: () => void;
  onAddWebNode: () => void;
  onAddStickyNote: () => void;
}

export function Siteboard({
  selectedNodeId,
  onSelectNode,
  onClearSelection,
  centeredNodeId = null,
  onCenteredNodeHandled,
  onAddWebNode,
  onAddStickyNote,
}: SiteboardProps) {
  const activeProject = useProjectStore(selectActiveProject);
  const activeProjectWebviewRuntime = useProjectStore(selectActiveProjectWebviewRuntime);
  const activeId = useProjectStore((s) => s.activeId);

  const {
    undoActiveProject,
    redoActiveProject,
    updateViewport,
    updateNodePosition,
    updateNodeSize,
    updateNodeSizeWithoutHistory,
    updateWebNodeUrl,
    updateNodeTitle,
    removeNode,
    setWebNodeWebviewLabel,
    clearWebNodeWebviewLabel,
    setWebNodeUrl,
    pinWebNodeUrl,
    updateStickyNoteContent,
    cycleStickyNoteColor,
  } = useProjectStore(
    useShallow((s) => ({
      cycleStickyNoteColor: s.cycleStickyNoteColor,
      clearWebNodeWebviewLabel: s.clearWebNodeWebviewLabel,
      redoActiveProject: s.redoActiveProject,
      pinWebNodeUrl: s.pinWebNodeUrl,
      removeNode: s.removeNode,
      setWebNodeUrl: s.setWebNodeUrl,
      setWebNodeWebviewLabel: s.setWebNodeWebviewLabel,
      undoActiveProject: s.undoActiveProject,
      updateNodePosition: s.updateNodePosition,
      updateNodeSize: s.updateNodeSize,
      updateNodeSizeWithoutHistory: s.updateNodeSizeWithoutHistory,
      updateNodeTitle: s.updateNodeTitle,
      updateStickyNoteContent: s.updateStickyNoteContent,
      updateViewport: s.updateViewport,
      updateWebNodeUrl: s.updateWebNodeUrl,
    })),
  );

  const nodes = useMemo(() => activeProject?.nodes ?? [], [activeProject?.nodes]);
  const webPageNodes = useMemo(() => nodes.filter(isWebPageNode), [nodes]);

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
    handleScreenshotPresented,
    interactionCursor,
    scheduleInteractionUpdate,
    scheduleZoomRestoreAfterReflow,
    screenshotUrls,
  } = useSiteboardDisplayEngine({
    webPageNodes,
    webviewLabelsByNodeId: activeProjectWebviewRuntime.labelsByNodeId,
    projectId: activeId ?? '',
    containerRef,
    canvasRef,
    zoomRef,
    centeredNodeId,
    onCenteredNodeHandled,
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
    onNodeResizeStart: handlePageResizeStart,
    onNodeResizeEnd: handlePageResizeEnd,
    scheduleInteractionUpdate,
    computeInteractionModes,
    computeDisplayModes,
    cancelZoomRestore,
    scheduleZoomRestoreAfterReflow,
    updateViewport,
    updateNodePosition,
    updateNodeSize,
  });
  const hideCompactControls = Math.round(uiZoom * 100) <= Math.round(LOW_ZOOM_HIDE_THRESHOLD * 100);

  const {
    handleDragStart,
    handleGoBack,
    handleGoForward,
    handleNavigated,
    handlePinWebNodeUrl,
    handleReloadWebNode,
    handleRemoveNode,
    handleResizePreset,
    handleResizeStart,
    handleStickyNoteAutoHeightChange,
    handleStickyNoteColorCycle,
    handleStickyNoteContentChange,
    handleTitleUpdated,
    handleUrlSubmit,
    handleScrollEnded,
    handleWebviewCreated,
    handleWebviewDestroyed,
    handleWebviewLoaded,
    navStates,
  } = useSiteboardNodeRuntime({
    activeId,
    nodes,
    selectedNodeId,
    onSelectNode,
    onClearSelection,
    startDrag,
    startResize,
    updateWebNodeUrl,
    updateNodeTitle,
    removeNode,
    setWebNodeWebviewLabel,
    clearWebNodeWebviewLabel,
    setWebNodeUrl,
    pinWebNodeUrl,
    updateNodeSize,
    updateNodeSizeWithoutHistory,
    updateStickyNoteContent,
    cycleStickyNoteColor,
    computeDisplayModes,
    captureScreenshot,
  });

  useSiteboardKeyboard({
    selectedNodeId,
    onRemoveNode: handleRemoveNode,
    onUndo: undoActiveProject,
    onRedo: redoActiveProject,
  });

  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(
    null,
  );

  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.preventDefault();
      onSelectNode(nodeId);

      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (node && !isStickyNoteNode(node)) {
        void handleContextMenuOpen(nodeId).then(() => {
          requestAnimationFrame(() => {
            setContextMenu({ nodeId, x: e.clientX, y: e.clientY });
          });
        });
      } else {
        setContextMenu({ nodeId, x: e.clientX, y: e.clientY });
      }
    },
    [handleContextMenuOpen, onSelectNode, nodes],
  );

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
    handleContextMenuCloseDisplay();
  }, [handleContextMenuCloseDisplay]);

  const handleContextMenuAction = useCallback(
    (actionId: string) => {
      if (actionId === 'remove' && contextMenu) {
        handleContextMenuCloseDisplay();
        handleRemoveNode(contextMenu.nodeId);
      }
    },
    [contextMenu, handleContextMenuCloseDisplay, handleRemoveNode],
  );

  const handleSiteboardMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (isPanMode.current) return;
      if ((e.target as HTMLElement).closest('[data-node-id]')) return;
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
        {nodes.map((node) => {
          if (isStickyNoteNode(node)) {
            return (
              <StickyNoteNode
                key={node.id}
                node={node}
                isActive={node.id === selectedNodeId}
                hideColorCycleButton={hideCompactControls}
                onActivate={onSelectNode}
                onContextMenu={handleNodeContextMenu}
                onDragStart={handleDragStart}
                onResizeStart={startStickyNoteResize}
                onContentChange={handleStickyNoteContentChange}
                onAutoHeightChange={handleStickyNoteAutoHeightChange}
                onColorCycle={handleStickyNoteColorCycle}
              />
            );
          }

          if (!isWebPageNode(node)) {
            return null;
          }

          return (
            <WebPageNode
              key={node.id}
              node={node}
              isActive={node.id === selectedNodeId}
              title={node.title}
              displayWidth={resizingSize?.nodeId === node.id ? resizingSize.width : node.width}
              displayHeight={resizingSize?.nodeId === node.id ? resizingSize.height : node.height}
              displayMode={displayModes[node.id] ?? 'hidden'}
              screenshotUrl={screenshotUrls[node.id] ?? null}
              hideTopNavControls={hideCompactControls}
              hideBottomPresetControls={hideCompactControls}
              canGoBack={navStates[node.id]?.can_go_back ?? false}
              canGoForward={navStates[node.id]?.can_go_forward ?? false}
              getZoom={getZoom}
              onGoBack={handleGoBack}
              onGoForward={handleGoForward}
              onActivate={onSelectNode}
              onReload={handleReloadWebNode}
              onPinUrl={handlePinWebNodeUrl}
              onContextMenu={handleNodeContextMenu}
              onDragStart={handleDragStart}
              onResizeStart={handleResizeStart}
              onResizePreset={handleResizePreset}
              onNavigated={handleNavigated}
              onTitleUpdated={handleTitleUpdated}
              onWebviewCreated={handleWebviewCreated}
              onWebviewDestroyed={handleWebviewDestroyed}
              onWebviewLoaded={handleWebviewLoaded}
              onScreenshotPresented={handleScreenshotPresented}
              onScrollEnded={handleScrollEnded}
              onUrlSubmit={handleUrlSubmit}
            />
          );
        })}
      </div>

      <FloatingToolbar onAddWebNode={onAddWebNode} onAddStickyNote={onAddStickyNote} />

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
