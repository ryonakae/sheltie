import { toast } from '@heroui/react';
import { useCallback, useMemo, useState } from 'react';

import type { NodeResizeDirection } from '@/renderer/hooks/siteboard/types';
import type { NavigationState } from '@/renderer/lib/tauri-bridge';
import { webviewApi } from '@/renderer/lib/tauri-bridge';
import type { Page } from '@/renderer/types/tab';

interface UseSiteboardNodeRuntimeParams {
  activeId: string;
  pages: Page[];
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  onClearSelection: () => void;
  startDrag: (e: React.MouseEvent, pageId: string) => void;
  startResize: (e: React.MouseEvent, pageId: string, direction: NodeResizeDirection) => void;
  updatePageUrl: (projectId: string, pageId: string, url: string, title: string) => void;
  updatePageTitle: (projectId: string, pageId: string, title: string) => void;
  removePage: (projectId: string, pageId: string) => void;
  setPageWebviewLabel: (projectId: string, pageId: string, label: string) => void;
  setPageUrl: (projectId: string, pageId: string, url: string) => void;
  pinPageUrl: (projectId: string, pageId: string) => void;
  updatePageSize: (projectId: string, pageId: string, width: number, height: number) => void;
  updateStickyNoteContent: (projectId: string, pageId: string, content: string) => void;
  cycleStickyNoteColor: (projectId: string, pageId: string) => void;
  computeDisplayModes: () => void;
  captureScreenshot: (pageId: string) => Promise<void>;
}

export function useSiteboardNodeRuntime({
  activeId,
  pages,
  selectedPageId,
  onSelectPage,
  onClearSelection,
  startDrag,
  startResize,
  updatePageUrl,
  updatePageTitle,
  removePage,
  setPageWebviewLabel,
  setPageUrl,
  pinPageUrl,
  updatePageSize,
  updateStickyNoteContent,
  cycleStickyNoteColor,
  computeDisplayModes,
  captureScreenshot,
}: UseSiteboardNodeRuntimeParams) {
  const [navStates, setNavStates] = useState<Record<string, NavigationState>>({});

  const visibleNavStates = useMemo(() => {
    const pageIds = new Set(pages.map((page) => page.id));
    const next: Record<string, NavigationState> = {};
    for (const [pageId, value] of Object.entries(navStates)) {
      if (pageIds.has(pageId)) {
        next[pageId] = value;
      }
    }
    return next;
  }, [navStates, pages]);

  const refreshNavigationState = useCallback(async (pageId: string) => {
    const state = await webviewApi.getNavigationState(pageId);
    setNavStates((prev) => {
      const existing = prev[pageId];
      if (
        existing &&
        existing.can_go_back === state.can_go_back &&
        existing.can_go_forward === state.can_go_forward
      ) {
        return prev;
      }
      return { ...prev, [pageId]: state };
    });
  }, []);

  const removeNavigationState = useCallback((pageId: string) => {
    setNavStates((prev) => {
      if (!(pageId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[pageId];
      return next;
    });
  }, []);

  const handleGoBack = useCallback((pageId: string) => {
    void webviewApi.goBack(pageId);
  }, []);

  const handleGoForward = useCallback((pageId: string) => {
    void webviewApi.goForward(pageId);
  }, []);

  const handleNavigated = useCallback(
    (pageId: string, url: string, title: string) => {
      updatePageUrl(activeId, pageId, url, title);
      setTimeout(() => void captureScreenshot(pageId), 500);
      void refreshNavigationState(pageId);
    },
    [activeId, captureScreenshot, refreshNavigationState, updatePageUrl],
  );

  const handleTitleUpdated = useCallback(
    (pageId: string, title: string) => {
      if (!title) return;
      updatePageTitle(activeId, pageId, title);
      void refreshNavigationState(pageId);
    },
    [activeId, refreshNavigationState, updatePageTitle],
  );

  const handleDragStart = useCallback(
    (e: React.MouseEvent, pageId: string) => {
      onSelectPage(pageId);
      startDrag(e, pageId);
    },
    [onSelectPage, startDrag],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, pageId: string, direction: NodeResizeDirection) => {
      startResize(e, pageId, direction);
    },
    [startResize],
  );

  const handleWebviewCreated = useCallback(
    (pageId: string, label: string) => {
      setPageWebviewLabel(activeId, pageId, label);
      requestAnimationFrame(() => computeDisplayModes());
      void refreshNavigationState(pageId);
    },
    [activeId, computeDisplayModes, refreshNavigationState, setPageWebviewLabel],
  );

  const handleWebviewLoaded = useCallback(
    (pageId: string) => {
      void captureScreenshot(pageId);
      void refreshNavigationState(pageId);
    },
    [captureScreenshot, refreshNavigationState],
  );

  const handleRemovePage = useCallback(
    (pageId: string) => {
      if (selectedPageId === pageId) {
        onClearSelection();
      }
      removeNavigationState(pageId);
      removePage(activeId, pageId);
    },
    [activeId, onClearSelection, removeNavigationState, removePage, selectedPageId],
  );

  const handleReloadPage = useCallback(
    (pageId: string) => {
      const page = pages.find((p) => p.id === pageId);
      if (!page) return;
      void webviewApi.reload(pageId, page.addedUrl ?? page.url);
    },
    [pages],
  );

  const handlePinPageUrl = useCallback(
    (pageId: string) => {
      pinPageUrl(activeId, pageId);
      toast.success('表示中のページで固定しました');
    },
    [activeId, pinPageUrl],
  );

  const handleUrlSubmit = useCallback(
    (pageId: string, url: string) => {
      setPageUrl(activeId, pageId, url);
    },
    [activeId, setPageUrl],
  );

  const handleResizePreset = useCallback(
    (pageId: string, width: number, height: number) => {
      updatePageSize(activeId, pageId, width, height);
    },
    [activeId, updatePageSize],
  );

  const handleStickyNoteContentChange = useCallback(
    (pageId: string, content: string) => {
      updateStickyNoteContent(activeId, pageId, content);
    },
    [activeId, updateStickyNoteContent],
  );

  const handleStickyNoteColorCycle = useCallback(
    (pageId: string) => {
      cycleStickyNoteColor(activeId, pageId);
    },
    [activeId, cycleStickyNoteColor],
  );

  const handleStickyNoteAutoHeightChange = useCallback(
    (pageId: string, height: number) => {
      const page = pages.find((p) => p.id === pageId);
      if (!page || page.height === height) return;
      updatePageSize(activeId, pageId, page.width, height);
    },
    [activeId, pages, updatePageSize],
  );

  return {
    handleDragStart,
    handleGoBack,
    handleGoForward,
    handleNavigated,
    handlePinPageUrl,
    handleReloadPage,
    handleRemovePage,
    handleResizePreset,
    handleResizeStart,
    handleStickyNoteAutoHeightChange,
    handleStickyNoteColorCycle,
    handleStickyNoteContentChange,
    handleTitleUpdated,
    handleUrlSubmit,
    handleWebviewCreated,
    handleWebviewLoaded,
    navStates: visibleNavStates,
  };
}
