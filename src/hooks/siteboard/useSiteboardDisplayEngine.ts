import { convertFileSrc } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { WEBVIEW_REVEAL_DELAY_MS } from '@/constants';
import { getPlatformInfo, webviewApi } from '@/lib/tauri-bridge';
import type { DisplayMode, WebPageNode } from '@/types';

import { getWebPageElements, setDisplayModeAttribute } from './display-engine/dom';
import { isOutsideExpandedViewport, resolveViewportDisplayMode } from './display-engine/mode';

import type { InteractionType } from './types';

/** 検証用フラグ: false にするとスクリーンショットクリッピング機能を完全に無効化する */
const SCREENSHOT_CLIPPING_ENABLED = true;

interface UseSiteboardDisplayEngineParams {
  webPageNodes: WebPageNode[];
  webviewLabelsByNodeId: Record<string, string>;
  cachedScreenshotUrlsByNodeId: Record<string, string>;
  projectId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoomRef: React.RefObject<number>;
  centeredNodeId?: string | null;
  onCenteredNodeHandled?: () => void;
  hydrateCachedScreenshotUrls: (
    projectId: string,
    screenshotUrlsByNodeId: Record<string, string>,
  ) => void;
  setCachedScreenshotUrl: (projectId: string, nodeId: string, url: string) => void;
  clearCachedScreenshotUrl: (projectId: string, nodeId: string) => void;
}

interface CaptureScreenshotOptions {
  forceDuringInteraction?: boolean;
  hideAfterSnapshotRequest?: boolean;
  source?: 'default' | 'interaction-start' | 'resize-end';
  waitForPresentation?: boolean;
}

type InteractionPreparationType = InteractionType | 'context-menu' | 'unsaved-changes-dialog';

function buildSeededScreenshotUrls(
  webPageNodes: WebPageNode[],
  cachedScreenshotUrlsByNodeId: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const page of webPageNodes) {
    if (!page.url) continue;
    const cachedUrl = cachedScreenshotUrlsByNodeId[page.id];
    if (!cachedUrl) continue;
    next[page.id] = cachedUrl;
  }
  return next;
}

function buildInitialDisplayModes(
  webPageNodes: WebPageNode[],
  seededScreenshotUrls: Record<string, string>,
): Record<string, DisplayMode> {
  const next: Record<string, DisplayMode> = {};
  for (const page of webPageNodes) {
    next[page.id] = seededScreenshotUrls[page.id] ? 'screenshot' : 'hidden';
  }
  return next;
}

function buildScreenshotReadyState(
  seededScreenshotUrls: Record<string, string>,
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const nodeId of Object.keys(seededScreenshotUrls)) {
    next[nodeId] = true;
  }
  return next;
}

export function useSiteboardDisplayEngine({
  webPageNodes,
  webviewLabelsByNodeId,
  cachedScreenshotUrlsByNodeId,
  projectId,
  containerRef,
  zoomRef,
  centeredNodeId = null,
  onCenteredNodeHandled,
  hydrateCachedScreenshotUrls,
  setCachedScreenshotUrl,
  clearCachedScreenshotUrl,
}: UseSiteboardDisplayEngineParams) {
  const seededScreenshotUrls = useMemo(
    () => buildSeededScreenshotUrls(webPageNodes, cachedScreenshotUrlsByNodeId),
    [cachedScreenshotUrlsByNodeId, webPageNodes],
  );
  const [displayModes, setDisplayModes] = useState<Record<string, DisplayMode>>(() =>
    buildInitialDisplayModes(webPageNodes, seededScreenshotUrls),
  );
  const [screenshotUrls, setScreenshotUrls] =
    useState<Record<string, string>>(seededScreenshotUrls);

  const screenshotReadyRef = useRef<Record<string, boolean>>(
    buildScreenshotReadyState(seededScreenshotUrls),
  );
  const capturePromiseRef = useRef<Record<string, Promise<boolean> | undefined>>({});
  const pendingCaptureOptionsRef = useRef<Record<string, CaptureScreenshotOptions | undefined>>({});
  const queuedFreshCaptureRef = useRef<Record<string, boolean>>({});
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
  const unsavedChangesDialogOpenRef = useRef(false);
  const settlingNodeIdsRef = useRef<Set<string>>(new Set());
  const forceHiddenInteractionNodeIdsRef = useRef<Set<string>>(new Set());
  const nativeHiddenByInteractionCaptureRef = useRef<Set<string>>(new Set());
  const interactionCaptureRetryNodeIdsRef = useRef<Set<string>>(new Set());
  const interactionCaptureRetryTimerRef = useRef<number | null>(null);
  const resizeObserverRafRef = useRef<number | null>(null);

  const screenshotUrlsRef = useRef<Record<string, string>>(seededScreenshotUrls);
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
  const warnMissingWebviewLabel = useCallback((nodeId: string, command: string) => {
    if (!import.meta.env.DEV) return;
    console.warn(`[useSiteboardDisplayEngine] ${command}: WebView label がありません`, {
      nodeId,
    });
  }, []);

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

  const cancelNativeReveal = useCallback(
    (nodeId: string) => {
      const label = getWebviewLabel(nodeId);
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

      if (isMacOsRef.current && label && (wasPending || hadToken || timerId !== undefined)) {
        void webviewApi.setOpacity(label, 1);
      }
    },
    [getWebviewLabel],
  );

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
      const label = getWebviewLabel(nodeId);
      if (!label) continue;
      void webviewApi.setOpacity(label, 1);
    }
  }, [getWebviewLabel]);

  const cancelInteractionCaptureRetry = useCallback(() => {
    if (interactionCaptureRetryTimerRef.current === null) return;
    clearTimeout(interactionCaptureRetryTimerRef.current);
    interactionCaptureRetryTimerRef.current = null;
  }, []);

  const hasDisplayableScreenshot = useCallback((nodeId: string) => {
    return Boolean(screenshotReadyRef.current[nodeId] && screenshotUrlsRef.current[nodeId]);
  }, []);

  const isPanOrZoomInteractionActive = useCallback(() => {
    return activeInteractionsRef.current.has('pan') || activeInteractionsRef.current.has('zoom');
  }, []);

  const mergeCaptureOptions = useCallback(
    (
      current: CaptureScreenshotOptions | undefined,
      next: CaptureScreenshotOptions | undefined,
    ): CaptureScreenshotOptions | undefined => {
      if (!current) return next;
      if (!next) return current;
      return {
        forceDuringInteraction: Boolean(
          current.forceDuringInteraction || next.forceDuringInteraction,
        ),
        hideAfterSnapshotRequest: Boolean(
          current.hideAfterSnapshotRequest || next.hideAfterSnapshotRequest,
        ),
        source: next.source ?? current.source,
        waitForPresentation: Boolean(current.waitForPresentation || next.waitForPresentation),
      };
    },
    [],
  );

  const getFallbackDisplayMode = useCallback(
    (nodeId: string, isOutside = false): DisplayMode => {
      if (isOutside) return 'hidden';
      return hasDisplayableScreenshot(nodeId) ? 'screenshot' : 'hidden';
    },
    [hasDisplayableScreenshot],
  );

  const setNodeDisplayMode = useCallback(
    (nodeId: string, mode: DisplayMode, wrapper?: HTMLElement | null) => {
      const targetWrapper = wrapper ?? getWebPageElements(containerRef.current, nodeId).wrapper;
      setDisplayModeAttribute(targetWrapper, mode);

      setDisplayModes((prev) => {
        if (prev[nodeId] === mode) return prev;
        return { ...prev, [nodeId]: mode };
      });
    },
    [containerRef],
  );

  const hideNodeWebview = useCallback((label: string) => {
    if (isMacOsRef.current) {
      void webviewApi.setOpacity(label, 1);
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

      if (hasDisplayableScreenshot(nodeId)) {
        void captureScreenshotRef.current?.(nodeId, {
          ...options,
          waitForPresentation: false,
        });
        return true;
      }

      return (
        (await captureScreenshotRef.current?.(nodeId, {
          ...options,
          waitForPresentation: true,
        })) ?? false
      );
    },
    [hasDisplayableScreenshot],
  );

  const getInteractionPreparationNodeIds = useCallback(
    (type: InteractionPreparationType, targetNodeId?: string) => {
      if (!containerRef.current) return [];

      if (type === 'context-menu') {
        return targetNodeId ? [targetNodeId] : [];
      }

      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return [];

      const nodeIds: string[] = [];
      for (const page of webPageNodes) {
        const { placeholder } = getWebPageElements(containerRef.current, page.id);
        if (!placeholder) continue;

        const placeholderRect = placeholder.getBoundingClientRect();
        if (isOutsideExpandedViewport(placeholderRect, containerRect)) continue;
        nodeIds.push(page.id);
      }

      return nodeIds;
    },
    [containerRef, webPageNodes],
  );

  const prepareInteractionStart = useCallback(
    async (type: InteractionPreparationType, targetNodeId?: string) => {
      const nodeIds = getInteractionPreparationNodeIds(type, targetNodeId);
      if (nodeIds.length === 0) return true;
      const useNativeHideAfterSnapshot = type === 'pan' || type === 'zoom';

      const results = await Promise.all(
        nodeIds.map(async (nodeId) => {
          const label = getWebviewLabel(nodeId);
          if (!label) {
            return hasDisplayableScreenshot(nodeId);
          }

          const ready = await ensureScreenshotReady(nodeId, {
            hideAfterSnapshotRequest: useNativeHideAfterSnapshot,
            source: 'interaction-start',
          });

          if (ready || hasDisplayableScreenshot(nodeId)) {
            forceHiddenInteractionNodeIdsRef.current.delete(nodeId);
            interactionCaptureRetryNodeIdsRef.current.delete(nodeId);
            return true;
          }

          forceHiddenInteractionNodeIdsRef.current.add(nodeId);
          if (useNativeHideAfterSnapshot) {
            interactionCaptureRetryNodeIdsRef.current.add(nodeId);
          }
          return false;
        }),
      );

      if (type === 'context-menu') {
        return results.every(Boolean);
      }

      return true;
    },
    [
      ensureScreenshotReady,
      getInteractionPreparationNodeIds,
      getWebviewLabel,
      hasDisplayableScreenshot,
    ],
  );

  const computeDisplayModes = useCallback(() => {
    // 操作中は applyPreparedInteractionModes + computeInteractionModes が表示を管理する。
    // ここで走ると native に復帰して webview が表示されてしまう。
    if (activeInteractionsRef.current.size > 0) return;
    if (!containerRef.current || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const modes: Record<string, DisplayMode> = {};
    // 非 macOS: screenshot→native 遷移ページは show 後 1 フレーム待ってスクショを消す
    const deferredNativeSwaps: HTMLElement[] = [];

    for (const page of webPageNodes) {
      const label = getWebviewLabel(page.id);
      const { wrapper, placeholder } = getWebPageElements(containerRef.current, page.id);
      if (!placeholder || !wrapper) {
        modes[page.id] = 'hidden';
        cancelNativeReveal(page.id);
        continue;
      }

      const placeholderRect = placeholder.getBoundingClientRect();
      let nextMode = resolveViewportDisplayMode(
        placeholderRect,
        containerRect,
        hasDisplayableScreenshot(page.id),
      );

      if (unsavedChangesDialogOpenRef.current && nextMode === 'native') {
        nextMode = hasDisplayableScreenshot(page.id) ? 'screenshot' : 'hidden';
      }
      // コンテキストメニュー表示中のページは native に復帰させない
      if (contextMenuNodeIdRef.current === page.id && nextMode === 'native') {
        nextMode = hasDisplayableScreenshot(page.id) ? 'screenshot' : 'hidden';
      }
      if (settlingNodeIdsRef.current.has(page.id) && nextMode === 'native') {
        nextMode = hasDisplayableScreenshot(page.id) ? 'screenshot' : 'hidden';
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
            label,
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

              void webviewApi.setOpacity(label, 0);
              void webviewApi.show(label);

              nativeRevealTimersRef.current[page.id] = window.setTimeout(() => {
                if (nativeRevealTokenRef.current[page.id] !== token) return;
                delete nativeRevealTimersRef.current[page.id];

                void webviewApi.setOpacity(label, 1);

                requestAnimationFrame(() => {
                  if (nativeRevealTokenRef.current[page.id] !== token) return;
                  pendingNativeRevealRef.current.delete(page.id);
                  delete nativeRevealTokenRef.current[page.id];

                  const latestWrapper = getWebPageElements(containerRef.current, page.id).wrapper;
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
              void webviewApi.setOpacity(label, 1);
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
            void webviewApi.setOpacity(label, 1);
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
    containerRef,
    cancelNativeReveal,
    getFallbackDisplayMode,
    getWebviewLabel,
    hasDisplayableScreenshot,
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

  const shouldSkipImmediateInteractionHide = useCallback(
    (nodeId: string) => {
      if (!nativeHiddenByInteractionCaptureRef.current.has(nodeId)) {
        return false;
      }

      // zoom は native 側の snapshot 要求直後 hide に任せた方が安定している。
      // pan は drag 開始直後に JS 側からも hide しないと visible のまま残るケースがあるため、
      // skip せず applyPreparedInteractionModes / computeInteractionModes 側で即 hide させる。
      return activeInteractionsRef.current.has('zoom') && isPanOrZoomInteractionActive();
    },
    [isPanOrZoomInteractionActive],
  );

  const applyPreparedInteractionModes = useCallback(() => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect || !containerRef.current) return;

    for (const page of webPageNodes) {
      const label = getWebviewLabel(page.id);
      const { wrapper, placeholder } = getWebPageElements(containerRef.current, page.id);
      if (!wrapper || !placeholder) continue;

      const placeholderRect = placeholder.getBoundingClientRect();
      const isOutsideExpanded = isOutsideExpandedViewport(placeholderRect, containerRect);

      if (!label) {
        setNodeDisplayMode(page.id, getFallbackDisplayMode(page.id, isOutsideExpanded), wrapper);
        continue;
      }

      if (isOutsideExpanded) {
        setNodeDisplayMode(page.id, 'hidden', wrapper);
        if (!shouldSkipImmediateInteractionHide(page.id)) {
          hideNodeWebview(label);
        }
        continue;
      }

      if (hasDisplayableScreenshot(page.id)) {
        setNodeDisplayMode(page.id, 'screenshot', wrapper);
        if (!shouldSkipImmediateInteractionHide(page.id)) {
          hideNodeWebview(label);
        }
        continue;
      }

      if (forceHiddenInteractionNodeIdsRef.current.has(page.id)) {
        setNodeDisplayMode(page.id, 'hidden', wrapper);
        if (!shouldSkipImmediateInteractionHide(page.id)) {
          hideNodeWebview(label);
        }
        continue;
      }

      // 操作開始直後は native を残さず hidden に退避し、fresh capture 完了後に screenshot へ差し替える。
      setNodeDisplayMode(page.id, 'hidden', wrapper);
      if (!shouldSkipImmediateInteractionHide(page.id)) {
        hideNodeWebview(label);
      }
    }
  }, [
    containerRef,
    getFallbackDisplayMode,
    getWebviewLabel,
    hasDisplayableScreenshot,
    hideNodeWebview,
    setNodeDisplayMode,
    shouldSkipImmediateInteractionHide,
    webPageNodes,
  ]);

  const computeInteractionModes = useCallback(() => {
    const containerRect = containerRectRef.current;
    if (!containerRect || !containerRef.current) return;

    for (const page of webPageNodes) {
      const label = getWebviewLabel(page.id);
      const { wrapper, placeholder } = getWebPageElements(containerRef.current, page.id);
      if (!placeholder || !wrapper) continue;

      const placeholderRect = placeholder.getBoundingClientRect();
      const isOutsideExpanded = isOutsideExpandedViewport(placeholderRect, containerRect);

      if (!label) {
        setNodeDisplayMode(page.id, getFallbackDisplayMode(page.id, isOutsideExpanded), wrapper);
        continue;
      }

      if (isOutsideExpanded) {
        setNodeDisplayMode(page.id, 'hidden', wrapper);
        if (!shouldSkipImmediateInteractionHide(page.id)) {
          hideNodeWebview(label);
        }
        continue;
      }

      if (hasDisplayableScreenshot(page.id)) {
        setNodeDisplayMode(page.id, 'screenshot', wrapper);
        if (!shouldSkipImmediateInteractionHide(page.id)) {
          hideNodeWebview(label);
        }
        continue;
      }

      setNodeDisplayMode(page.id, 'hidden', wrapper);
      if (!shouldSkipImmediateInteractionHide(page.id)) {
        hideNodeWebview(label);
      }
    }
  }, [
    containerRef,
    getFallbackDisplayMode,
    getWebviewLabel,
    hasDisplayableScreenshot,
    hideNodeWebview,
    setNodeDisplayMode,
    shouldSkipImmediateInteractionHide,
    webPageNodes,
  ]);

  const scheduleInteractionCaptureRetry = useCallback(() => {
    cancelInteractionCaptureRetry();
    if (interactionCaptureRetryNodeIdsRef.current.size === 0) return;

    interactionCaptureRetryTimerRef.current = window.setTimeout(() => {
      interactionCaptureRetryTimerRef.current = null;
      if (activeInteractionsRef.current.size > 0 || !containerRef.current) return;

      const retryNodeIds = Array.from(interactionCaptureRetryNodeIdsRef.current);
      interactionCaptureRetryNodeIdsRef.current.clear();

      for (const nodeId of retryNodeIds) {
        const label = getWebviewLabel(nodeId);
        const { wrapper } = getWebPageElements(containerRef.current, nodeId);
        if (!label || wrapper?.getAttribute('data-display-mode') !== 'native') continue;

        void captureScreenshotRef.current?.(nodeId, {
          source: 'default',
          waitForPresentation: false,
        });
      }
    }, WEBVIEW_REVEAL_DELAY_MS + 32);
  }, [cancelInteractionCaptureRetry, containerRef, getWebviewLabel]);

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
      if (!SCREENSHOT_CLIPPING_ENABLED) return false;
      const label = getWebviewLabel(nodeId);
      if (!label) {
        warnMissingWebviewLabel(nodeId, 'saveScreenshot');
        return false;
      }

      pendingCaptureOptionsRef.current[nodeId] = mergeCaptureOptions(
        pendingCaptureOptionsRef.current[nodeId],
        options,
      );

      const existingPromise = capturePromiseRef.current[nodeId];
      if (existingPromise) {
        queuedFreshCaptureRef.current[nodeId] = true;
        return existingPromise;
      }

      const captureTask = (async () => {
        let lastResult = false;

        while (true) {
          const nextOptions = pendingCaptureOptionsRef.current[nodeId];
          delete pendingCaptureOptionsRef.current[nodeId];
          queuedFreshCaptureRef.current[nodeId] = false;

          const forceDuringInteraction = nextOptions?.forceDuringInteraction ?? false;
          const hideAfterSnapshotRequest = nextOptions?.hideAfterSnapshotRequest ?? false;
          if (
            !forceDuringInteraction &&
            (activeInteractionsRef.current.has('drag') ||
              activeInteractionsRef.current.has('resize'))
          ) {
            lastResult = false;
          } else {
            if (hideAfterSnapshotRequest) {
              nativeHiddenByInteractionCaptureRef.current.add(nodeId);
            }

            const filePath = await webviewApi.saveScreenshot(label, nodeId, projectId, {
              hideAfterSnapshotRequest,
            });
            if (!filePath) {
              if (nextOptions?.source === 'interaction-start' && hideAfterSnapshotRequest) {
                interactionCaptureRetryNodeIdsRef.current.add(nodeId);
              }
              lastResult = false;
            } else if (
              !forceDuringInteraction &&
              (activeInteractionsRef.current.has('drag') ||
                activeInteractionsRef.current.has('resize'))
            ) {
              lastResult = false;
            } else {
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
              forceHiddenInteractionNodeIdsRef.current.delete(nodeId);
              interactionCaptureRetryNodeIdsRef.current.delete(nodeId);
              setCachedScreenshotUrl(projectId, nodeId, assetUrl);

              setScreenshotUrls((prev) => {
                const next = { ...prev, [nodeId]: assetUrl };
                screenshotUrlsRef.current = next;
                return next;
              });

              if (nextOptions?.waitForPresentation ?? true) {
                await waitForScreenshotPresentation(nodeId, assetUrl);
              }

              const shouldUseScreenshotNow =
                unsavedChangesDialogOpenRef.current ||
                contextMenuNodeIdRef.current === nodeId ||
                activeInteractionsRef.current.size > 0;

              if (shouldUseScreenshotNow) {
                setNodeDisplayMode(nodeId, 'screenshot');
                if (!hideAfterSnapshotRequest) {
                  hideNodeWebview(label);
                }
              }

              if (activeInteractionsRef.current.size === 0) {
                computeDisplayModes();
              }

              lastResult = true;
            }
          }

          if (!queuedFreshCaptureRef.current[nodeId]) {
            return lastResult;
          }
        }
      })().finally(() => {
        delete capturePromiseRef.current[nodeId];
        delete pendingCaptureOptionsRef.current[nodeId];
        delete queuedFreshCaptureRef.current[nodeId];
      });

      capturePromiseRef.current[nodeId] = captureTask;
      return captureTask;
    },
    [
      computeDisplayModes,
      getWebviewLabel,
      hideNodeWebview,
      mergeCaptureOptions,
      projectId,
      setCachedScreenshotUrl,
      setNodeDisplayMode,
      waitForScreenshotPresentation,
      warnMissingWebviewLabel,
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

      const { wrapper } = getWebPageElements(containerRef.current, nodeId);
      if (hasDisplayableScreenshot(nodeId)) {
        setNodeDisplayMode(nodeId, 'screenshot', wrapper);
        hideNodeWebview(label);
        void captureScreenshotRef.current?.(nodeId, {
          source: 'interaction-start',
          waitForPresentation: false,
        });
      } else {
        setNodeDisplayMode(nodeId, 'native', wrapper);
      }
    },
    [
      containerRef,
      cancelNativeReveal,
      getWebviewLabel,
      hasDisplayableScreenshot,
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

        const { wrapper, placeholder } = getWebPageElements(containerRef.current, nodeId);
        if (!wrapper || !placeholder) {
          if (activeInteractionsRef.current.size === 0) {
            computeDisplayModes();
          }
          return;
        }

        const placeholderRect = placeholder.getBoundingClientRect();
        setNodeDisplayMode(nodeId, 'native', wrapper);

        void webviewApi.updateBounds(
          label,
          placeholderRect.left,
          placeholderRect.top,
          placeholderRect.width,
          placeholderRect.height,
          zoomRef.current,
        );
        void webviewApi.show(label);
        if (isMacOsRef.current) {
          void webviewApi.setOpacity(label, 0);
        }

        void (async () => {
          await waitForWebviewResizeRelayout();
          if (activeInteractionsRef.current.has('resize')) return;

          await captureScreenshotRef.current?.(nodeId, {
            forceDuringInteraction: true,
            source: 'resize-end',
          });

          if (isMacOsRef.current) {
            void webviewApi.setOpacity(label, 1);
          }
          if (activeInteractionsRef.current.size === 0) {
            computeDisplayModes();
          }
        })();
      });
    },
    [
      containerRef,
      computeDisplayModes,
      getWebviewLabel,
      setNodeDisplayMode,
      waitForWebviewResizeRelayout,
      zoomRef,
    ],
  );

  const handleInteractionChange = useCallback(
    (active: boolean, type: InteractionType = 'drag') => {
      if (active) {
        cancelInteractionCaptureRetry();
        cancelZoomRestore();
        cancelAllNativeReveals();
        activeInteractionsRef.current.add(type);

        applyPreparedInteractionModes();

        if (type === 'pan' || type === 'zoom') {
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
        forceHiddenInteractionNodeIdsRef.current.clear();
        nativeHiddenByInteractionCaptureRef.current.clear();

        if (type === 'zoom') {
          scheduleZoomRestoreAfterReflow();
        } else if (type === 'resize') {
          // resize 終了時の最終反映は handlePageResizeEnd 側で実施する
        } else {
          computeDisplayModes();
        }

        scheduleInteractionCaptureRetry();
      }
    },
    [
      cancelInteractionCaptureRetry,
      cancelAllNativeReveals,
      cancelZoomRestore,
      applyPreparedInteractionModes,
      computeDisplayModes,
      computeInteractionModes,
      containerRef,
      scheduleInteractionCaptureRetry,
      scheduleZoomRestoreAfterReflow,
    ],
  );

  const handleContextMenuOpen = useCallback(
    async (nodeId: string) => {
      cancelNativeReveal(nodeId);
      const label = getWebviewLabel(nodeId);

      if (label) {
        await ensureScreenshotReady(nodeId, {
          source: 'interaction-start',
        });
      }

      contextMenuNodeIdRef.current = nodeId;

      const { wrapper } = getWebPageElements(containerRef.current, nodeId);

      const newMode: DisplayMode = hasDisplayableScreenshot(nodeId) ? 'screenshot' : 'hidden';
      setNodeDisplayMode(nodeId, newMode, wrapper);

      if (label) {
        hideNodeWebview(label);
      }
    },
    [
      containerRef,
      cancelNativeReveal,
      ensureScreenshotReady,
      getWebviewLabel,
      hasDisplayableScreenshot,
      hideNodeWebview,
      setNodeDisplayMode,
    ],
  );

  const handleContextMenuClose = useCallback(() => {
    contextMenuNodeIdRef.current = null;
    computeDisplayModes();
  }, [computeDisplayModes]);

  const handleUnsavedChangesDialogOpen = useCallback(async () => {
    if (unsavedChangesDialogOpenRef.current) return;
    cancelInteractionCaptureRetry();
    cancelAllNativeReveals();
    await prepareInteractionStart('unsaved-changes-dialog');
    unsavedChangesDialogOpenRef.current = true;
    computeDisplayModes();

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }, [
    cancelAllNativeReveals,
    cancelInteractionCaptureRetry,
    computeDisplayModes,
    prepareInteractionStart,
  ]);

  const handleUnsavedChangesDialogClose = useCallback(() => {
    if (!unsavedChangesDialogOpenRef.current) return;
    unsavedChangesDialogOpenRef.current = false;
    if (activeInteractionsRef.current.size === 0) {
      computeDisplayModes();
    }
  }, [computeDisplayModes]);

  const holdNodeDuringPositionSettle = useCallback(
    (nodeId: string) => {
      settlingNodeIdsRef.current.add(nodeId);
      cancelNativeReveal(nodeId);
    },
    [cancelNativeReveal],
  );

  const releaseNodeAfterPositionSettle = useCallback(
    (nodeId: string) => {
      if (!settlingNodeIdsRef.current.delete(nodeId)) return;
      if (activeInteractionsRef.current.size === 0) {
        computeDisplayModes();
      }
    },
    [computeDisplayModes],
  );

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
      delete pendingCaptureOptionsRef.current[nodeId];
      delete queuedFreshCaptureRef.current[nodeId];
      delete presentedScreenshotUrlRef.current[nodeId];
      delete screenshotPresentationWaitersRef.current[nodeId];
      forceHiddenInteractionNodeIdsRef.current.delete(nodeId);
      nativeHiddenByInteractionCaptureRef.current.delete(nodeId);
      interactionCaptureRetryNodeIdsRef.current.delete(nodeId);
      settlingNodeIdsRef.current.delete(nodeId);
      clearCachedScreenshotUrl(projectId, nodeId);
      if (resizingNodeIdRef.current === nodeId) {
        resizingNodeIdRef.current = null;
      }
      // スクリーンショットファイルをクリーンアップ
      void webviewApi.deleteScreenshot(nodeId, projectId);
    },
    [cancelNativeReveal, clearCachedScreenshotUrl, projectId],
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
    const missingPageIds = restorablePageIds.filter((nodeId) => !screenshotUrlsRef.current[nodeId]);
    if (missingPageIds.length === 0) return;

    let cancelled = false;
    void webviewApi.getExistingScreenshotPaths(projectId, missingPageIds).then((entries) => {
      if (cancelled || entries.length === 0) return;

      const restoredUrls: Record<string, string> = {};
      for (const [nodeId, filePath] of entries) {
        if (screenshotUrlsRef.current[nodeId]) continue;
        screenshotReadyRef.current[nodeId] = true;
        restoredUrls[nodeId] = `${convertFileSrc(filePath)}?t=restored`;
      }
      if (Object.keys(restoredUrls).length === 0) return;

      hydrateCachedScreenshotUrls(projectId, restoredUrls);
      setScreenshotUrls((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [nodeId, url] of Object.entries(restoredUrls)) {
          if (next[nodeId]) continue;
          next[nodeId] = url;
          changed = true;
        }
        if (!changed) return prev;
        screenshotUrlsRef.current = next;
        return next;
      });
      // 復元後にモード判定を再実行し、端のページが screenshot モードで表示されるようにする
      requestAnimationFrame(() => computeDisplayModes());
    });

    return () => {
      cancelled = true;
    };
  }, [computeDisplayModes, hydrateCachedScreenshotUrls, projectId, webPageIdsKey, webPageNodes]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (resizeObserverRafRef.current !== null) return;
      resizeObserverRafRef.current = requestAnimationFrame(() => {
        resizeObserverRafRef.current = null;
        computeDisplayModes();
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (resizeObserverRafRef.current !== null) {
        cancelAnimationFrame(resizeObserverRafRef.current);
        resizeObserverRafRef.current = null;
      }
    };
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
      cancelInteractionCaptureRetry();
      cancelZoomRestore();
      cancelAllNativeReveals();
      forceHiddenInteractionNodeIdsRef.current.clear();
      nativeHiddenByInteractionCaptureRef.current.clear();
      interactionCaptureRetryNodeIdsRef.current.clear();
      settlingNodeIdsRef.current.clear();
      resizingNodeIdRef.current = null;
      computeDisplayModes();
    };

    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [
    cancelAllNativeReveals,
    cancelInteractionCaptureRetry,
    cancelZoomRestore,
    computeDisplayModes,
  ]);

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
    const settlingNodeIds = settlingNodeIdsRef.current;
    const nativeHiddenByInteractionCaptureNodeIds = nativeHiddenByInteractionCaptureRef.current;
    const interactionCaptureRetryNodeIds = interactionCaptureRetryNodeIdsRef.current;
    return () => {
      cancelInteractionCaptureRetry();
      cancelAllNativeReveals();
      nativeHiddenByInteractionCaptureNodeIds.clear();
      interactionCaptureRetryNodeIds.clear();
      settlingNodeIds.clear();
      resizingNodeIdRef.current = null;
    };
  }, [cancelAllNativeReveals, cancelInteractionCaptureRetry]);

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
    prepareInteractionStart,
    handleScreenshotPresented,
    handleUnsavedChangesDialogClose,
    handleUnsavedChangesDialogOpen,
    holdNodeDuringPositionSettle,
    releaseNodeAfterPositionSettle,
    scheduleInteractionUpdate,
    scheduleZoomRestoreAfterReflow,
    screenshotUrls,
  };
}
