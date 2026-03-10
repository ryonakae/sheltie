import { convertFileSrc } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { WEBVIEW_REVEAL_DELAY_MS } from '@/constants';
import { getPlatformInfo, webviewApi } from '@/lib/tauri-bridge';
import type { DisplayMode, WebPageNode } from '@/types';

import { getWebPageElements, setDisplayModeAttribute } from './display-engine/dom';
import {
  isFullyInsideNativeSafeArea,
  isOutsideExpandedViewport,
  resolveViewportDisplayMode,
} from './display-engine/mode';

import type { InteractionType } from './types';

/** 検証用フラグ: false にするとスクリーンショットクリッピング機能を完全に無効化する */
const SCREENSHOT_CLIPPING_ENABLED = true;

interface UseSiteboardDisplayEngineParams {
  webPageNodes: WebPageNode[];
  webviewLabelsByNodeId: Record<string, string>;
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
  webPageNodes,
  webviewLabelsByNodeId,
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
  const webPageIds = useMemo(() => webPageNodes.map((page) => page.id), [webPageNodes]);
  const webPageIdsKey = useMemo(() => webPageIds.join('|'), [webPageIds]);

  const getWebviewLabel = useCallback(
    (nodeId: string) => webviewLabelsByNodeId[nodeId],
    [webviewLabelsByNodeId],
  );

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
      const targetWrapper = wrapper ?? getWebPageElements(canvasRef.current, nodeId).wrapper;
      setDisplayModeAttribute(targetWrapper, mode);

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

    const containerRect = containerRef.current.getBoundingClientRect();
    const modes: Record<string, DisplayMode> = {};
    // 非 macOS: screenshot→native 遷移ページは show 後 1 フレーム待ってスクショを消す
    const deferredNativeSwaps: HTMLElement[] = [];

    for (const page of webPageNodes) {
      const label = getWebviewLabel(page.id);
      const { wrapper, placeholder } = getWebPageElements(canvasRef.current, page.id);
      if (!placeholder || !wrapper) {
        modes[page.id] = 'hidden';
        cancelNativeReveal(page.id);
        continue;
      }

      const placeholderRect = placeholder.getBoundingClientRect();
      let nextMode = resolveViewportDisplayMode(
        placeholderRect,
        containerRect,
        hasStoredScreenshot(page.id),
      );

      // コンテキストメニュー表示中のページは native に復帰させない
      if (contextMenuNodeIdRef.current === page.id && nextMode === 'native') {
        nextMode = hasStoredScreenshot(page.id) ? 'screenshot' : 'hidden';
      }
      if (!label && nextMode === 'native') {
        nextMode = getFallbackDisplayMode(page.id);
      }

      const currentAttr = wrapper.getAttribute('data-display-mode') ?? 'native';
      if (nextMode !== 'native' && pendingNativeRevealRef.current.has(page.id)) {
        cancelNativeReveal(page.id);
      }

      modes[page.id] = nextMode;

      if (label) {
        if (nextMode === 'native') {
          void webviewApi.updateBounds(
            page.id,
            placeholderRect.left,
            placeholderRect.top,
            placeholderRect.width,
            placeholderRect.height,
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
              void webviewApi.show(label);

              nativeRevealTimersRef.current[page.id] = window.setTimeout(() => {
                if (nativeRevealTokenRef.current[page.id] !== token) return;
                delete nativeRevealTimersRef.current[page.id];

                void webviewApi.setOpacity(page.id, 1);

                requestAnimationFrame(() => {
                  if (nativeRevealTokenRef.current[page.id] !== token) return;
                  pendingNativeRevealRef.current.delete(page.id);
                  delete nativeRevealTokenRef.current[page.id];

                  const latestWrapper = getWebPageElements(canvasRef.current, page.id).wrapper;
                  if (!latestWrapper) return;

                  setDisplayModeAttribute(latestWrapper, 'native');
                  setDisplayModes((prev) => {
                    if (prev[page.id] === 'native') return prev;
                    return { ...prev, [page.id]: 'native' };
                  });
                });
              }, WEBVIEW_REVEAL_DELAY_MS);
            } else {
              void webviewApi.show(label);
            }
          } else {
            if (isMacOsRef.current) {
              void webviewApi.setOpacity(page.id, 1);
            }
            void webviewApi.show(label);
            if (isScreenshotToNative) {
              deferredNativeSwaps.push(wrapper);
            } else {
              setDisplayModeAttribute(wrapper, 'native');
            }
          }
        } else {
          if (isMacOsRef.current) {
            void webviewApi.setOpacity(page.id, 1);
          }
          setDisplayModeAttribute(wrapper, nextMode);
          void webviewApi.hide(label);
        }
      } else {
        setDisplayModeAttribute(wrapper, nextMode);
      }
    }

    if (deferredNativeSwaps.length > 0) {
      // WebView が OS レベルで描画されるのを 1 フレーム待ってからスクリーンショットを非表示にする
      requestAnimationFrame(() => {
        for (const wrapper of deferredNativeSwaps) {
          setDisplayModeAttribute(wrapper, 'native');
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
    getWebviewLabel,
    hasStoredScreenshot,
    webPageNodes,
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
    const containerRect = containerRectRef.current;
    if (!containerRect || !canvasRef.current) return;

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

    for (const page of webPageNodes) {
      const label = getWebviewLabel(page.id);
      const { wrapper, placeholder } = getWebPageElements(canvasRef.current, page.id);
      if (!placeholder || !wrapper) continue;

      const placeholderRect = placeholder.getBoundingClientRect();
      const currentMode = (wrapper.getAttribute('data-display-mode') ?? 'native') as DisplayMode;

      const isOutsideExpanded = isOutsideExpandedViewport(placeholderRect, containerRect);
      const isFullyInside = isFullyInsideNativeSafeArea(placeholderRect, containerRect);

      if (!label) {
        setNodeDisplayMode(page.id, getFallbackDisplayMode(page.id, isOutsideExpanded), wrapper);
        continue;
      }

      if (currentMode === 'native') {
        if (isOutsideExpanded) {
          setNodeDisplayMode(page.id, 'hidden', wrapper);
          hideNodeWebview(page.id, label);
        } else if (!isFullyInside) {
          if (hasStoredScreenshot(page.id)) {
            setNodeDisplayMode(page.id, 'screenshot', wrapper);
            hideNodeWebview(page.id, label);
          } else {
            if (isPanOnly) {
              positionEntries.push({
                pageId: page.id,
                x: placeholderRect.left,
                y: placeholderRect.top,
              });
            } else {
              boundsEntries.push({
                pageId: page.id,
                x: placeholderRect.left,
                y: placeholderRect.top,
                w: placeholderRect.width,
                h: placeholderRect.height,
                zoom: zoomRef.current,
              });
            }
          }
        } else {
          if (isPanOnly) {
            positionEntries.push({
              pageId: page.id,
              x: placeholderRect.left,
              y: placeholderRect.top,
            });
          } else {
            boundsEntries.push({
              pageId: page.id,
              x: placeholderRect.left,
              y: placeholderRect.top,
              w: placeholderRect.width,
              h: placeholderRect.height,
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
    getWebviewLabel,
    hasStoredScreenshot,
    hideNodeWebview,
    webPageNodes,
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

        const label = getWebviewLabel(nodeId);
        if (label) {
          const shouldUseScreenshotNow =
            contextMenuNodeIdRef.current === nodeId ||
            activeInteractionsRef.current.has('pan') ||
            activeInteractionsRef.current.has('zoom');

          if (shouldUseScreenshotNow) {
            setNodeDisplayMode(nodeId, 'screenshot');
            hideNodeWebview(nodeId, label);
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
      getWebviewLabel,
      hideNodeWebview,
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
      const label = getWebviewLabel(nodeId);
      if (!label) return;

      cancelNativeReveal(nodeId);

      const { wrapper } = getWebPageElements(canvasRef.current, nodeId);
      if (hasStoredScreenshot(nodeId)) {
        setNodeDisplayMode(nodeId, 'screenshot', wrapper);
        hideNodeWebview(nodeId, label);
      } else {
        setNodeDisplayMode(nodeId, 'native', wrapper);
      }
    },
    [
      canvasRef,
      cancelNativeReveal,
      getWebviewLabel,
      hasStoredScreenshot,
      hideNodeWebview,
      setNodeDisplayMode,
    ],
  );

  const handlePageResizeEnd = useCallback(
    (nodeId: string) => {
      if (resizingNodeIdRef.current === nodeId) {
        resizingNodeIdRef.current = null;
      }

      const label = getWebviewLabel(nodeId);
      if (!label) {
        if (activeInteractionsRef.current.size === 0) {
          computeDisplayModes();
        }
        return;
      }

      requestAnimationFrame(() => {
        if (activeInteractionsRef.current.has('resize')) return;

        const { wrapper, placeholder } = getWebPageElements(canvasRef.current, nodeId);
        if (!wrapper || !placeholder) {
          if (activeInteractionsRef.current.size === 0) {
            computeDisplayModes();
          }
          return;
        }

        const placeholderRect = placeholder.getBoundingClientRect();
        setNodeDisplayMode(nodeId, 'native', wrapper);

        void webviewApi.updateBounds(
          nodeId,
          placeholderRect.left,
          placeholderRect.top,
          placeholderRect.width,
          placeholderRect.height,
          zoomRef.current,
        );
        void webviewApi.show(label);
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
      getWebviewLabel,
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
            for (const page of webPageNodes) {
              const label = getWebviewLabel(page.id);
              const { wrapper } = getWebPageElements(canvasRef.current, page.id);
              if (!wrapper) continue;

              if (!label) {
                setNodeDisplayMode(page.id, getFallbackDisplayMode(page.id), wrapper);
                continue;
              }

              if (hasStoredScreenshot(page.id)) {
                setNodeDisplayMode(page.id, 'screenshot', wrapper);
                hideNodeWebview(page.id, label);
              } else {
                setNodeDisplayMode(page.id, 'native', wrapper);
              }
            }
          }
        } else if (type === 'resize') {
          // resize 開始時の表示制御は handlePageResizeStart 側で行う
        } else {
          if (SCREENSHOT_CLIPPING_ENABLED && canvasRef.current) {
            for (const page of webPageNodes) {
              const label = getWebviewLabel(page.id);
              const { wrapper } = getWebPageElements(canvasRef.current, page.id);
              if (!wrapper) continue;

              if (!label) {
                setNodeDisplayMode(page.id, getFallbackDisplayMode(page.id), wrapper);
                continue;
              }

              if (hasStoredScreenshot(page.id)) {
                setNodeDisplayMode(page.id, 'screenshot', wrapper);
                hideNodeWebview(page.id, label);
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
      getWebviewLabel,
      hasStoredScreenshot,
      hideNodeWebview,
      scheduleZoomRestoreAfterReflow,
      setNodeDisplayMode,
      webPageNodes,
    ],
  );

  const handleContextMenuOpen = useCallback(
    async (nodeId: string) => {
      cancelNativeReveal(nodeId);
      const label = getWebviewLabel(nodeId);

      if (!hasStoredScreenshot(nodeId) && label) {
        await ensureScreenshotReady(nodeId, {
          forceDuringInteraction: true,
        });
      }

      contextMenuNodeIdRef.current = nodeId;

      const { wrapper } = getWebPageElements(canvasRef.current, nodeId);

      const newMode: DisplayMode = hasStoredScreenshot(nodeId) ? 'screenshot' : 'hidden';
      setNodeDisplayMode(nodeId, newMode, wrapper);

      if (label) {
        hideNodeWebview(nodeId, label);
      }
    },
    [
      canvasRef,
      cancelNativeReveal,
      ensureScreenshotReady,
      getWebviewLabel,
      hasStoredScreenshot,
      hideNodeWebview,
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
    const nextIds = new Set(webPageIds);
    for (const nodeId of knownNodeIdsRef.current) {
      if (!nextIds.has(nodeId)) {
        cleanupPageArtifacts(nodeId);
      }
    }
    knownNodeIdsRef.current = nextIds;
  }, [cleanupPageArtifacts, webPageIds, webPageIdsKey]);

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
    const restorablePageIds = webPageNodes.filter((page) => page.url).map((page) => page.id);
    if (restorablePageIds.length === 0) return;

    let cancelled = false;
    void webviewApi.getExistingScreenshotPaths(projectId, restorablePageIds).then((entries) => {
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
  }, [computeDisplayModes, projectId, webPageIdsKey, webPageNodes]);

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

    const targetPage = webPageNodes.find((page) => page.id === centeredNodeId);
    if (!targetPage) {
      onCenteredNodeHandled?.();
      return;
    }

    const frameId = requestAnimationFrame(() => {
      computeDisplayModes();
      onCenteredNodeHandled?.();
    });

    return () => cancelAnimationFrame(frameId);
  }, [centeredNodeId, computeDisplayModes, onCenteredNodeHandled, webPageNodes]);

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
