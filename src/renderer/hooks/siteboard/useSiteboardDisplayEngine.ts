import { useCallback, useEffect, useRef, useState } from 'react';

import {
  HYSTERESIS_PX,
  NATIVE_SAFE_MARGIN_BOTTOM_PX,
  NATIVE_SAFE_MARGIN_PX,
  PRE_DISPLAY_MARGIN_PX,
  WEBVIEW_REVEAL_DELAY_MS,
} from '@/renderer/constants';
import { getPlatformInfo, webviewApi } from '@/renderer/lib/tauri-bridge';
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

interface CaptureScreenshotOptions {
  forceDuringInteraction?: boolean;
  source?: 'default' | 'interaction-start' | 'resize-end';
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
  const captureInFlightRef = useRef<Record<string, boolean>>({});
  const lastCaptureTimeRef = useRef<Record<string, number>>({});
  const captureScreenshotRef = useRef<
    ((pageId: string, options?: CaptureScreenshotOptions) => Promise<void>) | null
  >(null);
  const interactionRafRef = useRef<number | null>(null);
  const containerRectRef = useRef<DOMRect | null>(null);
  const interactionSnapshotModeRef = useRef(false);
  const pendingSnapshotSwapRef = useRef<Set<string>>(new Set());
  const activeInteractionsRef = useRef<Set<InteractionType>>(new Set());
  const isMacOsRef = useRef(false);
  const pendingNativeRevealRef = useRef<Set<string>>(new Set());
  const nativeRevealTimersRef = useRef<Record<string, number>>({});
  const nativeRevealTokenRef = useRef<Record<string, number>>({});
  const resizingPageIdRef = useRef<string | null>(null);

  const screenshotUrlsRef = useRef<Record<string, string>>({});
  const knownPageIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void getPlatformInfo()
      .then(({ platform }) => {
        if (cancelled) return;
        isMacOsRef.current = platform === 'macos';
      })
      .catch(() => {
        // no-op
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const cancelNativeReveal = useCallback((pageId: string) => {
    const timerId = nativeRevealTimersRef.current[pageId];
    const wasPending = pendingNativeRevealRef.current.delete(pageId);
    const hadToken = pageId in nativeRevealTokenRef.current;

    if (timerId !== undefined) {
      clearTimeout(timerId);
      delete nativeRevealTimersRef.current[pageId];
    }
    if (hadToken) {
      delete nativeRevealTokenRef.current[pageId];
    }

    if (isMacOsRef.current && (wasPending || hadToken || timerId !== undefined)) {
      void webviewApi.setOpacity(pageId, 1);
    }
  }, []);

  const cancelAllNativeReveals = useCallback(() => {
    const pageIds = new Set([
      ...Object.keys(nativeRevealTimersRef.current),
      ...Object.keys(nativeRevealTokenRef.current),
      ...pendingNativeRevealRef.current,
    ]);

    for (const timerId of Object.values(nativeRevealTimersRef.current)) {
      clearTimeout(timerId);
    }
    nativeRevealTimersRef.current = {};
    nativeRevealTokenRef.current = {};
    pendingNativeRevealRef.current.clear();

    if (!isMacOsRef.current) return;
    for (const pageId of pageIds) {
      void webviewApi.setOpacity(pageId, 1);
    }
  }, []);

  const computeDisplayModes = useCallback(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const cr = containerRef.current.getBoundingClientRect();
    const modes: Record<string, DisplayMode> = {};
    // 非 macOS: screenshot→native 遷移ページは show 後 1 フレーム待ってスクショを消す
    const deferredNativeSwaps: HTMLElement[] = [];

    for (const page of pages) {
      const wrapper = canvasRef.current.querySelector(
        `[data-page-id="${page.id}"]`,
      ) as HTMLElement | null;
      const el = wrapper?.querySelector('[data-webview-placeholder]') as HTMLElement | null;
      if (!el || !wrapper) {
        modes[page.id] = 'hidden';
        cancelNativeReveal(page.id);
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
        pr.bottom <= cr.bottom - NATIVE_SAFE_MARGIN_BOTTOM_PX + HYSTERESIS_PX
      ) {
        nextMode = 'native';
      } else {
        nextMode = screenshotReadyRef.current[page.id] ? 'screenshot' : 'native';
      }

      const currentAttr = wrapper.getAttribute('data-display-mode') ?? 'native';
      if (nextMode !== 'native' && pendingNativeRevealRef.current.has(page.id)) {
        cancelNativeReveal(page.id);
      }

      modes[page.id] = nextMode;

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

          const isScreenshotToNative = currentAttr === 'screenshot';
          const shouldUseOpacityReveal = isMacOsRef.current && isScreenshotToNative;
          if (shouldUseOpacityReveal) {
            // macOS: show/hide の代わりに alpha を 0→1 へ遷移させて復帰時の白フラッシュを回避
            modes[page.id] = 'screenshot';

            if (!pendingNativeRevealRef.current.has(page.id)) {
              pendingNativeRevealRef.current.add(page.id);

              const token = (nativeRevealTokenRef.current[page.id] ?? 0) + 1;
              nativeRevealTokenRef.current[page.id] = token;

              void webviewApi.setOpacity(page.id, 0);
              void webviewApi.show(page.webviewLabel);

              nativeRevealTimersRef.current[page.id] = window.setTimeout(() => {
                if (nativeRevealTokenRef.current[page.id] !== token) return;
                delete nativeRevealTimersRef.current[page.id];

                void webviewApi.setOpacity(page.id, 1);

                requestAnimationFrame(() => {
                  if (nativeRevealTokenRef.current[page.id] !== token) return;
                  pendingNativeRevealRef.current.delete(page.id);
                  delete nativeRevealTokenRef.current[page.id];

                  const latestWrapper = canvasRef.current?.querySelector(
                    `[data-page-id="${page.id}"]`,
                  ) as HTMLElement | null;
                  if (!latestWrapper) return;

                  latestWrapper.setAttribute('data-display-mode', 'native');
                  setDisplayModes((prev) => {
                    if (prev[page.id] === 'native') return prev;
                    return { ...prev, [page.id]: 'native' };
                  });
                });
              }, WEBVIEW_REVEAL_DELAY_MS);
            } else {
              void webviewApi.show(page.webviewLabel);
            }
          } else {
            if (isMacOsRef.current) {
              void webviewApi.setOpacity(page.id, 1);
            }
            void webviewApi.show(page.webviewLabel);
            if (isScreenshotToNative) {
              deferredNativeSwaps.push(wrapper);
            } else {
              wrapper.setAttribute('data-display-mode', 'native');
            }
          }
        } else {
          if (isMacOsRef.current) {
            void webviewApi.setOpacity(page.id, 1);
          }
          wrapper.setAttribute('data-display-mode', nextMode);
          void webviewApi.hide(page.webviewLabel);
        }
      } else {
        wrapper.setAttribute('data-display-mode', nextMode);
      }
    }

    if (deferredNativeSwaps.length > 0) {
      // WebView が OS レベルで描画されるのを 1 フレーム待ってからスクリーンショットを非表示にする
      requestAnimationFrame(() => {
        for (const wrapper of deferredNativeSwaps) {
          wrapper.setAttribute('data-display-mode', 'native');
        }
        setDisplayModes(modes);
      });
    } else {
      setDisplayModes(modes);
    }
  }, [canvasRef, cancelNativeReveal, containerRef, pages, zoomRef]);

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
        pr.bottom <= cr.bottom - NATIVE_SAFE_MARGIN_BOTTOM_PX + HYSTERESIS_PX;

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
    }

    if (isPanOnly) {
      if (positionEntries.length > 0) {
        void webviewApi.updateAllPositions(positionEntries);
      }
    } else if (boundsEntries.length > 0) {
      void webviewApi.updateAllBounds(boundsEntries);
    }
  }, [canvasRef, pages, zoomRef]);

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
    async (pageId: string, options?: CaptureScreenshotOptions) => {
      const forceDuringInteraction = options?.forceDuringInteraction ?? false;
      if (!SCREENSHOT_CLIPPING_ENABLED) return;
      if (
        !forceDuringInteraction &&
        (activeInteractionsRef.current.has('drag') || activeInteractionsRef.current.has('resize'))
      )
        return;

      const dataUrl = await webviewApi.captureScreenshot(pageId);
      if (!dataUrl) return;

      if (
        !forceDuringInteraction &&
        (activeInteractionsRef.current.has('drag') || activeInteractionsRef.current.has('resize'))
      )
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
          if (isMacOsRef.current) {
            void webviewApi.setOpacity(pageId, 0);
          } else {
            void webviewApi.hide(page.webviewLabel);
          }
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

  const waitForWebviewResizeRelayout = useCallback(async () => {
    // updateBounds 後の WKWebView レイアウト反映を待つ（フレーム境界反映 + 余裕時間）
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), WEBVIEW_REVEAL_DELAY_MS);
    });
  }, []);

  const handlePageResizeStart = useCallback(
    (pageId: string) => {
      resizingPageIdRef.current = pageId;
      const page = pages.find((p) => p.id === pageId);
      if (!page?.webviewLabel) return;
      const webviewLabel = page.webviewLabel;

      cancelNativeReveal(pageId);
      pendingSnapshotSwapRef.current.delete(pageId);
      interactionSnapshotModeRef.current = false;

      const wrapper = canvasRef.current?.querySelector(
        `[data-page-id="${pageId}"]`,
      ) as HTMLElement | null;
      if (wrapper) {
        wrapper.setAttribute('data-display-mode', 'hidden');
      }

      setDisplayModes((prev) => {
        if (prev[pageId] === 'hidden') return prev;
        return { ...prev, [pageId]: 'hidden' };
      });

      void webviewApi.show(webviewLabel);
      if (isMacOsRef.current) {
        void webviewApi.setOpacity(pageId, 0);
      } else {
        void webviewApi.hide(webviewLabel);
      }
    },
    [canvasRef, cancelNativeReveal, pages],
  );

  const handlePageResizeEnd = useCallback(
    (pageId: string) => {
      if (resizingPageIdRef.current === pageId) {
        resizingPageIdRef.current = null;
      }

      const page = pages.find((p) => p.id === pageId);
      if (!page?.webviewLabel) {
        if (activeInteractionsRef.current.size === 0) {
          computeDisplayModes();
        }
        return;
      }
      const webviewLabel = page.webviewLabel;

      requestAnimationFrame(() => {
        if (activeInteractionsRef.current.has('resize')) return;

        const wrapper = canvasRef.current?.querySelector(
          `[data-page-id="${pageId}"]`,
        ) as HTMLElement | null;
        const el = wrapper?.querySelector('[data-webview-placeholder]') as HTMLElement | null;
        if (!wrapper || !el) {
          if (activeInteractionsRef.current.size === 0) {
            computeDisplayModes();
          }
          return;
        }

        const pr = el.getBoundingClientRect();
        wrapper.setAttribute('data-display-mode', 'native');
        setDisplayModes((prev) => {
          if (prev[pageId] === 'native') return prev;
          return { ...prev, [pageId]: 'native' };
        });

        void webviewApi.updateBounds(
          page.id,
          pr.left,
          pr.top,
          pr.width,
          pr.height,
          zoomRef.current,
        );
        void webviewApi.show(webviewLabel);
        if (isMacOsRef.current) {
          void webviewApi.setOpacity(pageId, 0);
        }

        void (async () => {
          await waitForWebviewResizeRelayout();
          if (activeInteractionsRef.current.has('resize')) return;

          if (!captureInFlightRef.current[pageId]) {
            captureInFlightRef.current[pageId] = true;
            lastCaptureTimeRef.current[pageId] = Date.now();
            try {
              await captureScreenshotRef.current?.(pageId, {
                forceDuringInteraction: true,
                source: 'resize-end',
              });
            } finally {
              captureInFlightRef.current[pageId] = false;
            }
          }

          if (isMacOsRef.current) {
            void webviewApi.setOpacity(pageId, 1);
          }
          if (activeInteractionsRef.current.size === 0) {
            computeDisplayModes();
          }
        })();
      });
    },
    [canvasRef, computeDisplayModes, pages, waitForWebviewResizeRelayout, zoomRef],
  );

  const handleInteractionChange = useCallback(
    (active: boolean, cursor = 'default', type: InteractionType = 'drag') => {
      if (active) {
        cancelZoomRestore();
        cancelAllNativeReveals();
        activeInteractionsRef.current.add(type);
        setInteractionCursor(cursor);

        if (type === 'drag') {
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
        } else if (type === 'resize') {
          interactionSnapshotModeRef.current = false;
          pendingSnapshotSwapRef.current.clear();
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
                  // 1. 古いスクショを DOM に表示（WebView が前面なのでまだ見えない）
                  wrapper.setAttribute('data-display-mode', 'screenshot');

                  // 2. WebView が visible な間に新規スクショ撮影を開始（最新スクショを取得）
                  if (!captureInFlightRef.current[page.id]) {
                    captureInFlightRef.current[page.id] = true;
                    lastCaptureTimeRef.current[page.id] = Date.now();
                    void captureScreenshotRef
                      .current?.(page.id, {
                        source: 'interaction-start',
                      })
                      .finally(() => {
                        captureInFlightRef.current[page.id] = false;
                      });
                  }

                  // 3. WebView を不可視にして古いスクショを露出させる
                  const label = page.webviewLabel;
                  if (isMacOsRef.current) {
                    // macOS: opacity:0 で透明化。ビュー階層に残るため takeSnapshot は動作する
                    void webviewApi.setOpacity(page.id, 0);
                  } else {
                    // 非 macOS: 1フレーム待って <img> の描画確定後に hide
                    requestAnimationFrame(() => {
                      void webviewApi.hide(label);
                    });
                  }
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

        if (type === 'zoom') {
          scheduleZoomRestoreAfterReflow();
        } else if (type === 'resize') {
          // resize 終了時の最終反映は handlePageResizeEnd 側で実施する
        } else {
          computeDisplayModes();
        }
      }
    },
    [
      cancelAllNativeReveals,
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

  const cleanupPageArtifacts = useCallback(
    (pageId: string) => {
      cancelNativeReveal(pageId);
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
      delete captureInFlightRef.current[pageId];
      delete lastCaptureTimeRef.current[pageId];
      pendingSnapshotSwapRef.current.delete(pageId);
      if (resizingPageIdRef.current === pageId) {
        resizingPageIdRef.current = null;
      }
    },
    [cancelNativeReveal],
  );

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
      if (activeInteractionsRef.current.size === 0 && pendingNativeRevealRef.current.size === 0)
        return;
      activeInteractionsRef.current.clear();

      if (interactionRafRef.current !== null) {
        cancelAnimationFrame(interactionRafRef.current);
        interactionRafRef.current = null;
      }

      containerRectRef.current = null;
      cancelZoomRestore();
      cancelAllNativeReveals();
      interactionSnapshotModeRef.current = false;
      pendingSnapshotSwapRef.current.clear();
      resizingPageIdRef.current = null;
      setInteractionCursor(null);
      prevModesRef.current = {};
      computeDisplayModes();
    };

    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [cancelAllNativeReveals, cancelZoomRestore, computeDisplayModes]);

  useEffect(() => {
    if (!centeredPageId) return;

    const targetPage = pages.find((p) => p.id === centeredPageId);
    if (!targetPage) {
      onCenteredPageHandled?.();
      return;
    }

    const frameId = requestAnimationFrame(() => {
      computeDisplayModes();
      onCenteredPageHandled?.();
    });

    return () => cancelAnimationFrame(frameId);
  }, [centeredPageId, computeDisplayModes, onCenteredPageHandled, pages]);

  useEffect(() => {
    return () => {
      cancelAllNativeReveals();
      resizingPageIdRef.current = null;
      for (const url of Object.values(screenshotUrlsRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, [cancelAllNativeReveals]);

  return {
    activeInteractionsRef,
    captureScreenshot,
    cancelZoomRestore,
    cleanupPageArtifacts,
    computeDisplayModes,
    computeInteractionModes,
    displayModes,
    handleInteractionChange,
    handlePageResizeEnd,
    handlePageResizeStart,
    interactionCursor,
    scheduleInteractionUpdate,
    scheduleZoomRestoreAfterReflow,
    screenshotUrls,
  };
}
