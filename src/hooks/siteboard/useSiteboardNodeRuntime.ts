import { toast } from '@heroui/react';
import { useCallback, useMemo, useRef, useState } from 'react';

import type { NodeResizeDirection } from '@/hooks/siteboard/types';
import type { NavigationState } from '@/lib/tauri-bridge';
import { webviewApi } from '@/lib/tauri-bridge';
import type { BoardNode } from '@/types';

interface UseSiteboardNodeRuntimeParams {
  activeId: string;
  nodes: BoardNode[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
  startDrag: (e: React.MouseEvent, nodeId: string) => void;
  startResize: (e: React.MouseEvent, nodeId: string, direction: NodeResizeDirection) => void;
  updateWebNodeUrl: (projectId: string, nodeId: string, url: string, title: string) => void;
  updateNodeTitle: (projectId: string, nodeId: string, title: string) => void;
  removeNode: (projectId: string, nodeId: string) => void;
  setWebNodeWebviewLabel: (projectId: string, nodeId: string, label: string) => void;
  clearWebNodeWebviewLabel: (projectId: string, nodeId: string) => void;
  setWebNodeUrl: (projectId: string, nodeId: string, url: string) => void;
  pinWebNodeUrl: (projectId: string, nodeId: string) => void;
  updateNodeSize: (projectId: string, nodeId: string, width: number, height: number) => void;
  updateNodeSizeWithoutHistory: (
    projectId: string,
    nodeId: string,
    width: number,
    height: number,
  ) => void;
  updateStickyNoteContent: (projectId: string, nodeId: string, content: string) => void;
  cycleStickyNoteColor: (projectId: string, nodeId: string) => void;
  computeDisplayModes: () => void;
  captureScreenshot: (nodeId: string) => Promise<boolean>;
}

export function useSiteboardNodeRuntime({
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
}: UseSiteboardNodeRuntimeParams) {
  const [navStates, setNavStates] = useState<Record<string, NavigationState>>({});

  const isGoingBackRef = useRef(false);
  const isGoingForwardRef = useRef(false);
  const navigatedCountRef = useRef<Record<string, number>>({});

  const visibleNavStates = useMemo(() => {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const next: Record<string, NavigationState> = {};
    for (const [nodeId, value] of Object.entries(navStates)) {
      if (nodeIds.has(nodeId)) {
        next[nodeId] = value;
      }
    }
    return next;
  }, [navStates, nodes]);

  const refreshNavigationState = useCallback(async (nodeId: string) => {
    const state = await webviewApi.getNavigationState(nodeId);
    setNavStates((prev) => {
      const existing = prev[nodeId];
      const merged: NavigationState = {
        can_go_back: state.can_go_back || (existing?.can_go_back ?? false),
        can_go_forward: state.can_go_forward || (existing?.can_go_forward ?? false),
      };
      if (
        existing &&
        existing.can_go_back === merged.can_go_back &&
        existing.can_go_forward === merged.can_go_forward
      ) {
        return prev;
      }
      return { ...prev, [nodeId]: merged };
    });
  }, []);

  const removeNavigationState = useCallback((nodeId: string) => {
    setNavStates((prev) => {
      if (!(nodeId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  }, []);

  const handleGoBack = useCallback(
    (nodeId: string) => {
      isGoingBackRef.current = true;
      void webviewApi.goBack(nodeId);
      setNavStates((prev) => ({
        ...prev,
        [nodeId]: {
          can_go_back: prev[nodeId]?.can_go_back ?? false,
          can_go_forward: true,
        },
      }));
      setTimeout(() => {
        isGoingBackRef.current = false;
        void refreshNavigationState(nodeId);
      }, 300);
    },
    [refreshNavigationState],
  );

  const handleGoForward = useCallback(
    (nodeId: string) => {
      isGoingForwardRef.current = true;
      void webviewApi.goForward(nodeId);
      setNavStates((prev) => ({
        ...prev,
        [nodeId]: {
          can_go_back: true,
          can_go_forward: prev[nodeId]?.can_go_forward ?? false,
        },
      }));
      setTimeout(() => {
        isGoingForwardRef.current = false;
        void refreshNavigationState(nodeId);
      }, 300);
    },
    [refreshNavigationState],
  );

  const handleNavigated = useCallback(
    (nodeId: string, url: string, title: string) => {
      updateWebNodeUrl(activeId, nodeId, url, title);
      setTimeout(() => void captureScreenshot(nodeId), 1000);

      const count = (navigatedCountRef.current[nodeId] ?? 0) + 1;
      navigatedCountRef.current[nodeId] = count;

      if (count >= 2 && !isGoingBackRef.current && !isGoingForwardRef.current) {
        setNavStates((prev) => ({
          ...prev,
          [nodeId]: { can_go_back: true, can_go_forward: false },
        }));
      }

      void refreshNavigationState(nodeId);
      setTimeout(() => void refreshNavigationState(nodeId), 300);
    },
    [activeId, captureScreenshot, refreshNavigationState, updateWebNodeUrl],
  );

  const handleTitleUpdated = useCallback(
    (nodeId: string, title: string) => {
      if (!title) return;
      updateNodeTitle(activeId, nodeId, title);
      void refreshNavigationState(nodeId);
    },
    [activeId, refreshNavigationState, updateNodeTitle],
  );

  const handleDragStart = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      onSelectNode(nodeId);
      startDrag(e, nodeId);
    },
    [onSelectNode, startDrag],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, nodeId: string, direction: NodeResizeDirection) => {
      startResize(e, nodeId, direction);
    },
    [startResize],
  );

  const handleWebviewCreated = useCallback(
    (nodeId: string, label: string) => {
      setWebNodeWebviewLabel(activeId, nodeId, label);
      requestAnimationFrame(() => computeDisplayModes());
      void refreshNavigationState(nodeId);
    },
    [activeId, computeDisplayModes, refreshNavigationState, setWebNodeWebviewLabel],
  );

  const handleWebviewDestroyed = useCallback(
    (nodeId: string) => {
      clearWebNodeWebviewLabel(activeId, nodeId);
    },
    [activeId, clearWebNodeWebviewLabel],
  );

  const handleWebviewLoaded = useCallback(
    (nodeId: string) => {
      void captureScreenshot(nodeId);
      void refreshNavigationState(nodeId);
    },
    [captureScreenshot, refreshNavigationState],
  );

  const handleScrollEnded = useCallback(
    (nodeId: string) => {
      void captureScreenshot(nodeId);
    },
    [captureScreenshot],
  );

  const handleRemoveNode = useCallback(
    (nodeId: string) => {
      if (selectedNodeId === nodeId) {
        onClearSelection();
      }
      removeNavigationState(nodeId);
      delete navigatedCountRef.current[nodeId];
      removeNode(activeId, nodeId);
    },
    [activeId, onClearSelection, removeNavigationState, removeNode, selectedNodeId],
  );

  const handleReloadWebNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;
      void webviewApi.reload(nodeId, node.addedUrl ?? node.url);
    },
    [nodes],
  );

  const handlePinWebNodeUrl = useCallback(
    (nodeId: string) => {
      pinWebNodeUrl(activeId, nodeId);
      toast.success('表示中のページで固定しました');
    },
    [activeId, pinWebNodeUrl],
  );

  const handleUrlSubmit = useCallback(
    (nodeId: string, url: string) => {
      setWebNodeUrl(activeId, nodeId, url);
    },
    [activeId, setWebNodeUrl],
  );

  const handleResizePreset = useCallback(
    (nodeId: string, width: number, height: number) => {
      updateNodeSize(activeId, nodeId, width, height);
    },
    [activeId, updateNodeSize],
  );

  const handleStickyNoteContentChange = useCallback(
    (nodeId: string, content: string) => {
      updateStickyNoteContent(activeId, nodeId, content);
    },
    [activeId, updateStickyNoteContent],
  );

  const handleStickyNoteColorCycle = useCallback(
    (nodeId: string) => {
      cycleStickyNoteColor(activeId, nodeId);
    },
    [activeId, cycleStickyNoteColor],
  );

  const handleStickyNoteAutoHeightChange = useCallback(
    (nodeId: string, height: number) => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node || node.height === height) return;
      updateNodeSizeWithoutHistory(activeId, nodeId, node.width, height);
    },
    [activeId, nodes, updateNodeSizeWithoutHistory],
  );

  return {
    handleDragStart,
    handleGoBack,
    handleGoForward,
    handleNavigated,
    handlePinWebNodeUrl,
    handleReloadWebNode,
    handleRemoveNode,
    handleResizePreset,
    handleResizeStart,
    handleScrollEnded,
    handleStickyNoteAutoHeightChange,
    handleStickyNoteColorCycle,
    handleStickyNoteContentChange,
    handleTitleUpdated,
    handleUrlSubmit,
    handleWebviewCreated,
    handleWebviewDestroyed,
    handleWebviewLoaded,
    navStates: visibleNavStates,
  };
}
