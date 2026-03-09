import { convertFileSrc } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  HYSTERESIS_PX,
  NATIVE_SAFE_MARGIN_BOTTOM_PX,
  NATIVE_SAFE_MARGIN_PX,
  PRE_DISPLAY_MARGIN_PX,
  WEBVIEW_REVEAL_DELAY_MS,
} from '@/constants';
import { getPlatformInfo, webviewApi } from '@/lib/tauri-bridge';
import type { DisplayMode, BoardNode } from '@/types';
import { isWebPageNode } from '@/types';

import type { InteractionType } from './types';

/** 検証用フラグ: false にするとスクリーンショットクリッピング機能を完全に無効化する */
const SCREENSHOT_CLIPPING_ENABLED = true;

interface UseSiteboardDisplayEngineParams {
  nodes: BoardNode[];
  projectId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  zoomRef: React.RefObject<number>;
  centeredNodeId?: string | null;
  onCenteredNodeHandled?: () => void;
}

interface CaptureScreenshotOptions {
  forceDuringInteraction?: boolean;
  source?: 'default' | 'interaction-start' | 'resize-end';
  waitForPresentation?: boolean;
}

export function useSiteboardDisplayEngine({
  nodes,
  projectId,
  containerRef,
  canvasRef,
  zoomRef,
  centeredNodeId = null,
  onCenteredNodeHandled,
}: UseSiteboardDisplayEngineParams) {
  const [displayModes, setDisplayModes] = useState<Record<string, DisplayMode>>({});
  const [screenshotUrls, setScreenshotUrls] = useState<Record<string, string>>({});
  const [interactionCursor, setInteractionCursor] = useState<string | null>(null);

  const screenshotReadyRef = useRef<Record<string, boolean>>({});
  const capturePromiseRef = useRef<Record<string, Promise<boolean> | undefined>>({});
  const captureScreenshotRef = useRef<
    ((nodeId: string, options?: CaptureScreenshotOptions) => Promise<boolean>) | null
  >(null);
  const interactionRafRef = useRef<number | null>(null);
  const containerRectRef = useRef<DOMRect | null>(null);
  const activeInteractionsRef = useRef<Set<InteractionType>>(new Set());
  const isMacOsRef = useRef(false);
  const pendingNativeRevealRef = useRef<Set<string>>(new Set());
  const nativeRevealTimersRef = useRef<Record<string, number>>({});
  const nativeRevealTokenRef = useRef<Record<string, number>>({});
  const resizingNodeIdRef = useRef<string | null>(null);
  const contextMenuNodeIdRef = useRef<string | null>(null);

  const screenshotUrlsRef = useRef<Record<string, string>>({});
  const presentedScreenshotUrlRef = useRef<Record<string, string>>({});
  const screenshotPresentationWaitersRef = useRef<
    Record<string, { url: string; resolvers: Array<() => void> }>
  >({});
  const knownNodeIdsRef = useRef<Set<string>>(new Set());

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

  const cancelNativeReveal = useCallback((nodeId: string) => {
    const timerId = nativeRevealTimersRef.current[nodeId];
    const wasPending = pendingNativeRevealRef.current.delete(nodeId);
    const hadToken = nodeId in nativeRevealTokenRef.current;

    if (timerId !== undefined) {
      clearTimeout(timerId);
      delete nativeRevealTimersRef.current[nodeId];
    }
    if (hadToken) {
      delete nativeRevealTokenRef.current[nodeId];
    }

    if (isMacOsRef.current && (wasPending || hadToken || timerId !== undefined)) {
      void webviewApi.setOpacity(nodeId, 1);
    }
  }, []);

  const cancelAllNativeReveals = useCallback(() => {
    const nodeIds = new Set([
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
    for (const nodeId of nodeIds) {
      void webviewApi.setOpacity(nodeId, 1);
    }
  }, []);

  const hasStoredScreenshot = useCallback((nodeId: string) => {
    return Boolean(screenshotUrlsRef.current[nodeId]);
  }, []);

  const getFallbackDisplayMode = useCallback(
    (nodeId: string, isOutside = false): DisplayMode => {
      if (isOutside) return 'hidden';
      return hasStoredScreenshot(nodeId) ? 'screenshot' : 'hidden';
    },
    [hasStoredScreenshot],
  );

  const setNodeDisplayMode = useCallback(
    (nodeId: string, mode: DisplayMode, wrapper?: HTMLElement | null) => {
      const targetWrapper =
        wrapper ??
        (canvasRef.current?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null) ??
        null;

      if (targetWrapper?.getAttribute('data-display-mode') !== mode) {
        targetWrapper?.setAttribute('data-display-mode', mode);
      }

      setDisplayModes((prev) => {
        if (prev[nodeId] === mode) return prev;
        return { ...prev, [nodeId]: mode };
      });
    },
    [canvasRef],
  );

  const hideNodeWebview = useCallback((nodeId: string, label: string) => {
    if (isMacOsRef.current) {
      void webviewApi.setOpacity(nodeId, 1);
    }
    void webviewApi.hide(label);
  }, []);

  const waitForScreenshotPresentation = useCallback((nodeId: string, url: string) => {
    if (!url) {
      return Promise.resolve();
    }
    if (presentedScreenshotUrlRef.current[nodeId] === url) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const settle = () => {
        clearTimeout(timeoutId);
        resolve();
      };

      const existing = screenshotPresentationWaitersRef.current[nodeId];
      if (existing?.url === url) {
        existing.resolvers.push(settle);
      } else {
        screenshotPresentationWaitersRef.current[nodeId] = {
          url,
          resolvers: [settle],
        };
      }

      const timeoutId = window.setTimeout(() => {
        const current = screenshotPresentationWaitersRef.current[nodeId];
        if (current?.url === url) {
          current.resolvers = current.resolvers.filter((resolver) => resolver !== settle);
          if (current.resolvers.length === 0) {
            delete screenshotPresentationWaitersRef.current[nodeId];
          }
        }
        resolve();
      }, 250);
    });
  }, []);

  const ensureScreenshotReady = useCallback(
    async (nodeId: string, options?: CaptureScreenshotOptions) => {
      if (!SCREENSHOT_CLIPPING_ENABLED) return false;

      const currentUrl = screenshotUrlsRef.current[nodeId];
      if (screenshotReadyRef.current[nodeId] && currentUrl) {
        await waitForScreenshotPresentation(nodeId, currentUrl);
        return true;
      }

      const pendingCapture = capturePromiseRef.current[nodeId];
      if (pendingCapture) {
        return pendingCapture;
      }

      return (
        (await captureScreenshotRef.current?.(nodeId, {
          ...options,
          waitForPresentation: true,
        })) ?? false
      );
    },
    [waitForScreenshotPresentation],
  );

  const computeDisplayModes = useCallback(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const cr = containerRef.current.getBoundingClientRect();
    const modes: Record<string, DisplayMode> = {};
    // 非 macOS: screenshot→native 遷移ページは show 後 1 フレーム待ってスクショを消す
    const deferredNativeSwaps: HTMLElement[] = [];

    for (const page of nodes) {
      const wrapper = canvasRef.current.querySelector(
        `[data-node-id="${page.id}"]`,
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
        nextMode = hasStoredScreenshot(page.id) ? 'screenshot' : 'native';
      }

      // コンテキストメニュー表示中のページは native に復帰させない
      if (contextMenuNodeIdRef.current === page.id && nextMode === 'native') {
        nextMode = hasStoredScreenshot(page.id) ? 'screenshot' : 'hidden';
      }
      if (!page.webviewLabel && nextMode === 'native') {
        nextMode = getFallbackDisplayMode(page.id);
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
                    `[data-node-id="${page.id}"]`,
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
  }, [
    canvasRef,
    cancelNativeReveal,
    containerRef,
    getFallbackDisplayMode,
    hasStoredScreenshot,
    nodes,
    zoomRef,
  ]);

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

    for (const page of nodes) {
      const wrapper = canvasRef.current.querySelector(
        `[data-node-id="${page.id}"]`,
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

      if (!page.webviewLabel) {
        setNodeDisplayMode(page.id, getFallbackDisplayMode(page.id, isOutsideExpanded), wrapper);
        continue;
      }

      if (currentMode === 'native') {
        if (isOutsideExpanded) {
          setNodeDisplayMode(page.id, 'hidden', wrapper);
          hideNodeWebview(page.id, page.webviewLabel);
        } else if (!isFullyInside) {
          if (hasStoredScreenshot(page.id)) {
            setNodeDisplayMode(page.id, 'screenshot', wrapper);
            hideNodeWebview(page.id, page.webviewLabel);
          } else {
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
        } else {
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
        if (!isOutsideExpanded && hasStoredScreenshot(page.id)) {
          setNodeDisplayMode(page.id, 'screenshot', wrapper);
        }
      } else if (isOutsideExpanded) {
        setNodeDisplayMode(page.id, 'hidden', wrapper);
      }
    }

    if (isPanOnly) {
      if (positionEntries.length > 0) {
        void webviewApi.updateAllPositions(positionEntries);
      }
    } else if (boundsEntries.length > 0) {
      void webviewApi.updateAllBounds(boundsEntries);
    }
  }, [
    canvasRef,
    getFallbackDisplayMode,
    hasStoredScreenshot,
    hideNodeWebview,
    nodes,
    setNodeDisplayMode,
    zoomRef,
  ]);

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
    async (nodeId: string, options?: CaptureScreenshotOptions) => {
      const existingPromise = capturePromiseRef.current[nodeId];
      if (existingPromise) {
        return existingPromise;
      }

      const forceDuringInteraction = options?.forceDuringInteraction ?? false;
      if (!SCREENSHOT_CLIPPING_ENABLED) return false;
      if (
        !forceDuringInteraction &&
        (activeInteractionsRef.current.has('drag') || activeInteractionsRef.current.has('resize'))
      )
        return false;

      const captureTask = (async () => {
        const filePath = await webviewApi.saveScreenshot(nodeId, projectId);
        if (!filePath) return false;

        if (
          !forceDuringInteraction &&
          (activeInteractionsRef.current.has('drag') || activeInteractionsRef.current.has('resize'))
        )
          return false;

        const assetUrl = `${convertFileSrc(filePath)}?t=${Date.now()}`;

        const img = new Image();
        img.src = assetUrl;
        try {
          await img.decode();
        } catch {
          // no-op
        }

        screenshotReadyRef.current[nodeId] = true;
        delete presentedScreenshotUrlRef.current[nodeId];

        setScreenshotUrls((prev) => {
          const next = { ...prev, [nodeId]: assetUrl };
          screenshotUrlsRef.current = next;
          return next;
        });

        if (options?.waitForPresentation ?? true) {
          await waitForScreenshotPresentation(nodeId, assetUrl);
        }

        const page = nodes.find((candidate) => candidate.id === nodeId);
        if (page?.webviewLabel) {
          const shouldUseScreenshotNow =
            contextMenuNodeIdRef.current === nodeId ||
            activeInteractionsRef.current.has('pan') ||
            activeInteractionsRef.current.has('zoom');

          if (shouldUseScreenshotNow) {
            setNodeDisplayMode(nodeId, 'screenshot');
            hideNodeWebview(nodeId, page.webviewLabel);
            return true;
          }
        }

        if (activeInteractionsRef.current.size === 0) {
          computeDisplayModes();
        }
        return true;
      })().finally(() => {
        delete capturePromiseRef.current[nodeId];
      });

      capturePromiseRef.current[nodeId] = captureTask;
      return captureTask;
    },
    [
      computeDisplayModes,
      hideNodeWebview,
      nodes,
      projectId,
      setNodeDisplayMode,
      waitForScreenshotPresentation,
    ],
  );

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
    (nodeId: string) => {
      resizingNodeIdRef.current = nodeId;
      const page = nodes.find((p) => p.id === nodeId);
      if (!page?.webviewLabel) return;

      cancelNativeReveal(nodeId);

      const wrapper = canvasRef.current?.querySelector(
        `[data-node-id="${nodeId}"]`,
      ) as HTMLElement | null;
      if (hasStoredScreenshot(nodeId)) {
        setNodeDisplayMode(nodeId, 'screenshot', wrapper);
        hideNodeWebview(nodeId, page.webviewLabel);
      } else {
        setNodeDisplayMode(nodeId, 'native', wrapper);
      }
    },
    [
      canvasRef,
      cancelNativeReveal,
      hasStoredScreenshot,
      hideNodeWebview,
      nodes,
      setNodeDisplayMode,
    ],
  );

  const handlePageResizeEnd = useCallback(
    (nodeId: string) => {
      if (resizingNodeIdRef.current === nodeId) {
        resizingNodeIdRef.current = null;
      }

      const page = nodes.find((p) => p.id === nodeId);
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
          `[data-node-id="${nodeId}"]`,
        ) as HTMLElement | null;
        const el = wrapper?.querySelector('[data-webview-placeholder]') as HTMLElement | null;
        if (!wrapper || !el) {
          if (activeInteractionsRef.current.size === 0) {
            computeDisplayModes();
          }
          return;
        }

        const pr = el.getBoundingClientRect();
        setNodeDisplayMode(nodeId, 'native', wrapper);

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
          void webviewApi.setOpacity(nodeId, 0);
        }

        void (async () => {
          await waitForWebviewResizeRelayout();
          if (activeInteractionsRef.current.has('resize')) return;

          await captureScreenshotRef.current?.(nodeId, {
            forceDuringInteraction: true,
            source: 'resize-end',
          });

          if (isMacOsRef.current) {
            void webviewApi.setOpacity(nodeId, 1);
          }
          if (activeInteractionsRef.current.size === 0) {
            computeDisplayModes();
          }
        })();
      });
    },
    [
      canvasRef,
      computeDisplayModes,
      nodes,
      setNodeDisplayMode,
      waitForWebviewResizeRelayout,
      zoomRef,
    ],
  );

  const handleInteractionChange = useCallback(
    (active: boolean, cursor = 'default', type: InteractionType = 'drag') => {
      if (active) {
        cancelZoomRestore();
        cancelAllNativeReveals();
        activeInteractionsRef.current.add(type);
        setInteractionCursor(cursor);

        if (type === 'drag') {
          if (canvasRef.current) {
            for (const page of nodes) {
              const wrapper = canvasRef.current.querySelector(
                `[data-node-id="${page.id}"]`,
              ) as HTMLElement | null;
              if (!wrapper) continue;

              if (!page.webviewLabel) {
                setNodeDisplayMode(page.id, getFallbackDisplayMode(page.id), wrapper);
                continue;
              }

              if (hasStoredScreenshot(page.id)) {
                setNodeDisplayMode(page.id, 'screenshot', wrapper);
                hideNodeWebview(page.id, page.webviewLabel);
              } else {
                setNodeDisplayMode(page.id, 'native', wrapper);
              }
            }
          }
        } else if (type === 'resize') {
          // resize 開始時の表示制御は handlePageResizeStart 側で行う
        } else {
          if (SCREENSHOT_CLIPPING_ENABLED && canvasRef.current) {
            for (const page of nodes) {
              const wrapper = canvasRef.current.querySelector(
                `[data-node-id="${page.id}"]`,
              ) as HTMLElement | null;
              if (!wrapper) continue;

              if (!page.webviewLabel) {
                setNodeDisplayMode(page.id, getFallbackDisplayMode(page.id), wrapper);
                continue;
              }

              if (hasStoredScreenshot(page.id)) {
                setNodeDisplayMode(page.id, 'screenshot', wrapper);
                hideNodeWebview(page.id, page.webviewLabel);
                continue;
              }

              setNodeDisplayMode(page.id, 'native', wrapper);
              void captureScreenshotRef.current?.(page.id, {
                source: 'interaction-start',
              });
            }
          }

          containerRectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
          computeInteractionModes();
        }
        return;
      }

      activeInteractionsRef.current.delete(type);
      if (activeInteractionsRef.current.size === 0) {
        if (interactionRafRef.current !== null) {
          cancelAnimationFrame(interactionRafRef.current);
          interactionRafRef.current = null;
        }
        containerRectRef.current = null;
        setInteractionCursor(null);

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
      getFallbackDisplayMode,
      hasStoredScreenshot,
      hideNodeWebview,
      nodes,
      scheduleZoomRestoreAfterReflow,
      setNodeDisplayMode,
    ],
  );

  const handleContextMenuOpen = useCallback(
    async (nodeId: string) => {
      cancelNativeReveal(nodeId);

      const page = nodes.find((p) => p.id === nodeId);

      if (!hasStoredScreenshot(nodeId) && page?.webviewLabel) {
        await ensureScreenshotReady(nodeId, {
          forceDuringInteraction: true,
        });
      }

      contextMenuNodeIdRef.current = nodeId;

      const wrapper = canvasRef.current?.querySelector(
        `[data-node-id="${nodeId}"]`,
      ) as HTMLElement | null;

      const newMode: DisplayMode = hasStoredScreenshot(nodeId) ? 'screenshot' : 'hidden';
      setNodeDisplayMode(nodeId, newMode, wrapper);

      if (page?.webviewLabel) {
        hideNodeWebview(nodeId, page.webviewLabel);
      }
    },
    [
      canvasRef,
      cancelNativeReveal,
      ensureScreenshotReady,
      hasStoredScreenshot,
      hideNodeWebview,
      nodes,
      setNodeDisplayMode,
    ],
  );

  const handleContextMenuClose = useCallback(() => {
    contextMenuNodeIdRef.current = null;
    computeDisplayModes();
  }, [computeDisplayModes]);

  const cleanupPageArtifacts = useCallback(
    (nodeId: string) => {
      cancelNativeReveal(nodeId);
      setDisplayModes((prev) => {
        if (!(nodeId in prev)) return prev;
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      setScreenshotUrls((prev) => {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      delete screenshotReadyRef.current[nodeId];
      delete capturePromiseRef.current[nodeId];
      delete presentedScreenshotUrlRef.current[nodeId];
      delete screenshotPresentationWaitersRef.current[nodeId];
      if (resizingNodeIdRef.current === nodeId) {
        resizingNodeIdRef.current = null;
      }
      // スクリーンショットファイルをクリーンアップ
      void webviewApi.deleteScreenshot(nodeId, projectId);
    },
    [cancelNativeReveal, projectId],
  );

  useEffect(() => {
    const nextIds = new Set(nodes.map((page) => page.id));
    for (const nodeId of knownNodeIdsRef.current) {
      if (!nextIds.has(nodeId)) {
        cleanupPageArtifacts(nodeId);
      }
    }
    knownNodeIdsRef.current = nextIds;
  }, [cleanupPageArtifacts, nodes]);

  useEffect(() => {
    captureScreenshotRef.current = captureScreenshot;
  }, [captureScreenshot]);

  useEffect(() => {
    screenshotUrlsRef.current = screenshotUrls;
  }, [screenshotUrls]);

  const handleScreenshotPresented = useCallback(
    (nodeId: string, url: string) => {
      presentedScreenshotUrlRef.current[nodeId] = url;
      const waiter = screenshotPresentationWaitersRef.current[nodeId];
      if (waiter?.url === url) {
        delete screenshotPresentationWaitersRef.current[nodeId];
        for (const resolve of waiter.resolvers) {
          resolve();
        }
      }

      if (activeInteractionsRef.current.size === 0) {
        computeDisplayModes();
      }
    },
    [computeDisplayModes],
  );

  // 起動時に保存済みスクリーンショットをファイルシステムから復元する。
  // screenshotReadyRef を true に設定することで、右クリック時の白画面や
  // 起動直後の Webview がサイドバーに重なる問題を防ぐ。
  useEffect(() => {
    const webPageIds = nodes.filter((p) => isWebPageNode(p) && p.url).map((p) => p.id);
    if (webPageIds.length === 0) return;

    let cancelled = false;
    void webviewApi.getExistingScreenshotPaths(projectId, webPageIds).then((entries) => {
      if (cancelled || entries.length === 0) return;

      const restoredUrls: Record<string, string> = {};
      for (const [nodeId, filePath] of entries) {
        screenshotReadyRef.current[nodeId] = true;
        restoredUrls[nodeId] = `${convertFileSrc(filePath)}?t=restored`;
      }
      setScreenshotUrls((prev) => ({ ...prev, ...restoredUrls }));
      // 復元後にモード判定を再実行し、端のページが screenshot モードで表示されるようにする
      requestAnimationFrame(() => computeDisplayModes());
    });

    return () => {
      cancelled = true;
    };
    // 初回マウント時のみ実行（projectId は起動後に変化しない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      resizingNodeIdRef.current = null;
      setInteractionCursor(null);
      computeDisplayModes();
    };

    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [cancelAllNativeReveals, cancelZoomRestore, computeDisplayModes]);

  useEffect(() => {
    if (!centeredNodeId) return;

    const targetPage = nodes.find((p) => p.id === centeredNodeId);
    if (!targetPage) {
      onCenteredNodeHandled?.();
      return;
    }

    const frameId = requestAnimationFrame(() => {
      computeDisplayModes();
      onCenteredNodeHandled?.();
    });

    return () => cancelAnimationFrame(frameId);
  }, [centeredNodeId, computeDisplayModes, onCenteredNodeHandled, nodes]);

  useEffect(() => {
    return () => {
      cancelAllNativeReveals();
      resizingNodeIdRef.current = null;
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
    handleContextMenuClose,
    handleContextMenuOpen,
    handleInteractionChange,
    handlePageResizeEnd,
    handlePageResizeStart,
    handleScreenshotPresented,
    interactionCursor,
    scheduleInteractionUpdate,
    scheduleZoomRestoreAfterReflow,
    screenshotUrls,
  };
}
