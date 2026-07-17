import { convertFileSrc } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { webviewApi } from '@/lib/tauri-bridge';
import { useProjectStore } from '@/store/tab-store';
import type { DisplayMode, ScreenshotCacheEntry, WebPageNode } from '@/types';
import { isWebPageNode } from '@/types';

import {
  type DisplayEngineAction,
  type DisplayEngineState,
  hasAnyInteraction,
  isContextMenuTarget,
  isDragOrResizeActive,
} from './display-engine/state-machine';

/** 検証用フラグ: false にするとスクリーンショットクリッピング機能を完全に無効化する */
const SCREENSHOT_CLIPPING_ENABLED = true;

export interface CaptureScreenshotOptions {
  forceDuringInteraction?: boolean;
  hideAfterSnapshotRequest?: boolean;
  source?: 'default' | 'interaction-start' | 'resize-end';
  waitForPresentation?: boolean;
}

export interface ScreenshotCaptureSharedRefs {
  // 5-5 段階 4c: 全 ref が state machine に集約され、サブフックは { stateRef, dispatch } 経由のみ
  stateRef: React.MutableRefObject<DisplayEngineState>;
  dispatch: (action: DisplayEngineAction) => void;
}

interface UseScreenshotCaptureQueueParams {
  webPageNodes: WebPageNode[];
  projectId: string;
  cachedScreenshotCacheByNodeId: Record<string, ScreenshotCacheEntry>;
  hydrateCachedScreenshotCache: (
    projectId: string,
    screenshotCacheByNodeId: Record<string, ScreenshotCacheEntry>,
  ) => void;
  setCachedScreenshotCacheEntry: (
    projectId: string,
    nodeId: string,
    entry: ScreenshotCacheEntry,
  ) => void;
  getWebviewLabel: (nodeId: string) => string | undefined;
  warnMissingWebviewLabel: (nodeId: string, command: string) => void;
  sharedRefs: ScreenshotCaptureSharedRefs;
  setNodeDisplayModeRef: React.MutableRefObject<
    ((nodeId: string, mode: DisplayMode, wrapper?: HTMLElement | null) => void) | null
  >;
  hideNodeWebviewRef: React.MutableRefObject<((label: string) => void) | null>;
  computeDisplayModesRef: React.MutableRefObject<(() => void) | null>;
  displayModesRef: React.MutableRefObject<Record<string, DisplayMode>>;
}

export interface WebpageScreenshotCacheDescriptor {
  pageNodeId: string;
  entry: ScreenshotCacheEntry | null;
}

export function isCurrentScreenshotTarget(
  projectId: string,
  nodeId: string,
  capturedUrl: string,
): boolean {
  const project = useProjectStore.getState().project;
  if (!project || project.id !== projectId) return false;
  const node = project.nodes.find((candidate) => candidate.id === nodeId);
  return Boolean(node && isWebPageNode(node) && node.url === capturedUrl);
}

export async function collectWebpageScreenshotCache({
  webPageNodes,
  pageNodeIds,
  displayModes,
  captureScreenshot,
  getCacheEntry,
}: {
  webPageNodes: WebPageNode[];
  pageNodeIds?: string[];
  displayModes: Record<string, DisplayMode>;
  captureScreenshot: (nodeId: string) => Promise<unknown>;
  getCacheEntry: (nodeId: string) => ScreenshotCacheEntry | null;
}): Promise<WebpageScreenshotCacheDescriptor[]> {
  const liveIds = new Set(webPageNodes.map((page) => page.id));
  if (pageNodeIds && new Set(pageNodeIds).size !== pageNodeIds.length) {
    throw {
      code: 'validation_failed',
      message: 'pageNodeIds must not contain duplicate IDs',
    };
  }
  const unknownIds = pageNodeIds?.filter((nodeId) => !liveIds.has(nodeId)) ?? [];
  if (unknownIds.length > 0) {
    throw {
      code: 'validation_failed',
      message: `Unknown or non-WebPage node IDs: ${unknownIds.join(', ')}`,
    };
  }

  const requestedIds = pageNodeIds ? new Set(pageNodeIds) : null;
  const requestedPages = requestedIds
    ? webPageNodes.filter((page) => requestedIds.has(page.id))
    : webPageNodes;
  const results: WebpageScreenshotCacheDescriptor[] = [];
  for (const page of requestedPages) {
    if (displayModes[page.id] === 'native') {
      try {
        await captureScreenshot(page.id);
      } catch {
        // The previous cache remains usable when a fresh native capture fails.
      }
    }
    results.push({ pageNodeId: page.id, entry: getCacheEntry(page.id) });
  }
  return results;
}

function buildSeededScreenshotUrls(
  webPageNodes: WebPageNode[],
  cachedScreenshotCacheByNodeId: Record<string, ScreenshotCacheEntry>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const page of webPageNodes) {
    if (!page.url) continue;
    const cached = cachedScreenshotCacheByNodeId[page.id];
    if (!cached) continue;
    next[page.id] = cached.assetUrl;
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

function mergeCaptureOptions(
  current: CaptureScreenshotOptions | undefined,
  next: CaptureScreenshotOptions | undefined,
): CaptureScreenshotOptions | undefined {
  if (!current) return next;
  if (!next) return current;
  return {
    forceDuringInteraction: Boolean(current.forceDuringInteraction || next.forceDuringInteraction),
    hideAfterSnapshotRequest: Boolean(
      current.hideAfterSnapshotRequest || next.hideAfterSnapshotRequest,
    ),
    source: next.source ?? current.source,
    waitForPresentation: Boolean(current.waitForPresentation || next.waitForPresentation),
  };
}

export function useScreenshotCaptureQueue({
  webPageNodes,
  projectId,
  cachedScreenshotCacheByNodeId,
  hydrateCachedScreenshotCache,
  setCachedScreenshotCacheEntry,
  getWebviewLabel,
  warnMissingWebviewLabel,
  sharedRefs,
  setNodeDisplayModeRef,
  hideNodeWebviewRef,
  computeDisplayModesRef,
  displayModesRef,
}: UseScreenshotCaptureQueueParams) {
  const seededScreenshotUrls = useMemo(
    () => buildSeededScreenshotUrls(webPageNodes, cachedScreenshotCacheByNodeId),
    [cachedScreenshotCacheByNodeId, webPageNodes],
  );

  const [screenshotUrls, setScreenshotUrls] =
    useState<Record<string, string>>(seededScreenshotUrls);

  const screenshotReadyRef = useRef<Record<string, boolean>>(
    buildScreenshotReadyState(seededScreenshotUrls),
  );
  const capturePromiseRef = useRef<Record<string, Promise<boolean> | undefined>>({});
  const pendingCaptureOptionsRef = useRef<Record<string, CaptureScreenshotOptions | undefined>>({});
  const queuedFreshCaptureRef = useRef<Record<string, boolean>>({});
  const screenshotUrlsRef = useRef<Record<string, string>>(seededScreenshotUrls);
  const screenshotCacheRef = useRef<Record<string, ScreenshotCacheEntry>>({
    ...cachedScreenshotCacheByNodeId,
  });
  const presentedScreenshotUrlRef = useRef<Record<string, string>>({});
  const screenshotPresentationWaitersRef = useRef<
    Record<string, { url: string; resolvers: Array<() => void> }>
  >({});

  const webPageIds = useMemo(() => webPageNodes.map((page) => page.id), [webPageNodes]);
  const webPageIdsKey = useMemo(() => webPageIds.join('|'), [webPageIds]);

  const hasDisplayableScreenshot = useCallback((nodeId: string) => {
    return Boolean(screenshotReadyRef.current[nodeId] && screenshotUrlsRef.current[nodeId]);
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

  const captureScreenshotRef = useRef<
    ((nodeId: string, options?: CaptureScreenshotOptions) => Promise<boolean>) | null
  >(null);

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
          if (!forceDuringInteraction && isDragOrResizeActive(sharedRefs.stateRef.current)) {
            lastResult = false;
          } else {
            if (hideAfterSnapshotRequest) {
              sharedRefs.dispatch({ type: 'NATIVE_HIDDEN_BY_CAPTURE_ADD', nodeId });
            }

            const capturedUrl = webPageNodes.find((page) => page.id === nodeId)?.url;
            if (capturedUrl === undefined) return false;
            const saved = await webviewApi.saveScreenshot(label, nodeId, projectId, capturedUrl, {
              hideAfterSnapshotRequest,
            });
            if (!saved) {
              if (nextOptions?.source === 'interaction-start' && hideAfterSnapshotRequest) {
                sharedRefs.dispatch({ type: 'CAPTURE_RETRY_ADD', nodeId });
              }
              lastResult = false;
            } else if (!isCurrentScreenshotTarget(projectId, nodeId, capturedUrl)) {
              await webviewApi.deleteScreenshot(nodeId, projectId);
              lastResult = false;
            } else if (
              !forceDuringInteraction &&
              isDragOrResizeActive(sharedRefs.stateRef.current)
            ) {
              lastResult = false;
            } else {
              const assetUrl = `${convertFileSrc(saved.filePath)}?t=${Date.now()}`;
              const cacheEntry: ScreenshotCacheEntry = {
                assetUrl,
                filePath: saved.filePath,
                capturedAt: saved.capturedAt,
                capturedUrl: saved.capturedUrl,
              };

              const img = new Image();
              img.src = assetUrl;
              try {
                await img.decode();
              } catch {
                // no-op
              }

              screenshotReadyRef.current[nodeId] = true;
              delete presentedScreenshotUrlRef.current[nodeId];
              sharedRefs.dispatch({ type: 'FORCE_HIDDEN_REMOVE', nodeId });
              sharedRefs.dispatch({ type: 'CAPTURE_RETRY_REMOVE', nodeId });
              screenshotCacheRef.current = {
                ...screenshotCacheRef.current,
                [nodeId]: cacheEntry,
              };
              setCachedScreenshotCacheEntry(projectId, nodeId, cacheEntry);

              setScreenshotUrls((prev) => {
                const next = { ...prev, [nodeId]: assetUrl };
                screenshotUrlsRef.current = next;
                return next;
              });

              if (nextOptions?.waitForPresentation ?? true) {
                await waitForScreenshotPresentation(nodeId, assetUrl);
              }

              const shouldUseScreenshotNow =
                sharedRefs.stateRef.current.unsavedDialogOpen ||
                isContextMenuTarget(sharedRefs.stateRef.current, nodeId) ||
                hasAnyInteraction(sharedRefs.stateRef.current);

              if (shouldUseScreenshotNow) {
                setNodeDisplayModeRef.current?.(nodeId, 'screenshot');
                if (!hideAfterSnapshotRequest) {
                  hideNodeWebviewRef.current?.(label);
                }
              }

              if (!hasAnyInteraction(sharedRefs.stateRef.current)) {
                computeDisplayModesRef.current?.();
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
      computeDisplayModesRef,
      getWebviewLabel,
      hideNodeWebviewRef,
      projectId,
      setCachedScreenshotCacheEntry,
      setNodeDisplayModeRef,
      sharedRefs,
      waitForScreenshotPresentation,
      warnMissingWebviewLabel,
      webPageNodes,
    ],
  );

  useEffect(() => {
    captureScreenshotRef.current = captureScreenshot;
  }, [captureScreenshot]);

  useEffect(() => {
    screenshotUrlsRef.current = screenshotUrls;
  }, [screenshotUrls]);

  useEffect(() => {
    screenshotCacheRef.current = { ...cachedScreenshotCacheByNodeId };
    const nextUrls = buildSeededScreenshotUrls(webPageNodes, cachedScreenshotCacheByNodeId);
    const nextReady = buildScreenshotReadyState(nextUrls);
    screenshotReadyRef.current = nextReady;
    setScreenshotUrls((previous) => {
      const previousEntries = Object.entries(previous);
      const nextEntries = Object.entries(nextUrls);
      const unchanged =
        previousEntries.length === nextEntries.length &&
        nextEntries.every(([nodeId, url]) => previous[nodeId] === url);
      if (unchanged) return previous;
      screenshotUrlsRef.current = nextUrls;
      return nextUrls;
    });
  }, [cachedScreenshotCacheByNodeId, webPageNodes]);

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

      if (!hasAnyInteraction(sharedRefs.stateRef.current)) {
        computeDisplayModesRef.current?.();
      }
    },
    [computeDisplayModesRef, sharedRefs],
  );

  // 起動時に保存済みスクリーンショットをファイルシステムから復元する。
  // screenshotReadyRef を true に設定することで、右クリック時の白画面や
  // 起動直後の Webview がサイドバーに重なる問題を防ぐ。
  useEffect(() => {
    const restorablePages = webPageNodes.filter((page) => page.url);
    const pageById = new Map(restorablePages.map((page) => [page.id, page]));
    const missingPageIds = restorablePages
      .map((page) => page.id)
      .filter((nodeId) => !screenshotCacheRef.current[nodeId]);
    if (missingPageIds.length === 0) return;

    let cancelled = false;
    void webviewApi.getExistingScreenshotPaths(projectId, missingPageIds).then((entries) => {
      if (cancelled || entries.length === 0) return;

      const restoredCache: Record<string, ScreenshotCacheEntry> = {};
      const restoredUrls: Record<string, string> = {};
      for (const restored of entries) {
        const page = pageById.get(restored.pageId);
        if (!page) continue;
        if (restored.capturedUrl !== null && restored.capturedUrl !== page.url) {
          void webviewApi.deleteScreenshot(restored.pageId, projectId);
          continue;
        }
        const current = screenshotCacheRef.current[restored.pageId];
        if (current && Date.parse(current.capturedAt) >= Date.parse(restored.capturedAt)) continue;

        const assetUrl = `${convertFileSrc(restored.filePath)}?t=restored`;
        restoredCache[restored.pageId] = {
          assetUrl,
          filePath: restored.filePath,
          capturedAt: restored.capturedAt,
          capturedUrl: restored.capturedUrl,
        };
        restoredUrls[restored.pageId] = assetUrl;
        screenshotReadyRef.current[restored.pageId] = true;
      }
      if (Object.keys(restoredCache).length === 0) return;

      screenshotCacheRef.current = { ...screenshotCacheRef.current, ...restoredCache };
      hydrateCachedScreenshotCache(projectId, restoredCache);
      setScreenshotUrls((previous) => {
        const next = { ...previous, ...restoredUrls };
        screenshotUrlsRef.current = next;
        return next;
      });
      requestAnimationFrame(() => computeDisplayModesRef.current?.());
    });

    return () => {
      cancelled = true;
    };
  }, [
    computeDisplayModesRef,
    hydrateCachedScreenshotCache,
    projectId,
    webPageIdsKey,
    webPageNodes,
  ]);

  const getWebpageScreenshotCache = useCallback(
    (pageNodeIds?: string[]) =>
      collectWebpageScreenshotCache({
        webPageNodes,
        pageNodeIds,
        displayModes: displayModesRef.current,
        captureScreenshot,
        getCacheEntry: (nodeId) => screenshotCacheRef.current[nodeId] ?? null,
      }),
    [captureScreenshot, displayModesRef, webPageNodes],
  );

  // 1 ノード分の screenshot 関連 state/ref をクリアする（メインフックの cleanup から呼ぶ）。
  const cleanupScreenshot = useCallback((nodeId: string) => {
    setScreenshotUrls((prev) => {
      if (!(nodeId in prev)) return prev;
      const next = { ...prev };
      delete next[nodeId];
      screenshotUrlsRef.current = next;
      return next;
    });
    const remainingCache = { ...screenshotCacheRef.current };
    delete remainingCache[nodeId];
    screenshotCacheRef.current = remainingCache;
    delete screenshotReadyRef.current[nodeId];
    delete capturePromiseRef.current[nodeId];
    delete pendingCaptureOptionsRef.current[nodeId];
    delete queuedFreshCaptureRef.current[nodeId];
    delete presentedScreenshotUrlRef.current[nodeId];
    delete screenshotPresentationWaitersRef.current[nodeId];
  }, []);

  return {
    screenshotUrls,
    screenshotUrlsRef,
    screenshotReadyRef,
    presentedScreenshotUrlRef,
    hasDisplayableScreenshot,
    waitForScreenshotPresentation,
    handleScreenshotPresented,
    captureScreenshot,
    ensureScreenshotReady,
    getWebpageScreenshotCache,
    cleanupScreenshot,
  };
}
