import { useCallback, useEffect, useRef, useState } from 'react';

import { useShallow } from 'zustand/react/shallow';

import { selectActiveProject, useProjectStore } from '../../store/tab-store';
import { useArtboardPan } from '../../hooks/useArtboardPan';
import { useArtboardZoom } from '../../hooks/useArtboardZoom';
import { usePageDrag } from '../../hooks/usePageDrag';
import { usePageResize } from '../../hooks/usePageResize';
import { calcAllPageBounds, calcArtboardLayout } from '../../utils/page-bounds';
import { InteractionOverlay } from './InteractionOverlay';
import { PageFrame, type ResizeDirection } from './PageFrame';

export function Artboard() {
  const activeProject = useProjectStore(selectActiveProject);
  const activeId = useProjectStore((s) => s.activeId);
  const {
    updateViewport,
    updatePagePosition,
    updatePageSize,
    updatePageUrl,
    removePage,
    bringPageToFront,
  } = useProjectStore(
    useShallow((s) => ({
      updateViewport: s.updateViewport,
      updatePagePosition: s.updatePagePosition,
      updatePageSize: s.updatePageSize,
      updatePageUrl: s.updatePageUrl,
      removePage: s.removePage,
      bringPageToFront: s.bringPageToFront,
    })),
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // zoom と pan を ref で管理（DOM 直接操作用）
  const zoomRef = useRef(activeProject?.viewport.zoom ?? 1);
  const panXRef = useRef(activeProject?.viewport.panX ?? 0);
  const panYRef = useRef(activeProject?.viewport.panY ?? 0);

  // アクティブページ ID（最前面表示・ボーダー制御用）
  const [activePageId, setActivePageId] = useState<string | null>(null);

  // ページタイトルのローカル状態（IPC ナビゲーションイベントで更新）
  const [pageTitles, setPageTitles] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const page of activeProject?.pages ?? []) {
      initial[page.id] = page.title;
    }
    return initial;
  });

  // 操作中フラグ（InteractionOverlay の表示制御）
  const [interactionCursor, setInteractionCursor] = useState<string | null>(null);

  const pages = activeProject?.pages ?? [];

  // WebContentsView の bounds を一括更新する関数
  const syncBounds = useCallback(() => {
    if (!containerRef.current) return;
    const layout = calcArtboardLayout(containerRef.current);
    const updates = calcAllPageBounds(pages, {
      zoom: zoomRef.current,
      panX: panXRef.current,
      panY: panYRef.current,
    });
    window.pageViewApi.batchUpdateBounds(updates, zoomRef.current);
    window.pageViewApi.updateArtboardLayout(layout);
  }, [pages]);

  // RAF を使って毎フレーム 1 回だけ bounds を同期する
  const rafRef = useRef<number | null>(null);
  const scheduleSyncBounds = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      syncBounds();
    });
  }, [syncBounds]);

  const handleInteractionChange = useCallback((active: boolean, cursor = 'default') => {
    setInteractionCursor(active ? cursor : null);
    // mainView の z-order を切り替えて操作モードを制御
    window.pageViewApi.setInteractionMode(active);
  }, []);

  // パン操作
  useArtboardPan({
    canvasRef,
    zoom: zoomRef,
    panX: panXRef,
    panY: panYRef,
    onPanEnd: useCallback(
      (px, py) => updateViewport(activeId, { panX: px, panY: py }),
      [updateViewport, activeId],
    ),
    onInteractionChange: useCallback(
      (active) => handleInteractionChange(active, 'grabbing'),
      [handleInteractionChange],
    ),
    onTransformChange: scheduleSyncBounds,
  });

  // ズーム操作
  useArtboardZoom({
    containerRef,
    canvasRef,
    zoom: zoomRef,
    panX: panXRef,
    panY: panYRef,
    onZoomEnd: useCallback(
      (z, px, py) => updateViewport(activeId, { zoom: z, panX: px, panY: py }),
      [updateViewport, activeId],
    ),
    onTransformChange: scheduleSyncBounds,
  });

  // ページドラッグ
  const { startDrag } = usePageDrag({
    zoom: zoomRef,
    onDragEnd: useCallback(
      (pageId, x, y) => {
        updatePagePosition(activeId, pageId, x, y);
        // ドラッグ完了後に最終 bounds を同期
        syncBounds();
      },
      [updatePagePosition, activeId, syncBounds],
    ),
    onInteractionChange: useCallback(
      (active) => handleInteractionChange(active, 'grabbing'),
      [handleInteractionChange],
    ),
  });

  // ページリサイズ
  const { startResize } = usePageResize({
    zoom: zoomRef,
    onResizeEnd: useCallback(
      (pageId, width, height) => {
        updatePageSize(activeId, pageId, width, height);
        syncBounds();
      },
      [updatePageSize, activeId, syncBounds],
    ),
    onInteractionChange: useCallback(
      (active) => handleInteractionChange(active, 'default'),
      [handleInteractionChange],
    ),
  });

  // 初回マウント時にキャンバスの transform を設定
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.style.transform = `translate(${panXRef.current}px, ${panYRef.current}px) scale(${zoomRef.current})`;
    }
  }, []);

  // プロジェクト切り替え時に WebContentsView の表示を切り替え
  useEffect(() => {
    window.pageViewApi.showProjectPages(activeId).catch(() => {});
    // マウント時に bounds を同期
    syncBounds();
  }, [activeId, syncBounds]);

  // ページの追加/削除を検知して WebContentsView を生成/破棄
  const prevPageIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(pages.map((p) => p.id));
    const prevIds = prevPageIdsRef.current;

    // 追加されたページの WebContentsView を生成
    for (const page of pages) {
      if (!prevIds.has(page.id)) {
        window.pageViewApi.createPageView(activeId, page.id, page.url).catch(() => {});
      }
    }

    // 削除されたページの WebContentsView を破棄
    for (const prevId of prevIds) {
      if (!currentIds.has(prevId)) {
        window.pageViewApi.destroyPageView(prevId).catch(() => {});
      }
    }

    prevPageIdsRef.current = currentIds;
    // ページ変更後に bounds を同期
    syncBounds();
  }, [pages, activeId, syncBounds]);

  // ウィンドウリサイズ時に bounds を再同期
  useEffect(() => {
    const handleResize = () => syncBounds();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [syncBounds]);

  // IPC ナビゲーションイベントの購読（ページタイトル・URL の更新）
  useEffect(() => {
    window.pageViewApi.onNavigated((pageId, url, title) => {
      updatePageUrl(activeId, pageId, url, title);
      setPageTitles((prev) => ({ ...prev, [pageId]: title }));
    });
    window.pageViewApi.onTitleUpdated((pageId, title) => {
      setPageTitles((prev) => ({ ...prev, [pageId]: title }));
    });
    // onNavigated/onTitleUpdated は ipcRenderer.on で登録するため、
    // アンマウント時にクリーンアップできないが、Artboard は key={activeId} で
    // 再マウントされるためリスナーが蓄積しても実害は少ない
  }, [activeId, updatePageUrl]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent, pageId: string) => {
      bringPageToFront(activeId, pageId);
      setActivePageId(pageId);
      window.pageViewApi.bringToFront(pageId);
      startDrag(e, pageId);
    },
    [bringPageToFront, activeId, startDrag],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, pageId: string, direction: ResizeDirection) => {
      startResize(e, pageId, direction);
    },
    [startResize],
  );

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden">
      {/* 操作中オーバーレイ */}
      {interactionCursor && <InteractionOverlay cursor={interactionCursor} />}

      {/* アートボードキャンバス（transform-origin: 0 0） */}
      <div
        ref={canvasRef}
        className="absolute"
        style={{ transformOrigin: '0 0', willChange: 'transform' }}
      >
        {pages.map((page) => (
          <PageFrame
            key={page.id}
            page={page}
            isActive={page.id === activePageId}
            title={pageTitles[page.id] ?? page.title}
            onActivate={() => {
              setActivePageId(page.id);
              bringPageToFront(activeId, page.id);
              window.pageViewApi.bringToFront(page.id);
            }}
            onClose={() => removePage(activeId, page.id)}
            onDragStart={(e) => handleDragStart(e, page.id)}
            onResizeStart={(e, direction) => handleResizeStart(e, page.id, direction)}
          />
        ))}
      </div>

      {/* ページが 0 件の場合のガイドメッセージ */}
      {pages.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-muted">
            サイドバーの「ページを追加」から URL を入力してください
          </p>
        </div>
      )}
    </div>
  );
}
