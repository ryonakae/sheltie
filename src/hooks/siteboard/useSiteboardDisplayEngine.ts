import { convertFileSrc } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SiteboardRuntimeStore } from '@/components/Siteboard/siteboard-runtime-store';
import { WEBVIEW_REVEAL_DELAY_MS, WEB_PAGE_TOP_BAR_HEIGHT } from '@/constants';
import { getPlatformInfo, webviewApi } from '@/lib/tauri-bridge';
import type { DisplayMode, WebPageNode } from '@/types';

import { isOutsideExpandedViewport, resolveViewportDisplayMode } from './display-engine/mode';

import type { InteractionType } from './types';
import type { StoreApi } from 'zustand/vanilla';

/** 検証用フラグ: false にするとスクリーンショットクリッピング機能を完全に無効化する */
const SCREENSHOT_CLIPPING_ENABLED = true;

interface UseSiteboardDisplayEngineParams {
  getCurrentWebPageNodes: () => WebPageNode[];
  webPageNodes: WebPageNode[];
  runtimeStore: StoreApi<SiteboardRuntimeStore>;
  webviewLabelsByNodeId: Record<string, string>;
  cachedScreenshotUrlsByNodeId: Record<string, string>;
  projectId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoomRef: React.RefObject<number>;
  panXRef: React.RefObject<number>;
  panYRef: React.RefObject<number>;
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
  source?: 'default' | 'interaction-start' | 'resize-end';
  waitForPresentation?: boolean;
}

type InteractionPreparationType = InteractionType | 'context-menu';

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

function buildPlaceholderScreenRect(
  node: Pick<WebPageNode, 'x' | 'y' | 'width' | 'height'>,
  viewport: { zoom: number; panX: number; panY: number },
): DOMRect {
  const left = viewport.panX + node.x * viewport.zoom;
  const top = viewport.panY + node.y * viewport.zoom + WEB_PAGE_TOP_BAR_HEIGHT;
  const width = node.width * viewport.zoom;
  const height = node.height * viewport.zoom;
  return new DOMRect(left, top, width, height);
}

export function useSiteboardDisplayEngine({
  getCurrentWebPageNodes,
  webPageNodes,
  runtimeStore,
  webviewLabelsByNodeId,
  cachedScreenshotUrlsByNodeId,
  projectId,
  containerRef,
  zoomRef,
  panXRef,
  panYRef,
  centeredNodeId = null,
  onCenteredNodeHandled,
  hydrateCachedScreenshotUrls,
  setCachedScreenshotUrl,
  clearCachedScreenshotUrl,
}: UseSiteboardDisplayEngineParams) {
  // 起動時のキャッシュ復元用のシード値。初期マウント時のみ構築し、以降は固定する。
  // スクリーンショットキャプチャで cachedScreenshotUrlsByNodeId が更新されても
  // useSiteboardDisplayEngine の再計算が走らないようにするため useState で固定する。
  // ランタイムのスクリーンショット管理は screenshotUrlsRef と runtimeStore.setNodeScreenshotUrl で行う。
  const [seededScreenshotUrls] = useState(() =>
    buildSeededScreenshotUrls(webPageNodes, cachedScreenshotUrlsByNodeId),
  );
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
  const settlingNodeIdsRef = useRef<Set<string>>(new Set());
  const forceHiddenInteractionNodeIdsRef = useRef<Set<string>>(new Set());
  // パン専用 IPC の前回送信位置キャッシュ。2px 未満の移動は IPC をスキップして通信コストを削減する
  const prevPositionsRef = useRef<Record<string, { x: number; y: number }>>({});

  const displayModesRef = useRef<Record<string, DisplayMode>>(
    buildInitialDisplayModes(webPageNodes, seededScreenshotUrls),
  );
  // パン/ズーム/ドラッグ中に hide() IPC が毎フレーム重複呼出しされるのを防ぐ。
  // show() が呼ばれた際にエントリを削除し、次の hide() 呼出しで再び IPC が実行される。
  const webviewAlreadyHiddenRef = useRef<Set<string>>(new Set());
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

  useEffect(() => {
    runtimeStore.getState().syncWebNodeIds(webPageIds);
    for (const page of webPageNodes) {
      const seededScreenshotUrl = seededScreenshotUrls[page.id] ?? null;
      if (seededScreenshotUrl && !screenshotUrlsRef.current[page.id]) {
        screenshotReadyRef.current[page.id] = true;
        screenshotUrlsRef.current = {
          ...screenshotUrlsRef.current,
          [page.id]: seededScreenshotUrl,
        };
        runtimeStore.getState().setNodeScreenshotUrl(page.id, seededScreenshotUrl);
      }
      if (!(page.id in displayModesRef.current)) {
        const initialMode = seededScreenshotUrl ? 'screenshot' : 'hidden';
        displayModesRef.current = {
          ...displayModesRef.current,
          [page.id]: initialMode,
        };
        runtimeStore.getState().setNodeDisplayMode(page.id, initialMode);
      }
    }
  }, [runtimeStore, seededScreenshotUrls, webPageIds, webPageNodes]);

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

  const hasDisplayableScreenshot = useCallback((nodeId: string) => {
    return Boolean(screenshotReadyRef.current[nodeId] && screenshotUrlsRef.current[nodeId]);
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

  const getCurrentViewport = useCallback(
    () => ({
      zoom: zoomRef.current,
      panX: panXRef.current,
      panY: panYRef.current,
    }),
    [panXRef, panYRef, zoomRef],
  );

  const getScreenRectForNode = useCallback(
    (nodeId: string): DOMRect | null => {
      const node = getCurrentWebPageNodes().find((page) => page.id === nodeId);
      if (!node) return null;
      return buildPlaceholderScreenRect(node, getCurrentViewport());
    },
    [getCurrentViewport, getCurrentWebPageNodes],
  );

  const setNodeScreenshotUrl = useCallback(
    (nodeId: string, url: string | null) => {
      const currentUrl = screenshotUrlsRef.current[nodeId] ?? null;
      if (currentUrl === url) return;

      if (url) {
        screenshotUrlsRef.current[nodeId] = url; // ref はイミュータブル更新不要
      } else {
        delete screenshotUrlsRef.current[nodeId];
      }

      runtimeStore.getState().setNodeScreenshotUrl(nodeId, url);
    },
    [runtimeStore],
  );

  const setNodeDisplayMode = useCallback(
    (nodeId: string, mode: DisplayMode) => {
      if (displayModesRef.current[nodeId] === mode) return;
      displayModesRef.current[nodeId] = mode; // ref はイミュータブル更新不要
      runtimeStore.getState().setNodeDisplayMode(nodeId, mode);
    },
    [runtimeStore],
  );

  const applyNodeDisplayModes = useCallback(
    (nextModes: Record<string, DisplayMode>) => {
      const previousModes = displayModesRef.current;

      // 変更があるノードを特定
      const removedIds: string[] = [];
      const changedEntries: [string, DisplayMode][] = [];

      for (const nodeId of Object.keys(previousModes)) {
        if (!(nodeId in nextModes)) {
          removedIds.push(nodeId);
        }
      }
      for (const [nodeId, mode] of Object.entries(nextModes)) {
        if (previousModes[nodeId] !== mode) {
          changedEntries.push([nodeId, mode]);
        }
      }

      if (removedIds.length === 0 && changedEntries.length === 0) return;

      // ref を直接更新（イミュータブル不要）
      for (const nodeId of removedIds) {
        delete displayModesRef.current[nodeId];
        runtimeStore.getState().setNodeDisplayMode(nodeId, 'hidden');
      }
      for (const [nodeId, mode] of changedEntries) {
        displayModesRef.current[nodeId] = mode;
        runtimeStore.getState().setNodeDisplayMode(nodeId, mode);
      }
    },
    [runtimeStore],
  );

  const hideNodeWebview = useCallback((nodeId: string, label: string) => {
    // すでに非表示の場合は IPC を呼ばない（毎フレームの重複呼出しを排除）
    if (webviewAlreadyHiddenRef.current.has(label)) return;
    webviewAlreadyHiddenRef.current.add(label);
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
      if (webPageNodes.length === 0) return [];

      if (
        type === 'context-menu' ||
        ((type === 'drag' || type === 'resize' || type === 'scroll') && targetNodeId)
      ) {
        return targetNodeId ? [targetNodeId] : [];
      }

      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return [];

      // ループ外で viewport を取得し O(N²) を O(N) に改善
      const viewport = getCurrentViewport();
      const nodeIds: string[] = [];
      for (const page of getCurrentWebPageNodes()) {
        const placeholderRect = buildPlaceholderScreenRect(page, viewport);
        if (isOutsideExpandedViewport(placeholderRect, containerRect)) continue;
        nodeIds.push(page.id);
      }

      return nodeIds;
    },
    [containerRef, getCurrentViewport, getCurrentWebPageNodes, webPageNodes.length],
  );

  const prepareInteractionStart = useCallback(
    async (type: InteractionPreparationType, targetNodeId?: string) => {
      const nodeIds = getInteractionPreparationNodeIds(type, targetNodeId);
      if (nodeIds.length === 0) return true;

      if (type === 'context-menu') {
        const results = await Promise.all(
          nodeIds.map(async (nodeId) => {
            const label = getWebviewLabel(nodeId);
            if (!label) {
              return hasDisplayableScreenshot(nodeId);
            }

            const ready = await ensureScreenshotReady(nodeId, {
              source: 'interaction-start',
            });

            if (ready || hasDisplayableScreenshot(nodeId)) {
              forceHiddenInteractionNodeIdsRef.current.delete(nodeId);
              return true;
            }

            forceHiddenInteractionNodeIdsRef.current.add(nodeId);
            return false;
          }),
        );

        return results.every(Boolean);
      }

      const shouldForceCapture =
        type === 'drag' || type === 'resize' || type === 'connect' || type === 'scroll';

      for (const nodeId of nodeIds) {
        if (hasDisplayableScreenshot(nodeId)) {
          forceHiddenInteractionNodeIdsRef.current.delete(nodeId);
        } else {
          forceHiddenInteractionNodeIdsRef.current.add(nodeId);
        }

        if (!getWebviewLabel(nodeId)) continue;
        void captureScreenshotRef.current?.(nodeId, {
          source: 'interaction-start',
          forceDuringInteraction: shouldForceCapture,
          waitForPresentation: false,
        });
      }

      return true;
    },
    [
      captureScreenshotRef,
      ensureScreenshotReady,
      getInteractionPreparationNodeIds,
      getWebviewLabel,
      hasDisplayableScreenshot,
    ],
  );

  const computeDisplayModes = useCallback(() => {
    const livePages = getCurrentWebPageNodes();
    if (livePages.length === 0) return;
    if (!containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const viewport = getCurrentViewport();
    const modes: Record<string, DisplayMode> = {};
    const deferredNativeSwapNodeIds: string[] = [];

    for (const page of livePages) {
      const label = getWebviewLabel(page.id);
      const placeholderRect = buildPlaceholderScreenRect(page, viewport);
      let nextMode = resolveViewportDisplayMode(
        placeholderRect,
        containerRect,
        hasDisplayableScreenshot(page.id),
      );

      if (contextMenuNodeIdRef.current === page.id && nextMode === 'native') {
        nextMode = hasDisplayableScreenshot(page.id) ? 'screenshot' : 'hidden';
      }
      if (settlingNodeIdsRef.current.has(page.id) && nextMode === 'native') {
        nextMode = hasDisplayableScreenshot(page.id) ? 'screenshot' : 'hidden';
      }
      if (!label && nextMode === 'native') {
        nextMode = getFallbackDisplayMode(page.id);
      }

      const currentMode = displayModesRef.current[page.id] ?? 'hidden';
      if (nextMode !== 'native' && pendingNativeRevealRef.current.has(page.id)) {
        cancelNativeReveal(page.id);
      }

      modes[page.id] = nextMode;

      if (!label) continue;

      if (nextMode === 'native') {
        void webviewApi.updateBounds(
          page.id,
          placeholderRect.left,
          placeholderRect.top,
          placeholderRect.width,
          placeholderRect.height,
          viewport.zoom,
        );

        const isScreenshotToNative = currentMode === 'screenshot';
        const shouldUseOpacityReveal = isMacOsRef.current && isScreenshotToNative;
        if (shouldUseOpacityReveal) {
          modes[page.id] = 'screenshot';

          if (!pendingNativeRevealRef.current.has(page.id)) {
            pendingNativeRevealRef.current.add(page.id);

            const token = (nativeRevealTokenRef.current[page.id] ?? 0) + 1;
            nativeRevealTokenRef.current[page.id] = token;

            void webviewApi.setOpacity(page.id, 0);
            webviewAlreadyHiddenRef.current.delete(label); // show() するので hide 済みフラグを解除
            void webviewApi.show(label);

            nativeRevealTimersRef.current[page.id] = window.setTimeout(() => {
              if (nativeRevealTokenRef.current[page.id] !== token) return;
              delete nativeRevealTimersRef.current[page.id];

              void webviewApi.setOpacity(page.id, 1);

              requestAnimationFrame(() => {
                if (nativeRevealTokenRef.current[page.id] !== token) return;
                pendingNativeRevealRef.current.delete(page.id);
                delete nativeRevealTokenRef.current[page.id];
                runtimeStore.getState().setNodeDisplayMode(page.id, 'native');
                displayModesRef.current[page.id] = 'native';
              });
            }, WEBVIEW_REVEAL_DELAY_MS);
          } else {
            webviewAlreadyHiddenRef.current.delete(label); // show() するので hide 済みフラグを解除
            void webviewApi.show(label);
          }
        } else {
          if (isMacOsRef.current) {
            void webviewApi.setOpacity(page.id, 1);
          }
          webviewAlreadyHiddenRef.current.delete(label); // show() するので hide 済みフラグを解除
          void webviewApi.show(label);
          if (isScreenshotToNative) {
            deferredNativeSwapNodeIds.push(page.id);
          }
        }
      } else {
        if (isMacOsRef.current) {
          void webviewApi.setOpacity(page.id, 1);
        }
        hideNodeWebview(page.id, label);
      }
    }

    if (deferredNativeSwapNodeIds.length > 0) {
      requestAnimationFrame(() => {
        const nextModes = { ...modes };
        for (const nodeId of deferredNativeSwapNodeIds) {
          nextModes[nodeId] = 'native';
        }
        applyNodeDisplayModes(nextModes);
      });
      return;
    }

    applyNodeDisplayModes(modes);
  }, [
    applyNodeDisplayModes,
    cancelNativeReveal,
    containerRef,
    getCurrentViewport,
    getCurrentWebPageNodes,
    getFallbackDisplayMode,
    getWebviewLabel,
    hasDisplayableScreenshot,
    hideNodeWebview,
    runtimeStore,
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

  const applyPreparedInteractionModes = useCallback(() => {
    const livePages = getCurrentWebPageNodes();
    if (livePages.length === 0) return;
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    // ループ外で viewport を一度取得し O(N²) を O(N) に改善
    const viewport = getCurrentViewport();
    for (const page of livePages) {
      const label = getWebviewLabel(page.id);
      const placeholderRect = buildPlaceholderScreenRect(page, viewport);
      const isOutsideExpanded = isOutsideExpandedViewport(placeholderRect, containerRect);

      if (!label) {
        setNodeDisplayMode(
          page.id,
          isOutsideExpanded
            ? 'hidden'
            : hasDisplayableScreenshot(page.id)
              ? 'screenshot'
              : 'hidden',
        );
        continue;
      }

      if (isOutsideExpanded) {
        setNodeDisplayMode(page.id, 'hidden');
        hideNodeWebview(page.id, label);
        continue;
      }

      if (hasDisplayableScreenshot(page.id)) {
        setNodeDisplayMode(page.id, 'screenshot');
        hideNodeWebview(page.id, label);
        continue;
      }

      setNodeDisplayMode(page.id, 'hidden');
      hideNodeWebview(page.id, label);
    }
  }, [
    containerRef,
    getCurrentViewport,
    getCurrentWebPageNodes,
    hasDisplayableScreenshot,
    hideNodeWebview,
    setNodeDisplayMode,
    getWebviewLabel,
  ]);

  const computeInteractionModes = useCallback(() => {
    const livePages = getCurrentWebPageNodes();
    if (livePages.length === 0) return;
    const containerRect = containerRectRef.current;
    if (!containerRect) return;

    const positionEntries: { pageId: string; x: number; y: number }[] = [];

    // パン専用の場合は位置のみ更新（size/zoom は変化しないため IPC を軽量化）
    const isPanOnly =
      activeInteractionsRef.current.has('pan') && !activeInteractionsRef.current.has('zoom');

    // ループ外で viewport を一度だけ取得し O(N²) を O(N) に改善
    const viewport = getCurrentViewport();
    // displayMode の変更をバッチ化し、zustand の set() 呼出し回数を削減
    const nextModes: Record<string, DisplayMode> = {};

    for (const page of livePages) {
      const label = getWebviewLabel(page.id);
      // getScreenRectForNode の内部 find() を排除し O(N) に
      const placeholderRect = buildPlaceholderScreenRect(page, viewport);
      const isOutsideExpanded = isOutsideExpandedViewport(placeholderRect, containerRect);

      if (!label) {
        nextModes[page.id] = isOutsideExpanded
          ? 'hidden'
          : hasDisplayableScreenshot(page.id)
            ? 'screenshot'
            : 'hidden';
        continue;
      }

      // ズーム中は全 Webview を hide するため bounds/position の IPC は不要。
      // ズーム終了後に computeDisplayModes() で正しい bounds が復帰する。
      if (!isOutsideExpanded && isPanOnly) {
        const newX = placeholderRect.left;
        const newY = placeholderRect.top;
        const prev = prevPositionsRef.current[page.id];
        // 前回送信位置から 2px 未満の変化は IPC をスキップして通信コストを削減する
        if (!prev || Math.abs(prev.x - newX) >= 2 || Math.abs(prev.y - newY) >= 2) {
          prevPositionsRef.current[page.id] = { x: newX, y: newY };
          positionEntries.push({ pageId: page.id, x: newX, y: newY });
        }
      }

      if (isOutsideExpanded) {
        nextModes[page.id] = 'hidden';
        hideNodeWebview(page.id, label); // 冪等化済み：既に非表示なら IPC スキップ
      } else if (hasDisplayableScreenshot(page.id)) {
        nextModes[page.id] = 'screenshot';
        hideNodeWebview(page.id, label);
      } else {
        nextModes[page.id] = 'hidden';
        hideNodeWebview(page.id, label);
      }
    }

    // バッチで zustand を更新（N 回 → 1 回）
    applyNodeDisplayModes(nextModes);

    if (isPanOnly && positionEntries.length > 0) {
      void webviewApi.updateAllPositions(positionEntries);
    }
  }, [
    applyNodeDisplayModes,
    getCurrentViewport,
    getCurrentWebPageNodes,
    getWebviewLabel,
    hasDisplayableScreenshot,
    hideNodeWebview,
  ]);

  const scheduleInteractionUpdate = useCallback(() => {
    if (interactionRafRef.current !== null) return;

    interactionRafRef.current = requestAnimationFrame(() => {
      interactionRafRef.current = null;
      computeInteractionModes();
    });
  }, [computeInteractionModes]);

  const captureScreenshot = useCallback(
    async (nodeId: string, options?: CaptureScreenshotOptions) => {
      if (!SCREENSHOT_CLIPPING_ENABLED) return false;

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
          if (
            !forceDuringInteraction &&
            (activeInteractionsRef.current.has('drag') ||
              activeInteractionsRef.current.has('resize'))
          ) {
            lastResult = false;
          } else {
            const filePath = await webviewApi.saveScreenshot(nodeId, projectId);
            if (!filePath) {
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
              setCachedScreenshotUrl(projectId, nodeId, assetUrl);
              setNodeScreenshotUrl(nodeId, assetUrl);

              if (nextOptions?.waitForPresentation ?? true) {
                await waitForScreenshotPresentation(nodeId, assetUrl);
              }

              const label = getWebviewLabel(nodeId);
              if (label) {
                const shouldUseScreenshotNow =
                  contextMenuNodeIdRef.current === nodeId || activeInteractionsRef.current.size > 0;

                if (shouldUseScreenshotNow) {
                  setNodeDisplayMode(nodeId, 'screenshot');
                  hideNodeWebview(nodeId, label);
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
      setNodeScreenshotUrl,
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

      if (hasDisplayableScreenshot(nodeId)) {
        setNodeDisplayMode(nodeId, 'screenshot');
        hideNodeWebview(nodeId, label);
        void captureScreenshotRef.current?.(nodeId, {
          forceDuringInteraction: true,
          source: 'interaction-start',
          waitForPresentation: false,
        });
      } else {
        setNodeDisplayMode(nodeId, 'hidden');
        hideNodeWebview(nodeId, label);
        void captureScreenshotRef.current?.(nodeId, {
          forceDuringInteraction: true,
          source: 'interaction-start',
          waitForPresentation: false,
        });
      }
    },
    [
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

        const placeholderRect = getScreenRectForNode(nodeId);
        if (!placeholderRect) {
          if (activeInteractionsRef.current.size === 0) {
            computeDisplayModes();
          }
          return;
        }

        setNodeDisplayMode(nodeId, 'native');

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
      computeDisplayModes,
      getWebviewLabel,
      getScreenRectForNode,
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
        // React state 更新なし。DOM 属性でカーソルを直接制御し Siteboard の再レンダリングを回避する
        containerRef.current?.setAttribute('data-interaction-cursor', cursor);
        containerRectRef.current = containerRef.current?.getBoundingClientRect() ?? null;

        applyPreparedInteractionModes();

        if (type === 'pan' || type === 'zoom') {
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
        containerRef.current?.removeAttribute('data-interaction-cursor');
        forceHiddenInteractionNodeIdsRef.current.clear();
        // パン終了時にキャッシュをクリアし、次のパン開始時に全ノードの位置を送信する
        prevPositionsRef.current = {};

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
      applyPreparedInteractionModes,
      computeDisplayModes,
      computeInteractionModes,
      containerRef,
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
      const newMode: DisplayMode = hasDisplayableScreenshot(nodeId) ? 'screenshot' : 'hidden';
      setNodeDisplayMode(nodeId, newMode);

      if (label) {
        hideNodeWebview(nodeId, label);
      }
    },
    [
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
      const { [nodeId]: _removedMode, ...remainingModes } = displayModesRef.current;
      displayModesRef.current = remainingModes;
      const { [nodeId]: _removedScreenshot, ...remainingScreenshots } = screenshotUrlsRef.current;
      screenshotUrlsRef.current = remainingScreenshots;
      runtimeStore.getState().clearWebNodeRuntime(nodeId);
      delete screenshotReadyRef.current[nodeId];
      delete capturePromiseRef.current[nodeId];
      delete pendingCaptureOptionsRef.current[nodeId];
      delete queuedFreshCaptureRef.current[nodeId];
      delete presentedScreenshotUrlRef.current[nodeId];
      delete screenshotPresentationWaitersRef.current[nodeId];
      forceHiddenInteractionNodeIdsRef.current.delete(nodeId);
      settlingNodeIdsRef.current.delete(nodeId);
      clearCachedScreenshotUrl(projectId, nodeId);
      if (resizingNodeIdRef.current === nodeId) {
        resizingNodeIdRef.current = null;
      }
      // スクリーンショットファイルをクリーンアップ
      void webviewApi.deleteScreenshot(nodeId, projectId);
    },
    [cancelNativeReveal, clearCachedScreenshotUrl, projectId, runtimeStore],
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
      for (const [nodeId, url] of Object.entries(restoredUrls)) {
        if (screenshotUrlsRef.current[nodeId]) continue;
        setNodeScreenshotUrl(nodeId, url);
      }
      // 復元後にモード判定を再実行し、端のページが screenshot モードで表示されるようにする
      requestAnimationFrame(() => computeDisplayModes());
    });

    return () => {
      cancelled = true;
    };
  }, [
    computeDisplayModes,
    hydrateCachedScreenshotUrls,
    projectId,
    setNodeScreenshotUrl,
    webPageIdsKey,
    webPageNodes,
  ]);

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
      forceHiddenInteractionNodeIdsRef.current.clear();
      settlingNodeIdsRef.current.clear();
      resizingNodeIdRef.current = null;
      containerRef.current?.removeAttribute('data-interaction-cursor');
      prevPositionsRef.current = {};
      computeDisplayModes();
    };

    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [cancelAllNativeReveals, cancelZoomRestore, computeDisplayModes, containerRef]);

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
    return () => {
      cancelAllNativeReveals();
      settlingNodeIds.clear();
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
    handleContextMenuClose,
    handleContextMenuOpen,
    handleInteractionChange,
    handlePageResizeEnd,
    handlePageResizeStart,
    prepareInteractionStart,
    handleScreenshotPresented,
    holdNodeDuringPositionSettle,
    releaseNodeAfterPositionSettle,
    scheduleInteractionUpdate,
    scheduleZoomRestoreAfterReflow,
  };
}
