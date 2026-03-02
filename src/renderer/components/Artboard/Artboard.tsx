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
import type { DisplayMode } from '@/renderer/types/tab';

/** intersection 判定のヒステリシスマージン（境界近辺でのモード振動を防ぐ） */
const HYSTERESIS_PX = 4;

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

  // 操作中フラグ（InteractionOverlay 表示に使用）
  const [interactionCursor, setInteractionCursor] = useState<string | null>(null);

  // 複数操作の同時性を管理（例: ホイール debounce 終了前にドラッグ開始した場合の競合防止）
  type InteractionType = 'pan' | 'zoom' | 'drag' | 'resize';
  const activeInteractionsRef = useRef<Set<InteractionType>>(new Set());

  // activeProject が undefined の時 `?? []` が毎回新しい配列を生成するのを防ぐ
  const pages = useMemo(() => activeProject?.pages ?? [], [activeProject?.pages]);

  // ── displayMode 管理 ──────────────────────────────────────────────────────

  /** 静的状態の displayMode（React 再レンダリング経由で PageFrame に渡す） */
  const [displayModes, setDisplayModes] = useState<Record<string, DisplayMode>>({});
  /** リアルタイム切り替え用の前回モード記録（show/hide の重複呼び出し防止） */
  const prevModesRef = useRef<Record<string, DisplayMode>>({});
  /** デコード完了フラグ（pageId → true）。true になって初めて screenshot モードに切り替え可 */
  const screenshotReadyRef = useRef<Record<string, boolean>>({});

  /** ページの placeholder 矩形がアートボード内にどの程度含まれるかを判定して displayMode を計算 */
  const computeDisplayModes = useCallback(() => {
    if (!containerRef.current || !canvasRef.current) return;
    const cr = containerRef.current.getBoundingClientRect();
    const modes: Record<string, DisplayMode> = {};
    for (const page of pages) {
      const el = canvasRef.current.querySelector(
        `[data-page-id="${page.id}"] [data-webview-placeholder]`,
      ) as HTMLElement | null;
      if (!el) {
        modes[page.id] = 'hidden';
        continue;
      }
      const pr = el.getBoundingClientRect();

      if (
        pr.right <= cr.left ||
        pr.left >= cr.right ||
        pr.bottom <= cr.top ||
        pr.top >= cr.bottom
      ) {
        modes[page.id] = 'hidden';
      } else if (
        pr.left >= cr.left - HYSTERESIS_PX &&
        pr.right <= cr.right + HYSTERESIS_PX &&
        pr.top >= cr.top - HYSTERESIS_PX &&
        pr.bottom <= cr.bottom + HYSTERESIS_PX
      ) {
        modes[page.id] = 'native';
      } else {
        // スクリーンショット準備済みなら screenshot、まだなら native を維持（フリッカー防止）
        modes[page.id] = screenshotReadyRef.current[page.id] ? 'screenshot' : 'native';
      }
    }
    setDisplayModes(modes);
  }, [pages]);

  // ── スクリーンショットキャッシュ ─────────────────────────────────────────

  /**
   * スクリーンショット ObjectURL キャッシュ（state として管理してレンダリングに反映）。
   * base64 より省メモリ（Blob + ObjectURL 方式）。
   */
  const [screenshotUrls, setScreenshotUrls] = useState<Record<string, string>>({});

  const captureScreenshot = useCallback(
    async (pageId: string) => {
      const dataUrl = await webviewApi.captureScreenshot(pageId);
      if (!dataUrl) return;

      // base64 Data URL → Blob → ObjectURL に変換（メモリ効率改善）
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);

      // <img> のデコード完了を待ってからフラグを立てる（native→screenshot 遷移時のフリッカー防止）
      const img = new Image();
      img.src = objectUrl;
      try {
        await img.decode();
      } catch {
        // デコード失敗は無視（objectURL は有効のまま保持）
      }
      screenshotReadyRef.current[pageId] = true;

      setScreenshotUrls((prev) => {
        // 古い ObjectURL を解放
        const oldUrl = prev[pageId];
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        return { ...prev, [pageId]: objectUrl };
      });

      // スクリーンショットが ready になったので displayMode を再計算（静的状態を更新）
      computeDisplayModes();
    },
    [computeDisplayModes],
  );

  // ── Webview 操作ヘルパー ──────────────────────────────────────────────────

  /** 全ページの webviewLabel を収集 */
  const getAllWebviewLabels = useCallback(() => {
    return pages.map((p) => p.webviewLabel).filter((l): l is string => !!l);
  }, [pages]);

  /** rAF スロットリング用 ID */
  const rafIdRef = useRef<number>(0);

  /**
   * 操作中（pan/zoom）にリアルタイムで各 Webview の intersection を判定し、
   * native / screenshot / hidden を切り替える。DOM 直接操作で React 再レンダリングを回避。
   */
  const syncAllWebviewBoundsImmediate = useCallback(() => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = 0;
      if (!containerRef.current || !canvasRef.current) return;

      const cr = containerRef.current.getBoundingClientRect();

      for (const page of pages) {
        if (!page.webviewLabel) continue;
        const wrapper = canvasRef.current.querySelector(
          `[data-page-id="${page.id}"]`,
        ) as HTMLElement | null;
        const el = wrapper?.querySelector('[data-webview-placeholder]') as HTMLElement | null;
        if (!el || !wrapper) continue;

        const pr = el.getBoundingClientRect();
        let mode: DisplayMode;

        if (
          pr.right <= cr.left ||
          pr.left >= cr.right ||
          pr.bottom <= cr.top ||
          pr.top >= cr.bottom
        ) {
          mode = 'hidden';
        } else if (
          pr.left >= cr.left - HYSTERESIS_PX &&
          pr.right <= cr.right + HYSTERESIS_PX &&
          pr.top >= cr.top - HYSTERESIS_PX &&
          pr.bottom <= cr.bottom + HYSTERESIS_PX
        ) {
          mode = 'native';
        } else {
          mode = screenshotReadyRef.current[page.id] ? 'screenshot' : 'native';
        }

        const prevMode = prevModesRef.current[page.id];

        // DOM 属性を直接更新（React 再レンダリングなし）
        wrapper.setAttribute('data-display-mode', mode);

        if (mode === 'native') {
          // native: 常に bounds を更新（show/hide は prevMode で判定）
          void webviewApi.updateBounds(page.webviewLabel, pr.left, pr.top, pr.width, pr.height);
          if (prevMode !== 'native') {
            void webviewApi.show(page.webviewLabel);
          }
        } else if (prevMode === 'native' || prevMode === undefined) {
          // native → screenshot/hidden: hide のみ（bounds 更新不要）
          void webviewApi.hide(page.webviewLabel);
        }
        // screenshot/hidden → screenshot/hidden: hide 済みなのでスキップ

        prevModesRef.current[page.id] = mode;
      }
    });
  }, [pages]);

  const handleInteractionChange = useCallback(
    (active: boolean, cursor = 'default', type: InteractionType = 'drag') => {
      if (active) {
        activeInteractionsRef.current.add(type);
        setInteractionCursor(cursor);

        // ページ操作（drag/resize）は全 Webview を hide
        // キャンバス操作（pan/zoom）は syncAllWebviewBoundsImmediate がリアルタイムで切り替えるため何もしない
        if (type === 'drag' || type === 'resize') {
          void webviewApi.hideAll(getAllWebviewLabels());
        }
      } else {
        activeInteractionsRef.current.delete(type);

        if (activeInteractionsRef.current.size === 0) {
          setInteractionCursor(null);
          // リアルタイムモード追跡をリセットして React state に反映
          prevModesRef.current = {};
          computeDisplayModes();
        }
      }
    },
    [getAllWebviewLabels, computeDisplayModes],
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

  // 初回マウント時にキャンバスの transform を設定して displayMode を計算
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.style.transform = `translate(${panXRef.current}px, ${panYRef.current}px) scale(${zoomRef.current})`;
      canvasRef.current.style.setProperty('--canvas-zoom', String(zoomRef.current));
    }
    // transform 反映後に displayMode を計算
    requestAnimationFrame(() => computeDisplayModes());
  }, [computeDisplayModes]);

  // ウィンドウリサイズ時に displayMode を再計算
  useEffect(() => {
    window.addEventListener('resize', computeDisplayModes);
    return () => window.removeEventListener('resize', computeDisplayModes);
  }, [computeDisplayModes]);

  // ウィンドウがフォーカスを失った場合に isInteracting を強制解除
  useEffect(() => {
    const handleBlur = () => handleInteractionChange(false);
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [handleInteractionChange]);

  const handleNavigated = useCallback(
    (pageId: string, url: string, title: string) => {
      updatePageUrl(activeId, pageId, url, title);
      if (title) {
        setPageTitles((prev) => ({ ...prev, [pageId]: title }));
      }
      // ナビゲーション完了後にスクリーンショットを更新（500ms 遅延でロード完了を待つ）
      setTimeout(() => void captureScreenshot(pageId), 500);
    },
    [updatePageUrl, activeId, captureScreenshot],
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
      // Webview 作成完了後に displayMode を再計算（初期表示位置の判定）
      requestAnimationFrame(() => computeDisplayModes());
    },
    [setPageWebviewLabel, activeId, computeDisplayModes],
  );

  const handleWebviewLoaded = useCallback(
    (pageId: string) => {
      // ページロード完了後にスクリーンショットをキャプチャ（Webview が表示中の時に取る）
      void captureScreenshot(pageId);
    },
    [captureScreenshot],
  );

  const handleRemovePage = useCallback(
    (pageId: string) => {
      // ObjectURL を解放してからページを削除
      setScreenshotUrls((prev) => {
        const oldUrl = prev[pageId];
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        const next = { ...prev };
        delete next[pageId];
        return next;
      });
      delete screenshotReadyRef.current[pageId];
      removePage(activeId, pageId);
    },
    [removePage, activeId],
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
            displayMode={displayModes[page.id] ?? 'native'}
            screenshotUrl={screenshotUrls[page.id] ?? null}
            onActivate={() => {
              setActivePageId(page.id);
              bringPageToFront(activeId, page.id);
            }}
            onClose={() => handleRemovePage(page.id)}
            onDragStart={(e) => handleDragStart(e, page.id)}
            onResizeStart={(e, direction) => handleResizeStart(e, page.id, direction)}
            onResizePreset={(w, h) => updatePageSize(activeId, page.id, w, h)}
            onNavigated={handleNavigated}
            onTitleUpdated={handleTitleUpdated}
            onWebviewCreated={handleWebviewCreated}
            onWebviewLoaded={handleWebviewLoaded}
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
