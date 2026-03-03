import { useCallback, useEffect, useRef, useState } from 'react';

import {
  CAPTURE_MIN_INTERVAL_MS,
  HYSTERESIS_PX,
  NATIVE_SAFE_MARGIN_PX,
  PRE_CAPTURE_MARGIN_PX,
  PRE_DISPLAY_MARGIN_PX,
  SCREENSHOT_REFRESH_INTERVAL_MS,
} from '@/renderer/constants';
import { webviewApi } from '@/renderer/lib/tauri-bridge';
import type { DisplayMode, Page } from '@/renderer/types/tab';

import type { InteractionType } from './types';

/** 検証用フラグ: false にするとスクリーンショットクリッピング機能を完全に無効化する */
const SCREENSHOT_CLIPPING_ENABLED = true;

interface UseSiteboardDisplayEngineParams {
  pages: Page[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  zoomRef: React.RefObject<number>;
  centeredPageId?: string | null;
  onCenteredPageHandled?: () => void;
}

export function useSiteboardDisplayEngine({
  pages,
  containerRef,
  canvasRef,
  zoomRef,
  centeredPageId = null,
  onCenteredPageHandled,
}: UseSiteboardDisplayEngineParams) {
  const [displayModes, setDisplayModes] = useState<Record<string, DisplayMode>>({});
  const [screenshotUrls, setScreenshotUrls] = useState<Record<string, string>>({});
  const [interactionCursor, setInteractionCursor] = useState<string | null>(null);

  const prevModesRef = useRef<Record<string, DisplayMode>>({});
  const screenshotReadyRef = useRef<Record<string, boolean>>({});
  const nearEdgeRef = useRef<Record<string, boolean>>({});
  const captureInFlightRef = useRef<Record<string, boolean>>({});
  const lastCaptureTimeRef = useRef<Record<string, number>>({});
  const captureScreenshotRef = useRef<((pageId: string) => Promise<void>) | null>(null);
  const interactionRafRef = useRef<number | null>(null);
  const containerRectRef = useRef<DOMRect | null>(null);
  const interactionSnapshotModeRef = useRef(false);
  const pendingSnapshotSwapRef = useRef<Set<string>>(new Set());
  const activeInteractionsRef = useRef<Set<InteractionType>>(new Set());

  const screenshotUrlsRef = useRef<Record<string, string>>({});
  const knownPageIdsRef = useRef<Set<string>>(new Set());

  const checkPreCapture = useCallback(
    (pageId: string, pr: DOMRect, cr: DOMRect, mode: DisplayMode) => {
      if (activeInteractionsRef.current.has('drag') || activeInteractionsRef.current.has('resize'))
        return;

      const minDist = Math.min(
        pr.left - cr.left,
        cr.right - pr.right,
        pr.top - cr.top,
        cr.bottom - pr.bottom,
      );
      const isNearEdge = minDist >= 0 && minDist < PRE_CAPTURE_MARGIN_PX;

      const wasNearEdge = nearEdgeRef.current[pageId] ?? false;
      nearEdgeRef.current[pageId] = isNearEdge;

      if (!isNearEdge || wasNearEdge) return;
      if (mode !== 'native') return;
      if (captureInFlightRef.current[pageId]) return;

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
    [],
  );

  const computeDisplayModes = useCallback(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const cr = containerRef.current.getBoundingClientRect();
    const modes: Record<string, DisplayMode> = {};
    // screenshot→native 遷移ページ: WebView表示後にスクリーンショットを非表示にするため遅延リスト
    const deferredNativeSwaps: HTMLElement[] = [];

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

      let nextMode: DisplayMode;
      if (
        pr.right <= cr.left ||
        pr.left >= cr.right ||
        pr.bottom <= cr.top ||
        pr.top >= cr.bottom
      ) {
        nextMode = 'hidden';
      } else if (
        pr.left >= cr.left + NATIVE_SAFE_MARGIN_PX - HYSTERESIS_PX &&
        pr.right <= cr.right - NATIVE_SAFE_MARGIN_PX + HYSTERESIS_PX &&
        pr.top >= cr.top + NATIVE_SAFE_MARGIN_PX - HYSTERESIS_PX &&
        pr.bottom <= cr.bottom - NATIVE_SAFE_MARGIN_PX + HYSTERESIS_PX
      ) {
        nextMode = 'native';
      } else {
        nextMode = screenshotReadyRef.current[page.id] ? 'screenshot' : 'native';
      }

      modes[page.id] = nextMode;

      const currentAttr = wrapper.getAttribute('data-display-mode') ?? 'native';

      if (page.webviewLabel) {
        if (nextMode === 'native') {
          void webviewApi.updateBounds(
            page.id,
            pr.left,
            pr.top,
            pr.width,
            pr.height,
            zoomRef.current,
          );
          void webviewApi.show(page.webviewLabel);
          // screenshot→native 遷移: WebViewの表示が確定するまでスクリーンショットを残す。
          // show() は非同期 IPC のため即時ではなく、先にスクリーンショットを消すとちらつく。
          if (currentAttr === 'screenshot') {
            deferredNativeSwaps.push(wrapper);
          } else {
            wrapper.setAttribute('data-display-mode', 'native');
          }
        } else {
          wrapper.setAttribute('data-display-mode', nextMode);
          void webviewApi.hide(page.webviewLabel);
        }
      } else {
        wrapper.setAttribute('data-display-mode', nextMode);
      }

      checkPreCapture(page.id, pr, cr, nextMode);
    }

    const runEagerCapture = () => {
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
    };

    if (deferredNativeSwaps.length > 0) {
      // WebView が OS レベルで描画されるのを 1 フレーム待ってからスクリーンショットを非表示にする
      requestAnimationFrame(() => {
        for (const wrapper of deferredNativeSwaps) {
          wrapper.setAttribute('data-display-mode', 'native');
        }
        setDisplayModes(modes);
        runEagerCapture();
      });
    } else {
      setDisplayModes(modes);
      runEagerCapture();
    }
  }, [canvasRef, checkPreCapture, containerRef, pages, zoomRef]);

  // setBoundsSize アプローチでは pageZoom を使わないため、zoom 後のリフロー待ちは不要。
  // インターフェース互換性のため関数は残し、単純に computeDisplayModes を rAF 後に実行する。
  const cancelZoomRestore = useCallback(() => {
    // no-op（pageZoom 廃止により zoom リフロー待ち機構は不要）
  }, []);

  const scheduleZoomRestoreAfterReflow = useCallback(() => {
    // pageZoom を使わないため即座に computeDisplayModes を呼ぶだけで良い
    requestAnimationFrame(() => {
      if (activeInteractionsRef.current.size > 0) return;
      computeDisplayModes();
    });
  }, [computeDisplayModes]);

  const computeInteractionModes = useCallback(() => {
    const cr = containerRectRef.current;
    if (!cr || !canvasRef.current) return;

    if (interactionSnapshotModeRef.current) {
      const pendingBoundsEntries: {
        pageId: string;
        x: number;
        y: number;
        w: number;
        h: number;
        zoom: number;
      }[] = [];
      for (const page of pages) {
        if (!pendingSnapshotSwapRef.current.has(page.id)) continue;
        if (!page.webviewLabel) {
          pendingSnapshotSwapRef.current.delete(page.id);
          continue;
        }

        const wrapper = canvasRef.current.querySelector(
          `[data-page-id="${page.id}"]`,
        ) as HTMLElement | null;
        const el = wrapper?.querySelector('[data-webview-placeholder]') as HTMLElement | null;
        if (!el || !wrapper) continue;

        const pr = el.getBoundingClientRect();
        pendingBoundsEntries.push({
          pageId: page.id,
          x: pr.left,
          y: pr.top,
          w: pr.width,
          h: pr.height,
          zoom: zoomRef.current,
        });
      }

      if (pendingBoundsEntries.length > 0) {
        void webviewApi.updateAllBounds(pendingBoundsEntries);
      }
      return;
    }

    const boundsEntries: {
      pageId: string;
      x: number;
      y: number;
      w: number;
      h: number;
      zoom: number;
    }[] = [];
    const positionEntries: { pageId: string; x: number; y: number }[] = [];

    // パン専用の場合は位置のみ更新（size/zoom は変化しないため IPC を軽量化）
    const isPanOnly =
      activeInteractionsRef.current.has('pan') && !activeInteractionsRef.current.has('zoom');

    for (const page of pages) {
      const wrapper = canvasRef.current.querySelector(
        `[data-page-id="${page.id}"]`,
      ) as HTMLElement | null;
      const el = wrapper?.querySelector('[data-webview-placeholder]') as HTMLElement | null;
      if (!el || !wrapper) continue;

      const pr = el.getBoundingClientRect();
      const currentMode = (wrapper.getAttribute('data-display-mode') ?? 'native') as DisplayMode;

      const isOutsideExpanded =
        pr.right <= cr.left - PRE_DISPLAY_MARGIN_PX ||
        pr.left >= cr.right + PRE_DISPLAY_MARGIN_PX ||
        pr.bottom <= cr.top - PRE_DISPLAY_MARGIN_PX ||
        pr.top >= cr.bottom + PRE_DISPLAY_MARGIN_PX;

      const isOutsideCanvas =
        pr.right <= cr.left || pr.left >= cr.right || pr.bottom <= cr.top || pr.top >= cr.bottom;

      const isFullyInside =
        !isOutsideCanvas &&
        pr.left >= cr.left + NATIVE_SAFE_MARGIN_PX - HYSTERESIS_PX &&
        pr.right <= cr.right - NATIVE_SAFE_MARGIN_PX + HYSTERESIS_PX &&
        pr.top >= cr.top + NATIVE_SAFE_MARGIN_PX - HYSTERESIS_PX &&
        pr.bottom <= cr.bottom - NATIVE_SAFE_MARGIN_PX + HYSTERESIS_PX;

      if (currentMode === 'native') {
        if (isOutsideExpanded) {
          wrapper.setAttribute('data-display-mode', 'hidden');
          if (page.webviewLabel) void webviewApi.hide(page.webviewLabel);
        } else if (!isFullyInside) {
          if (screenshotReadyRef.current[page.id]) {
            wrapper.setAttribute('data-display-mode', 'screenshot');
            if (page.webviewLabel) void webviewApi.hide(page.webviewLabel);
          } else if (page.webviewLabel) {
            if (isPanOnly) {
              positionEntries.push({ pageId: page.id, x: pr.left, y: pr.top });
            } else {
              boundsEntries.push({
                pageId: page.id,
                x: pr.left,
                y: pr.top,
                w: pr.width,
                h: pr.height,
                zoom: zoomRef.current,
              });
            }
          }
        } else if (page.webviewLabel) {
          if (isPanOnly) {
            positionEntries.push({ pageId: page.id, x: pr.left, y: pr.top });
          } else {
            boundsEntries.push({
              pageId: page.id,
              x: pr.left,
              y: pr.top,
              w: pr.width,
              h: pr.height,
              zoom: zoomRef.current,
            });
          }
        }
      } else if (currentMode === 'hidden') {
        if (!isOutsideExpanded && screenshotReadyRef.current[page.id]) {
          wrapper.setAttribute('data-display-mode', 'screenshot');
        }
      } else if (isOutsideExpanded) {
        wrapper.setAttribute('data-display-mode', 'hidden');
      }

      if (currentMode === 'native' && !isOutsideCanvas) {
        checkPreCapture(page.id, pr, cr, 'native');
      }
    }

    if (isPanOnly) {
      if (positionEntries.length > 0) {
        void webviewApi.updateAllPositions(positionEntries);
      }
    } else if (boundsEntries.length > 0) {
      void webviewApi.updateAllBounds(boundsEntries);
    }
  }, [canvasRef, checkPreCapture, pages, zoomRef]);

  const scheduleInteractionUpdate = useCallback(() => {
    if (activeInteractionsRef.current.has('drag') || activeInteractionsRef.current.has('resize'))
      return;
    if (interactionRafRef.current !== null) return;

    interactionRafRef.current = requestAnimationFrame(() => {
      interactionRafRef.current = null;
      computeInteractionModes();
    });
  }, [computeInteractionModes]);

  const captureScreenshot = useCallback(
    async (pageId: string) => {
      if (!SCREENSHOT_CLIPPING_ENABLED) return;
      if (activeInteractionsRef.current.has('drag') || activeInteractionsRef.current.has('resize'))
        return;

      const dataUrl = await webviewApi.captureScreenshot(pageId);
      if (!dataUrl) return;

      if (activeInteractionsRef.current.has('drag') || activeInteractionsRef.current.has('resize'))
        return;

      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);

      const img = new Image();
      img.src = objectUrl;
      try {
        await img.decode();
      } catch {
        // no-op
      }

      screenshotReadyRef.current[pageId] = true;

      setScreenshotUrls((prev) => {
        const oldUrl = prev[pageId];
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        return { ...prev, [pageId]: objectUrl };
      });

      if (interactionSnapshotModeRef.current && pendingSnapshotSwapRef.current.has(pageId)) {
        const page = pages.find((p) => p.id === pageId);
        const wrapper = canvasRef.current?.querySelector(
          `[data-page-id="${pageId}"]`,
        ) as HTMLElement | null;
        if (wrapper) {
          wrapper.setAttribute('data-display-mode', 'screenshot');
        }
        if (page?.webviewLabel) {
          void webviewApi.hide(page.webviewLabel);
        }
        pendingSnapshotSwapRef.current.delete(pageId);
      }

      if (activeInteractionsRef.current.size === 0) {
        computeDisplayModes();
      }
    },
    [canvasRef, computeDisplayModes, pages],
  );

  const getAllWebviewLabels = useCallback(() => {
    return pages.map((p) => p.webviewLabel).filter((l): l is string => !!l);
  }, [pages]);

  const handleInteractionChange = useCallback(
    (active: boolean, cursor = 'default', type: InteractionType = 'drag') => {
      if (active) {
        cancelZoomRestore();
        activeInteractionsRef.current.add(type);
        setInteractionCursor(cursor);

        if (type === 'drag' || type === 'resize') {
          interactionSnapshotModeRef.current = false;
          pendingSnapshotSwapRef.current.clear();
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
          // スクリーンショットクリッピングが有効な場合のみスナップショットモードを使用する。
          // 無効時にスナップショットモードに入ると computeInteractionModes のスナップショット
          // ブランチで早期 return され、isPanOnly → updateAllPositions（軽量IPC）への
          // 最適化パスに到達できなくなるため、条件分岐で回避する。
          if (SCREENSHOT_CLIPPING_ENABLED) {
            interactionSnapshotModeRef.current = true;
            pendingSnapshotSwapRef.current.clear();

            if (canvasRef.current) {
              for (const page of pages) {
                const wrapper = canvasRef.current.querySelector(
                  `[data-page-id="${page.id}"]`,
                ) as HTMLElement | null;
                if (!wrapper) continue;

                if (!page.webviewLabel) {
                  wrapper.setAttribute('data-display-mode', 'hidden');
                  continue;
                }

                if (screenshotReadyRef.current[page.id]) {
                  wrapper.setAttribute('data-display-mode', 'screenshot');
                  void webviewApi.hide(page.webviewLabel);
                  continue;
                }

                wrapper.setAttribute('data-display-mode', 'native');
                pendingSnapshotSwapRef.current.add(page.id);
                if (!captureInFlightRef.current[page.id]) {
                  captureInFlightRef.current[page.id] = true;
                  lastCaptureTimeRef.current[page.id] = Date.now();
                  void captureScreenshotRef.current?.(page.id).finally(() => {
                    captureInFlightRef.current[page.id] = false;
                  });
                }
              }
            }
          }

          containerRectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
          computeInteractionModes();
        }
        return;
      }

      activeInteractionsRef.current.delete(type);
      const hasPanOrZoom =
        activeInteractionsRef.current.has('pan') || activeInteractionsRef.current.has('zoom');
      if (!hasPanOrZoom) {
        interactionSnapshotModeRef.current = false;
        pendingSnapshotSwapRef.current.clear();
      }

      if (activeInteractionsRef.current.size === 0) {
        if (interactionRafRef.current !== null) {
          cancelAnimationFrame(interactionRafRef.current);
          interactionRafRef.current = null;
        }
        containerRectRef.current = null;
        setInteractionCursor(null);
        prevModesRef.current = {};
        nearEdgeRef.current = {};

        if (type === 'zoom') {
          scheduleZoomRestoreAfterReflow();
        } else {
          computeDisplayModes();
        }
      }
    },
    [
      cancelZoomRestore,
      canvasRef,
      computeDisplayModes,
      computeInteractionModes,
      containerRef,
      getAllWebviewLabels,
      pages,
      scheduleZoomRestoreAfterReflow,
    ],
  );

  const cleanupPageArtifacts = useCallback((pageId: string) => {
    setDisplayModes((prev) => {
      if (!(pageId in prev)) return prev;
      const next = { ...prev };
      delete next[pageId];
      return next;
    });
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
    pendingSnapshotSwapRef.current.delete(pageId);
  }, []);

  useEffect(() => {
    const nextIds = new Set(pages.map((page) => page.id));
    for (const pageId of knownPageIdsRef.current) {
      if (!nextIds.has(pageId)) {
        cleanupPageArtifacts(pageId);
      }
    }
    knownPageIdsRef.current = nextIds;
  }, [cleanupPageArtifacts, pages]);

  useEffect(() => {
    captureScreenshotRef.current = captureScreenshot;
  }, [captureScreenshot]);

  useEffect(() => {
    screenshotUrlsRef.current = screenshotUrls;
  }, [screenshotUrls]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      computeDisplayModes();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [computeDisplayModes, containerRef]);

  useEffect(() => {
    const handleBlur = () => {
      if (activeInteractionsRef.current.size === 0) return;
      activeInteractionsRef.current.clear();

      if (interactionRafRef.current !== null) {
        cancelAnimationFrame(interactionRafRef.current);
        interactionRafRef.current = null;
      }

      containerRectRef.current = null;
      cancelZoomRestore();
      interactionSnapshotModeRef.current = false;
      pendingSnapshotSwapRef.current.clear();
      setInteractionCursor(null);
      prevModesRef.current = {};
      nearEdgeRef.current = {};
      computeDisplayModes();
    };

    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [cancelZoomRestore, computeDisplayModes]);

  useEffect(() => {
    if (!centeredPageId) return;

    const targetPage = pages.find((p) => p.id === centeredPageId);
    if (!targetPage) {
      onCenteredPageHandled?.();
      return;
    }

    const frameId = requestAnimationFrame(() => {
      computeDisplayModes();
      void captureScreenshot(targetPage.id);
      onCenteredPageHandled?.();
    });

    return () => cancelAnimationFrame(frameId);
  }, [captureScreenshot, centeredPageId, computeDisplayModes, onCenteredPageHandled, pages]);

  useEffect(() => {
    const refresh = () => {
      if (activeInteractionsRef.current.has('drag') || activeInteractionsRef.current.has('resize'))
        return;
      if (interactionSnapshotModeRef.current) return;
      if (!canvasRef.current) return;

      const now = Date.now();
      for (const page of pages) {
        if (!page.webviewLabel) continue;
        if (captureInFlightRef.current[page.id]) continue;
        if (now - (lastCaptureTimeRef.current[page.id] ?? 0) < SCREENSHOT_REFRESH_INTERVAL_MS)
          continue;

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
  }, [canvasRef, pages]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(screenshotUrlsRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  return {
    activeInteractionsRef,
    captureScreenshot,
    cancelZoomRestore,
    cleanupPageArtifacts,
    computeDisplayModes,
    computeInteractionModes,
    displayModes,
    handleInteractionChange,
    interactionCursor,
    scheduleInteractionUpdate,
    scheduleZoomRestoreAfterReflow,
    screenshotUrls,
  };
}
