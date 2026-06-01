import ArrowsExpand from '@gravity-ui/icons/ArrowsExpand';
import {
  Background,
  BackgroundVariant,
  type Connection,
  ConnectionMode,
  type Edge,
  type EdgeChange,
  type EdgeSelectionChange,
  type Node,
  type NodeChange,
  type NodeDimensionChange,
  type NodePositionChange,
  type NodeSelectionChange,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  type Viewport as FlowViewport,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { AppButton } from '@/components/Common/AppButton';
import { ArrowConnectionLine } from '@/components/ReactFlowEdges/ArrowConnectionLine';
import { EDGE_STROKE_WIDTH } from '@/components/ReactFlowEdges/arrowGeometry';
import { edgeTypes } from '@/components/ReactFlowEdges/edgeTypes';
import { nodeTypes } from '@/components/ReactFlowNodes/nodeTypes';
import type {
  StickyNoteFlowNodeData,
  TextFlowNodeData,
  WebPageFlowNodeData,
} from '@/components/ReactFlowNodes/types';
import { FLOATING_CONTROL_SOLID_BUTTON_CLASSNAME } from '@/components/Siteboard/floatingControlStyles';
import { FloatingToolbar } from '@/components/Siteboard/FloatingToolbar';
import { ZoomIndicator } from '@/components/Siteboard/ZoomIndicator';
import {
  DRAG_REPOSITION_GAP,
  MIN_ZOOM,
  MAX_ZOOM,
  PAGE_MIN_HEIGHT,
  PAGE_MIN_WIDTH,
  STICKY_NOTE_MIN_HEIGHT,
  STICKY_NOTE_MIN_WIDTH,
  TEXT_NODE_MIN_WIDTH,
} from '@/constants';
import { useSiteboardContextMenus } from '@/hooks/siteboard/useSiteboardContextMenus';
import { useSiteboardDisplayEngine } from '@/hooks/siteboard/useSiteboardDisplayEngine';
import { useSiteboardKeyboard } from '@/hooks/siteboard/useSiteboardKeyboard';
import { useSiteboardNodeRuntime } from '@/hooks/siteboard/useSiteboardNodeRuntime';
import { useSiteboardViewportController } from '@/hooks/siteboard/useSiteboardViewportController';
import {
  getNodeChromeHeight,
  getNodeChromeWidth,
  getNodeFrameHeight,
  getNodeFrameWidth,
} from '@/lib/siteboard-node-frame';
import { resolveDraggedNodePosition } from '@/lib/siteboard-node-placement';
import { registerUnsavedChangesDialogDisplayController } from '@/lib/unsaved-changes-dialog-display';
import { selectProject, selectProjectWebviewRuntime, useProjectStore } from '@/store/tab-store';
import { useThemeStore } from '@/store/theme-store';
import {
  isNodeEmpty,
  isNodeMoved,
  isStickyNoteNode,
  isTextNode,
  isTextNodeEmpty,
  isWebPageNode,
} from '@/types';
import type { TextNode, WebPageNode } from '@/types';

interface SiteboardProps {
  selectedNodeIds: string[];
  setSelection: (idsOrUpdater: string[] | ((prev: string[]) => string[])) => void;
  centeredNodeId?: string | null;
  onCenteredNodeHandled?: () => void;
  autoEditTextNodeId?: string | null;
  onAutoEditTextNodeHandled?: () => void;
  autoEditStickyNoteId?: string | null;
  onAutoEditStickyNoteHandled?: () => void;
  onAddWebNode: () => void;
  onAddStickyNote: () => void;
  onAddTextNode: () => void;
}

interface PositionCorrectionAnimation {
  token: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export function Siteboard({
  selectedNodeIds,
  setSelection,
  centeredNodeId = null,
  onCenteredNodeHandled,
  autoEditTextNodeId = null,
  onAutoEditTextNodeHandled,
  autoEditStickyNoteId = null,
  onAutoEditStickyNoteHandled,
  onAddWebNode,
  onAddStickyNote,
  onAddTextNode,
}: SiteboardProps) {
  // 単独選択時のみ「active」(リサイズハンドルや URL 編集など、単一ノード前提の UI を有効化する判定)
  const activeNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const project = useProjectStore(selectProject);
  const projectWebviewRuntime = useProjectStore(selectProjectWebviewRuntime);
  const isDark = useThemeStore((s) => s.isDark);

  const {
    undoProject,
    redoProject,
    updateViewport,
    updateNodePosition,
    updateNodePositions,
    updateNodeSize,
    updateNodeSizeWithoutHistory,
    updateWebNodeUrl,
    updateNodeTitle,
    removeNode,
    removeNodes,
    setWebNodeWebviewLabel,
    clearWebNodeWebviewLabel,
    setWebNodeUrl,
    changeWebNodeUrl,
    pinWebNodeUrl,
    updateStickyNoteContent,
    updateStickyNoteStyle,
    updateTextNodeContent,
    updateTextNodeStyle,
    updateTextNodeWidthMode,
    hydrateProjectScreenshotUrls,
    setProjectScreenshotUrl,
    clearProjectScreenshotUrl,
    addEdge: addEdgeToStore,
    removeEdges,
    reverseEdge,
    bringNodeToFront,
    sendNodeToBack,
    bringNodeForward,
    sendNodeBackward,
  } = useProjectStore(
    useShallow((s) => ({
      addEdge: s.addEdge,
      removeEdges: s.removeEdges,
      reverseEdge: s.reverseEdge,
      clearProjectScreenshotUrl: s.clearProjectScreenshotUrl,
      updateStickyNoteStyle: s.updateStickyNoteStyle,
      updateTextNodeContent: s.updateTextNodeContent,
      updateTextNodeStyle: s.updateTextNodeStyle,
      updateTextNodeWidthMode: s.updateTextNodeWidthMode,
      clearWebNodeWebviewLabel: s.clearWebNodeWebviewLabel,
      hydrateProjectScreenshotUrls: s.hydrateProjectScreenshotUrls,
      redoProject: s.redoProject,
      pinWebNodeUrl: s.pinWebNodeUrl,
      removeNode: s.removeNode,
      removeNodes: s.removeNodes,
      setProjectScreenshotUrl: s.setProjectScreenshotUrl,
      setWebNodeUrl: s.setWebNodeUrl,
      changeWebNodeUrl: s.changeWebNodeUrl,
      setWebNodeWebviewLabel: s.setWebNodeWebviewLabel,
      undoProject: s.undoProject,
      updateNodePosition: s.updateNodePosition,
      updateNodePositions: s.updateNodePositions,
      updateNodeSize: s.updateNodeSize,
      updateNodeSizeWithoutHistory: s.updateNodeSizeWithoutHistory,
      updateNodeTitle: s.updateNodeTitle,
      updateStickyNoteContent: s.updateStickyNoteContent,
      updateViewport: s.updateViewport,
      updateWebNodeUrl: s.updateWebNodeUrl,
      bringNodeToFront: s.bringNodeToFront,
      sendNodeToBack: s.sendNodeToBack,
      bringNodeForward: s.bringNodeForward,
      sendNodeBackward: s.sendNodeBackward,
    })),
  );

  const nodes = useMemo(() => project?.nodes ?? [], [project?.nodes]);
  const edges = useMemo(() => project?.edges ?? [], [project?.edges]);
  const webPageNodes = useMemo(() => nodes.filter(isWebPageNode), [nodes]);

  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(project?.viewport.zoom ?? 1);

  // React Flow ネイティブドラッグ中のノード位置（ストアへの反映は dragStop 時のみ）
  const [draggingNodePositions, setDraggingNodePositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  // React Flow が ResizeObserver で測定したノード寸法（controlled mode でのノード初期化に必要）
  const [rfMeasured, setRfMeasured] = useState<Record<string, { width: number; height: number }>>(
    {},
  );
  // 選択中のエッジ ID。controlled mode では flowEdges.selected を自前で同期しないと
  // React Flow の選択スタイル（CSS class や custom edge への selected prop）が反映されない
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(() => new Set());
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

  const getZoom = useCallback(() => zoomRef.current, [zoomRef]);
  const hydrateCachedScreenshotUrls = useCallback(
    (_projectId: string, screenshotUrlsByNodeId: Record<string, string>) => {
      hydrateProjectScreenshotUrls(screenshotUrlsByNodeId);
    },
    [hydrateProjectScreenshotUrls],
  );
  const setCachedScreenshotUrl = useCallback(
    (_projectId: string, nodeId: string, url: string) => {
      setProjectScreenshotUrl(nodeId, url);
    },
    [setProjectScreenshotUrl],
  );
  const clearCachedScreenshotUrl = useCallback(
    (_projectId: string, nodeId: string) => {
      clearProjectScreenshotUrl(nodeId);
    },
    [clearProjectScreenshotUrl],
  );
  const {
    captureScreenshot,
    cancelZoomRestore,
    displayModes,
    handleContextMenuClose: handleContextMenuCloseDisplay,
    handleContextMenuOpen,
    handleInteractionChange,
    handlePageResizeEnd,
    handlePageResizeStart,
    prepareInteractionStart,
    handleScreenshotPresented,
    handleUnsavedChangesDialogClose,
    handleUnsavedChangesDialogOpen,
    holdNodeDuringPositionSettle,
    scheduleInteractionUpdate,
    scheduleZoomRestoreAfterReflow,
    releaseNodeAfterPositionSettle,
    screenshotUrls,
  } = useSiteboardDisplayEngine({
    webPageNodes,
    webviewLabelsByNodeId: projectWebviewRuntime.labelsByNodeId,
    cachedScreenshotUrlsByNodeId: projectWebviewRuntime.screenshotUrlsByNodeId,
    projectId: project?.id ?? '',
    containerRef,
    zoomRef,
    centeredNodeId,
    onCenteredNodeHandled,
    selectedNodeIds,
    hydrateCachedScreenshotUrls,
    setCachedScreenshotUrl,
    clearCachedScreenshotUrl,
  });

  const storeViewport = useMemo<FlowViewport>(
    () => ({
      x: project?.viewport.panX ?? 0,
      y: project?.viewport.panY ?? 0,
      zoom: project?.viewport.zoom ?? 1,
    }),
    [project?.viewport.panX, project?.viewport.panY, project?.viewport.zoom],
  );

  const {
    uiZoom,
    handleInit,
    handleViewportChange,
    handleMoveStart,
    handleMove,
    handleMoveEnd,
    handleFitAllNodes,
    handleResetViewport,
  } = useSiteboardViewportController({
    containerRef,
    zoomRef,
    nodes,
    storeViewport,
    updateViewport,
    cancelZoomRestore,
    scheduleZoomRestoreAfterReflow,
    prepareInteractionStart,
    handleInteractionChange,
    scheduleInteractionUpdate,
  });

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
      // React Flow の resize params.width / params.height は chrome 込みのフレーム外周サイズ
      const chromeWidth = getNodeChromeWidth({ type: 'webpage' });
      const chromeHeight = getNodeChromeHeight({ type: 'webpage' });
      const contentWidth = Math.max(PAGE_MIN_WIDTH, params.width - chromeWidth);
      const contentHeight = Math.max(PAGE_MIN_HEIGHT, params.height - chromeHeight);
      setWebPageResizing({
        nodeId,
        x: params.x,
        y: params.y,
        width: Math.round(contentWidth),
        height: Math.round(contentHeight),
      });
    },
    [],
  );

  const handleWebPageResizeEnd = useCallback(
    (nodeId: string, params: { x: number; y: number; width: number; height: number }) => {
      const chromeWidth = getNodeChromeWidth({ type: 'webpage' });
      const chromeHeight = getNodeChromeHeight({ type: 'webpage' });
      const contentWidth = Math.max(PAGE_MIN_WIDTH, params.width - chromeWidth);
      const contentHeight = Math.max(PAGE_MIN_HEIGHT, params.height - chromeHeight);
      const nextX = Math.round(params.x);
      const nextY = Math.round(params.y);
      const nextWidth = Math.round(contentWidth);
      const nextHeight = Math.round(contentHeight);
      useProjectStore.getState().updateNodeBounds(nodeId, nextX, nextY, nextWidth, nextHeight);
      setWebPageResizing(null);
      handleInteractionChange(false, 'resize');
      handlePageResizeEnd(nodeId);
    },
    [handleInteractionChange, handlePageResizeEnd],
  );

  const {
    handleGoBack,
    handleGoForward,
    handleNavigated,
    handlePinWebNodeUrl,
    handleReloadWebNode,
    handleRemoveNode,
    handleRemoveNodes,
    handleResizePreset,
    handleStickyNoteAutoHeightChange,
    handleStickyNoteStyleChange,
    handleStickyNoteContentChange,
    handleTitleUpdated,
    handleUrlSubmit,
    handleScrollEnded,
    handleWebviewCreated,
    handleWebviewDestroyed,
    handleWebviewLoaded,
    navStates,
  } = useSiteboardNodeRuntime({
    nodes,
    webviewLabelsByNodeId: projectWebviewRuntime.labelsByNodeId,
    selectedNodeIds,
    onDeselectNode: useCallback(
      (nodeId: string) => setSelection((prev) => prev.filter((id) => id !== nodeId)),
      [setSelection],
    ),
    updateWebNodeUrl,
    updateNodeTitle,
    removeNode,
    removeNodes,
    setWebNodeWebviewLabel,
    clearWebNodeWebviewLabel,
    setWebNodeUrl,
    pinWebNodeUrl,
    updateNodeSize,
    updateNodeSizeWithoutHistory,
    updateStickyNoteContent,
    updateStickyNoteStyle,
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
  // 第3引数 draggedNodes は、複数選択時に同時に動かしたノード全てを含む
  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node, draggedNodes: Node[]) => {
      handleInteractionChange(false, 'drag');

      // ドラッグ中の一時位置をクリア（複数選択時は全ノード分）
      setDraggingNodePositions((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const dragged of draggedNodes) {
          if (dragged.id in next) {
            delete next[dragged.id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      // 複数ノードを同時に動かしている場合、位置補正アニメーションは複雑になるため省略し、
      // 1 つの履歴エントリに集約してコミットする
      if (draggedNodes.length > 1) {
        updateNodePositions(
          draggedNodes.map((dragged) => ({
            nodeId: dragged.id,
            x: dragged.position.x,
            y: dragged.position.y,
          })),
        );
        return;
      }

      const movingNode = nodes.find((candidate) => candidate.id === node.id);
      if (!movingNode) return;

      const resolvedPosition = resolveDraggedNodePosition({
        nodes,
        movingNode,
        proposedX: node.position.x,
        proposedY: node.position.y,
        gap: DRAG_REPOSITION_GAP,
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
          updateNodePosition(node.id, resolvedPosition.x, resolvedPosition.y);
        }
        return;
      }

      updateNodePosition(node.id, resolvedPosition.x, resolvedPosition.y);
    },
    [
      handleInteractionChange,
      holdNodeDuringPositionSettle,
      nodes,
      updateNodePosition,
      updateNodePositions,
    ],
  );

  // エッジ接続: ドラッグで繋いだときにストアへ追加
  const handleConnect = useCallback(
    (connection: Connection) => {
      addEdgeToStore({
        id: `e-${connection.source}-${connection.sourceHandle ?? 'null'}-${connection.target}-${connection.targetHandle ?? 'null'}`,
        source: connection.source,
        sourceHandle: connection.sourceHandle,
        target: connection.target,
        targetHandle: connection.targetHandle,
      });
    },
    [addEdgeToStore],
  );

  // エッジ変更: 削除キーでの削除と、選択状態のローカル同期を処理
  // （controlled mode では select 変更を反映しないと React Flow の selected 表示が動かない）
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removeIds = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      if (removeIds.length > 0) {
        removeEdges(removeIds);
      }
      const selectChanges = changes.filter((c): c is EdgeSelectionChange => c.type === 'select');
      if (selectChanges.length > 0) {
        setSelectedEdgeIds((prev) => {
          const next = new Set(prev);
          for (const change of selectChanges) {
            if (change.selected) next.add(change.id);
            else next.delete(change.id);
          }
          return next;
        });
      }
    },
    [removeEdges],
  );

  // 自己接続を禁止
  const isValidConnection = useCallback((connection: Edge | Connection) => {
    return connection.source !== connection.target;
  }, []);

  // エッジのデフォルト設定: ArrowEdge（edgeTypes.default）が矢じりを自前で描くため markerEnd は持たない
  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'default' as const,
      style: { strokeWidth: EDGE_STROKE_WIDTH },
    }),
    [],
  );

  // React Flow の flowEdges 配列を構築する
  const flowEdges = useMemo(
    (): Edge[] =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target: edge.target,
        targetHandle: edge.targetHandle,
        selected: selectedEdgeIds.has(edge.id),
      })),
    [edges, selectedEdgeIds],
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
      // 複数選択を扱うため、changes をまとめてセットに反映する
      const selectChanges = changes.filter((c): c is NodeSelectionChange => c.type === 'select');
      if (selectChanges.length > 0) {
        setSelection((prev) => {
          const next = new Set(prev);
          for (const change of selectChanges) {
            if (change.selected) next.add(change.id);
            else next.delete(change.id);
          }
          // 順序保持のため、prev の順序を維持しつつ新規追加分を末尾に追加
          const result: string[] = [];
          for (const id of prev) {
            if (next.has(id)) {
              result.push(id);
              next.delete(id);
            }
          }
          for (const id of next) result.push(id);
          return result;
        });
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
    [setSelection],
  );

  const handleRemoveNodeWithSettleReset = useCallback(
    (nodeId: string) => {
      clearPositionCorrectionAnimation(nodeId);
      handleRemoveNode(nodeId);
    },
    [clearPositionCorrectionAnimation, handleRemoveNode],
  );

  const handleRemoveNodesWithSettleReset = useCallback(
    (nodeIds: string[]) => {
      for (const nodeId of nodeIds) {
        clearPositionCorrectionAnimation(nodeId);
      }
      handleRemoveNodes(nodeIds);
    },
    [clearPositionCorrectionAnimation, handleRemoveNodes],
  );

  const handleStickyNoteResize = useCallback(
    (nodeId: string, params: { x: number; y: number; width: number; height: number }) => {
      setStickyResizing({ nodeId, ...params });
    },
    [],
  );

  const handleStickyNoteResizeEnd = useCallback(
    (nodeId: string, width: number, height: number) => {
      updateNodeSize(nodeId, width, height);
      setStickyResizing(null);
    },
    [updateNodeSize],
  );

  // テキストノードのリサイズ中間状態
  const [textResizing, setTextResizing] = useState<{
    nodeId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const handleTextNodeResize = useCallback(
    (nodeId: string, params: { x: number; y: number; width: number; height: number }) => {
      setTextResizing({ nodeId, ...params });
      // ドラッグでリサイズした時点で fixed モードに切り替え
      updateTextNodeWidthMode(nodeId, 'fixed');
    },
    [updateTextNodeWidthMode],
  );

  const handleTextNodeResizeEnd = useCallback(
    (nodeId: string, width: number, height: number) => {
      updateNodeSize(nodeId, width, height);
      setTextResizing(null);
    },
    [updateNodeSize],
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
    selectedNodeIds,
    selectedEdgeIds,
    onRemoveNode: handleRemoveNodeWithSettleReset,
    onRemoveNodes: handleRemoveNodesWithSettleReset,
    onRemoveEdges: removeEdges,
    onUndo: undoProject,
    onRedo: redoProject,
    onBringNodeToFront: bringNodeToFront,
    onSendNodeToBack: sendNodeToBack,
    onBringNodeForward: bringNodeForward,
    onSendNodeBackward: sendNodeBackward,
  });

  const [editingUrlNodeId, setEditingUrlNodeId] = useState<string | null>(null);
  const [editingTextNodeId, setEditingTextNodeId] = useState<string | null>(null);

  // 新規テキストノード作成時に親からリクエストされた編集開始を反映する
  useEffect(() => {
    if (!autoEditTextNodeId) return;
    setEditingTextNodeId(autoEditTextNodeId);
    onAutoEditTextNodeHandled?.();
  }, [autoEditTextNodeId, onAutoEditTextNodeHandled]);

  // 付箋は内部 state で編集状態を持つため、flowNodes 構築時に autoStartEditing を渡す。
  // 渡した直後に親へ ack して再 render で false に戻し、二度起動を防ぐ
  useEffect(() => {
    if (!autoEditStickyNoteId) return;
    onAutoEditStickyNoteHandled?.();
  }, [autoEditStickyNoteId, onAutoEditStickyNoteHandled]);

  const handleTextNodeStartEditing = useCallback((nodeId: string) => {
    setEditingTextNodeId(nodeId);
  }, []);

  const handleTextNodeStopEditing = useCallback(
    (nodeId: string, tiptapContent: object) => {
      updateTextNodeContent(nodeId, tiptapContent);
      setEditingTextNodeId(null);
    },
    [updateTextNodeContent],
  );

  // 直前の選択を保持し、テキストノードが選択解除されたタイミングで空なら削除する
  const previousSelectedNodeIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const previous = previousSelectedNodeIdsRef.current;
    previousSelectedNodeIdsRef.current = selectedNodeIds;

    const currentSet = new Set(selectedNodeIds);
    const deselected = previous.filter((id) => !currentSet.has(id));
    if (deselected.length === 0) return;

    const emptyTextNodeIds = deselected.filter((id) => {
      if (id === editingTextNodeId) return false;
      const node = nodes.find((candidate) => candidate.id === id);
      return !!node && isTextNode(node) && isTextNodeEmpty(node);
    });
    if (emptyTextNodeIds.length === 0) return;

    if (emptyTextNodeIds.length === 1) {
      removeNode(emptyTextNodeIds[0]);
    } else {
      removeNodes(emptyTextNodeIds);
    }
  }, [editingTextNodeId, nodes, removeNode, removeNodes, selectedNodeIds]);

  const handleTextNodeAutoHeightChange = useCallback(
    (nodeId: string, height: number) => {
      updateNodeSizeWithoutHistory(
        nodeId,
        useProjectStore.getState().project?.nodes.find((n) => n.id === nodeId)?.width ?? 200,
        height,
      );
    },
    [updateNodeSizeWithoutHistory],
  );

  const handleTextNodeAutoWidthChange = useCallback(
    (nodeId: string, width: number) => {
      const node = useProjectStore.getState().project?.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      updateNodeSizeWithoutHistory(nodeId, Math.max(width, TEXT_NODE_MIN_WIDTH), node.height);
    },
    [updateNodeSizeWithoutHistory],
  );

  const handleTextNodeWidthModeChange = useCallback(
    (nodeId: string, mode: 'auto' | 'fixed') => {
      updateTextNodeWidthMode(nodeId, mode);
    },
    [updateTextNodeWidthMode],
  );

  const handleTextNodeStyleChange = useCallback(
    (
      nodeId: string,
      style: {
        fontSizePreset?: import('@/types').TextNodeFontSizePreset;
        fontWeight?: 'normal' | 'bold';
        italic?: boolean;
        strikethrough?: boolean;
        textColorIndex?: number;
      },
    ) => {
      updateTextNodeStyle(nodeId, style);
    },
    [updateTextNodeStyle],
  );

  const { handleNodeContextMenu, handleEdgeContextMenu } = useSiteboardContextMenus({
    nodes,
    setSelection,
    setSelectedEdgeIds,
    setEditingUrlNodeId,
    handleContextMenuOpen,
    handleContextMenuClose: handleContextMenuCloseDisplay,
    onRemoveNode: handleRemoveNodeWithSettleReset,
    reverseEdge,
    removeEdges,
    bringNodeToFront,
    sendNodeToBack,
    bringNodeForward,
    sendNodeBackward,
  });

  const handleChangeUrlSubmit = useCallback(
    (nodeId: string, url: string) => {
      changeWebNodeUrl(nodeId, url);
      setEditingUrlNodeId(null);
    },
    [changeWebNodeUrl],
  );

  // ペイン（空白エリア）クリックで選択解除（Shift 押下時は複数選択操作の途中とみなして維持）
  const handlePaneClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.shiftKey) return;
      setSelection([]);
    },
    [setSelection],
  );

  // ノード mousedown 時の選択更新（Shift 押下で追加、それ以外は単独選択へ切替）
  // 既に複数選択メンバーをクリックした場合は選択を維持し、その後の drag で全選択を一括移動できるようにする
  const handleNodeActivate = useCallback(
    (nodeId: string, addToSelection: boolean) => {
      setSelection((prev) => {
        if (addToSelection) {
          return prev.includes(nodeId) ? prev : [...prev, nodeId];
        }
        if (prev.length > 1 && prev.includes(nodeId)) return prev;
        return [nodeId];
      });
    },
    [setSelection],
  );

  // タイトル段ドラッグ。React Flow の NodeToolbar はノード DOM サブツリー外に portal 配置されるため
  // dragHandle が効かない。ここで pointer 系イベントを直接取り、draggingNodePositions を更新する
  const handleTitlePointerDown = useCallback(
    (nodeId: string, event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.stopPropagation();

      handleNodeActivate(nodeId, event.shiftKey);

      const startClientX = event.clientX;
      const startClientY = event.clientY;
      const startZoom = zoomRef.current;

      const movingIds =
        selectedNodeIds.includes(nodeId) && selectedNodeIds.length > 1 ? selectedNodeIds : [nodeId];
      const startPositions = new Map<string, { x: number; y: number }>();
      for (const id of movingIds) {
        const target = nodes.find((candidate) => candidate.id === id);
        if (target) startPositions.set(id, { x: target.x, y: target.y });
      }
      if (startPositions.size === 0) return;

      let dragStarted = false;
      const DRAG_THRESHOLD_PX = 3;

      const handleMove = (ev: PointerEvent) => {
        const screenDx = ev.clientX - startClientX;
        const screenDy = ev.clientY - startClientY;
        if (!dragStarted) {
          if (Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD_PX) return;
          dragStarted = true;
          void prepareInteractionStart('drag', nodeId);
          handleInteractionChange(true, 'drag');
        }
        const dx = screenDx / startZoom;
        const dy = screenDy / startZoom;
        setDraggingNodePositions((prev) => {
          const next = { ...prev };
          for (const [id, start] of startPositions) {
            next[id] = { x: start.x + dx, y: start.y + dy };
          }
          return next;
        });
      };

      const handleUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);

        if (!dragStarted) return;

        handleInteractionChange(false, 'drag');

        const dx = (ev.clientX - startClientX) / startZoom;
        const dy = (ev.clientY - startClientY) / startZoom;

        setDraggingNodePositions((prev) => {
          const next = { ...prev };
          for (const id of startPositions.keys()) delete next[id];
          return next;
        });

        if (startPositions.size > 1) {
          updateNodePositions(
            Array.from(startPositions.entries()).map(([id, start]) => ({
              nodeId: id,
              x: start.x + dx,
              y: start.y + dy,
            })),
          );
        } else {
          const start = startPositions.get(nodeId);
          if (start) {
            updateNodePosition(nodeId, start.x + dx, start.y + dy);
          }
        }
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [
      nodes,
      selectedNodeIds,
      handleNodeActivate,
      prepareInteractionStart,
      handleInteractionChange,
      updateNodePosition,
      updateNodePositions,
    ],
  );

  useEffect(() => {
    const unregister = registerUnsavedChangesDialogDisplayController({
      enter: handleUnsavedChangesDialogOpen,
      exit: handleUnsavedChangesDialogClose,
    });

    return unregister;
  }, [handleUnsavedChangesDialogClose, handleUnsavedChangesDialogOpen]);

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
        const nodeHeight = getNodeFrameHeight({ type: 'stickynote', height: contentHeight });
        const nodeData: StickyNoteFlowNodeData = {
          nodeProps: {
            node: { ...node, x: 0, y: 0, width: contentWidth, height: contentHeight },
            isActive: node.id === activeNodeId,
            autoStartEditing: autoEditStickyNoteId === node.id,
            onActivate: handleNodeActivate,
            onContextMenu: handleNodeContextMenu,
            onContentChange: handleStickyNoteContentChange,
            onAutoHeightChange: handleStickyNoteAutoHeightChange,
            onStyleChange: handleStickyNoteStyleChange,
          },
          onResize: handleStickyNoteResize,
          onResizeEnd: handleStickyNoteResizeEnd,
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
          selected: selectedNodeIdSet.has(node.id),
          measured: rfMeasured[node.id],
          data: nodeData as unknown as Record<string, unknown>,
        };
      }

      if (isTextNode(node)) {
        const isResizing = textResizing?.nodeId === node.id;
        const textPosition = isResizing ? { x: textResizing.x, y: textResizing.y } : position;
        const contentWidth = isResizing ? textResizing.width : node.width;
        const contentHeight = isResizing ? textResizing.height : node.height;
        const nodeData: TextFlowNodeData = {
          nodeProps: {
            node: { ...node, x: 0, y: 0, width: contentWidth, height: contentHeight } as TextNode,
            isActive: node.id === activeNodeId,
            isEditing: editingTextNodeId === node.id,
            onActivate: handleNodeActivate,
            onContextMenu: handleNodeContextMenu,
            onStartEditing: handleTextNodeStartEditing,
            onStopEditing: handleTextNodeStopEditing,
            onAutoHeightChange: handleTextNodeAutoHeightChange,
            onAutoWidthChange: handleTextNodeAutoWidthChange,
            onStyleChange: handleTextNodeStyleChange,
            onWidthModeChange: handleTextNodeWidthModeChange,
          },
          onResize: handleTextNodeResize,
          onResizeEnd: handleTextNodeResizeEnd,
        };
        return {
          id: node.id,
          type: 'textFlowNode',
          position: textPosition,
          width: contentWidth,
          height: contentHeight,
          selected: selectedNodeIdSet.has(node.id),
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
      const empty = isNodeEmpty(node);
      const moved = isNodeMoved(node);
      const nodeData: WebPageFlowNodeData = {
        nodeProps: {
          // isStickyNoteNode の早期 return 後に WebPageNode と確定しているが spread で型が広がるため cast
          node: { ...node, x: 0, y: 0 } as WebPageNode,
          isActive: node.id === activeNodeId,
          displayMode: displayModes[node.id] ?? 'hidden',
          screenshotUrl: screenshotUrls[node.id] ?? null,
          getZoom,
          onActivate: handleNodeActivate,
          onContextMenu: handleNodeContextMenu,
          onNavigated: handleNavigated,
          onTitleUpdated: handleTitleUpdated,
          onWebviewCreated: handleWebviewCreated,
          onWebviewDestroyed: handleWebviewDestroyed,
          onWebviewLoaded: handleWebviewLoaded,
          onScreenshotPresented: handleScreenshotPresented,
          onScrollEnded: handleScrollEnded,
          positionCorrectionAnimationToken: positionCorrectionAnimations[node.id]?.token ?? null,
          positionCorrectionFromX: positionCorrectionAnimations[node.id]?.fromX ?? null,
          positionCorrectionFromY: positionCorrectionAnimations[node.id]?.fromY ?? null,
          positionCorrectionToX: positionCorrectionAnimations[node.id]?.toX ?? null,
          positionCorrectionToY: positionCorrectionAnimations[node.id]?.toY ?? null,
          onPositionCorrectionAnimationComplete: handlePositionCorrectionAnimationComplete,
        },
        toolbar: {
          title: node.title,
          displayWidth: contentWidth,
          displayHeight: contentHeight,
          canGoBack: navStates[node.id]?.can_go_back ?? false,
          canGoForward: navStates[node.id]?.can_go_forward ?? false,
          isMoved: moved,
          isEmpty: empty,
          isEditingUrl: editingUrlNodeId === node.id,
          currentUrl: node.url,
          onGoBack: () => handleGoBack(node.id),
          onGoForward: () => handleGoForward(node.id),
          onReload: () => handleReloadWebNode(node.id),
          onPinUrl: () => handlePinWebNodeUrl(node.id),
          onResizePreset: (width, height) => handleResizePreset(node.id, width, height),
          onUrlSubmit: (url) =>
            editingUrlNodeId === node.id
              ? handleChangeUrlSubmit(node.id, url)
              : handleUrlSubmit(node.id, url),
          onTitlePointerDown: (event) => handleTitlePointerDown(node.id, event),
          onTitleContextMenu: (event) => handleNodeContextMenu(event, node.id),
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
        width: getNodeFrameWidth({ type: 'webpage', width: contentWidth }),
        height: getNodeFrameHeight({ type: 'webpage', height: contentHeight }),
        dragHandle: '.node-drag-handle',
        selected: selectedNodeIdSet.has(node.id),
        measured: rfMeasured[node.id],
        data: nodeData as unknown as Record<string, unknown>,
      };
    });
  }, [
    nodes,
    draggingNodePositions,
    rfMeasured,
    activeNodeId,
    selectedNodeIdSet,
    stickyResizing,
    textResizing,
    webPageResizing,
    uiZoom,
    displayModes,
    screenshotUrls,
    navStates,
    positionCorrectionAnimations,
    handleNodeActivate,
    handleNodeContextMenu,
    handleStickyNoteResize,
    handleStickyNoteResizeEnd,
    handleStickyNoteContentChange,
    handleStickyNoteAutoHeightChange,
    handleStickyNoteStyleChange,
    autoEditStickyNoteId,
    editingTextNodeId,
    handleTextNodeStartEditing,
    handleTextNodeStopEditing,
    handleTextNodeAutoHeightChange,
    handleTextNodeAutoWidthChange,
    handleTextNodeStyleChange,
    handleTextNodeWidthModeChange,
    handleTextNodeResize,
    handleTextNodeResizeEnd,
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
    handleChangeUrlSubmit,
    editingUrlNodeId,
    handleTitlePointerDown,
    handlePositionCorrectionAnimationComplete,
  ]);

  return (
    <ReactFlowProvider>
      <div ref={containerRef} data-siteboard-container className="relative flex-1 overflow-hidden">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineComponent={ArrowConnectionLine}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onEdgeContextMenu={handleEdgeContextMenu}
          onConnect={handleConnect}
          connectionMode={ConnectionMode.Loose}
          // 吸着スナップ範囲。Handle のヒット領域より少し広めに取って、近接時の吸着を出やすくする
          connectionRadius={40}
          isValidConnection={isValidConnection}
          defaultEdgeOptions={defaultEdgeOptions}
          // 自前のキーボードハンドラ（useSiteboardKeyboard）で削除を一元化するため、
          // React Flow の組み込み delete は無効化する。
          // 組み込み経由だと「edges 削除イベント → handleEdgesChange → store.removeEdges」と
          // 「キーハンドラ → store.removeNode（edges を cascade 削除）」が二重に発火し、
          // 1 つのノード削除で履歴が 2 段になる（Cmd+Z で edges が復元されない）。
          deleteKeyCode={null}
          onViewportChange={handleViewportChange}
          onMoveStart={handleMoveStart}
          onMove={handleMove}
          onMoveEnd={handleMoveEnd}
          onNodeDragStart={handleNodeDragStart}
          onNodeDragStop={handleNodeDragStop}
          onPaneClick={handlePaneClick}
          onInit={handleInit}
          panActivationKeyCode="Space"
          panOnDrag={[1]}
          panOnScroll={true}
          selectionOnDrag={true}
          // Figma 同様、選択範囲がノードに少しでも重なれば選択対象に含める
          selectionMode={SelectionMode.Partial}
          // Figma 同様、Shift で複数選択を切り替える（macOS の Meta デフォルトを上書き）
          multiSelectionKeyCode="Shift"
          nodeDragThreshold={3}
          zoomOnScroll={true}
          zoomOnPinch={true}
          zoomOnDoubleClick={false}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          // Webview 対策: 仮想化を無効化してすべてのノードをレンダリングする
          onlyRenderVisibleElements={false}
          proOptions={{ hideAttribution: true }}
          colorMode={isDark ? 'dark' : 'light'}
          className="size-full"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={2}
            color={isDark ? '#27272a' : '#d1d5db'}
            bgColor={isDark ? '#18181b' : '#f9fafb'}
          />
          <FloatingToolbar
            onAddWebNode={onAddWebNode}
            onAddStickyNote={onAddStickyNote}
            onAddTextNode={onAddTextNode}
          />
          <div className="pointer-events-none absolute right-4 bottom-4 z-20 flex items-center gap-2">
            <div className="pointer-events-auto">
              <AppButton
                size="sm"
                isIconOnly={true}
                tooltipMessage="Zoom to Fit"
                onPress={handleFitAllNodes}
                aria-label="Zoom to Fit"
                isDisabled={nodes.length === 0}
                className={FLOATING_CONTROL_SOLID_BUTTON_CLASSNAME}
              >
                <ArrowsExpand className="size-4" />
              </AppButton>
            </div>
            <div className="pointer-events-auto">
              <ZoomIndicator zoom={uiZoom} onResetViewport={handleResetViewport} />
            </div>
          </div>
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
