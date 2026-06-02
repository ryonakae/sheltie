import { useMemo } from 'react';

import type { StickyNoteNodeProps } from '@/components/Node/StickyNoteNode';
import type { TextNodeProps } from '@/components/Node/TextNode';
import type { WebPageNodeProps } from '@/components/Node/WebPageNode';
import type {
  StickyNoteFlowNodeData,
  TextFlowNodeData,
  WebPageFlowNodeData,
} from '@/components/ReactFlowNodes/types';
import { STICKY_NOTE_MIN_HEIGHT, STICKY_NOTE_MIN_WIDTH } from '@/constants';
import type { PositionCorrectionAnimation } from '@/hooks/siteboard/useSiteboardDrag';
import { getNodeFrameHeight, getNodeFrameWidth } from '@/lib/siteboard-node-frame';
import type { NavigationState } from '@/lib/tauri-bridge/types';
import { isNodeEmpty, isNodeMoved, isStickyNoteNode, isTextNode } from '@/types';
import type { BoardNode, DisplayMode, TextNode, WebPageNode } from '@/types';

import type { Node } from '@xyflow/react';

interface ResizingState {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface UseSiteboardFlowNodesParams {
  nodes: BoardNode[];
  draggingNodePositions: Record<string, { x: number; y: number }>;
  rfMeasured: Record<string, { width: number; height: number }>;
  activeNodeId: string | null;
  selectedNodeIdSet: Set<string>;
  stickyResizing: ResizingState | null;
  textResizing: ResizingState | null;
  webPageResizing: ResizingState | null;
  uiZoom: number;
  displayModes: Record<string, DisplayMode>;
  screenshotUrls: Record<string, string>;
  navStates: Record<string, NavigationState>;
  positionCorrectionAnimations: Record<string, PositionCorrectionAnimation>;
  autoEditStickyNoteId: string | null;
  editingTextNodeId: string | null;
  editingUrlNodeId: string | null;
  getZoom: () => number;
  // 全種別共通のノードハンドラ
  handleNodeActivate: WebPageNodeProps['onActivate'];
  handleNodeContextMenu: WebPageNodeProps['onContextMenu'];
  // 付箋ノード
  handleStickyNoteContentChange: StickyNoteNodeProps['onContentChange'];
  handleStickyNoteAutoHeightChange: StickyNoteNodeProps['onAutoHeightChange'];
  handleStickyNoteStyleChange: StickyNoteFlowNodeData['nodeProps']['onStyleChange'];
  handleStickyNoteResize: StickyNoteFlowNodeData['onResize'];
  handleStickyNoteResizeEnd: StickyNoteFlowNodeData['onResizeEnd'];
  // テキストノード
  handleTextNodeStartEditing: TextNodeProps['onStartEditing'];
  handleTextNodeStopEditing: TextNodeProps['onStopEditing'];
  handleTextNodeAutoHeightChange: TextNodeProps['onAutoHeightChange'];
  handleTextNodeAutoWidthChange: TextNodeProps['onAutoWidthChange'];
  handleTextNodeStyleChange: TextFlowNodeData['nodeProps']['onStyleChange'];
  handleTextNodeWidthModeChange: TextFlowNodeData['nodeProps']['onWidthModeChange'];
  handleTextNodeResize: TextFlowNodeData['onResize'];
  handleTextNodeResizeEnd: TextFlowNodeData['onResizeEnd'];
  // WebPage ノード
  handleNavigated: WebPageNodeProps['onNavigated'];
  handleTitleUpdated: WebPageNodeProps['onTitleUpdated'];
  handleWebviewCreated: WebPageNodeProps['onWebviewCreated'];
  handleWebviewDestroyed: WebPageNodeProps['onWebviewDestroyed'];
  handleWebviewLoaded: WebPageNodeProps['onWebviewLoaded'];
  handleScreenshotPresented: WebPageNodeProps['onScreenshotPresented'];
  handleScrollEnded: WebPageNodeProps['onScrollEnded'];
  handlePositionCorrectionAnimationComplete: WebPageNodeProps['onPositionCorrectionAnimationComplete'];
  handleWebPageResizeStart: WebPageFlowNodeData['onResizeStart'];
  handleWebPageResize: WebPageFlowNodeData['onResize'];
  handleWebPageResizeEnd: WebPageFlowNodeData['onResizeEnd'];
  // WebPage ツールバー段（nodeId を渡して呼び出し側で wrap される）
  handleGoBack: (nodeId: string) => void;
  handleGoForward: (nodeId: string) => void;
  handleReloadWebNode: (nodeId: string) => void;
  handlePinWebNodeUrl: (nodeId: string) => void;
  handleResizePreset: (nodeId: string, width: number, height: number) => void;
  handleUrlSubmit: (nodeId: string, url: string) => void;
  handleChangeUrlSubmit: (nodeId: string, url: string) => void;
  handleTitlePointerDown: (nodeId: string, event: React.PointerEvent) => void;
}

/**
 * ストアのノード配列と各種ランタイム状態（表示モード/スクショ/ナビ状態/リサイズ/ドラッグ位置）から
 * React Flow の controlled mode 用ノード配列を構築するフック。
 * displayModes/screenshotUrls/navStates/resizingSize の変化に追従するため useMemo 依存に含める。
 */
export function useSiteboardFlowNodes({
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
  autoEditStickyNoteId,
  editingTextNodeId,
  editingUrlNodeId,
  getZoom,
  handleNodeActivate,
  handleNodeContextMenu,
  handleStickyNoteContentChange,
  handleStickyNoteAutoHeightChange,
  handleStickyNoteStyleChange,
  handleStickyNoteResize,
  handleStickyNoteResizeEnd,
  handleTextNodeStartEditing,
  handleTextNodeStopEditing,
  handleTextNodeAutoHeightChange,
  handleTextNodeAutoWidthChange,
  handleTextNodeStyleChange,
  handleTextNodeWidthModeChange,
  handleTextNodeResize,
  handleTextNodeResizeEnd,
  handleNavigated,
  handleTitleUpdated,
  handleWebviewCreated,
  handleWebviewDestroyed,
  handleWebviewLoaded,
  handleScreenshotPresented,
  handleScrollEnded,
  handlePositionCorrectionAnimationComplete,
  handleWebPageResizeStart,
  handleWebPageResize,
  handleWebPageResizeEnd,
  handleGoBack,
  handleGoForward,
  handleReloadWebNode,
  handlePinWebNodeUrl,
  handleResizePreset,
  handleUrlSubmit,
  handleChangeUrlSubmit,
  handleTitlePointerDown,
}: UseSiteboardFlowNodesParams): Node[] {
  return useMemo((): Node[] => {
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
}
