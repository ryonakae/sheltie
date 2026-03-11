import {
  applyNodeChanges,
  Background,
  ConnectionMode,
  MarkerType,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { animate, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { ContextMenu } from '@/components/Common/ContextMenu';
import { StickyNoteNode } from '@/components/Node/StickyNoteNode';
import { WebPageNode } from '@/components/Node/WebPageNode';
import { FloatingToolbar } from '@/components/Siteboard/FloatingToolbar';
import type { SiteboardFlowEdge, SiteboardFlowNode } from '@/components/Siteboard/flow-types';
import {
  EMPTY_POSITION_CORRECTION_ANIMATION,
  SiteboardNodeHandlersProvider,
  SiteboardRuntimeProvider,
  createSiteboardRuntimeStore,
} from '@/components/Siteboard/siteboard-runtime-store';
import { ZoomIndicator } from '@/components/Siteboard/ZoomIndicator';
import {
  DRAG_REPOSITION_GAP,
  LOW_ZOOM_HIDE_THRESHOLD,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_ANIMATION_EASE,
  ZOOM_RESET_DURATION_SEC,
  ZOOM_RESET_TARGET,
} from '@/constants';
import { useSiteboardDisplayEngine } from '@/hooks/siteboard/useSiteboardDisplayEngine';
import { useSiteboardKeyboard } from '@/hooks/siteboard/useSiteboardKeyboard';
import { useSiteboardNodeRuntime } from '@/hooks/siteboard/useSiteboardNodeRuntime';
import { resolveDraggedNodePosition } from '@/lib/siteboard-node-placement';
import {
  selectActiveProject,
  selectActiveProjectScreenshotUrls,
  selectActiveProjectWebviewLabels,
  useProjectStore,
} from '@/store/tab-store';
import { useThemeStore } from '@/store/theme-store';
import { type BoardEdge, type BoardNode, isStickyNoteNode, isWebPageNode } from '@/types';

const nodeTypes = {
  stickynote: StickyNoteNode,
  webpage: WebPageNode,
};

interface SiteboardProps {
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
  centeredNodeId?: string | null;
  onCenteredNodeHandled?: () => void;
  onAddWebNode: () => void;
  onAddStickyNote: () => void;
}

interface HistorySnapshot {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

interface ContextMenuState {
  kind: 'node' | 'edge';
  id: string;
  x: number;
  y: number;
}

interface PositionCorrectionAnimation {
  token: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

function cloneHistorySnapshot(project?: {
  nodes: BoardNode[];
  edges: BoardEdge[];
}): HistorySnapshot | null {
  if (!project) return null;
  return {
    nodes: project.nodes.map((node) => ({ ...node })),
    edges: project.edges.map((edge) => ({ ...edge })),
  };
}

function areSnapshotsEqual(left: HistorySnapshot, right: HistorySnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function shouldHideCompactControlsAtZoom(zoom: number): boolean {
  return Math.round(zoom * 100) <= Math.round(LOW_ZOOM_HIDE_THRESHOLD * 100);
}

function isViewportSnapshotEqual(
  currentViewport: Viewport,
  nextViewport: { zoom: number; panX: number; panY: number },
): boolean {
  return (
    Math.abs(currentViewport.zoom - nextViewport.zoom) < 0.0001 &&
    Math.abs(currentViewport.x - nextViewport.panX) < 0.0001 &&
    Math.abs(currentViewport.y - nextViewport.panY) < 0.0001
  );
}

function areBoardNodesEquivalent(left: BoardNode, right: BoardNode): boolean {
  return (
    left.id === right.id &&
    left.type === right.type &&
    left.title === right.title &&
    left.url === right.url &&
    left.addedUrl === right.addedUrl &&
    left.content === right.content &&
    left.colorIndex === right.colorIndex &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
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
  // webview ラベルの購読はラベル変更時のみ再レンダリング（スクリーンショット更新では発火しない）
  const webviewLabelsByNodeId = useProjectStore(selectActiveProjectWebviewLabels);
  // screenshotUrls は初期マウント時のシード用途のみ。購読は維持するが
  // useSiteboardDisplayEngine 内で useState により初期値として固定され、以降は反応しない
  const cachedScreenshotUrlsByNodeId = useProjectStore(selectActiveProjectScreenshotUrls);
  const activeId = useProjectStore((state) => state.activeId);
  const isDark = useThemeStore((s) => s.isDark);
  const prefersReducedMotion = useReducedMotion();

  const {
    addEdge,
    bringNodeToFront,
    clearProjectScreenshotUrl,
    clearWebNodeWebviewLabel,
    cycleStickyNoteColor,
    hydrateProjectScreenshotUrls,
    pinWebNodeUrl,
    recordProjectHistorySnapshot,
    redoActiveProject,
    removeEdge,
    removeNode,
    setProjectNodesWithoutHistory,
    setProjectScreenshotUrl,
    setWebNodeUrl,
    setWebNodeWebviewLabel,
    undoActiveProject,
    updateNodeSize,
    updateNodeSizeWithoutHistory,
    updateNodeTitle,
    updateStickyNoteContent,
    updateViewport,
    updateWebNodeUrl,
  } = useProjectStore(
    useShallow((state) => ({
      addEdge: state.addEdge,
      bringNodeToFront: state.bringNodeToFront,
      clearProjectScreenshotUrl: state.clearProjectScreenshotUrl,
      clearWebNodeWebviewLabel: state.clearWebNodeWebviewLabel,
      cycleStickyNoteColor: state.cycleStickyNoteColor,
      hydrateProjectScreenshotUrls: state.hydrateProjectScreenshotUrls,
      pinWebNodeUrl: state.pinWebNodeUrl,
      recordProjectHistorySnapshot: state.recordProjectHistorySnapshot,
      redoActiveProject: state.redoActiveProject,
      removeEdge: state.removeEdge,
      removeNode: state.removeNode,
      setProjectNodesWithoutHistory: state.setProjectNodesWithoutHistory,
      setProjectScreenshotUrl: state.setProjectScreenshotUrl,
      setWebNodeUrl: state.setWebNodeUrl,
      setWebNodeWebviewLabel: state.setWebNodeWebviewLabel,
      undoActiveProject: state.undoActiveProject,
      updateNodeSize: state.updateNodeSize,
      updateNodeSizeWithoutHistory: state.updateNodeSizeWithoutHistory,
      updateNodeTitle: state.updateNodeTitle,
      updateStickyNoteContent: state.updateStickyNoteContent,
      updateViewport: state.updateViewport,
      updateWebNodeUrl: state.updateWebNodeUrl,
    })),
  );

  const nodes = useMemo(() => activeProject?.nodes ?? [], [activeProject?.nodes]);
  const edges = useMemo(() => activeProject?.edges ?? [], [activeProject?.edges]);
  const webPageNodes = useMemo(() => nodes.filter(isWebPageNode), [nodes]);

  const containerRef = useRef<HTMLDivElement>(null);
  const reactFlowInstanceRef = useRef<ReactFlowInstance<
    SiteboardFlowNode,
    SiteboardFlowEdge
  > | null>(null);
  const [runtimeStore] = useState(() =>
    createSiteboardRuntimeStore({
      compactControlsHidden: shouldHideCompactControlsAtZoom(activeProject?.viewport.zoom ?? 1),
    }),
  );
  const liveNodesRef = useRef<BoardNode[]>(nodes);
  const flowNodesRef = useRef<SiteboardFlowNode[]>([]);
  const zoomRef = useRef(activeProject?.viewport.zoom ?? 1);
  const panXRef = useRef(activeProject?.viewport.panX ?? 0);
  const panYRef = useRef(activeProject?.viewport.panY ?? 0);
  const moveStartZoomRef = useRef(activeProject?.viewport.zoom ?? 1);
  const zoomMoveActiveRef = useRef(false);
  const dragHistorySnapshotRef = useRef<HistorySnapshot | null>(null);
  const resizeHistorySnapshotRef = useRef<HistorySnapshot | null>(null);
  const scrollInteractionTokenRef = useRef(0);
  const zoomResetAnimationRef = useRef<{ stop: () => void } | null>(null);
  const positionCorrectionSequenceRef = useRef(0);
  // ドラッグ/リサイズ中の setFlowNodes を rAF でスロットリングするため
  const nodeStateUpdateRafRef = useRef<number | null>(null);

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(() =>
    selectedNodeId ? [selectedNodeId] : [],
  );
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const compactControlsHiddenRef = useRef(
    shouldHideCompactControlsAtZoom(activeProject?.viewport.zoom ?? 1),
  );
  const [flowNodes, setFlowNodes] = useState<SiteboardFlowNode[]>([]);

  const syncCompactControlsVisibility = useCallback(
    (zoom: number) => {
      const nextHidden = shouldHideCompactControlsAtZoom(zoom);
      if (compactControlsHiddenRef.current === nextHidden) return;

      compactControlsHiddenRef.current = nextHidden;
      runtimeStore.getState().setCompactControlsHidden(nextHidden);
    },
    [runtimeStore],
  );

  const getCurrentWebPageNodes = useCallback(() => liveNodesRef.current.filter(isWebPageNode), []);

  const syncViewportStyles = useCallback(
    (viewport: { zoom: number; panX: number; panY: number }, skipCssPropUpdate = false) => {
      const zoomChanged = zoomRef.current !== viewport.zoom;

      zoomRef.current = viewport.zoom;
      panXRef.current = viewport.panX;
      panYRef.current = viewport.panY;

      if (!zoomChanged) return;

      syncCompactControlsVisibility(viewport.zoom);

      if (skipCssPropUpdate) return;

      const container = containerRef.current;
      if (!container) return;

      // ノード UI のスケーリング（zoomPx()）に必要
      container.style.setProperty('--canvas-zoom', String(viewport.zoom));
    },
    [syncCompactControlsVisibility],
  );

  const {
    activeInteractionsRef,
    captureScreenshot,
    cancelZoomRestore,
    computeDisplayModes,
    handleContextMenuClose: handleContextMenuCloseDisplay,
    handleContextMenuOpen,
    handleInteractionChange,
    handlePageResizeEnd,
    handlePageResizeStart,
    prepareInteractionStart,
    handleScreenshotPresented,
    holdNodeDuringPositionSettle,
    releaseNodeAfterPositionSettle,
    scheduleInteractionUpdate,
    scheduleZoomRestoreAfterReflow,
  } = useSiteboardDisplayEngine({
    getCurrentWebPageNodes,
    webPageNodes,
    runtimeStore,
    webviewLabelsByNodeId,
    cachedScreenshotUrlsByNodeId,
    projectId: activeId ?? '',
    containerRef,
    zoomRef,
    panXRef,
    panYRef,
    centeredNodeId,
    onCenteredNodeHandled,
    hydrateCachedScreenshotUrls: hydrateProjectScreenshotUrls,
    setCachedScreenshotUrl: setProjectScreenshotUrl,
    clearCachedScreenshotUrl: clearProjectScreenshotUrl,
  });

  const {
    handleGoBack,
    handleGoForward,
    handleNavigated,
    handlePinWebNodeUrl,
    handleReloadWebNode,
    handleRemoveNode,
    handleResizePreset,
    handleStickyNoteAutoHeightChange,
    handleStickyNoteColorCycle,
    handleStickyNoteContentChange,
    handleTitleUpdated,
    handleUrlSubmit,
    handleWebviewCreated,
    handleWebviewDestroyed,
    handleWebviewLoaded,
  } = useSiteboardNodeRuntime({
    activeId,
    nodes,
    selectedNodeId,
    onClearSelection,
    runtimeStore,
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

  const persistedViewport = useMemo(
    () => ({
      zoom: activeProject?.viewport.zoom ?? 1,
      panX: activeProject?.viewport.panX ?? 0,
      panY: activeProject?.viewport.panY ?? 0,
    }),
    [activeProject?.viewport.panX, activeProject?.viewport.panY, activeProject?.viewport.zoom],
  );

  const effectiveSelectedNodeIds = useMemo(() => {
    const liveNodeIds = new Set(nodes.map((node) => node.id));
    if (selectedNodeId && liveNodeIds.has(selectedNodeId)) {
      return [selectedNodeId];
    }
    return selectedNodeIds.filter((nodeId) => liveNodeIds.has(nodeId));
  }, [nodes, selectedNodeId, selectedNodeIds]);

  const effectiveSelectedEdgeIds = useMemo(() => {
    const liveEdgeIds = new Set(edges.map((edge) => edge.id));
    return selectedEdgeIds.filter((edgeId) => liveEdgeIds.has(edgeId));
  }, [edges, selectedEdgeIds]);

  const syncCanvasSelection = useCallback(
    (nextNodeIds: string[], nextEdgeIds: string[]) => {
      setSelectedNodeIds(nextNodeIds);
      setSelectedEdgeIds(nextEdgeIds);

      if (nextNodeIds.length === 1 && nextEdgeIds.length === 0) {
        onSelectNode(nextNodeIds[0]);
        return;
      }

      onClearSelection();
    },
    [onClearSelection, onSelectNode],
  );

  useEffect(() => {
    // 操作中は handleMove/handleMoveEnd が viewport を直接管理しているため、
    // Zustand 経由の反射的な setViewport を防ぐ
    if (activeInteractionsRef.current.size > 0) return;

    // handleMoveEnd が直前に syncViewportStyles を実行済みの場合は二重適用を防ぐ。
    // zoomRef/panXRef/panYRef は syncViewportStyles で常に最新値に更新されるため、
    // ref と persistedViewport が一致する = 既にこのフレームで同期済み。
    if (
      Math.abs(zoomRef.current - persistedViewport.zoom) < 0.0001 &&
      Math.abs(panXRef.current - persistedViewport.panX) < 0.0001 &&
      Math.abs(panYRef.current - persistedViewport.panY) < 0.0001
    ) {
      return;
    }

    syncViewportStyles(persistedViewport);

    const instance = reactFlowInstanceRef.current;
    if (instance && !isViewportSnapshotEqual(instance.getViewport(), persistedViewport)) {
      void instance.setViewport({
        x: persistedViewport.panX,
        y: persistedViewport.panY,
        zoom: persistedViewport.zoom,
      });
    }

    requestAnimationFrame(() => {
      if (activeInteractionsRef.current.size === 0) {
        computeDisplayModes();
      }
    });
  }, [
    activeInteractionsRef,
    computeDisplayModes,
    panXRef,
    panYRef,
    persistedViewport,
    syncViewportStyles,
    zoomRef,
  ]);

  const commitHistorySnapshot = useCallback(
    (snapshot: HistorySnapshot | null) => {
      if (!snapshot) return;
      const latestProject = useProjectStore
        .getState()
        .projects.find((project) => project.id === activeId);
      if (!latestProject) return;

      const latestSnapshot = cloneHistorySnapshot(latestProject);
      if (!latestSnapshot || areSnapshotsEqual(snapshot, latestSnapshot)) return;
      recordProjectHistorySnapshot(activeId, snapshot);
    },
    [activeId, recordProjectHistorySnapshot],
  );

  const clearPositionCorrectionAnimation = useCallback(
    (nodeId: string) => {
      runtimeStore.getState().clearPositionCorrectionAnimation(nodeId);
      releaseNodeAfterPositionSettle(nodeId);
    },
    [releaseNodeAfterPositionSettle, runtimeStore],
  );

  const handlePositionCorrectionAnimationComplete = useCallback(
    (nodeId: string, token: number) => {
      const currentAnimation =
        runtimeStore.getState().webNodes[nodeId]?.positionCorrectionAnimation ??
        EMPTY_POSITION_CORRECTION_ANIMATION;
      if (currentAnimation.token !== token) return;
      clearPositionCorrectionAnimation(nodeId);
    },
    [clearPositionCorrectionAnimation, runtimeStore],
  );

  const removeNodesByIds = useCallback(
    (nodeIds: string[]) => {
      handleContextMenuCloseDisplay();
      setContextMenu(null);
      for (const nodeId of nodeIds) {
        clearPositionCorrectionAnimation(nodeId);
        handleRemoveNode(nodeId);
      }
      syncCanvasSelection([], []);
    },
    [
      clearPositionCorrectionAnimation,
      handleContextMenuCloseDisplay,
      handleRemoveNode,
      syncCanvasSelection,
    ],
  );

  const removeEdgesByIds = useCallback(
    (edgeIds: string[]) => {
      setContextMenu(null);
      edgeIds.forEach((edgeId) => removeEdge(activeId, edgeId));
      syncCanvasSelection([], []);
    },
    [activeId, removeEdge, syncCanvasSelection],
  );

  useSiteboardKeyboard({
    selectedNodeIds: effectiveSelectedNodeIds,
    selectedEdgeIds: effectiveSelectedEdgeIds,
    onRemoveNodes: removeNodesByIds,
    onRemoveEdges: removeEdgesByIds,
    onUndo: undoActiveProject,
    onRedo: redoActiveProject,
  });

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
    handleContextMenuCloseDisplay();
  }, [handleContextMenuCloseDisplay]);

  const handleContextMenuAction = useCallback(
    (actionId: string) => {
      if (actionId !== 'remove' || !contextMenu) return;

      if (contextMenu.kind === 'node') {
        removeNodesByIds([contextMenu.id]);
        return;
      }

      removeEdgesByIds([contextMenu.id]);
    },
    [contextMenu, removeEdgesByIds, removeNodesByIds],
  );

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node<Record<string, unknown>>) => {
      event.preventDefault();
      syncCanvasSelection([node.id], []);

      const boardNode = nodes.find((candidate) => candidate.id === node.id);
      if (boardNode && !isStickyNoteNode(boardNode)) {
        void handleContextMenuOpen(node.id).then(() => {
          requestAnimationFrame(() => {
            setContextMenu({ kind: 'node', id: node.id, x: event.clientX, y: event.clientY });
          });
        });
        return;
      }

      setContextMenu({ kind: 'node', id: node.id, x: event.clientX, y: event.clientY });
    },
    [handleContextMenuOpen, nodes, syncCanvasSelection],
  );

  const handleEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      syncCanvasSelection([], [edge.id]);
      setContextMenu({ kind: 'edge', id: edge.id, x: event.clientX, y: event.clientY });
    },
    [syncCanvasSelection],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: { nodes: Node[]; edges: Edge[] }) => {
      syncCanvasSelection(
        selectedNodes.map((node) => node.id),
        selectedEdges.map((edge) => edge.id),
      );
    },
    [syncCanvasSelection],
  );

  const commitLiveFlowNodes = useCallback((nextFlowNodes: SiteboardFlowNode[]) => {
    flowNodesRef.current = nextFlowNodes;
    liveNodesRef.current = nextFlowNodes.map((flowNode) => flowNode.data.node);
    setFlowNodes(nextFlowNodes);
  }, []);

  // ref のみ更新してドラッグ中の React state 更新を rAF でまとめる高速パス。
  // commitLiveFlowNodes と異なり setFlowNodes を即座に呼ばず、フレームあたり最大1回に抑える。
  const commitLiveFlowNodesThrottled = useCallback((nextFlowNodes: SiteboardFlowNode[]) => {
    flowNodesRef.current = nextFlowNodes;
    liveNodesRef.current = nextFlowNodes.map((flowNode) => flowNode.data.node);
    if (nodeStateUpdateRafRef.current === null) {
      nodeStateUpdateRafRef.current = requestAnimationFrame(() => {
        nodeStateUpdateRafRef.current = null;
        setFlowNodes(flowNodesRef.current);
      });
    }
  }, []);

  const handleNodesChange = useCallback(
    (changes: NodeChange<SiteboardFlowNode>[]) => {
      if (activeInteractionsRef.current.size > 0) {
        // 操作中は position change のみ手動適用。dimensions change を完全スキップし、
        // ズーム中の ResizeObserver → dimensions change → setFlowNodes フィードバックループを断ち切る。
        // applyNodeChanges を使わないことで measured 更新も発生しないため、
        // ループの根本原因を除去できる。measured は操作終了後に自然に再取得される。
        const positionChanges = changes.filter(
          (c): c is Extract<NodeChange<SiteboardFlowNode>, { type: 'position' }> =>
            c.type === 'position' && c.position !== undefined,
        );
        if (positionChanges.length === 0) return;

        const positionsById = new Map(positionChanges.map((c) => [c.id, c.position] as const));
        const nextFlowNodes = flowNodesRef.current.map((flowNode) => {
          const nextPos = positionsById.get(flowNode.id);
          if (!nextPos) return flowNode;
          if (flowNode.data.node.x === nextPos.x && flowNode.data.node.y === nextPos.y) {
            return flowNode;
          }
          return {
            ...flowNode,
            position: nextPos,
            data: {
              ...flowNode.data,
              node: { ...flowNode.data.node, x: nextPos.x, y: nextPos.y },
            },
          } as SiteboardFlowNode;
        });
        commitLiveFlowNodesThrottled(nextFlowNodes);
        scheduleInteractionUpdate();
        return;
      }

      // 非操作時は controlled mode の要件通り applyNodeChanges で全 change を適用する。
      // dimensions change を反映しないとノードの measured が失われチラつきが発生する。
      const updatedFlowNodes = applyNodeChanges(
        changes,
        flowNodesRef.current,
      ) as SiteboardFlowNode[];

      const positionChanges = changes.filter(
        (change): change is Extract<NodeChange<SiteboardFlowNode>, { type: 'position' }> =>
          change.type === 'position' && change.position !== undefined,
      );

      let finalNodes = updatedFlowNodes;
      if (positionChanges.length > 0) {
        // position change がある場合は data.node の x, y も同期（Webview 位置追従用）
        const positionsById = new Map(
          positionChanges.map((change) => [change.id, change.position] as const),
        );
        finalNodes = updatedFlowNodes.map((flowNode) => {
          const nextPosition = positionsById.get(flowNode.id);
          if (!nextPosition) return flowNode;
          if (flowNode.data.node.x === nextPosition.x && flowNode.data.node.y === nextPosition.y) {
            return flowNode;
          }
          return {
            ...flowNode,
            data: {
              ...flowNode.data,
              node: {
                ...flowNode.data.node,
                x: nextPosition.x,
                y: nextPosition.y,
              },
            },
          } as SiteboardFlowNode;
        });
      }

      if (finalNodes === flowNodesRef.current) return;

      // dimensions 等は即座に反映（遅延するとチラつきが発生する）
      flowNodesRef.current = finalNodes;
      liveNodesRef.current = finalNodes.map((flowNode) => flowNode.data.node);
      setFlowNodes(finalNodes);
    },
    [activeInteractionsRef, commitLiveFlowNodesThrottled, scheduleInteractionUpdate],
  );

  const handleNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: Node, draggedNodes: Node[]) => {
      const draggedNodeIds = draggedNodes.map((entry) => entry.id);
      syncCanvasSelection(draggedNodeIds, []);
      bringNodeToFront(activeId, node.id);
      clearPositionCorrectionAnimation(node.id);

      if (!dragHistorySnapshotRef.current) {
        // activeProject を依存配列から除くため getState() で最新値を取得
        const latestProject = useProjectStore
          .getState()
          .projects.find((project) => project.id === activeId);
        dragHistorySnapshotRef.current = cloneHistorySnapshot(latestProject);
      }

      void prepareInteractionStart('drag', node.id);
      handleInteractionChange(true, 'grabbing', 'drag');
    },
    [
      activeId,
      bringNodeToFront,
      clearPositionCorrectionAnimation,
      handleInteractionChange,
      prepareInteractionStart,
      syncCanvasSelection,
    ],
  );

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node, draggedNodes: Node[]) => {
      const currentNodes = liveNodesRef.current;
      let nextCommittedNodes = currentNodes;

      if (draggedNodes.length === 1) {
        const movingNode = currentNodes.find((candidate) => candidate.id === node.id);
        if (movingNode) {
          const resolvedPosition = resolveDraggedNodePosition({
            nodes: currentNodes,
            movingNode,
            proposedX: movingNode.x,
            proposedY: movingNode.y,
            gap: DRAG_REPOSITION_GAP,
            zoom: zoomRef.current,
          });

          if (resolvedPosition.corrected && isWebPageNode(movingNode)) {
            positionCorrectionSequenceRef.current += 1;
            const nextAnimation: PositionCorrectionAnimation = {
              token: positionCorrectionSequenceRef.current,
              fromX: movingNode.x,
              fromY: movingNode.y,
              toX: resolvedPosition.x,
              toY: resolvedPosition.y,
            };
            runtimeStore.getState().setPositionCorrectionAnimation(node.id, nextAnimation);
            holdNodeDuringPositionSettle(node.id);

            nextCommittedNodes = currentNodes.map((candidate) =>
              candidate.id === node.id
                ? { ...candidate, x: resolvedPosition.x, y: resolvedPosition.y }
                : candidate,
            );
            commitLiveFlowNodes(
              flowNodesRef.current.map((flowNode) =>
                flowNode.id === node.id
                  ? ({
                      ...flowNode,
                      position: { x: resolvedPosition.x, y: resolvedPosition.y },
                      data: {
                        ...flowNode.data,
                        node: {
                          ...flowNode.data.node,
                          x: resolvedPosition.x,
                          y: resolvedPosition.y,
                        },
                      },
                    } as SiteboardFlowNode)
                  : flowNode,
              ),
            );
          }
        }
      }

      setProjectNodesWithoutHistory(activeId, nextCommittedNodes);
      commitHistorySnapshot(dragHistorySnapshotRef.current);
      dragHistorySnapshotRef.current = null;
      handleInteractionChange(false, 'grabbing', 'drag');
      scheduleInteractionUpdate();
    },
    [
      activeId,
      commitLiveFlowNodes,
      commitHistorySnapshot,
      handleInteractionChange,
      holdNodeDuringPositionSettle,
      runtimeStore,
      scheduleInteractionUpdate,
      setProjectNodesWithoutHistory,
    ],
  );

  const handleResizeStart = useCallback(
    (nodeId: string) => {
      if (!resizeHistorySnapshotRef.current) {
        // activeProject を依存配列から除くため getState() で最新値を取得
        const latestProject = useProjectStore
          .getState()
          .projects.find((project) => project.id === activeId);
        resizeHistorySnapshotRef.current = cloneHistorySnapshot(latestProject);
      }
      void prepareInteractionStart('resize', nodeId);
      handlePageResizeStart(nodeId);
      handleInteractionChange(true, 'default', 'resize');
    },
    [activeId, handleInteractionChange, handlePageResizeStart, prepareInteractionStart],
  );

  const handleResize = useCallback(
    (nodeId: string, width: number, height: number) => {
      const nextFlowNodes = flowNodesRef.current.map((flowNode) =>
        flowNode.id === nodeId
          ? ({
              ...flowNode,
              data: {
                ...flowNode.data,
                node: {
                  ...flowNode.data.node,
                  width,
                  height,
                },
              },
            } as SiteboardFlowNode)
          : flowNode,
      );
      // リサイズ中の毎フレーム React 再レンダリングを rAF でまとめる
      commitLiveFlowNodesThrottled(nextFlowNodes);
      scheduleInteractionUpdate();
    },
    [commitLiveFlowNodesThrottled, scheduleInteractionUpdate],
  );

  const handleResizeEnd = useCallback(
    (nodeId: string, width: number, height: number) => {
      const nextCommittedNodes = liveNodesRef.current.map((node) =>
        node.id === nodeId ? { ...node, width, height } : node,
      );
      commitLiveFlowNodes(
        flowNodesRef.current.map((flowNode) =>
          flowNode.id === nodeId
            ? ({
                ...flowNode,
                data: {
                  ...flowNode.data,
                  node: {
                    ...flowNode.data.node,
                    width,
                    height,
                  },
                },
              } as SiteboardFlowNode)
            : flowNode,
        ),
      );
      setProjectNodesWithoutHistory(activeId, nextCommittedNodes);
      commitHistorySnapshot(resizeHistorySnapshotRef.current);
      resizeHistorySnapshotRef.current = null;
      handlePageResizeEnd(nodeId);
      handleInteractionChange(false, 'default', 'resize');
      scheduleInteractionUpdate();
    },
    [
      activeId,
      commitLiveFlowNodes,
      commitHistorySnapshot,
      handleInteractionChange,
      handlePageResizeEnd,
      scheduleInteractionUpdate,
      setProjectNodesWithoutHistory,
    ],
  );

  const handleScrollStarted = useCallback(
    (nodeId: string) => {
      scrollInteractionTokenRef.current += 1;
      void prepareInteractionStart('scroll', nodeId);
      handleInteractionChange(true, 'default', 'scroll');
    },
    [handleInteractionChange, prepareInteractionStart],
  );

  const handleScrollEnded = useCallback(
    (nodeId: string) => {
      const token = scrollInteractionTokenRef.current;
      void (async () => {
        await captureScreenshot(nodeId, {
          forceDuringInteraction: true,
          waitForPresentation: true,
        });
        if (scrollInteractionTokenRef.current !== token) return;
        handleInteractionChange(false, 'default', 'scroll');
      })();
    },
    [captureScreenshot, handleInteractionChange],
  );

  const handleConnectStart = useCallback(() => {
    void prepareInteractionStart('connect');
    handleInteractionChange(true, 'default', 'connect');
  }, [handleInteractionChange, prepareInteractionStart]);

  const handleConnectEnd = useCallback(() => {
    handleInteractionChange(false, 'default', 'connect');
  }, [handleInteractionChange]);

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => syncCanvasSelection([], [edge.id]),
    [syncCanvasSelection],
  );

  const handlePaneClick = useCallback(() => {
    handleContextMenuClose();
    syncCanvasSelection([], []);
  }, [handleContextMenuClose, syncCanvasSelection]);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      addEdge(activeId, {
        id: crypto.randomUUID(),
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        type: 'smoothstep',
      });
    },
    [activeId, addEdge],
  );

  const handleMoveStart = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      moveStartZoomRef.current = viewport.zoom;
      zoomMoveActiveRef.current = false;
      syncViewportStyles({ zoom: viewport.zoom, panX: viewport.x, panY: viewport.y });
      void prepareInteractionStart('pan');
      handleInteractionChange(true, 'grabbing', 'pan');
    },
    [handleInteractionChange, prepareInteractionStart, syncViewportStyles],
  );

  const handleMove = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      // ズーム中は --canvas-zoom の CSS 更新をスキップし、ResizeObserver フィードバックループを防止する。
      // zoomRef は更新されるため display engine の座標計算には影響しない。
      // --canvas-zoom はズーム終了（handleMoveEnd）時に確実に反映される。
      syncViewportStyles({ zoom: viewport.zoom, panX: viewport.x, panY: viewport.y }, true);
      scheduleInteractionUpdate();

      if (
        !zoomMoveActiveRef.current &&
        Math.abs(viewport.zoom - moveStartZoomRef.current) > 0.0001
      ) {
        zoomMoveActiveRef.current = true;
        // pan 開始時に prepareInteractionStart('pan') で既にスクリーンショット準備済みのため省略
        handleInteractionChange(true, 'default', 'zoom');
      }
    },
    [handleInteractionChange, scheduleInteractionUpdate, syncViewportStyles],
  );

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      syncViewportStyles({ zoom: viewport.zoom, panX: viewport.x, panY: viewport.y });

      // ズーム中に --canvas-zoom の更新をスキップしていたため、ズーム終了時に確実に反映する。
      // handleMove の最終フレームと同じ zoom 値が来ると syncViewportStyles の zoomChanged が
      // false になり CSS 更新がスキップされるため、ここで明示的に適用する。
      if (zoomMoveActiveRef.current) {
        containerRef.current?.style.setProperty('--canvas-zoom', String(viewport.zoom));
      }

      updateViewport(activeId, {
        zoom: viewport.zoom,
        panX: viewport.x,
        panY: viewport.y,
      });

      if (zoomMoveActiveRef.current) {
        zoomMoveActiveRef.current = false;
        handleInteractionChange(false, 'default', 'zoom');
      }
      handleInteractionChange(false, 'grabbing', 'pan');
    },
    [activeId, handleInteractionChange, syncViewportStyles, updateViewport],
  );

  const handleResetZoom = useCallback(() => {
    const reactFlowInstance = reactFlowInstanceRef.current;
    if (!containerRef.current || !activeProject || !reactFlowInstance) return;
    if (Math.abs(zoomRef.current - ZOOM_RESET_TARGET) < 0.0001) return;

    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const startZoom = zoomRef.current;
    const startPanX = panXRef.current;
    const startPanY = panYRef.current;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const applyZoomState = (nextZoom: number) => {
      const scaleRatio = nextZoom / startZoom;
      const nextPanX = centerX - (centerX - startPanX) * scaleRatio;
      const nextPanY = centerY - (centerY - startPanY) * scaleRatio;

      syncViewportStyles({ zoom: nextZoom, panX: nextPanX, panY: nextPanY });
      void reactFlowInstance.setViewport({ x: nextPanX, y: nextPanY, zoom: nextZoom });
      scheduleInteractionUpdate();
    };

    zoomResetAnimationRef.current?.stop();
    void prepareInteractionStart('zoom');
    handleInteractionChange(true, 'default', 'zoom');

    if (prefersReducedMotion) {
      applyZoomState(ZOOM_RESET_TARGET);
      updateViewport(activeId, {
        zoom: ZOOM_RESET_TARGET,
        panX: panXRef.current,
        panY: panYRef.current,
      });
      handleInteractionChange(false, 'default', 'zoom');
      scheduleZoomRestoreAfterReflow();
      return;
    }

    zoomResetAnimationRef.current = animate(startZoom, ZOOM_RESET_TARGET, {
      duration: ZOOM_RESET_DURATION_SEC,
      ease: ZOOM_ANIMATION_EASE,
      onUpdate: applyZoomState,
      onComplete: () => {
        zoomResetAnimationRef.current = null;
        applyZoomState(ZOOM_RESET_TARGET);
        updateViewport(activeId, {
          zoom: ZOOM_RESET_TARGET,
          panX: panXRef.current,
          panY: panYRef.current,
        });
        handleInteractionChange(false, 'default', 'zoom');
        scheduleZoomRestoreAfterReflow();
      },
    });
  }, [
    activeId,
    activeProject,
    handleInteractionChange,
    prefersReducedMotion,
    prepareInteractionStart,
    scheduleInteractionUpdate,
    scheduleZoomRestoreAfterReflow,
    syncViewportStyles,
    updateViewport,
  ]);

  useEffect(() => {
    return () => {
      zoomResetAnimationRef.current?.stop();
      zoomResetAnimationRef.current = null;
      reactFlowInstanceRef.current = null;
      cancelZoomRestore();
    };
  }, [cancelZoomRestore]);

  // 全ハンドラを ref に保持し、毎レンダーで最新値に更新する。
  // buildFlowNode の依存配列からハンドラを排除することで、ハンドラ参照変更による
  // 全ノード再構築カスケードを防ぐ。
  const nodeDataHandlersRef = useRef({
    handleGoBack,
    handleGoForward,
    handleNavigated,
    handlePinWebNodeUrl,
    handlePositionCorrectionAnimationComplete,
    handleReloadWebNode,
    handleResize,
    handleResizeEnd,
    handleResizePreset,
    handleResizeStart,
    handleScreenshotPresented,
    handleScrollEnded,
    handleScrollStarted,
    handleStickyNoteAutoHeightChange,
    handleStickyNoteColorCycle,
    handleStickyNoteContentChange,
    handleTitleUpdated,
    handleUrlSubmit,
    handleWebviewCreated,
    handleWebviewDestroyed,
    handleWebviewLoaded,
  });
  // レンダーのたびに ref を最新値で同期（レンダー後・ペイント前に実行する useLayoutEffect を使用）
  useLayoutEffect(() => {
    nodeDataHandlersRef.current = {
      handleGoBack,
      handleGoForward,
      handleNavigated,
      handlePinWebNodeUrl,
      handlePositionCorrectionAnimationComplete,
      handleReloadWebNode,
      handleResize,
      handleResizeEnd,
      handleResizePreset,
      handleResizeStart,
      handleScreenshotPresented,
      handleScrollEnded,
      handleScrollStarted,
      handleStickyNoteAutoHeightChange,
      handleStickyNoteColorCycle,
      handleStickyNoteContentChange,
      handleTitleUpdated,
      handleUrlSubmit,
      handleWebviewCreated,
      handleWebviewDestroyed,
      handleWebviewLoaded,
    };
  });

  // ref 経由で最新ハンドラを呼ぶ安定したラッパー。依存配列が空なので参照が変わらず、
  // buildFlowNode → flowNodes の再構築を操作中に発生させない。
  const stableNodeDataHandlers = useMemo(
    () => ({
      onGoBack: (nodeId: string) => nodeDataHandlersRef.current.handleGoBack(nodeId),
      onGoForward: (nodeId: string) => nodeDataHandlersRef.current.handleGoForward(nodeId),
      onReload: (nodeId: string) => nodeDataHandlersRef.current.handleReloadWebNode(nodeId),
      onPinUrl: (nodeId: string) => nodeDataHandlersRef.current.handlePinWebNodeUrl(nodeId),
      onResizePreset: (nodeId: string, width: number, height: number) =>
        nodeDataHandlersRef.current.handleResizePreset(nodeId, width, height),
      onNavigated: (nodeId: string, url: string, title: string) =>
        nodeDataHandlersRef.current.handleNavigated(nodeId, url, title),
      onTitleUpdated: (nodeId: string, title: string) =>
        nodeDataHandlersRef.current.handleTitleUpdated(nodeId, title),
      onWebviewCreated: (nodeId: string, label: string) =>
        nodeDataHandlersRef.current.handleWebviewCreated(nodeId, label),
      onWebviewDestroyed: (nodeId: string) =>
        nodeDataHandlersRef.current.handleWebviewDestroyed(nodeId),
      onWebviewLoaded: (nodeId: string) => nodeDataHandlersRef.current.handleWebviewLoaded(nodeId),
      onScreenshotPresented: (nodeId: string, url: string) =>
        nodeDataHandlersRef.current.handleScreenshotPresented(nodeId, url),
      onScrollStarted: (nodeId: string) => nodeDataHandlersRef.current.handleScrollStarted(nodeId),
      onScrollEnded: (nodeId: string) => nodeDataHandlersRef.current.handleScrollEnded(nodeId),
      onUrlSubmit: (nodeId: string, url: string) =>
        nodeDataHandlersRef.current.handleUrlSubmit(nodeId, url),
      onResizeStart: (nodeId: string) => nodeDataHandlersRef.current.handleResizeStart(nodeId),
      onResize: (nodeId: string, width: number, height: number) =>
        nodeDataHandlersRef.current.handleResize(nodeId, width, height),
      onResizeEnd: (nodeId: string, width: number, height: number) =>
        nodeDataHandlersRef.current.handleResizeEnd(nodeId, width, height),
      onPositionCorrectionAnimationComplete: (nodeId: string, token: number) =>
        nodeDataHandlersRef.current.handlePositionCorrectionAnimationComplete(nodeId, token),
      onAutoHeightChange: (nodeId: string, height: number) =>
        nodeDataHandlersRef.current.handleStickyNoteAutoHeightChange(nodeId, height),
      onColorCycle: (nodeId: string) =>
        nodeDataHandlersRef.current.handleStickyNoteColorCycle(nodeId),
      onContentChange: (nodeId: string, content: string) =>
        nodeDataHandlersRef.current.handleStickyNoteContentChange(nodeId, content),
    }),
    [],
  );

  // ハンドラは SiteboardNodeHandlersContext 経由で配信するため、data は node のみを保持。
  // data の参照安定性を最大化し、ReactFlow の不要な再レンダリングを防ぐ。
  const buildFlowNode = useCallback((node: BoardNode, selected: boolean): SiteboardFlowNode => {
    if (isStickyNoteNode(node)) {
      return {
        id: node.id,
        type: 'stickynote',
        position: { x: node.x, y: node.y },
        selected,
        dragHandle: '.siteboard-node-drag-handle',
        data: { node },
      } as SiteboardFlowNode;
    }

    return {
      id: node.id,
      type: 'webpage',
      position: { x: node.x, y: node.y },
      selected,
      dragHandle: '.siteboard-node-drag-handle',
      data: { node },
    } as SiteboardFlowNode;
  }, []);

  useEffect(() => {
    const selectedNodeIdSet = new Set(effectiveSelectedNodeIds);
    const previousFlowNodes = flowNodesRef.current;
    const previousFlowNodesById = new Map(
      previousFlowNodes.map((flowNode) => [flowNode.id, flowNode]),
    );

    let changed = previousFlowNodes.length !== nodes.length;
    if (!changed) {
      changed = previousFlowNodes.some((flowNode, index) => flowNode.id !== nodes[index]?.id);
    }

    const nextFlowNodes = nodes.map((node) => {
      const selected = selectedNodeIdSet.has(node.id);
      const existing = previousFlowNodesById.get(node.id);

      if (existing && areBoardNodesEquivalent(existing.data.node, node)) {
        if (existing.selected === selected) {
          return existing; // 完全再利用：data も selected も変化なし
        }
        // selected のみ変化。data は再構築せず参照を維持し、ReactFlow の不要な再レンダリングを防ぐ
        changed = true;
        return { ...existing, selected };
      }

      changed = true;
      return buildFlowNode(node, selected);
    }) as SiteboardFlowNode[];

    if (!changed) {
      liveNodesRef.current = previousFlowNodes.map((flowNode) => flowNode.data.node);
      return;
    }

    commitLiveFlowNodes(nextFlowNodes);
  }, [buildFlowNode, commitLiveFlowNodes, effectiveSelectedNodeIds, nodes]);

  const flowEdges = useMemo<SiteboardFlowEdge[]>(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        type: edge.type ?? 'smoothstep',
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        label: edge.label,
        selected: effectiveSelectedEdgeIds.includes(edge.id),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: 'var(--color-border)',
        },
        style: {
          stroke: 'var(--color-border)',
          strokeWidth: 2,
        },
        data: {
          label: edge.label,
        },
      })),
    [edges, effectiveSelectedEdgeIds],
  );

  const defaultViewport = useMemo(
    () => ({
      x: persistedViewport.panX,
      y: persistedViewport.panY,
      zoom: persistedViewport.zoom,
    }),
    [persistedViewport],
  );

  const handleFlowInit = useCallback(
    (instance: ReactFlowInstance<SiteboardFlowNode, SiteboardFlowEdge>) => {
      reactFlowInstanceRef.current = instance;
      syncViewportStyles(persistedViewport);
      void instance.setViewport({
        x: persistedViewport.panX,
        y: persistedViewport.panY,
        zoom: persistedViewport.zoom,
      });

      requestAnimationFrame(() => {
        if (activeInteractionsRef.current.size === 0) {
          computeDisplayModes();
        }
      });
    },
    [activeInteractionsRef, computeDisplayModes, persistedViewport, syncViewportStyles],
  );

  return (
    <div
      ref={containerRef}
      data-siteboard-container
      className="relative flex-1 overflow-hidden siteboard-bg"
    >
      {/* 操作中カーソル制御用オーバーレイ（CSS [data-interaction-cursor] で表示/カーソル切替） */}
      <div className="siteboard-interaction-overlay" />

      <SiteboardRuntimeProvider store={runtimeStore}>
        <SiteboardNodeHandlersProvider handlers={stableNodeDataHandlers}>
          <div className="absolute inset-0">
            <ReactFlowProvider>
              <ReactFlow<SiteboardFlowNode, SiteboardFlowEdge>
                nodes={flowNodes}
                edges={flowEdges}
                defaultViewport={defaultViewport}
                nodeTypes={nodeTypes}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                connectionMode={ConnectionMode.Loose}
                deleteKeyCode={null}
                noDragClassName="nodrag"
                noPanClassName="nopan"
                fitView={false}
                nodesDraggable
                elementsSelectable
                onInit={handleFlowInit}
                onNodesChange={handleNodesChange}
                onNodeContextMenu={handleNodeContextMenu}
                onNodeDragStart={handleNodeDragStart}
                onNodeDragStop={handleNodeDragStop}
                onEdgeClick={handleEdgeClick}
                onEdgeContextMenu={handleEdgeContextMenu}
                onSelectionChange={handleSelectionChange}
                onConnectStart={handleConnectStart}
                onConnectEnd={handleConnectEnd}
                onConnect={handleConnect}
                onMoveStart={handleMoveStart}
                onMove={handleMove}
                onMoveEnd={handleMoveEnd}
                onPaneClick={handlePaneClick}
                panOnScroll={true}
                selectionOnDrag={true}
                panOnDrag={false}
                proOptions={{ hideAttribution: true }}
              >
                <Background
                  // variant={BackgroundVariant.Dots}
                  // gap={24}
                  size={2}
                  color={isDark ? '#27272a' : '#d1d5db'}
                />
              </ReactFlow>
            </ReactFlowProvider>
          </div>
        </SiteboardNodeHandlersProvider>
      </SiteboardRuntimeProvider>

      <FloatingToolbar onAddWebNode={onAddWebNode} onAddStickyNote={onAddStickyNote} />

      <ZoomIndicator zoom={persistedViewport.zoom} onReset={handleResetZoom} />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              id: 'remove',
              label: contextMenu.kind === 'node' ? 'ノードを削除' : '線を削除',
              variant: 'danger',
            },
          ]}
          onAction={handleContextMenuAction}
          onClose={handleContextMenuClose}
        />
      )}
    </div>
  );
}
