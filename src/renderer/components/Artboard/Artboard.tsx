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
/** スクリーンショットのプリキャプチャを開始するキャンバス端からの距離（px） */
const PRE_CAPTURE_MARGIN_PX = 50;
/** プリキャプチャの最小実行間隔（ms）、過剰撮影防止 */
const CAPTURE_MIN_INTERVAL_MS = 1000;
/** プリディスプレイゾーン: キャンバス端の外側 50px。hidden→screenshot の切り替え境界 */
const PRE_DISPLAY_MARGIN_PX = 50;
/** native ページのスクリーンショット定期リフレッシュ間隔（ms）。Webview 内スクロール等に対応 */
const SCREENSHOT_REFRESH_INTERVAL_MS = 2000;

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
  /** エッジ近傍ゾーン内判定（エッジトリガー用・ゾーン外→内の遷移時のみ撮影） */
  const nearEdgeRef = useRef<Record<string, boolean>>({});
  /** プリキャプチャ撮影中フラグ（二重撮影防止） */
  const captureInFlightRef = useRef<Record<string, boolean>>({});
  /** プリキャプチャの最終撮影時刻（スロットリング用） */
  const lastCaptureTimeRef = useRef<Record<string, number>>({});
  /**
   * captureScreenshot への参照。checkPreCapture → captureScreenshot → computeDisplayModes の
   * 循環依存を断ち切るため ref 経由で参照する
   */
  const captureScreenshotRef = useRef<((pageId: string) => Promise<void>) | null>(null);
  /** rAF スロットリング用（1フレーム1回に制限） */
  const interactionRafRef = useRef<number | null>(null);
  /** 操作開始時の container rect キャッシュ（パン/ズーム中は変化しない） */
  const containerRectRef = useRef<DOMRect | null>(null);

  /**
   * ページ矩形がキャンバス端から PRE_CAPTURE_MARGIN_PX 以内に入った瞬間にスクリーンショットを撮影。
   * エッジトリガー方式（ゾーン外→ゾーン内の遷移時のみ発火）で過剰撮影を防止する。
   */
  const checkPreCapture = useCallback(
    (pageId: string, pr: DOMRect, cr: DOMRect, mode: DisplayMode) => {
      // drag/resize 中は全 Webview が hide → 撮影不可
      if (activeInteractionsRef.current.has('drag') || activeInteractionsRef.current.has('resize'))
        return;

      // 四辺のキャンバス端からの最小距離（全辺がキャンバス内なら正の値）
      const minDist = Math.min(
        pr.left - cr.left,
        cr.right - pr.right,
        pr.top - cr.top,
        cr.bottom - pr.bottom,
      );
      const isNearEdge = minDist >= 0 && minDist < PRE_CAPTURE_MARGIN_PX;

      const wasNearEdge = nearEdgeRef.current[pageId] ?? false;
      nearEdgeRef.current[pageId] = isNearEdge;

      // エッジトリガー: ゾーン外→ゾーン内の遷移時のみ発火
      if (!isNearEdge || wasNearEdge) return;
      // native モードの時のみ撮影可能（hide 中は空白画像になる）
      if (mode !== 'native') return;
      // 撮影中ガード
      if (captureInFlightRef.current[pageId]) return;
      // 最小間隔スロットリング
      const now = Date.now();
      if (now - (lastCaptureTimeRef.current[pageId] ?? 0) < CAPTURE_MIN_INTERVAL_MS) return;

      if (captureScreenshotRef.current) {
        captureInFlightRef.current[pageId] = true;
        lastCaptureTimeRef.current[pageId] = now;
        void captureScreenshotRef.current(pageId).finally(() => {
          captureInFlightRef.current[pageId] = false;
        });
      }
    },
    // activeInteractionsRef, nearEdgeRef, captureInFlightRef, lastCaptureTimeRef, captureScreenshotRef はすべて安定した ref
    [],
  );

  /** ページの placeholder 矩形がアートボード内にどの程度含まれるかを判定して displayMode を計算 */
  const computeDisplayModes = useCallback(() => {
    if (!containerRef.current || !canvasRef.current) return;
    const cr = containerRef.current.getBoundingClientRect();
    const modes: Record<string, DisplayMode> = {};
    for (const page of pages) {
      const wrapper = canvasRef.current.querySelector(
        `[data-page-id="${page.id}"]`,
      ) as HTMLElement | null;
      const el = wrapper?.querySelector('[data-webview-placeholder]') as HTMLElement | null;
      if (!el || !wrapper) {
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

      // handleInteractionChange で設定した DOM 属性を確実にリセット（React state Bailout に依存しない）
      wrapper.setAttribute('data-display-mode', modes[page.id]);

      // 命令的に Webview の show/hide を実行（React state の Bailout で effect が発火しないケースを防ぐ）
      if (page.webviewLabel) {
        if (modes[page.id] === 'native') {
          void webviewApi.updateBounds(page.webviewLabel, pr.left, pr.top, pr.width, pr.height);
          void webviewApi.show(page.webviewLabel);
        } else {
          void webviewApi.hide(page.webviewLabel);
        }
      }

      checkPreCapture(page.id, pr, cr, modes[page.id]);
    }
    setDisplayModes(modes);

    // native モードだが screenshot 未取得のページを撮影（Eager Capture）。
    // 操作中は captureScreenshot 内のガードがスキップするため、パン/ズーム中の空白画像は発生しない。
    // captureScreenshot 完了後に computeDisplayModes が再呼び出しされるが、
    // 2回目では screenshotReadyRef が true になるためこのブロックは実行されず収束する。
    for (const page of pages) {
      if (
        modes[page.id] === 'native' &&
        !screenshotReadyRef.current[page.id] &&
        !captureInFlightRef.current[page.id] &&
        page.webviewLabel
      ) {
        captureInFlightRef.current[page.id] = true;
        lastCaptureTimeRef.current[page.id] = Date.now();
        void captureScreenshotRef.current?.(page.id).finally(() => {
          captureInFlightRef.current[page.id] = false;
        });
      }
    }
  }, [pages, checkPreCapture]);

  /**
   * パン/ズーム操作中に毎フレーム呼ばれる表示モード計算関数。
   * container rect はキャッシュ値を使用（パン/ズーム中は変化しない）。
   * placeholder rect は getBoundingClientRect() で正確な値を取得（タイトルバー高さが動的なため数学計算では不正確）。
   *
   * 遷移ルール:
   * - native → screenshot/hidden: 許可（即時）
   * - hidden → screenshot: 許可（プリディスプレイゾーンに入った時）
   * - screenshot → hidden: 許可（プリディスプレイゾーンからも出た時）
   * - screenshot/hidden → native: 禁止（show() 遅延によるフリッカー回避。操作終了後の computeDisplayModes() で復帰）
   */
  const computeInteractionModes = useCallback(() => {
    const cr = containerRectRef.current;
    if (!cr || !canvasRef.current) return;

    const boundsEntries: { label: string; x: number; y: number; w: number; h: number }[] = [];

    for (const page of pages) {
      const wrapper = canvasRef.current.querySelector(
        `[data-page-id="${page.id}"]`,
      ) as HTMLElement | null;
      const el = wrapper?.querySelector('[data-webview-placeholder]') as HTMLElement | null;
      if (!el || !wrapper) continue;

      const pr = el.getBoundingClientRect();
      const currentMode = (wrapper.getAttribute('data-display-mode') ?? 'native') as DisplayMode;

      // プリディスプレイゾーン（キャンバスの外側 PRE_DISPLAY_MARGIN_PX 拡張した矩形）との交差判定
      const isOutsideExpanded =
        pr.right <= cr.left - PRE_DISPLAY_MARGIN_PX ||
        pr.left >= cr.right + PRE_DISPLAY_MARGIN_PX ||
        pr.bottom <= cr.top - PRE_DISPLAY_MARGIN_PX ||
        pr.top >= cr.bottom + PRE_DISPLAY_MARGIN_PX;

      // キャンバス可視領域との交差判定
      const isOutsideCanvas =
        pr.right <= cr.left || pr.left >= cr.right || pr.bottom <= cr.top || pr.top >= cr.bottom;

      // 完全にキャンバス内か判定（ヒステリシス付き）
      const isFullyInside =
        !isOutsideCanvas &&
        pr.left >= cr.left - HYSTERESIS_PX &&
        pr.right <= cr.right + HYSTERESIS_PX &&
        pr.top >= cr.top - HYSTERESIS_PX &&
        pr.bottom <= cr.bottom + HYSTERESIS_PX;

      if (currentMode === 'native') {
        if (isOutsideExpanded) {
          // 完全にプリディスプレイゾーン外 → hidden
          wrapper.setAttribute('data-display-mode', 'hidden');
          if (page.webviewLabel) void webviewApi.hide(page.webviewLabel);
        } else if (!isFullyInside) {
          // キャンバス端にかかる or プリディスプレイゾーン内 → screenshot（準備済みの場合のみ）
          if (screenshotReadyRef.current[page.id]) {
            wrapper.setAttribute('data-display-mode', 'screenshot');
            if (page.webviewLabel) void webviewApi.hide(page.webviewLabel);
          } else {
            // screenshot 未準備 → native 維持 + bounds 同期
            if (page.webviewLabel) {
              boundsEntries.push({
                label: page.webviewLabel,
                x: pr.left,
                y: pr.top,
                w: pr.width,
                h: pr.height,
              });
            }
          }
        } else {
          // 完全にキャンバス内 → native 維持 + bounds 同期
          if (page.webviewLabel) {
            boundsEntries.push({
              label: page.webviewLabel,
              x: pr.left,
              y: pr.top,
              w: pr.width,
              h: pr.height,
            });
          }
        }
      } else if (currentMode === 'hidden') {
        if (!isOutsideExpanded && screenshotReadyRef.current[page.id]) {
          // プリディスプレイゾーンに入った → screenshot に切り替え（hidden → native は禁止）
          wrapper.setAttribute('data-display-mode', 'screenshot');
        }
      } else {
        // currentMode === 'screenshot'
        if (isOutsideExpanded) {
          // プリディスプレイゾーンからも出た → hidden（screenshot → native は禁止）
          wrapper.setAttribute('data-display-mode', 'hidden');
        }
      }

      // native 維持ページについてプリキャプチャ判定
      if (currentMode === 'native' && !isOutsideCanvas) {
        checkPreCapture(page.id, pr, cr, 'native');
      }
    }

    if (boundsEntries.length > 0) {
      void webviewApi.updateAllBounds(boundsEntries);
    }
  }, [pages, checkPreCapture]);

  /** パン/ズーム中の Webview 更新を rAF でスロットリング（1フレーム1回に制限） */
  const scheduleInteractionUpdate = useCallback(() => {
    if (activeInteractionsRef.current.has('drag') || activeInteractionsRef.current.has('resize'))
      return;
    if (interactionRafRef.current !== null) return;
    interactionRafRef.current = requestAnimationFrame(() => {
      interactionRafRef.current = null;
      computeInteractionModes();
    });
  }, [computeInteractionModes]);

  // ── スクリーンショットキャッシュ ─────────────────────────────────────────

  /**
   * スクリーンショット ObjectURL キャッシュ（state として管理してレンダリングに反映）。
   * base64 より省メモリ（Blob + ObjectURL 方式）。
   */
  const [screenshotUrls, setScreenshotUrls] = useState<Record<string, string>>({});

  const captureScreenshot = useCallback(
    async (pageId: string) => {
      // drag/resize 中は Webview が hide → 撮影不可。pan/zoom 中は native Webview は表示されているため撮影可
      if (activeInteractionsRef.current.has('drag') || activeInteractionsRef.current.has('resize'))
        return;

      const dataUrl = await webviewApi.captureScreenshot(pageId);
      if (!dataUrl) return;

      // IPC 中に drag/resize が開始されていた場合、空白画像の可能性があるためスキップ
      if (activeInteractionsRef.current.has('drag') || activeInteractionsRef.current.has('resize'))
        return;

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

      // pan/zoom 中は computeInteractionModes が表示制御するため再計算しない（競合防止）
      if (activeInteractionsRef.current.size === 0) {
        computeDisplayModes();
      }
    },
    [computeDisplayModes],
  );

  // captureScreenshot が変わるたびに ref を同期（checkPreCapture からの循環依存回避）
  useEffect(() => {
    captureScreenshotRef.current = captureScreenshot;
  }, [captureScreenshot]);

  // ── Webview 操作ヘルパー ──────────────────────────────────────────────────

  /** 全ページの webviewLabel を収集 */
  const getAllWebviewLabels = useCallback(() => {
    return pages.map((p) => p.webviewLabel).filter((l): l is string => !!l);
  }, [pages]);

  const handleInteractionChange = useCallback(
    (active: boolean, cursor = 'default', type: InteractionType = 'drag') => {
      if (active) {
        activeInteractionsRef.current.add(type);
        setInteractionCursor(cursor);

        if (type === 'drag' || type === 'resize') {
          // ページ操作: 従来通り全 Webview を hide してスクリーンショットに切り替え
          void webviewApi.hideAll(getAllWebviewLabels());
          if (canvasRef.current) {
            for (const page of pages) {
              const wrapper = canvasRef.current.querySelector(
                `[data-page-id="${page.id}"]`,
              ) as HTMLElement | null;
              if (!wrapper) continue;
              wrapper.setAttribute(
                'data-display-mode',
                screenshotReadyRef.current[page.id] ? 'screenshot' : 'hidden',
              );
            }
          }
        } else {
          // pan/zoom: container rect をキャッシュして選択的に Webview を制御（完全に内側は native 維持）
          containerRectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
          computeInteractionModes();
        }
      } else {
        activeInteractionsRef.current.delete(type);

        if (activeInteractionsRef.current.size === 0) {
          if (interactionRafRef.current !== null) {
            cancelAnimationFrame(interactionRafRef.current);
            interactionRafRef.current = null;
          }
          containerRectRef.current = null;
          setInteractionCursor(null);
          prevModesRef.current = {};
          nearEdgeRef.current = {};
          computeDisplayModes();
        }
      }
    },
    [getAllWebviewLabels, computeDisplayModes, computeInteractionModes, pages],
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
    onPanMove: scheduleInteractionUpdate,
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
    onBoundsUpdate: scheduleInteractionUpdate,
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

  // ウィンドウがフォーカスを失った場合に全操作タイプを一括クリア
  useEffect(() => {
    const handleBlur = () => {
      if (activeInteractionsRef.current.size === 0) return;
      activeInteractionsRef.current.clear();
      if (interactionRafRef.current !== null) {
        cancelAnimationFrame(interactionRafRef.current);
        interactionRafRef.current = null;
      }
      containerRectRef.current = null;
      setInteractionCursor(null);
      prevModesRef.current = {};
      nearEdgeRef.current = {};
      computeDisplayModes();
    };
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [computeDisplayModes]);

  // native ページのスクリーンショットを定期リフレッシュ（Webview 内スクロール等による変化に対応）
  useEffect(() => {
    const refresh = () => {
      // drag/resize 中は Webview が hide → 撮影不可
      if (activeInteractionsRef.current.has('drag') || activeInteractionsRef.current.has('resize'))
        return;
      if (!canvasRef.current) return;

      const now = Date.now();
      for (const page of pages) {
        if (!page.webviewLabel) continue;
        if (captureInFlightRef.current[page.id]) continue;
        if (now - (lastCaptureTimeRef.current[page.id] ?? 0) < SCREENSHOT_REFRESH_INTERVAL_MS)
          continue;

        // DOM 属性から現在のモードを読み取り（React state より最新の状態を反映）
        const wrapper = canvasRef.current.querySelector(
          `[data-page-id="${page.id}"]`,
        ) as HTMLElement | null;
        if (wrapper?.getAttribute('data-display-mode') !== 'native') continue;

        captureInFlightRef.current[page.id] = true;
        lastCaptureTimeRef.current[page.id] = now;
        void captureScreenshotRef.current?.(page.id).finally(() => {
          captureInFlightRef.current[page.id] = false;
        });
      }
    };

    const id = setInterval(refresh, SCREENSHOT_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pages]);

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
      delete nearEdgeRef.current[pageId];
      delete captureInFlightRef.current[pageId];
      delete lastCaptureTimeRef.current[pageId];
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
