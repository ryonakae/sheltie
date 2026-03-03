import { toast } from '@heroui/react';
import { useCallback, useState } from 'react';

import type { NodeResizeDirection } from '@/renderer/components/Node/PageNode';
import type { NavigationState } from '@/renderer/lib/tauri-bridge';
import { webviewApi } from '@/renderer/lib/tauri-bridge';
import type { Page } from '@/renderer/types/tab';

interface UseSiteboardNodeRuntimeParams {
  activeId: string;
  pages: Page[];
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  onClearSelection: () => void;
  zoomRef: React.RefObject<number>;
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
  cleanupPageArtifacts: (pageId: string) => void;
}

export function useSiteboardNodeRuntime({
  activeId,
  pages,
  selectedPageId,
  onSelectPage,
  onClearSelection,
  zoomRef,
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
  cleanupPageArtifacts,
}: UseSiteboardNodeRuntimeParams) {
  const [pageTitles, setPageTitles] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const page of pages) {
      initial[page.id] = page.title;
    }
    return initial;
  });

  const [navStates, setNavStates] = useState<Record<string, NavigationState>>({});

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

  const handleGoBack = useCallback((pageId: string) => {
    void webviewApi.goBack(pageId);
  }, []);

  const handleGoForward = useCallback((pageId: string) => {
    void webviewApi.goForward(pageId);
  }, []);

  const handleNavigated = useCallback(
    (pageId: string, url: string, title: string) => {
      updatePageUrl(activeId, pageId, url, title);
      if (title) {
        setPageTitles((prev) => ({ ...prev, [pageId]: title }));
      }

      if (Math.abs(zoomRef.current - 1.0) >= 0.005) {
        void webviewApi.setZoom(pageId, zoomRef.current);
      }

      setTimeout(() => void captureScreenshot(pageId), 500);
      void refreshNavigationState(pageId);
    },
    [activeId, captureScreenshot, refreshNavigationState, updatePageUrl, zoomRef],
  );

  const handleTitleUpdated = useCallback(
    (pageId: string, title: string) => {
      if (!title) return;
      updatePageTitle(activeId, pageId, title);
      setPageTitles((prev) => ({ ...prev, [pageId]: title }));
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
      void webviewApi.setZoom(pageId, zoomRef.current);
      requestAnimationFrame(() => computeDisplayModes());
      void refreshNavigationState(pageId);
    },
    [activeId, computeDisplayModes, refreshNavigationState, setPageWebviewLabel, zoomRef],
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
      cleanupPageArtifacts(pageId);
      removePage(activeId, pageId);
    },
    [activeId, cleanupPageArtifacts, onClearSelection, removePage, selectedPageId],
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
    handleStickyNoteColorCycle,
    handleStickyNoteContentChange,
    handleTitleUpdated,
    handleUrlSubmit,
    handleWebviewCreated,
    handleWebviewLoaded,
    navStates,
    pageTitles,
  };
}
