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
import { MIN_ZOOM, MAX_ZOOM, STICKY_NOTE_MIN_HEIGHT, STICKY_NOTE_MIN_WIDTH } from '@/constants';
import { useSiteboardContextMenus } from '@/hooks/siteboard/useSiteboardContextMenus';
import { useSiteboardDisplayEngine } from '@/hooks/siteboard/useSiteboardDisplayEngine';
import { useSiteboardDrag } from '@/hooks/siteboard/useSiteboardDrag';
import { useSiteboardKeyboard } from '@/hooks/siteboard/useSiteboardKeyboard';
import { useSiteboardNodeRuntime } from '@/hooks/siteboard/useSiteboardNodeRuntime';
import { useSiteboardResize } from '@/hooks/siteboard/useSiteboardResize';
import { useSiteboardTextEditing } from '@/hooks/siteboard/useSiteboardTextEditing';
import { useSiteboardViewportController } from '@/hooks/siteboard/useSiteboardViewportController';
import { getNodeFrameHeight, getNodeFrameWidth } from '@/lib/siteboard-node-frame';
import { registerUnsavedChangesDialogDisplayController } from '@/lib/unsaved-changes-dialog-display';
import { selectProject, selectProjectWebviewRuntime, useProjectStore } from '@/store/tab-store';
import { useThemeStore } from '@/store/theme-store';
import { isNodeEmpty, isNodeMoved, isStickyNoteNode, isTextNode, isWebPageNode } from '@/types';
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

  // React Flow が ResizeObserver で測定したノード寸法（controlled mode でのノード初期化に必要）
  const [rfMeasured, setRfMeasured] = useState<Record<string, { width: number; height: number }>>(
    {},
  );
  // 選択中のエッジ ID。controlled mode では flowEdges.selected を自前で同期しないと
  // React Flow の選択スタイル（CSS class や custom edge への selected prop）が反映されない
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(() => new Set());
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

  const {
    stickyResizing,
    webPageResizing,
    textResizing,
    handleWebPageResizeStart,
    handleWebPageResize,
    handleWebPageResizeEnd,
    handleStickyNoteResize,
    handleStickyNoteResizeEnd,
    handleTextNodeResize,
    handleTextNodeResizeEnd,
  } = useSiteboardResize({
    prepareInteractionStart,
    handleInteractionChange,
    handlePageResizeStart,
    handlePageResizeEnd,
    updateNodeSize,
    updateTextNodeWidthMode,
  });

  const {
    draggingNodePositions,
    positionCorrectionAnimations,
    clearPositionCorrectionAnimation,
    handlePositionCorrectionAnimationComplete,
    handleNodeDragStart,
    handleNodeDragStop,
    handleNodeActivate,
    handleTitlePointerDown,
    trackDraggingPositions,
  } = useSiteboardDrag({
    nodes,
    webPageNodes,
    selectedNodeIds,
    setSelection,
    zoomRef,
    prepareInteractionStart,
    handleInteractionChange,
    holdNodeDuringPositionSettle,
    releaseNodeAfterPositionSettle,
    updateNodePosition,
    updateNodePositions,
  });

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
      trackDraggingPositions(changes);
    },
    [setSelection, trackDraggingPositions],
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

  const {
    editingTextNodeId,
    editingUrlNodeId,
    setEditingUrlNodeId,
    handleTextNodeStartEditing,
    handleTextNodeStopEditing,
    handleTextNodeAutoHeightChange,
    handleTextNodeAutoWidthChange,
    handleTextNodeWidthModeChange,
    handleTextNodeStyleChange,
    handleChangeUrlSubmit,
  } = useSiteboardTextEditing({
    nodes,
    selectedNodeIds,
    autoEditTextNodeId,
    onAutoEditTextNodeHandled,
    autoEditStickyNoteId,
    onAutoEditStickyNoteHandled,
    updateTextNodeContent,
    updateNodeSizeWithoutHistory,
    updateTextNodeWidthMode,
    updateTextNodeStyle,
    changeWebNodeUrl,
    removeNode,
    removeNodes,
  });

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

  // ペイン（空白エリア）クリックで選択解除（Shift 押下時は複数選択操作の途中とみなして維持）
  const handlePaneClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.shiftKey) return;
      setSelection([]);
    },
    [setSelection],
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
