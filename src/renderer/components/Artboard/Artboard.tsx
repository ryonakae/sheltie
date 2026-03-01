import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useShallow } from 'zustand/react/shallow';

import { selectActiveProject, useProjectStore } from '@/renderer/store/tab-store';
import { webviewApi } from '@/renderer/lib/tauri-bridge';
import { useArtboardPan } from '@/renderer/hooks/useArtboardPan';
import { useArtboardZoom } from '@/renderer/hooks/useArtboardZoom';
import { usePageDrag } from '@/renderer/hooks/usePageDrag';
import { usePageResize } from '@/renderer/hooks/usePageResize';
import { InteractionOverlay } from '@/renderer/components/Artboard/InteractionOverlay';
import { PageFrame, type ResizeDirection } from '@/renderer/components/Artboard/PageFrame';

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
    setPageWebviewLabel,
  } = useProjectStore(
    useShallow((s) => ({
      updateViewport: s.updateViewport,
      updatePagePosition: s.updatePagePosition,
      updatePageSize: s.updatePageSize,
      updatePageUrl: s.updatePageUrl,
      removePage: s.removePage,
      bringPageToFront: s.bringPageToFront,
      setPageWebviewLabel: s.setPageWebviewLabel,
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

  // リサイズ中のページサイズ（タイトルバーのリアルタイム表示用）
  const [resizingSize, setResizingSize] = useState<{
    pageId: string;
    width: number;
    height: number;
  } | null>(null);

  // ページタイトルのローカル状態（Webview イベントで更新）
  const [pageTitles, setPageTitles] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const page of activeProject?.pages ?? []) {
      initial[page.id] = page.title;
    }
    return initial;
  });

  // 操作中フラグ（ネイティブ Webview の hide/show 制御と InteractionOverlay 表示に使用）
  const [isInteracting, setIsInteracting] = useState(false);
  const [interactionCursor, setInteractionCursor] = useState<string | null>(null);

  // 複数操作の同時性を管理（例: ホイール debounce 終了前にドラッグ開始した場合の競合防止）
  type InteractionType = 'pan' | 'zoom' | 'drag' | 'resize';
  const activeInteractionsRef = useRef<Set<InteractionType>>(new Set());

  // activeProject が undefined の時 `?? []` が毎回新しい配列を生成するのを防ぐ
  const pages = useMemo(() => activeProject?.pages ?? [], [activeProject?.pages]);

  /** 全ページの webviewLabel を収集 */
  const getAllWebviewLabels = useCallback(() => {
    return pages.map((p) => p.webviewLabel).filter((l): l is string => !!l);
  }, [pages]);

  /** 全ネイティブ Webview の座標をプレースホルダーに同期して再表示 */
  const syncAllWebviewBounds = useCallback(() => {
    if (!canvasRef.current) return;

    const entries = pages
      .filter((p) => p.webviewLabel)
      .map((p) => {
        const el = canvasRef.current?.querySelector(
          `[data-page-id="${p.id}"] [data-webview-placeholder]`,
        ) as HTMLElement | null;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { label: p.webviewLabel!, x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    void webviewApi.showAllWithBounds(entries);
  }, [pages]);

  /** rAF スロットリング用 ID（操作中の Webview 座標リアルタイム同期用） */
  const rafIdRef = useRef<number>(0);

  /** 操作中に全 Webview の座標をリアルタイム同期（show/hide なし、1フレーム1回に制限） */
  const syncAllWebviewBoundsImmediate = useCallback(() => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = 0;
      if (!canvasRef.current) return;
      const entries = pages
        .filter((p) => p.webviewLabel)
        .map((p) => {
          const el = canvasRef.current?.querySelector(
            `[data-page-id="${p.id}"] [data-webview-placeholder]`,
          ) as HTMLElement | null;
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return {
            label: p.webviewLabel!,
            x: rect.left,
            y: rect.top,
            w: rect.width,
            h: rect.height,
          };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);
      void webviewApi.updateAllBounds(entries);
    });
  }, [pages]);

  const handleInteractionChange = useCallback(
    (active: boolean, cursor = 'default', type: InteractionType = 'drag') => {
      if (active) {
        activeInteractionsRef.current.add(type);
        setIsInteracting(true);
        setInteractionCursor(cursor);

        // ページ操作のみ hideAll（キャンバス操作では Webview を非表示にしない）
        if (type === 'drag' || type === 'resize') {
          void webviewApi.hideAll(getAllWebviewLabels());
        }
      } else {
        activeInteractionsRef.current.delete(type);

        // 全操作が終了した時のみ座標同期して再表示
        if (activeInteractionsRef.current.size === 0) {
          setIsInteracting(false);
          setInteractionCursor(null);
          syncAllWebviewBounds();
        }
      }
    },
    [getAllWebviewLabels, syncAllWebviewBounds],
  );

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
      (active) => handleInteractionChange(active, 'grabbing', 'pan'),
      [handleInteractionChange],
    ),
    onPanMove: syncAllWebviewBoundsImmediate,
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
    onInteractionChange: useCallback(
      (active: boolean) => handleInteractionChange(active, 'default', 'zoom'),
      [handleInteractionChange],
    ),
    onBoundsUpdate: syncAllWebviewBoundsImmediate,
  });

  // ページドラッグ
  const { startDrag } = usePageDrag({
    zoom: zoomRef,
    onDragEnd: useCallback(
      (pageId, x, y) => {
        updatePagePosition(activeId, pageId, x, y);
      },
      [updatePagePosition, activeId],
    ),
    onInteractionChange: useCallback(
      (active) => handleInteractionChange(active, 'grabbing', 'drag'),
      [handleInteractionChange],
    ),
  });

  // ページリサイズ
  const { startResize } = usePageResize({
    zoom: zoomRef,
    onResizeMove: useCallback((pageId: string, width: number, height: number) => {
      setResizingSize({ pageId, width, height });
    }, []),
    onResizeEnd: useCallback(
      (pageId, width, height) => {
        updatePageSize(activeId, pageId, width, height);
        setResizingSize(null);
      },
      [updatePageSize, activeId],
    ),
    onInteractionChange: useCallback(
      (active) => handleInteractionChange(active, 'default', 'resize'),
      [handleInteractionChange],
    ),
  });

  // 初回マウント時にキャンバスの transform を設定
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.style.transform = `translate(${panXRef.current}px, ${panYRef.current}px) scale(${zoomRef.current})`;
      canvasRef.current.style.setProperty('--canvas-zoom', String(zoomRef.current));
    }
  }, []);

  // ウィンドウがフォーカスを失った場合に isInteracting を強制解除
  // （ウィンドウ外でマウスアップした際に操作中フラグが残り Webview が隠れ続けるのを防ぐ）
  useEffect(() => {
    const handleBlur = () => handleInteractionChange(false);
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [handleInteractionChange]);

  const handleNavigated = useCallback(
    (pageId: string, url: string, title: string) => {
      updatePageUrl(activeId, pageId, url, title);
      // 空タイトルの場合はローカル状態を更新しない（on_navigation の中間イベントで既存タイトルが消えるのを防ぐ）
      if (title) {
        setPageTitles((prev) => ({ ...prev, [pageId]: title }));
      }
    },
    [updatePageUrl, activeId],
  );

  const handleTitleUpdated = useCallback((pageId: string, title: string) => {
    setPageTitles((prev) => ({ ...prev, [pageId]: title }));
  }, []);

  const handleDragStart = useCallback(
    (e: React.MouseEvent, pageId: string) => {
      bringPageToFront(activeId, pageId);
      setActivePageId(pageId);
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

  const handleWebviewCreated = useCallback(
    (pageId: string, label: string) => {
      setPageWebviewLabel(activeId, pageId, label);
    },
    [setPageWebviewLabel, activeId],
  );

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden artboard-bg">
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
            displayWidth={resizingSize?.pageId === page.id ? resizingSize.width : page.width}
            displayHeight={resizingSize?.pageId === page.id ? resizingSize.height : page.height}
            isInteracting={isInteracting}
            onActivate={() => {
              setActivePageId(page.id);
              bringPageToFront(activeId, page.id);
              // 非操作中でも選択ページの Webview を再表示して最前面に配置
              if (page.webviewLabel && !isInteracting) {
                void webviewApi.show(page.webviewLabel);
              }
            }}
            onClose={() => removePage(activeId, page.id)}
            onDragStart={(e) => handleDragStart(e, page.id)}
            onResizeStart={(e, direction) => handleResizeStart(e, page.id, direction)}
            onResizePreset={(w, h) => updatePageSize(activeId, page.id, w, h)}
            onNavigated={handleNavigated}
            onTitleUpdated={handleTitleUpdated}
            onWebviewCreated={handleWebviewCreated}
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
