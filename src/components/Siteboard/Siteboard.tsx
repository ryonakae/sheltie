import ArrowsExpand from '@gravity-ui/icons/ArrowsExpand';
import {
  Background,
  BackgroundVariant,
  type Node,
  type NodeChange,
  type NodeDimensionChange,
  type NodePositionChange,
  type NodeSelectionChange,
  ReactFlow,
  ReactFlowProvider,
  type ReactFlowInstance,
  type Viewport as FlowViewport,
} from '@xyflow/react';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { AppButton } from '@/components/Common/AppButton';
import { ContextMenu } from '@/components/Common/ContextMenu';
import { nodeTypes } from '@/components/ReactFlowNodes/nodeTypes';
import type {
  StickyNoteFlowNodeData,
  WebPageFlowNodeData,
} from '@/components/ReactFlowNodes/types';
import { FloatingToolbar } from '@/components/Siteboard/FloatingToolbar';
import { ZoomIndicator } from '@/components/Siteboard/ZoomIndicator';
import {
  DRAG_REPOSITION_GAP,
  LOW_ZOOM_HIDE_THRESHOLD,
  MIN_ZOOM,
  MAX_ZOOM,
  PAGE_MIN_HEIGHT,
  STICKY_NOTE_MIN_HEIGHT,
  STICKY_NOTE_MIN_WIDTH,
  ZOOM_END_DEBOUNCE_MS,
  ZOOM_RESET_TARGET,
} from '@/constants';
import { useSiteboardDisplayEngine } from '@/hooks/siteboard/useSiteboardDisplayEngine';
import { useSiteboardKeyboard } from '@/hooks/siteboard/useSiteboardKeyboard';
import { useSiteboardNodeRuntime } from '@/hooks/siteboard/useSiteboardNodeRuntime';
import { getNodeChromeHeight, getNodeFrameHeight } from '@/lib/siteboard-node-frame';
import { resolveDraggedNodePosition } from '@/lib/siteboard-node-placement';
import {
  resolveCenteredViewport,
  resolveFitViewport,
  type SiteboardViewportTarget,
} from '@/lib/siteboard-viewport';
import {
  selectActiveProject,
  selectActiveProjectWebviewRuntime,
  useProjectStore,
} from '@/store/tab-store';
import { useThemeStore } from '@/store/theme-store';
import { isStickyNoteNode, isWebPageNode } from '@/types';
import type { WebPageNode } from '@/types';

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

const VIEWPORT_SYNC_EPSILON = 0.001;

function isSameViewport(a: FlowViewport | null, b: FlowViewport): boolean {
  if (!a) return false;

  return (
    Math.abs(a.x - b.x) < VIEWPORT_SYNC_EPSILON &&
    Math.abs(a.y - b.y) < VIEWPORT_SYNC_EPSILON &&
    Math.abs(a.zoom - b.zoom) < VIEWPORT_SYNC_EPSILON
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
  const activeProjectWebviewRuntime = useProjectStore(selectActiveProjectWebviewRuntime);
  const activeId = useProjectStore((s) => s.activeId);
  const isDark = useThemeStore((s) => s.isDark);

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
  const zoomRef = useRef(activeProject?.viewport.zoom ?? 1);

  const [uiZoom, setUiZoom] = useState(() => activeProject?.viewport.zoom ?? 1);
  // React Flow ネイティブドラッグ中のノード位置（ストアへの反映は dragStop 時のみ）
  const [draggingNodePositions, setDraggingNodePositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  // React Flow が ResizeObserver で測定したノード寸法（controlled mode でのノード初期化に必要）
  const [rfMeasured, setRfMeasured] = useState<Record<string, { width: number; height: number }>>(
    {},
  );
  // 付箋リサイズ中の中間サイズ（controlled mode でのリアルタイム追従用）
  const [stickyResizing, setStickyResizing] = useState<{
    nodeId: string;
    x: number;
    y: number;
    width: number;
    height: number; // 本文高さ（sticky header 除く）
  } | null>(null);
  // WebPage リサイズ中の中間サイズ（controlled mode でのリアルタイム追従用。height はコンテンツ高さ）
  const [webPageResizing, setWebPageResizing] = useState<{
    nodeId: string;
    x: number;
    y: number;
    width: number;
    height: number; // コンテンツ高さ（chrome 除く）
  } | null>(null);
  const viewportUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uiZoomRafRef = useRef<number | null>(null);
  // setViewport のみ使用するため広い型で保持
  const reactFlowInstanceRef = useRef<Pick<ReactFlowInstance, 'setViewport'> | null>(null);
  const flowViewportRef = useRef<FlowViewport | null>(null);
  const moveInteractionTypeRef = useRef<'pan' | 'zoom' | null>(null);
  const prefersReducedMotion = useReducedMotion();

  const {
    captureScreenshot,
    cancelZoomRestore,
    computeDisplayModes,
    displayModes,
    handleContextMenuClose: handleContextMenuCloseDisplay,
    handleContextMenuOpen,
    handleInteractionChange,
    handlePageResizeEnd,
    handlePageResizeStart,
    prepareInteractionStart,
    handleScreenshotPresented,
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

  // WebPage の React Flow resize control コールバック群
  const handleWebPageResizeStart = useCallback(
    (nodeId: string) => {
      // Phase 4 ドラッグと同じ fire-and-forget パターン
      void prepareInteractionStart('resize', nodeId);
      handleInteractionChange(true, 'resize');
      handlePageResizeStart(nodeId);
    },
    [handleInteractionChange, handlePageResizeStart, prepareInteractionStart],
  );

  const handleWebPageResize = useCallback(
    (nodeId: string, params: { x: number; y: number; width: number; height: number }) => {
      // React Flow の resize params.height は chrome 込みのフレーム全体高さ
      const chromeHeight = getNodeChromeHeight({ type: 'webpage' }, zoomRef.current);
      const contentHeight = Math.max(PAGE_MIN_HEIGHT, params.height - chromeHeight);
      setWebPageResizing({
        nodeId,
        x: params.x,
        y: params.y,
        width: Math.round(params.width),
        height: Math.round(contentHeight),
      });
    },
    [zoomRef],
  );

  const handleWebPageResizeEnd = useCallback(
    (nodeId: string, params: { x: number; y: number; width: number; height: number }) => {
      const chromeHeight = getNodeChromeHeight({ type: 'webpage' }, zoomRef.current);
      const contentHeight = Math.max(PAGE_MIN_HEIGHT, params.height - chromeHeight);
      const nextX = Math.round(params.x);
      const nextY = Math.round(params.y);
      const nextWidth = Math.round(params.width);
      const nextHeight = Math.round(contentHeight);
      useProjectStore
        .getState()
        .updateNodeBounds(activeId, nodeId, nextX, nextY, nextWidth, nextHeight);
      setWebPageResizing(null);
      handleInteractionChange(false, 'resize');
      handlePageResizeEnd(nodeId);
    },
    [activeId, handleInteractionChange, handlePageResizeEnd, zoomRef],
  );

  const hideCompactControls = Math.round(uiZoom * 100) <= Math.round(LOW_ZOOM_HIDE_THRESHOLD * 100);

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
    handleScrollEnded,
    handleWebviewCreated,
    handleWebviewDestroyed,
    handleWebviewLoaded,
    navStates,
  } = useSiteboardNodeRuntime({
    activeId,
    nodes,
    selectedNodeId,
    onClearSelection,
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

  // React Flow ネイティブドラッグ開始: スクリーンショット準備 + インタラクション開始
  const handleNodeDragStart = useCallback(
    async (_event: React.MouseEvent, node: Node) => {
      clearPositionCorrectionAnimation(node.id);
      await prepareInteractionStart('drag', node.id);
      handleInteractionChange(true, 'drag');
    },
    [clearPositionCorrectionAnimation, prepareInteractionStart, handleInteractionChange],
  );

  // React Flow ネイティブドラッグ終了: 位置補正後にストアへ反映
  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      handleInteractionChange(false, 'drag');

      // ドラッグ中の一時位置をクリア
      setDraggingNodePositions((prev) => {
        if (!(node.id in prev)) return prev;
        const { [node.id]: _, ...rest } = prev;
        return rest;
      });

      const movingNode = nodes.find((candidate) => candidate.id === node.id);
      if (!movingNode) return;

      const resolvedPosition = resolveDraggedNodePosition({
        nodes,
        movingNode,
        proposedX: node.position.x,
        proposedY: node.position.y,
        gap: DRAG_REPOSITION_GAP,
        zoom: zoomRef.current,
      });
      if (resolvedPosition.corrected && isWebPageNode(movingNode)) {
        positionCorrectionSequenceRef.current += 1;
        const nextAnimation = {
          token: positionCorrectionSequenceRef.current,
          fromX: node.position.x,
          fromY: node.position.y,
          toX: resolvedPosition.x,
          toY: resolvedPosition.y,
        };
        positionCorrectionAnimationsRef.current = {
          ...positionCorrectionAnimationsRef.current,
          [node.id]: nextAnimation,
        };
        setPositionCorrectionAnimations((prev) => ({ ...prev, [node.id]: nextAnimation }));
        holdNodeDuringPositionSettle(node.id);
        if (movingNode.x !== resolvedPosition.x || movingNode.y !== resolvedPosition.y) {
          updateNodePosition(activeId, node.id, resolvedPosition.x, resolvedPosition.y);
        }
        return;
      }

      updateNodePosition(activeId, node.id, resolvedPosition.x, resolvedPosition.y);
    },
    [
      activeId,
      handleInteractionChange,
      holdNodeDuringPositionSettle,
      nodes,
      updateNodePosition,
      zoomRef,
    ],
  );

  // ノード変更を処理: ドラッグ中の位置追跡 + dimension 測定結果の保持（ノード初期化に必要）
  // React Flow controlled mode では select/position/dimensions 全ての変更を処理する必要がある
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // dimension 変更を追跡（React Flow controlled mode でのノード初期化に必須）
      const dimensionChanges = changes.filter(
        (c): c is NodeDimensionChange => c.type === 'dimensions' && c.dimensions !== undefined,
      );
      if (dimensionChanges.length > 0) {
        setRfMeasured((prev) => {
          const next = { ...prev };
          for (const change of dimensionChanges) {
            if (change.dimensions) next[change.id] = change.dimensions;
          }
          return next;
        });
      }

      // select 変更を処理（React Flow 内部の選択状態と外部 state を同期。
      // これを無視すると内部状態が矛盾し、選択解除やリサイズ UI が正常動作しない）
      const selectChanges = changes.filter((c): c is NodeSelectionChange => c.type === 'select');
      if (selectChanges.length > 0) {
        const newlySelected = selectChanges.find((c) => c.selected);
        if (newlySelected) {
          onSelectNode(newlySelected.id);
        } else {
          onClearSelection();
        }
      }

      // ドラッグ中の position を一時ステートに反映（ストアは dragStop 時のみ更新）
      const positionChanges = changes.filter(
        (c): c is NodePositionChange => c.type === 'position' && c.dragging === true,
      );
      if (positionChanges.length === 0) return;
      setDraggingNodePositions((prev) => {
        const next = { ...prev };
        for (const change of positionChanges) {
          if (change.position) next[change.id] = change.position;
        }
        return next;
      });
    },
    [onSelectNode, onClearSelection],
  );

  const handleRemoveNodeWithSettleReset = useCallback(
    (nodeId: string) => {
      clearPositionCorrectionAnimation(nodeId);
      handleRemoveNode(nodeId);
    },
    [clearPositionCorrectionAnimation, handleRemoveNode],
  );

  const handleStickyNoteResize = useCallback(
    (nodeId: string, params: { x: number; y: number; width: number; height: number }) => {
      setStickyResizing({ nodeId, ...params });
    },
    [],
  );

  const handleStickyNoteResizeEnd = useCallback(
    (nodeId: string, width: number, height: number) => {
      updateNodeSize(activeId, nodeId, width, height);
      setStickyResizing(null);
    },
    [activeId, updateNodeSize],
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

  // ペイン（空白エリア）クリックで選択解除
  const handlePaneClick = useCallback(
    (_event: React.MouseEvent) => {
      setContextMenu(null);
      onClearSelection();
    },
    [onClearSelection],
  );

  // React Flow のビューポート変更ハンドラー
  const handleViewportChange = useCallback(
    (viewport: FlowViewport) => {
      flowViewportRef.current = viewport;
      zoomRef.current = viewport.zoom;
      // --canvas-zoom CSS 変数を同期（zoomPx() が引き続き動作するために必要）
      if (containerRef.current) {
        containerRef.current.style.setProperty('--canvas-zoom', String(viewport.zoom));
      }

      // setUiZoom は rAF で1フレームに1回に制限（毎フレームの re-render を防ぐ）
      if (uiZoomRafRef.current === null) {
        uiZoomRafRef.current = requestAnimationFrame(() => {
          uiZoomRafRef.current = null;
          setUiZoom(zoomRef.current);
        });
      }

      // debounce でストアへ永続化
      if (viewportUpdateTimerRef.current) clearTimeout(viewportUpdateTimerRef.current);
      viewportUpdateTimerRef.current = setTimeout(() => {
        viewportUpdateTimerRef.current = null;
        updateViewport(activeId, { zoom: viewport.zoom, panX: viewport.x, panY: viewport.y });
      }, ZOOM_END_DEBOUNCE_MS);
    },
    [activeId, containerRef, updateViewport, zoomRef],
  );

  const storeViewport = useMemo<FlowViewport>(
    () => ({
      x: activeProject?.viewport.panX ?? 0,
      y: activeProject?.viewport.panY ?? 0,
      zoom: activeProject?.viewport.zoom ?? 1,
    }),
    [activeProject?.viewport.panX, activeProject?.viewport.panY, activeProject?.viewport.zoom],
  );

  const syncViewportFromStore = useCallback(
    (instance = reactFlowInstanceRef.current) => {
      if (!instance) return;
      if (isSameViewport(flowViewportRef.current, storeViewport)) return;

      flowViewportRef.current = storeViewport;
      zoomRef.current = storeViewport.zoom;
      setUiZoom(storeViewport.zoom);
      if (containerRef.current) {
        containerRef.current.style.setProperty('--canvas-zoom', String(storeViewport.zoom));
      }

      void instance.setViewport(storeViewport, { duration: 0 });
    },
    [containerRef, storeViewport, zoomRef],
  );

  useEffect(() => {
    syncViewportFromStore();
  }, [syncViewportFromStore]);

  // React Flow は pan/zoom を同じ onMove 系 callback で通知するため、event から操作種別を復元する。
  // 現構成ではホイールは pan、Cmd/Ctrl+ホイールとピンチは zoom、programmatic setViewport は zoom 扱いにする。
  // Tauri WKWebView 環境では TouchEvent グローバルが未定義のため typeof ガードが必須。
  const resolveViewportInteractionType = useCallback(
    (event: MouseEvent | TouchEvent | null | undefined): 'pan' | 'zoom' =>
      event == null
        ? 'zoom'
        : 'deltaY' in event
          ? event.metaKey || event.ctrlKey
            ? 'zoom'
            : 'pan'
          : typeof TouchEvent !== 'undefined' &&
              event instanceof TouchEvent &&
              event.touches.length >= 2
            ? 'zoom'
            : 'pan',
    [],
  );

  // pan/zoom のインタラクション開始を記録し display engine を起動する共通処理。
  // handleMoveStart（主経路）と handleMove（fallback）の両方から呼ばれる。
  const beginViewportInteraction = useCallback(
    (event: MouseEvent | TouchEvent | null | undefined) => {
      const type = resolveViewportInteractionType(event);
      moveInteractionTypeRef.current = type;
      void prepareInteractionStart(type);
      handleInteractionChange(true, type);
      return type;
    },
    [resolveViewportInteractionType, prepareInteractionStart, handleInteractionChange],
  );

  const handleMoveStart = useCallback(
    (_event: MouseEvent | TouchEvent | null, _viewport: FlowViewport) => {
      beginViewportInteraction(_event);
    },
    [beginViewportInteraction],
  );

  const handleMove = useCallback(
    (_event: MouseEvent | TouchEvent | null, _viewport: FlowViewport) => {
      // onMoveStart が取りこぼされた場合のフォールバック。
      // onMove は viewport が実際に動いた時のみ発火するためクリック誤発火がない。
      if (moveInteractionTypeRef.current === null) {
        beginViewportInteraction(_event);
      }
      scheduleInteractionUpdate();
    },
    [beginViewportInteraction, scheduleInteractionUpdate],
  );

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, _viewport: FlowViewport) => {
      // start が取りこぼされた場合も 'pan' にフォールバックして display engine を正常終了させる
      const type = moveInteractionTypeRef.current ?? 'pan';
      moveInteractionTypeRef.current = null;
      handleInteractionChange(false, type);
    },
    [handleInteractionChange],
  );

  const applyViewportTarget = useCallback(
    (target: SiteboardViewportTarget) => {
      const instance = reactFlowInstanceRef.current;
      if (!instance) return;

      const currentViewport = flowViewportRef.current;
      const zoomChanged =
        !currentViewport || Math.abs(currentViewport.zoom - target.zoom) >= VIEWPORT_SYNC_EPSILON;
      const animationDurationMs = prefersReducedMotion ? 0 : 240;

      cancelZoomRestore();
      if (zoomRestoreTimerRef.current) clearTimeout(zoomRestoreTimerRef.current);
      instance.setViewport(target, { duration: animationDurationMs });

      if (!zoomChanged) return;
      zoomRestoreTimerRef.current = setTimeout(
        () => {
          zoomRestoreTimerRef.current = null;
          scheduleZoomRestoreAfterReflow();
        },
        prefersReducedMotion ? 0 : animationDurationMs + 20,
      );
    },
    [cancelZoomRestore, prefersReducedMotion, scheduleZoomRestoreAfterReflow],
  );

  const handleCenterViewportAtDefaultZoom = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    applyViewportTarget(resolveCenteredViewport(nodes, rect.width, rect.height, ZOOM_RESET_TARGET));
  }, [applyViewportTarget, nodes]);

  const handleFitAllNodes = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const target = resolveFitViewport(nodes, rect.width, rect.height);
    if (!target) return;
    applyViewportTarget(target);
  }, [applyViewportTarget, nodes]);

  const handleResetViewport = useCallback(() => {
    handleCenterViewportAtDefaultZoom();
  }, [handleCenterViewportAtDefaultZoom]);

  // ビューポートの debounce タイマーと rAF のクリーンアップ
  useEffect(() => {
    return () => {
      if (viewportUpdateTimerRef.current) clearTimeout(viewportUpdateTimerRef.current);
      if (zoomRestoreTimerRef.current) clearTimeout(zoomRestoreTimerRef.current);
      if (uiZoomRafRef.current !== null) cancelAnimationFrame(uiZoomRafRef.current);
    };
  }, []);

  // React Flow の flowNodes 配列を構築する
  // displayModes/screenshotUrls/navStates/resizingSize の変化に追従するため useMemo 依存に含める
  const flowNodes = useMemo((): Node[] => {
    return nodes.map((node): Node => {
      // ドラッグ中は一時位置を使用。dragStop 時にストアへ反映する
      const position = draggingNodePositions[node.id] ?? { x: node.x, y: node.y };
      if (isStickyNoteNode(node)) {
        const isResizing = stickyResizing?.nodeId === node.id;
        const stickyPosition = isResizing ? { x: stickyResizing.x, y: stickyResizing.y } : position;
        const contentWidth = Math.max(
          isResizing ? stickyResizing.width : node.width,
          STICKY_NOTE_MIN_WIDTH,
        );
        const contentHeight = Math.max(
          isResizing ? stickyResizing.height : node.height,
          STICKY_NOTE_MIN_HEIGHT,
        );
        const nodeHeight = getNodeFrameHeight(
          { type: 'stickynote', height: contentHeight },
          uiZoom,
        );
        const nodeData: StickyNoteFlowNodeData = {
          nodeProps: {
            node: { ...node, x: 0, y: 0, width: contentWidth, height: contentHeight },
            isActive: node.id === selectedNodeId,
            onActivate: onSelectNode,
            onContextMenu: handleNodeContextMenu,
            onContentChange: handleStickyNoteContentChange,
            onAutoHeightChange: handleStickyNoteAutoHeightChange,
          },
          displayWidth: contentWidth,
          onResize: handleStickyNoteResize,
          onResizeEnd: handleStickyNoteResizeEnd,
          onColorCycle: handleStickyNoteColorCycle,
          colorIndex: node.colorIndex ?? 0,
        };
        // top-level width/height を明示することで、flowNodes 再生成時に React Flow の
        // nodeHasDimensions チェックが失敗して visibility:hidden になるちらつきを防ぐ
        // style は付与しない（React Flow がラッパーサイズを直接制御するため）
        return {
          id: node.id,
          type: 'stickyNoteFlowNode',
          position: stickyPosition,
          width: contentWidth,
          height: nodeHeight,
          selected: node.id === selectedNodeId,
          measured: rfMeasured[node.id],
          data: nodeData as unknown as Record<string, unknown>,
        };
      }

      const isResizing = webPageResizing?.nodeId === node.id;
      const webPagePosition = isResizing
        ? { x: webPageResizing.x, y: webPageResizing.y }
        : position;
      const contentWidth = isResizing ? webPageResizing.width : node.width;
      const contentHeight = isResizing ? webPageResizing.height : node.height;
      const nodeData: WebPageFlowNodeData = {
        nodeProps: {
          // isStickyNoteNode の早期 return 後に WebPageNode と確定しているが spread で型が広がるため cast
          node: { ...node, x: 0, y: 0 } as WebPageNode,
          isActive: node.id === selectedNodeId,
          title: node.title,
          displayWidth: contentWidth,
          displayHeight: contentHeight,
          displayMode: displayModes[node.id] ?? 'hidden',
          screenshotUrl: screenshotUrls[node.id] ?? null,
          hideTopNavControls: hideCompactControls,
          hideBottomPresetControls: hideCompactControls,
          canGoBack: navStates[node.id]?.can_go_back ?? false,
          canGoForward: navStates[node.id]?.can_go_forward ?? false,
          getZoom,
          onGoBack: handleGoBack,
          onGoForward: handleGoForward,
          onActivate: onSelectNode,
          onReload: handleReloadWebNode,
          onPinUrl: handlePinWebNodeUrl,
          onContextMenu: handleNodeContextMenu,
          onResizePreset: handleResizePreset,
          onNavigated: handleNavigated,
          onTitleUpdated: handleTitleUpdated,
          onWebviewCreated: handleWebviewCreated,
          onWebviewDestroyed: handleWebviewDestroyed,
          onWebviewLoaded: handleWebviewLoaded,
          onScreenshotPresented: handleScreenshotPresented,
          onScrollEnded: handleScrollEnded,
          onUrlSubmit: handleUrlSubmit,
          positionCorrectionAnimationToken: positionCorrectionAnimations[node.id]?.token ?? null,
          positionCorrectionFromX: positionCorrectionAnimations[node.id]?.fromX ?? null,
          positionCorrectionFromY: positionCorrectionAnimations[node.id]?.fromY ?? null,
          positionCorrectionToX: positionCorrectionAnimations[node.id]?.toX ?? null,
          positionCorrectionToY: positionCorrectionAnimations[node.id]?.toY ?? null,
          onPositionCorrectionAnimationComplete: handlePositionCorrectionAnimationComplete,
        },
        layoutZoom: uiZoom,
        onResizeStart: handleWebPageResizeStart,
        onResize: handleWebPageResize,
        onResizeEnd: handleWebPageResizeEnd,
        getZoom,
      };
      // top-level width/height を明示することで、flowNodes 再生成時に React Flow の
      // nodeHasDimensions チェックが失敗して visibility:hidden になるちらつきを防ぐ
      return {
        id: node.id,
        type: 'webPageFlowNode',
        position: webPagePosition,
        width: contentWidth,
        height: getNodeFrameHeight({ type: 'webpage', height: contentHeight }, uiZoom),
        dragHandle: '.node-drag-handle',
        selected: node.id === selectedNodeId,
        measured: rfMeasured[node.id],
        data: nodeData as unknown as Record<string, unknown>,
      };
    });
  }, [
    nodes,
    draggingNodePositions,
    rfMeasured,
    selectedNodeId,
    hideCompactControls,
    stickyResizing,
    webPageResizing,
    uiZoom,
    displayModes,
    screenshotUrls,
    navStates,
    positionCorrectionAnimations,
    onSelectNode,
    handleNodeContextMenu,
    handleStickyNoteResize,
    handleStickyNoteResizeEnd,
    handleStickyNoteContentChange,
    handleStickyNoteAutoHeightChange,
    handleStickyNoteColorCycle,
    getZoom,
    handleGoBack,
    handleGoForward,
    handleReloadWebNode,
    handlePinWebNodeUrl,
    handleWebPageResizeStart,
    handleWebPageResize,
    handleWebPageResizeEnd,
    handleResizePreset,
    handleNavigated,
    handleTitleUpdated,
    handleWebviewCreated,
    handleWebviewDestroyed,
    handleWebviewLoaded,
    handleScreenshotPresented,
    handleScrollEnded,
    handleUrlSubmit,
    handlePositionCorrectionAnimationComplete,
  ]);

  return (
    <ReactFlowProvider>
      <div ref={containerRef} data-siteboard-container className="relative flex-1 overflow-hidden">
        <ReactFlow
          nodes={flowNodes}
          edges={[]}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onViewportChange={handleViewportChange}
          onMoveStart={handleMoveStart}
          onMove={handleMove}
          onMoveEnd={handleMoveEnd}
          onNodeDragStart={handleNodeDragStart}
          onNodeDragStop={handleNodeDragStop}
          onPaneClick={handlePaneClick}
          onInit={(instance) => {
            reactFlowInstanceRef.current = instance;
            syncViewportFromStore(instance);
          }}
          panActivationKeyCode="Space"
          panOnDrag={[1]}
          panOnScroll={true}
          selectionOnDrag={true}
          nodeDragThreshold={3}
          zoomOnScroll={true}
          zoomOnPinch={true}
          zoomOnDoubleClick={false}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          // Webview 対策: 仮想化を無効化してすべてのノードをレンダリングする
          onlyRenderVisibleElements={false}
          nodesConnectable={false}
          edgesFocusable={false}
          proOptions={{ hideAttribution: true }}
          className="size-full"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={3}
            color={isDark ? '#27272a' : '#d1d5db'}
            bgColor={isDark ? '#18181b' : '#f9fafb'}
          />
          <FloatingToolbar onAddWebNode={onAddWebNode} onAddStickyNote={onAddStickyNote} />
          <div className="pointer-events-none absolute right-4 bottom-4 z-20 flex items-center gap-2">
            <div className="pointer-events-auto">
              <AppButton
                size="sm"
                isIconOnly={true}
                tooltipMessage="全体を表示"
                onPress={handleFitAllNodes}
                aria-label="全体を表示"
                isDisabled={nodes.length === 0}
                className="border border-border bg-surface shadow-md"
              >
                <ArrowsExpand className="size-4" />
              </AppButton>
            </div>
            <div className="pointer-events-auto">
              <ZoomIndicator zoom={uiZoom} onResetViewport={handleResetViewport} />
            </div>
          </div>
        </ReactFlow>

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
    </ReactFlowProvider>
  );
}
