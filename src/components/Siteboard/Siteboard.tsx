import ArrowsExpand from '@gravity-ui/icons/ArrowsExpand';
import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu';
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
  type ReactFlowInstance,
  SelectionMode,
  type Viewport as FlowViewport,
} from '@xyflow/react';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  LOW_ZOOM_HIDE_THRESHOLD,
  MIN_ZOOM,
  MAX_ZOOM,
  PAGE_MIN_HEIGHT,
  STICKY_NOTE_MIN_HEIGHT,
  STICKY_NOTE_MIN_WIDTH,
  ZOOM_END_DEBOUNCE_MS,
  ZOOM_RESET_TARGET,
  ZOOM_STEPS,
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
import { registerUnsavedChangesDialogDisplayController } from '@/lib/unsaved-changes-dialog-display';
import { registerViewCommandHandlers } from '@/lib/view-commands';
import { selectProject, selectProjectWebviewRuntime, useProjectStore } from '@/store/tab-store';
import { useThemeStore } from '@/store/theme-store';
import { isNodeEmpty, isStickyNoteNode, isTextNode, isWebPageNode } from '@/types';
import type { TextNode, WebPageNode } from '@/types';

interface SiteboardProps {
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
  centeredNodeId?: string | null;
  onCenteredNodeHandled?: () => void;
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
  onAddTextNode,
}: SiteboardProps) {
  const project = useProjectStore(selectProject);
  const projectWebviewRuntime = useProjectStore(selectProjectWebviewRuntime);
  const isDark = useThemeStore((s) => s.isDark);

  const {
    undoProject,
    redoProject,
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
    changeWebNodeUrl,
    pinWebNodeUrl,
    updateStickyNoteContent,
    cycleStickyNoteColor,
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
      cycleStickyNoteColor: s.cycleStickyNoteColor,
      updateTextNodeContent: s.updateTextNodeContent,
      updateTextNodeStyle: s.updateTextNodeStyle,
      updateTextNodeWidthMode: s.updateTextNodeWidthMode,
      clearWebNodeWebviewLabel: s.clearWebNodeWebviewLabel,
      hydrateProjectScreenshotUrls: s.hydrateProjectScreenshotUrls,
      redoProject: s.redoProject,
      pinWebNodeUrl: s.pinWebNodeUrl,
      removeNode: s.removeNode,
      setProjectScreenshotUrl: s.setProjectScreenshotUrl,
      setWebNodeUrl: s.setWebNodeUrl,
      changeWebNodeUrl: s.changeWebNodeUrl,
      setWebNodeWebviewLabel: s.setWebNodeWebviewLabel,
      undoProject: s.undoProject,
      updateNodePosition: s.updateNodePosition,
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

  const [uiZoom, setUiZoom] = useState(() => project?.viewport.zoom ?? 1);
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
  const viewportUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uiZoomRafRef = useRef<number | null>(null);
  // setViewport のみ使用するため広い型で保持
  const reactFlowInstanceRef = useRef<Pick<ReactFlowInstance, 'setViewport'> | null>(null);
  const flowViewportRef = useRef<FlowViewport | null>(null);
  const moveInteractionTypeRef = useRef<'pan' | 'zoom' | null>(null);
  const prefersReducedMotion = useReducedMotion();

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
    hydrateCachedScreenshotUrls,
    setCachedScreenshotUrl,
    clearCachedScreenshotUrl,
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
      useProjectStore.getState().updateNodeBounds(nodeId, nextX, nextY, nextWidth, nextHeight);
      setWebPageResizing(null);
      handleInteractionChange(false, 'resize');
      handlePageResizeEnd(nodeId);
    },
    [handleInteractionChange, handlePageResizeEnd, zoomRef],
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
    nodes,
    webviewLabelsByNodeId: projectWebviewRuntime.labelsByNodeId,
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
          updateNodePosition(node.id, resolvedPosition.x, resolvedPosition.y);
        }
        return;
      }

      updateNodePosition(node.id, resolvedPosition.x, resolvedPosition.y);
    },
    [handleInteractionChange, holdNodeDuringPositionSettle, nodes, updateNodePosition, zoomRef],
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
    selectedNodeId,
    selectedEdgeIds,
    onRemoveNode: handleRemoveNodeWithSettleReset,
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

  const handleEdgeContextMenu = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      e.preventDefault();
      setSelectedEdgeIds(new Set([edge.id]));

      const showMenu = async () => {
        const menuItems: (MenuItem | PredefinedMenuItem)[] = [];

        menuItems.push(
          await MenuItem.new({
            text: '矢印の向きを入れ替え',
            action: () => {
              reverseEdge(edge.id);
            },
          }),
        );
        menuItems.push(await PredefinedMenuItem.new({ item: 'Separator' }));
        menuItems.push(
          await MenuItem.new({
            text: '矢印を削除',
            accelerator: 'Backspace',
            action: () => {
              removeEdges([edge.id]);
            },
          }),
        );

        const menu = await Menu.new({ items: menuItems });
        await menu.popup();
      };

      void showMenu();
    },
    [reverseEdge, removeEdges],
  );

  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.preventDefault();
      onSelectNode(nodeId);

      const node = nodes.find((candidate) => candidate.id === nodeId);
      const showMenu = async () => {
        if (node && !isStickyNoteNode(node) && !isTextNode(node)) {
          await handleContextMenuOpen(nodeId);
        }

        const menuItems: (MenuItem | PredefinedMenuItem)[] = [];

        if (node && isWebPageNode(node) && !isNodeEmpty(node)) {
          menuItems.push(
            await MenuItem.new({
              text: 'サイトのURLを変更',
              action: () => {
                setEditingUrlNodeId(nodeId);
                handleContextMenuCloseDisplay();
              },
            }),
          );
          menuItems.push(await PredefinedMenuItem.new({ item: 'Separator' }));
        }

        // 付箋・テキストノードの重なり順メニュー
        if (node && !isWebPageNode(node)) {
          const isAtFront = nodes[nodes.length - 1]?.id === nodeId;
          const isAtBack = nodes[0]?.id === nodeId;

          menuItems.push(
            await MenuItem.new({
              text: '最前面へ',
              accelerator: 'CmdOrCtrl+Alt+]',
              enabled: !isAtFront,
              action: () => {
                handleContextMenuCloseDisplay();
                bringNodeToFront(nodeId);
              },
            }),
          );
          menuItems.push(
            await MenuItem.new({
              text: '1つ前面へ',
              accelerator: 'CmdOrCtrl+]',
              enabled: !isAtFront,
              action: () => {
                handleContextMenuCloseDisplay();
                bringNodeForward(nodeId);
              },
            }),
          );
          menuItems.push(
            await MenuItem.new({
              text: '1つ背面へ',
              accelerator: 'CmdOrCtrl+[',
              enabled: !isAtBack,
              action: () => {
                handleContextMenuCloseDisplay();
                sendNodeBackward(nodeId);
              },
            }),
          );
          menuItems.push(
            await MenuItem.new({
              text: '最背面へ',
              accelerator: 'CmdOrCtrl+Alt+[',
              enabled: !isAtBack,
              action: () => {
                handleContextMenuCloseDisplay();
                sendNodeToBack(nodeId);
              },
            }),
          );
          menuItems.push(await PredefinedMenuItem.new({ item: 'Separator' }));
        }

        menuItems.push(
          await MenuItem.new({
            text: 'ノードを削除',
            accelerator: 'Backspace',
            action: () => {
              handleContextMenuCloseDisplay();
              handleRemoveNodeWithSettleReset(nodeId);
            },
          }),
        );

        const menu = await Menu.new({ items: menuItems });
        await menu.popup();
        handleContextMenuCloseDisplay();
      };

      void showMenu();
    },
    [
      handleContextMenuOpen,
      handleContextMenuCloseDisplay,
      handleRemoveNodeWithSettleReset,
      onSelectNode,
      nodes,
      bringNodeToFront,
      sendNodeToBack,
      bringNodeForward,
      sendNodeBackward,
    ],
  );

  const handleChangeUrlSubmit = useCallback(
    (nodeId: string, url: string) => {
      changeWebNodeUrl(nodeId, url);
      setEditingUrlNodeId(null);
    },
    [changeWebNodeUrl],
  );

  // ペイン（空白エリア）クリックで選択解除
  const handlePaneClick = useCallback(
    (_event: React.MouseEvent) => {
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
        updateViewport({ zoom: viewport.zoom, panX: viewport.x, panY: viewport.y });
      }, ZOOM_END_DEBOUNCE_MS);
    },
    [containerRef, updateViewport, zoomRef],
  );

  const storeViewport = useMemo<FlowViewport>(
    () => ({
      x: project?.viewport.panX ?? 0,
      y: project?.viewport.panY ?? 0,
      zoom: project?.viewport.zoom ?? 1,
    }),
    [project?.viewport.panX, project?.viewport.panY, project?.viewport.zoom],
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

  // --canvas-zoom を mount 直後（子 useEffect より前）に初期化する。
  // syncViewportFromStore は useEffect のため子コンポーネントの useEffect より後に走り、
  // Webview 作成時に --canvas-zoom が未設定（fallback 1）になって TopBar 高さが崩れる。
  // useLayoutEffect は useEffect より先に実行されるため、Webview 作成前に正しい値が設定できる。
  useLayoutEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.setProperty('--canvas-zoom', String(zoomRef.current));
    }
  }, []); // mount 時のみ実行（zoomRef は ref であり変更が依存要因にならないため空配列で問題なし）

  useEffect(() => {
    const unregister = registerUnsavedChangesDialogDisplayController({
      enter: handleUnsavedChangesDialogOpen,
      exit: handleUnsavedChangesDialogClose,
    });

    return unregister;
  }, [handleUnsavedChangesDialogClose, handleUnsavedChangesDialogOpen]);

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

  const handleZoomIn = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const viewport = flowViewportRef.current;
    if (!viewport) return;

    const { x, y, zoom } = viewport;
    const nextZoom =
      ZOOM_STEPS.find((step) => step > zoom + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
    if (Math.abs(nextZoom - zoom) < 0.001) return;

    // ビューポート中心のワールド座標を固定してズーム
    const worldX = (rect.width / 2 - x) / zoom;
    const worldY = (rect.height / 2 - y) / zoom;
    applyViewportTarget({
      x: rect.width / 2 - worldX * nextZoom,
      y: rect.height / 2 - worldY * nextZoom,
      zoom: nextZoom,
    });
  }, [applyViewportTarget]);

  const handleZoomOut = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const viewport = flowViewportRef.current;
    if (!viewport) return;

    const { x, y, zoom } = viewport;
    const prevZoom = [...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.001) ?? ZOOM_STEPS[0];
    if (Math.abs(prevZoom - zoom) < 0.001) return;

    // ビューポート中心のワールド座標を固定してズーム
    const worldX = (rect.width / 2 - x) / zoom;
    const worldY = (rect.height / 2 - y) / zoom;
    applyViewportTarget({
      x: rect.width / 2 - worldX * prevZoom,
      y: rect.height / 2 - worldY * prevZoom,
      zoom: prevZoom,
    });
  }, [applyViewportTarget]);

  // ビューポートの debounce タイマーと rAF のクリーンアップ
  useEffect(() => {
    return () => {
      if (viewportUpdateTimerRef.current) clearTimeout(viewportUpdateTimerRef.current);
      if (zoomRestoreTimerRef.current) clearTimeout(zoomRestoreTimerRef.current);
      if (uiZoomRafRef.current !== null) cancelAnimationFrame(uiZoomRafRef.current);
    };
  }, []);

  useEffect(() => {
    return registerViewCommandHandlers({
      fitView: handleFitAllNodes,
      resetZoom: handleResetViewport,
      zoomIn: handleZoomIn,
      zoomOut: handleZoomOut,
    });
  }, [handleFitAllNodes, handleResetViewport, handleZoomIn, handleZoomOut]);

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
            onColorCycle: handleStickyNoteColorCycle,
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
          selected: node.id === selectedNodeId,
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
            isActive: node.id === selectedNodeId,
            isEditing: editingTextNodeId === node.id,
            onActivate: onSelectNode,
            onContextMenu: handleNodeContextMenu,
            onStartEditing: handleTextNodeStartEditing,
            onStopEditing: handleTextNodeStopEditing,
            onAutoHeightChange: handleTextNodeAutoHeightChange,
            onStyleChange: handleTextNodeStyleChange,
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
          onUrlSubmit: editingUrlNodeId === node.id ? handleChangeUrlSubmit : handleUrlSubmit,
          isEditingUrl: editingUrlNodeId === node.id,
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
    textResizing,
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
    editingTextNodeId,
    handleTextNodeStartEditing,
    handleTextNodeStopEditing,
    handleTextNodeAutoHeightChange,
    handleTextNodeStyleChange,
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
          onInit={(instance) => {
            reactFlowInstanceRef.current = instance;
            syncViewportFromStore(instance);
          }}
          panActivationKeyCode="Space"
          panOnDrag={[1]}
          panOnScroll={true}
          selectionOnDrag={true}
          // Figma 同様、選択範囲がノードに少しでも重なれば選択対象に含める
          selectionMode={SelectionMode.Partial}
          nodeDragThreshold={3}
          zoomOnScroll={true}
          zoomOnPinch={true}
          zoomOnDoubleClick={false}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          // Webview 対策: 仮想化を無効化してすべてのノードをレンダリングする
          onlyRenderVisibleElements={false}
          proOptions={{ hideAttribution: true }}
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
                tooltipMessage="全体を表示"
                onPress={handleFitAllNodes}
                aria-label="全体を表示"
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
