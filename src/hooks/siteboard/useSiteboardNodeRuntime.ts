import { toast } from '@heroui/react';
import { useCallback, useMemo, useRef, useState } from 'react';

import type { NodeResizeDirection } from '@/hooks/siteboard/types';
import type { NavigationState } from '@/lib/tauri-bridge';
import { webviewApi } from '@/lib/tauri-bridge';
import type { Page } from '@/types';

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

  // goBack/goForward 操作中フラグ。操作中は handleNavigated の楽観的更新をスキップする
  const isGoingBackRef = useRef(false);
  const isGoingForwardRef = useRef(false);
  // handleNavigated の呼び出し回数（pageId 別）。初回は初期 URL ロードのためスキップ
  const navigatedCountRef = useRef<Record<string, number>>({});

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
      // ネイティブ API が true を返した場合はそれを採用。
      // false の場合は既存の楽観的更新値を維持（SPA では canGoBack/canGoForward が常に false のため）
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
      return { ...prev, [pageId]: merged };
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

  const handleGoBack = useCallback(
    (pageId: string) => {
      isGoingBackRef.current = true;
      void webviewApi.goBack(pageId);
      // 楽観的更新: 戻った後は少なくとも1つ進める
      setNavStates((prev) => ({
        ...prev,
        [pageId]: {
          can_go_back: prev[pageId]?.can_go_back ?? false,
          can_go_forward: true,
        },
      }));
      setTimeout(() => {
        isGoingBackRef.current = false;
        void refreshNavigationState(pageId);
      }, 300);
    },
    [refreshNavigationState],
  );

  const handleGoForward = useCallback(
    (pageId: string) => {
      isGoingForwardRef.current = true;
      void webviewApi.goForward(pageId);
      // 楽観的更新: 進んだ後は少なくとも1つ戻れる
      setNavStates((prev) => ({
        ...prev,
        [pageId]: {
          can_go_back: true,
          can_go_forward: prev[pageId]?.can_go_forward ?? false,
        },
      }));
      setTimeout(() => {
        isGoingForwardRef.current = false;
        void refreshNavigationState(pageId);
      }, 300);
    },
    [refreshNavigationState],
  );

  const handleNavigated = useCallback(
    (pageId: string, url: string, title: string) => {
      updatePageUrl(activeId, pageId, url, title);
      setTimeout(() => void captureScreenshot(pageId), 1000);

      const count = (navigatedCountRef.current[pageId] ?? 0) + 1;
      navigatedCountRef.current[pageId] = count;

      // 初回は初期 URL ロードなので楽観的更新をスキップ。
      // goBack/goForward 操作中も各ハンドラー側で更新済みのためスキップ
      if (count >= 2 && !isGoingBackRef.current && !isGoingForwardRef.current) {
        setNavStates((prev) => ({
          ...prev,
          [pageId]: { can_go_back: true, can_go_forward: false },
        }));
      }

      void refreshNavigationState(pageId);
      setTimeout(() => void refreshNavigationState(pageId), 300);
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

  const handleScrollEnded = useCallback(
    (pageId: string) => {
      void captureScreenshot(pageId);
    },
    [captureScreenshot],
  );

  const handleRemovePage = useCallback(
    (pageId: string) => {
      if (selectedPageId === pageId) {
        onClearSelection();
      }
      removeNavigationState(pageId);
      delete navigatedCountRef.current[pageId];
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
    handleScrollEnded,
    handleWebviewCreated,
    handleWebviewLoaded,
    navStates: visibleNavStates,
  };
}
