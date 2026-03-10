import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { ContextMenu } from '@/components/Common/ContextMenu';
import { StickyNoteNode } from '@/components/Node/StickyNoteNode';
import { WebPageNode } from '@/components/Node/WebPageNode';
import { FloatingToolbar } from '@/components/Siteboard/FloatingToolbar';
import { InteractionOverlay } from '@/components/Siteboard/InteractionOverlay';
import { ZoomIndicator } from '@/components/Siteboard/ZoomIndicator';
import { DRAG_REPOSITION_GAP, LOW_ZOOM_HIDE_THRESHOLD } from '@/constants';
import { useSiteboardDisplayEngine } from '@/hooks/siteboard/useSiteboardDisplayEngine';
import { useSiteboardKeyboard } from '@/hooks/siteboard/useSiteboardKeyboard';
import { useSiteboardNodeRuntime } from '@/hooks/siteboard/useSiteboardNodeRuntime';
import { useSiteboardViewportEngine } from '@/hooks/siteboard/useSiteboardViewportEngine';
import { resolveDraggedNodePosition } from '@/lib/siteboard-node-placement';
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

interface PositionCorrectionAnimation {
  token: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
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
    hydrateProjectScreenshotUrls,
    setProjectScreenshotUrl,
    clearProjectScreenshotUrl,
  } = useProjectStore(
    useShallow((s) => ({
      clearProjectScreenshotUrl: s.clearProjectScreenshotUrl,
      cycleStickyNoteColor: s.cycleStickyNoteColor,
      clearWebNodeWebviewLabel: s.clearWebNodeWebviewLabel,
      hydrateProjectScreenshotUrls: s.hydrateProjectScreenshotUrls,
      redoActiveProject: s.redoActiveProject,
      pinWebNodeUrl: s.pinWebNodeUrl,
      removeNode: s.removeNode,
      setProjectScreenshotUrl: s.setProjectScreenshotUrl,
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
    prepareInteractionStart,
    handleScreenshotPresented,
    interactionCursor,
    holdNodeDuringPositionSettle,
    scheduleInteractionUpdate,
    scheduleZoomRestoreAfterReflow,
    releaseNodeAfterPositionSettle,
    screenshotUrls,
  } = useSiteboardDisplayEngine({
    webPageNodes,
    webviewLabelsByNodeId: activeProjectWebviewRuntime.labelsByNodeId,
    cachedScreenshotUrlsByNodeId: activeProjectWebviewRuntime.screenshotUrlsByNodeId,
    projectId: activeId ?? '',
    containerRef,
    canvasRef,
    zoomRef,
    centeredNodeId,
    onCenteredNodeHandled,
    hydrateCachedScreenshotUrls: hydrateProjectScreenshotUrls,
    setCachedScreenshotUrl: setProjectScreenshotUrl,
    clearCachedScreenshotUrl: clearProjectScreenshotUrl,
  });

  const getZoom = useCallback(() => zoomRef.current, [zoomRef]);
  const [positionCorrectionAnimations, setPositionCorrectionAnimations] = useState<
    Record<string, PositionCorrectionAnimation>
  >({});
  const positionCorrectionAnimationsRef = useRef<Record<string, PositionCorrectionAnimation>>({});
  const positionCorrectionSequenceRef = useRef(0);

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
    prepareInteractionStart,
    onNodeResizeStart: handlePageResizeStart,
    onNodeResizeEnd: handlePageResizeEnd,
    scheduleInteractionUpdate,
    computeInteractionModes,
    computeDisplayModes,
    cancelZoomRestore,
    scheduleZoomRestoreAfterReflow,
    updateViewport,
    onNodeDragEnd: useCallback(
      (nodeId: string, x: number, y: number) => {
        const movingNode = nodes.find((candidate) => candidate.id === nodeId);
        if (!movingNode) return;

        const resolvedPosition = resolveDraggedNodePosition({
          nodes,
          movingNode,
          proposedX: x,
          proposedY: y,
          gap: DRAG_REPOSITION_GAP,
          zoom: zoomRef.current,
        });
        if (resolvedPosition.corrected && isWebPageNode(movingNode)) {
          positionCorrectionSequenceRef.current += 1;
          const nextAnimation = {
            token: positionCorrectionSequenceRef.current,
            fromX: x,
            fromY: y,
            toX: resolvedPosition.x,
            toY: resolvedPosition.y,
          };
          positionCorrectionAnimationsRef.current = {
            ...positionCorrectionAnimationsRef.current,
            [nodeId]: nextAnimation,
          };
          setPositionCorrectionAnimations((prev) => ({ ...prev, [nodeId]: nextAnimation }));
          holdNodeDuringPositionSettle(nodeId);
          if (movingNode.x !== resolvedPosition.x || movingNode.y !== resolvedPosition.y) {
            updateNodePosition(activeId, nodeId, resolvedPosition.x, resolvedPosition.y);
          }
          return;
        }

        updateNodePosition(activeId, nodeId, resolvedPosition.x, resolvedPosition.y);
      },
      [activeId, holdNodeDuringPositionSettle, nodes, updateNodePosition],
    ),
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

  const clearPositionCorrectionAnimation = useCallback(
    (nodeId: string) => {
      if (!(nodeId in positionCorrectionAnimationsRef.current)) return;
      const { [nodeId]: _removedAnimation, ...rest } = positionCorrectionAnimationsRef.current;
      positionCorrectionAnimationsRef.current = rest;
      setPositionCorrectionAnimations((prev) => {
        if (!(nodeId in prev)) return prev;
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      releaseNodeAfterPositionSettle(nodeId);
    },
    [releaseNodeAfterPositionSettle],
  );

  const handlePositionCorrectionAnimationComplete = useCallback(
    (nodeId: string, token: number) => {
      if (positionCorrectionAnimationsRef.current[nodeId]?.token !== token) return;
      clearPositionCorrectionAnimation(nodeId);
    },
    [clearPositionCorrectionAnimation],
  );

  const handleDragStartWithSettleReset = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      clearPositionCorrectionAnimation(nodeId);
      handleDragStart(e, nodeId);
    },
    [clearPositionCorrectionAnimation, handleDragStart],
  );

  const handleRemoveNodeWithSettleReset = useCallback(
    (nodeId: string) => {
      clearPositionCorrectionAnimation(nodeId);
      handleRemoveNode(nodeId);
    },
    [clearPositionCorrectionAnimation, handleRemoveNode],
  );

  useEffect(() => {
    const liveNodeIds = new Set(webPageNodes.map((node) => node.id));
    const staleAnimationNodeIds = Object.keys(positionCorrectionAnimationsRef.current).filter(
      (nodeId) => !liveNodeIds.has(nodeId),
    );
    if (staleAnimationNodeIds.length === 0) return;

    let nextAnimations = positionCorrectionAnimationsRef.current;
    for (const nodeId of staleAnimationNodeIds) {
      const { [nodeId]: _removedAnimation, ...rest } = nextAnimations;
      nextAnimations = rest;
      releaseNodeAfterPositionSettle(nodeId);
    }

    positionCorrectionAnimationsRef.current = nextAnimations;
    setPositionCorrectionAnimations((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const nodeId of staleAnimationNodeIds) {
        if (!(nodeId in next)) continue;
        delete next[nodeId];
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [releaseNodeAfterPositionSettle, webPageNodes]);

  useSiteboardKeyboard({
    selectedNodeId,
    onRemoveNode: handleRemoveNodeWithSettleReset,
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
        handleRemoveNodeWithSettleReset(contextMenu.nodeId);
      }
    },
    [contextMenu, handleContextMenuCloseDisplay, handleRemoveNodeWithSettleReset],
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
                onDragStart={handleDragStartWithSettleReset}
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
              onDragStart={handleDragStartWithSettleReset}
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
              positionCorrectionAnimationToken={
                positionCorrectionAnimations[node.id]?.token ?? null
              }
              positionCorrectionFromX={positionCorrectionAnimations[node.id]?.fromX ?? null}
              positionCorrectionFromY={positionCorrectionAnimations[node.id]?.fromY ?? null}
              positionCorrectionToX={positionCorrectionAnimations[node.id]?.toX ?? null}
              positionCorrectionToY={positionCorrectionAnimations[node.id]?.toY ?? null}
              onPositionCorrectionAnimationComplete={handlePositionCorrectionAnimationComplete}
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
