import { convertFileSrc } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { webviewApi } from '@/lib/tauri-bridge';
import type { DisplayMode, WebPageNode } from '@/types';

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
  // 5-5 段階 2-4a: state machine への移行が進むにつれ、ref は徐々に dispatch に置換される。
  stateRef: React.MutableRefObject<DisplayEngineState>;
  dispatch: (action: DisplayEngineAction) => void;
  interactionCaptureRetryNodeIdsRef: React.MutableRefObject<Set<string>>;
  nativeHiddenByInteractionCaptureRef: React.MutableRefObject<Set<string>>;
}

interface UseScreenshotCaptureQueueParams {
  webPageNodes: WebPageNode[];
  projectId: string;
  cachedScreenshotUrlsByNodeId: Record<string, string>;
  hydrateCachedScreenshotUrls: (
    projectId: string,
    screenshotUrlsByNodeId: Record<string, string>,
  ) => void;
  setCachedScreenshotUrl: (projectId: string, nodeId: string, url: string) => void;
  getWebviewLabel: (nodeId: string) => string | undefined;
  warnMissingWebviewLabel: (nodeId: string, command: string) => void;
  sharedRefs: ScreenshotCaptureSharedRefs;
  setNodeDisplayModeRef: React.MutableRefObject<
    ((nodeId: string, mode: DisplayMode, wrapper?: HTMLElement | null) => void) | null
  >;
  hideNodeWebviewRef: React.MutableRefObject<((label: string) => void) | null>;
  computeDisplayModesRef: React.MutableRefObject<(() => void) | null>;
}

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
  cachedScreenshotUrlsByNodeId,
  hydrateCachedScreenshotUrls,
  setCachedScreenshotUrl,
  getWebviewLabel,
  warnMissingWebviewLabel,
  sharedRefs,
  setNodeDisplayModeRef,
  hideNodeWebviewRef,
  computeDisplayModesRef,
}: UseScreenshotCaptureQueueParams) {
  const seededScreenshotUrls = useMemo(
    () => buildSeededScreenshotUrls(webPageNodes, cachedScreenshotUrlsByNodeId),
    [cachedScreenshotUrlsByNodeId, webPageNodes],
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
              sharedRefs.nativeHiddenByInteractionCaptureRef.current.add(nodeId);
            }

            const filePath = await webviewApi.saveScreenshot(label, nodeId, projectId, {
              hideAfterSnapshotRequest,
            });
            if (!filePath) {
              if (nextOptions?.source === 'interaction-start' && hideAfterSnapshotRequest) {
                sharedRefs.interactionCaptureRetryNodeIdsRef.current.add(nodeId);
              }
              lastResult = false;
            } else if (
              !forceDuringInteraction &&
              isDragOrResizeActive(sharedRefs.stateRef.current)
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
              sharedRefs.dispatch({ type: 'FORCE_HIDDEN_REMOVE', nodeId });
              sharedRefs.interactionCaptureRetryNodeIdsRef.current.delete(nodeId);
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
      setCachedScreenshotUrl,
      setNodeDisplayModeRef,
      sharedRefs,
      waitForScreenshotPresentation,
      warnMissingWebviewLabel,
    ],
  );

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
      requestAnimationFrame(() => computeDisplayModesRef.current?.());
    });

    return () => {
      cancelled = true;
    };
  }, [computeDisplayModesRef, hydrateCachedScreenshotUrls, projectId, webPageIdsKey, webPageNodes]);

  // 1 ノード分の screenshot 関連 state/ref をクリアする（メインフックの cleanup から呼ぶ）。
  const cleanupScreenshot = useCallback((nodeId: string) => {
    setScreenshotUrls((prev) => {
      if (!(nodeId in prev)) return prev;
      const next = { ...prev };
      delete next[nodeId];
      screenshotUrlsRef.current = next;
      return next;
    });
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
    cleanupScreenshot,
  };
}
