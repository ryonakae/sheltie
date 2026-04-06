import { toast } from '@heroui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { NavigationState } from '@/lib/tauri-bridge';
import { webviewApi } from '@/lib/tauri-bridge';
import type { BoardNode } from '@/types';

interface UseSiteboardNodeRuntimeParams {
  nodes: BoardNode[];
  webviewLabelsByNodeId: Record<string, string>;
  selectedNodeId: string | null;
  onClearSelection: () => void;
  updateWebNodeUrl: (nodeId: string, url: string, title: string) => void;
  updateNodeTitle: (nodeId: string, title: string) => void;
  removeNode: (nodeId: string) => void;
  setWebNodeWebviewLabel: (nodeId: string, label: string) => void;
  clearWebNodeWebviewLabel: (nodeId: string) => void;
  setWebNodeUrl: (nodeId: string, url: string) => void;
  pinWebNodeUrl: (nodeId: string) => void;
  updateNodeSize: (nodeId: string, width: number, height: number) => void;
  updateNodeSizeWithoutHistory: (nodeId: string, width: number, height: number) => void;
  updateStickyNoteContent: (nodeId: string, content: string) => void;
  cycleStickyNoteColor: (nodeId: string) => void;
  captureScreenshot: (nodeId: string) => Promise<boolean>;
}

interface NavigationRuntimeEntry {
  currentUrl: string | null;
  hasCommittedNavigation: boolean;
  nativeState: NavigationState;
  backDepth: number;
  forwardDepth: number;
}

export function useSiteboardNodeRuntime({
  nodes,
  webviewLabelsByNodeId,
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
}: UseSiteboardNodeRuntimeParams) {
  const [navStates, setNavStates] = useState<Record<string, NavigationState>>({});

  const navigationRuntimeRef = useRef<Record<string, NavigationRuntimeEntry>>({});
  const pendingActionRef = useRef<Record<string, 'back' | 'forward' | undefined>>({});
  const captureTimerRef = useRef<Record<string, number>>({});
  const refreshTimerRef = useRef<Record<string, number>>({});

  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const getLiveWebviewLabel = useCallback(
    (nodeId: string, command: string, labelOverride?: string): string | null => {
      const label = labelOverride ?? webviewLabelsByNodeId[nodeId];
      if (!label && import.meta.env.DEV) {
        console.warn(`[useSiteboardNodeRuntime] ${command}: WebView label がありません`, {
          nodeId,
        });
      }
      return label ?? null;
    },
    [webviewLabelsByNodeId],
  );
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

  const ensureNavigationRuntime = useCallback(
    (nodeId: string): NavigationRuntimeEntry => {
      const existing = navigationRuntimeRef.current[nodeId];
      if (existing) {
        return existing;
      }

      const node = nodesById.get(nodeId);
      const created: NavigationRuntimeEntry = {
        currentUrl: node?.url || null,
        hasCommittedNavigation: Boolean(node?.url),
        nativeState: { can_go_back: false, can_go_forward: false },
        backDepth: 0,
        forwardDepth: 0,
      };
      navigationRuntimeRef.current[nodeId] = created;
      return created;
    },
    [nodesById],
  );

  const clearCaptureTimer = useCallback((nodeId: string) => {
    const timerId = captureTimerRef.current[nodeId];
    if (timerId === undefined) return;
    window.clearTimeout(timerId);
    delete captureTimerRef.current[nodeId];
  }, []);

  const clearRefreshTimer = useCallback((nodeId: string) => {
    const timerId = refreshTimerRef.current[nodeId];
    if (timerId === undefined) return;
    window.clearTimeout(timerId);
    delete refreshTimerRef.current[nodeId];
  }, []);

  const clearNodeRuntime = useCallback(
    (nodeId: string) => {
      clearCaptureTimer(nodeId);
      clearRefreshTimer(nodeId);
      delete navigationRuntimeRef.current[nodeId];
      delete pendingActionRef.current[nodeId];
    },
    [clearCaptureTimer, clearRefreshTimer],
  );

  const clearAllRuntimeTimers = useCallback(() => {
    for (const nodeId of Object.keys(captureTimerRef.current)) {
      clearCaptureTimer(nodeId);
    }
    for (const nodeId of Object.keys(refreshTimerRef.current)) {
      clearRefreshTimer(nodeId);
    }
  }, [clearCaptureTimer, clearRefreshTimer]);

  const updateResolvedNavigationState = useCallback(
    (nodeId: string) => {
      const runtime = ensureNavigationRuntime(nodeId);
      const nextState: NavigationState = {
        can_go_back: runtime.nativeState.can_go_back || runtime.backDepth > 0,
        can_go_forward: runtime.nativeState.can_go_forward || runtime.forwardDepth > 0,
      };

      setNavStates((prev) => {
        const existing = prev[nodeId];
        if (
          existing &&
          existing.can_go_back === nextState.can_go_back &&
          existing.can_go_forward === nextState.can_go_forward
        ) {
          return prev;
        }
        return { ...prev, [nodeId]: nextState };
      });
    },
    [ensureNavigationRuntime],
  );

  const refreshNavigationState = useCallback(
    async (nodeId: string, labelOverride?: string) => {
      const label = getLiveWebviewLabel(nodeId, 'getNavigationState', labelOverride);
      const state = label
        ? await webviewApi.getNavigationState(label)
        : { can_go_back: false, can_go_forward: false };
      const runtime = ensureNavigationRuntime(nodeId);
      runtime.nativeState = state;
      updateResolvedNavigationState(nodeId);
    },
    [ensureNavigationRuntime, getLiveWebviewLabel, updateResolvedNavigationState],
  );

  const scheduleRefreshNavigationState = useCallback(
    (nodeId: string, delayMs = 300) => {
      clearRefreshTimer(nodeId);
      refreshTimerRef.current[nodeId] = window.setTimeout(() => {
        delete refreshTimerRef.current[nodeId];
        pendingActionRef.current[nodeId] = undefined;
        void refreshNavigationState(nodeId);
      }, delayMs);
    },
    [clearRefreshTimer, refreshNavigationState],
  );

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
      const label = getLiveWebviewLabel(nodeId, 'goBack');
      if (!label) return;
      const runtime = ensureNavigationRuntime(nodeId);
      pendingActionRef.current[nodeId] = 'back';
      runtime.forwardDepth = Math.max(runtime.forwardDepth, 1);
      updateResolvedNavigationState(nodeId);
      void webviewApi.goBack(label);
      scheduleRefreshNavigationState(nodeId);
    },
    [
      ensureNavigationRuntime,
      getLiveWebviewLabel,
      scheduleRefreshNavigationState,
      updateResolvedNavigationState,
    ],
  );

  const handleGoForward = useCallback(
    (nodeId: string) => {
      const label = getLiveWebviewLabel(nodeId, 'goForward');
      if (!label) return;
      const runtime = ensureNavigationRuntime(nodeId);
      pendingActionRef.current[nodeId] = 'forward';
      runtime.backDepth = Math.max(runtime.backDepth, 1);
      updateResolvedNavigationState(nodeId);
      void webviewApi.goForward(label);
      scheduleRefreshNavigationState(nodeId);
    },
    [
      ensureNavigationRuntime,
      getLiveWebviewLabel,
      scheduleRefreshNavigationState,
      updateResolvedNavigationState,
    ],
  );

  const handleNavigated = useCallback(
    (nodeId: string, url: string, title: string) => {
      updateWebNodeUrl(nodeId, url, title);

      clearCaptureTimer(nodeId);
      captureTimerRef.current[nodeId] = window.setTimeout(() => {
        delete captureTimerRef.current[nodeId];
        void captureScreenshot(nodeId);
      }, 1000);

      const runtime = ensureNavigationRuntime(nodeId);
      const pendingAction = pendingActionRef.current[nodeId];
      const previousUrl = runtime.currentUrl;

      if (!runtime.hasCommittedNavigation) {
        runtime.currentUrl = url;
        runtime.hasCommittedNavigation = true;
      } else if (pendingAction === 'back') {
        runtime.backDepth = Math.max(0, runtime.backDepth - 1);
        runtime.forwardDepth += 1;
        runtime.currentUrl = url;
      } else if (pendingAction === 'forward') {
        runtime.backDepth += 1;
        runtime.forwardDepth = Math.max(0, runtime.forwardDepth - 1);
        runtime.currentUrl = url;
      } else if (previousUrl !== url) {
        runtime.backDepth += 1;
        runtime.forwardDepth = 0;
        runtime.currentUrl = url;
      }

      pendingActionRef.current[nodeId] = undefined;
      updateResolvedNavigationState(nodeId);
      void refreshNavigationState(nodeId);
      scheduleRefreshNavigationState(nodeId);
    },
    [
      captureScreenshot,
      clearCaptureTimer,
      ensureNavigationRuntime,
      refreshNavigationState,
      scheduleRefreshNavigationState,
      updateResolvedNavigationState,
      updateWebNodeUrl,
    ],
  );

  const handleTitleUpdated = useCallback(
    (nodeId: string, title: string) => {
      if (!title) return;
      updateNodeTitle(nodeId, title);
      void refreshNavigationState(nodeId);
    },
    [refreshNavigationState, updateNodeTitle],
  );

  const handleWebviewCreated = useCallback(
    (nodeId: string, label: string) => {
      setWebNodeWebviewLabel(nodeId, label);
      ensureNavigationRuntime(nodeId);
      void refreshNavigationState(nodeId, label);
    },
    [ensureNavigationRuntime, refreshNavigationState, setWebNodeWebviewLabel],
  );

  const handleWebviewDestroyed = useCallback(
    (nodeId: string) => {
      clearWebNodeWebviewLabel(nodeId);
      clearRefreshTimer(nodeId);
      pendingActionRef.current[nodeId] = undefined;
    },
    [clearRefreshTimer, clearWebNodeWebviewLabel],
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
      clearNodeRuntime(nodeId);
      removeNode(nodeId);
    },
    [clearNodeRuntime, onClearSelection, removeNavigationState, removeNode, selectedNodeId],
  );

  const handleReloadWebNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;
      const label = getLiveWebviewLabel(nodeId, 'reload');
      if (!label) return;
      void webviewApi.reload(label, node.addedUrl ?? node.url);
    },
    [getLiveWebviewLabel, nodes],
  );

  const handlePinWebNodeUrl = useCallback(
    (nodeId: string) => {
      pinWebNodeUrl(nodeId);
      toast.success('表示中のページで固定しました');
    },
    [pinWebNodeUrl],
  );

  const handleUrlSubmit = useCallback(
    (nodeId: string, url: string) => {
      setWebNodeUrl(nodeId, url);
    },
    [setWebNodeUrl],
  );

  const handleResizePreset = useCallback(
    (nodeId: string, width: number, height: number) => {
      updateNodeSize(nodeId, width, height);
    },
    [updateNodeSize],
  );

  const handleStickyNoteContentChange = useCallback(
    (nodeId: string, content: string) => {
      updateStickyNoteContent(nodeId, content);
    },
    [updateStickyNoteContent],
  );

  const handleStickyNoteColorCycle = useCallback(
    (nodeId: string) => {
      cycleStickyNoteColor(nodeId);
    },
    [cycleStickyNoteColor],
  );

  const handleStickyNoteAutoHeightChange = useCallback(
    (nodeId: string, height: number) => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node || node.height === height) return;
      updateNodeSizeWithoutHistory(nodeId, node.width, height);
    },
    [nodes, updateNodeSizeWithoutHistory],
  );

  useEffect(() => {
    const nodeIds = new Set(nodes.map((node) => node.id));

    for (const nodeId of Object.keys(navigationRuntimeRef.current)) {
      if (!nodeIds.has(nodeId)) {
        clearNodeRuntime(nodeId);
      }
    }
  }, [clearNodeRuntime, nodes]);

  useEffect(() => {
    return () => {
      clearAllRuntimeTimers();
    };
  }, [clearAllRuntimeTimers]);

  return {
    handleGoBack,
    handleGoForward,
    handleNavigated,
    handlePinWebNodeUrl,
    handleReloadWebNode,
    handleRemoveNode,
    handleResizePreset,
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
