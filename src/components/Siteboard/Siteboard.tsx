import {
  Background,
  BackgroundVariant,
  type Node,
  type NodeChange,
  type NodePositionChange,
  ReactFlow,
  ReactFlowProvider,
  type ReactFlowInstance,
  type Viewport as FlowViewport,
} from '@xyflow/react';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { ContextMenu } from '@/components/Common/ContextMenu';
import { nodeTypes } from '@/components/ReactFlowNodes/nodeTypes';
import type {
  StickyNoteFlowNodeData,
  WebPageFlowNodeData,
} from '@/components/ReactFlowNodes/types';
import { FloatingToolbar } from '@/components/Siteboard/FloatingToolbar';
import { InteractionOverlay } from '@/components/Siteboard/InteractionOverlay';
import { ZoomIndicator } from '@/components/Siteboard/ZoomIndicator';
import {
  DRAG_REPOSITION_GAP,
  LOW_ZOOM_HIDE_THRESHOLD,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_END_DEBOUNCE_MS,
  ZOOM_RESET_TARGET,
} from '@/constants';
import { useSiteboardDisplayEngine } from '@/hooks/siteboard/useSiteboardDisplayEngine';
import { useSiteboardKeyboard } from '@/hooks/siteboard/useSiteboardKeyboard';
import { useSiteboardNodeRuntime } from '@/hooks/siteboard/useSiteboardNodeRuntime';
import { useSiteboardViewportEngine } from '@/hooks/siteboard/useSiteboardViewportEngine';
import { getNodeFrameHeight } from '@/lib/siteboard-node-frame';
import { resolveDraggedNodePosition } from '@/lib/siteboard-node-placement';
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
  // React Flow 移行後: canvasRef は containerRef と同じ DOM ツリーを指すスコープとして使う
  // (useSiteboardDisplayEngine の querySelector スコープとして機能)
  const canvasRef = containerRef;
  const zoomRef = useRef(activeProject?.viewport.zoom ?? 1);
  const panXRef = useRef(activeProject?.viewport.panX ?? 0);
  const panYRef = useRef(activeProject?.viewport.panY ?? 0);

  const [uiZoom, setUiZoom] = useState(() => activeProject?.viewport.zoom ?? 1);
  // React Flow ネイティブドラッグ中のノード位置（ストアへの反映は dragStop 時のみ）
  const [draggingNodePositions, setDraggingNodePositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const viewportUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uiZoomRafRef = useRef<number | null>(null);
  // setViewport のみ使用するため広い型で保持
  const reactFlowInstanceRef = useRef<Pick<ReactFlowInstance, 'setViewport'> | null>(null);
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

  const { resizingSize, startResize, startStickyNoteResize } = useSiteboardViewportEngine({
    zoomRef,
    activeId,
    onInteractionChange: handleInteractionChange,
    prepareInteractionStart,
    onNodeResizeStart: handlePageResizeStart,
    onNodeResizeEnd: handlePageResizeEnd,
    updateNodeSize,
  });

  const hideCompactControls = Math.round(uiZoom * 100) <= Math.round(LOW_ZOOM_HIDE_THRESHOLD * 100);

  const {
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
    onClearSelection,
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

  // React Flow ネイティブドラッグ開始: スクリーンショット準備 + インタラクション開始
  const handleNodeDragStart = useCallback(
    async (_event: React.MouseEvent, node: Node) => {
      clearPositionCorrectionAnimation(node.id);
      await prepareInteractionStart('drag', node.id);
      handleInteractionChange(true, 'grabbing', 'drag');
    },
    [clearPositionCorrectionAnimation, prepareInteractionStart, handleInteractionChange],
  );

  // React Flow ネイティブドラッグ終了: 位置補正後にストアへ反映
  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      handleInteractionChange(false, 'grabbing', 'drag');

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

  // ドラッグ中の position 変更を一時ステートに反映（ストアは dragStop 時のみ更新）
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
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
  }, []);

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
      zoomRef.current = viewport.zoom;
      panXRef.current = viewport.x;
      panYRef.current = viewport.y;

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
    [activeId, containerRef, panXRef, updateViewport, zoomRef],
  );

  // WheelEvent（zoom）か TouchEvent の多指（ピンチ zoom）か null（プログラマティック）は zoom として扱う。
  // Tauri WKWebView 環境では TouchEvent グローバルが未定義のため typeof ガードが必須。
  const resolveViewportInteractionType = useCallback(
    (event: MouseEvent | TouchEvent | null): 'pan' | 'zoom' =>
      event === null
        ? 'zoom'
        : 'deltaY' in event
          ? 'zoom'
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
    (event: MouseEvent | TouchEvent | null) => {
      const type = resolveViewportInteractionType(event);
      moveInteractionTypeRef.current = type;
      void prepareInteractionStart(type);
      // zoom 時は cursor を空文字（falsy）にして InteractionOverlay を非表示にする。
      // overlay が pointer-events-auto で画面全体を覆うとホイールイベントが遮断されるため。
      handleInteractionChange(true, type === 'pan' ? 'grabbing' : '', type);
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
      handleInteractionChange(false, 'default', type);
    },
    [handleInteractionChange],
  );

  const handleResetZoom = useCallback(() => {
    const instance = reactFlowInstanceRef.current;
    if (!instance) return;
    cancelZoomRestore();
    instance.setViewport(
      { x: 0, y: 0, zoom: ZOOM_RESET_TARGET },
      { duration: prefersReducedMotion ? 0 : 240 },
    );
    // ズームリセット完了後に Webview 座標を再計算
    setTimeout(() => scheduleZoomRestoreAfterReflow(), prefersReducedMotion ? 0 : 260);
  }, [cancelZoomRestore, prefersReducedMotion, scheduleZoomRestoreAfterReflow]);

  // ビューポートの debounce タイマーと rAF のクリーンアップ
  useEffect(() => {
    return () => {
      if (viewportUpdateTimerRef.current) clearTimeout(viewportUpdateTimerRef.current);
      if (uiZoomRafRef.current !== null) cancelAnimationFrame(uiZoomRafRef.current);
    };
  }, []);

  // React Flow の flowNodes 配列を構築する
  // displayModes/screenshotUrls/navStates/resizingSize の変化に追従するため useMemo 依存に含める
  const flowNodes = useMemo((): Node[] => {
    return nodes.map((node): Node => {
      // ドラッグ中は一時位置を使用。dragStop 時にストアへ反映する
      const position = draggingNodePositions[node.id] ?? { x: node.x, y: node.y };
      // React Flow の viewport が scale(zoom) を管理するため論理サイズをそのまま渡す
      const style = { width: node.width };

      if (isStickyNoteNode(node)) {
        const nodeData: StickyNoteFlowNodeData = {
          nodeProps: {
            node: { ...node, x: 0, y: 0 },
            isActive: node.id === selectedNodeId,
            hideColorCycleButton: hideCompactControls,
            onActivate: onSelectNode,
            onContextMenu: handleNodeContextMenu,
            onResizeStart: startStickyNoteResize,
            onContentChange: handleStickyNoteContentChange,
            onAutoHeightChange: handleStickyNoteAutoHeightChange,
            onColorCycle: handleStickyNoteColorCycle,
          },
        };
        // top-level width/height を明示することで、flowNodes 再生成時に React Flow の
        // nodeHasDimensions チェックが失敗して visibility:hidden になるちらつきを防ぐ
        return {
          id: node.id,
          type: 'stickyNoteFlowNode',
          position,
          width: node.width,
          height: getNodeFrameHeight({ type: 'stickynote', height: node.height }, zoomRef.current),
          style,
          dragHandle: '.node-drag-handle',
          data: nodeData as unknown as Record<string, unknown>,
        };
      }

      const contentWidth = resizingSize?.nodeId === node.id ? resizingSize.width : node.width;
      const contentHeight = resizingSize?.nodeId === node.id ? resizingSize.height : node.height;
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
          onResizeStart: handleResizeStart,
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
      };
      // top-level width/height を明示することで、flowNodes 再生成時に React Flow の
      // nodeHasDimensions チェックが失敗して visibility:hidden になるちらつきを防ぐ
      return {
        id: node.id,
        type: 'webPageFlowNode',
        position,
        width: contentWidth,
        height: getNodeFrameHeight({ type: 'webpage', height: contentHeight }, zoomRef.current),
        style,
        dragHandle: '.node-drag-handle',
        data: nodeData as unknown as Record<string, unknown>,
      };
    });
  }, [
    nodes,
    draggingNodePositions,
    selectedNodeId,
    hideCompactControls,
    resizingSize,
    displayModes,
    screenshotUrls,
    navStates,
    positionCorrectionAnimations,
    onSelectNode,
    handleNodeContextMenu,
    startStickyNoteResize,
    handleStickyNoteContentChange,
    handleStickyNoteAutoHeightChange,
    handleStickyNoteColorCycle,
    getZoom,
    handleGoBack,
    handleGoForward,
    handleReloadWebNode,
    handlePinWebNodeUrl,
    handleResizeStart,
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

  // React Flow はノードの変更（NodeChange）を onNodesChange で通知するが、
  const defaultViewport = useMemo(
    () => ({
      x: activeProject?.viewport.panX ?? 0,
      y: activeProject?.viewport.panY ?? 0,
      zoom: activeProject?.viewport.zoom ?? 1,
    }),
    [],
  );
  // 初期値のみ使用するため deps は空でよい（プロジェクト切り替えは別途対応）

  return (
    <ReactFlowProvider>
      <div ref={containerRef} data-siteboard-container className="relative flex-1 overflow-hidden">
        {interactionCursor && <InteractionOverlay cursor={interactionCursor} />}

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
          }}
          defaultViewport={defaultViewport}
          panActivationKeyCode="Space"
          panOnDrag={[0, 1]}
          panOnScroll={false}
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
            gap={24}
            size={2}
            color={isDark ? '#27272a' : '#d1d5db'}
            bgColor={isDark ? '#18181b' : '#f9fafb'}
          />
          <FloatingToolbar onAddWebNode={onAddWebNode} onAddStickyNote={onAddStickyNote} />
          <ZoomIndicator zoom={uiZoom} onReset={handleResetZoom} />
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
