import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { WEBVIEW_REVEAL_DELAY_MS } from '@/constants';
import { webviewApi } from '@/lib/tauri-bridge';
import {
  createScopedLogger,
  readCanvasZoomDebugValue,
  roundDebugValue,
  serializeRect,
} from '@/lib/webview-debug';
import type { DisplayMode, WebPageNode } from '@/types';

import {
  getSelectionToolbarRects,
  getWebPageElements,
  setDisplayModeAttribute,
} from './display-engine/dom';
import {
  applyDisplayModeDemotions,
  isOutsideExpandedViewport,
  isToolbarOccluded,
  resolveViewportDisplayMode,
  shouldUseOpacityReveal,
} from './display-engine/mode';
import {
  INITIAL_DISPLAY_ENGINE_STATE,
  hasAnyInteraction,
  isContextMenuTarget,
  isDragOrResizeActive,
  isInteractionActive,
  isPanOrZoomActive,
  type DisplayEngineAction,
  type DisplayEngineState,
  displayEngineReducer,
} from './display-engine/state-machine';
import { useNativeRevealController } from './useNativeRevealController';
import { useScreenshotCaptureQueue } from './useScreenshotCaptureQueue';

import type { InteractionType } from './types';

interface UseSiteboardDisplayEngineParams {
  webPageNodes: WebPageNode[];
  webviewLabelsByNodeId: Record<string, string>;
  cachedScreenshotUrlsByNodeId: Record<string, string>;
  projectId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoomRef: React.RefObject<number>;
  centeredNodeId?: string | null;
  onCenteredNodeHandled?: () => void;
  selectedNodeIds?: string[];
  hydrateCachedScreenshotUrls: (
    projectId: string,
    screenshotUrlsByNodeId: Record<string, string>,
  ) => void;
  setCachedScreenshotUrl: (projectId: string, nodeId: string, url: string) => void;
  clearCachedScreenshotUrl: (projectId: string, nodeId: string) => void;
}

type InteractionPreparationType = InteractionType | 'context-menu' | 'unsaved-changes-dialog';

const logDisplayEngineDebug = createScopedLogger('display-engine');

function buildInitialDisplayModes(
  webPageNodes: WebPageNode[],
  cachedScreenshotUrlsByNodeId: Record<string, string>,
): Record<string, DisplayMode> {
  const next: Record<string, DisplayMode> = {};
  for (const page of webPageNodes) {
    const hasSeeded = Boolean(page.url) && Boolean(cachedScreenshotUrlsByNodeId[page.id]);
    next[page.id] = hasSeeded ? 'screenshot' : 'hidden';
  }
  return next;
}

const EMPTY_SELECTION: string[] = [];

export function useSiteboardDisplayEngine({
  webPageNodes,
  webviewLabelsByNodeId,
  cachedScreenshotUrlsByNodeId,
  projectId,
  containerRef,
  zoomRef,
  centeredNodeId = null,
  onCenteredNodeHandled,
  selectedNodeIds = EMPTY_SELECTION,
  hydrateCachedScreenshotUrls,
  setCachedScreenshotUrl,
  clearCachedScreenshotUrl,
}: UseSiteboardDisplayEngineParams) {
  const [displayModes, setDisplayModes] = useState<Record<string, DisplayMode>>(() =>
    buildInitialDisplayModes(webPageNodes, cachedScreenshotUrlsByNodeId),
  );

  // 5-5 段階 1: state machine の枠を導入。既存 ref が真実の状態のままで、
  // dispatch は既存 ref の書き換えと並走させて stateRef を同期させる（読み手はまだ無し）。
  // 以降の段階で各 ref を消し、dispatch / stateRef 経由の読み書きへ移行する。
  const stateRef = useRef<DisplayEngineState>(INITIAL_DISPLAY_ENGINE_STATE);
  const dispatch = useCallback((action: DisplayEngineAction) => {
    stateRef.current = displayEngineReducer(stateRef.current, action);
  }, []);

  const computeDisplayModesRef = useRef<(() => void) | null>(null);
  const setNodeDisplayModeRef = useRef<
    ((nodeId: string, mode: DisplayMode, wrapper?: HTMLElement | null) => void) | null
  >(null);
  const hideNodeWebviewRef = useRef<((label: string) => void) | null>(null);
  const interactionRafRef = useRef<number | null>(null);
  const containerRectRef = useRef<DOMRect | null>(null);
  // 5-5 段階 2: resizingNodeId / contextMenuNodeId / unsavedDialogOpen は stateRef に集約
  // 5-5 段階 3: activeInteractions も stateRef に集約
  const settlingNodeIdsRef = useRef<Set<string>>(new Set());
  // ノードツールバーに被られているページ。被り開始の検出（fresh 撮影の 1 回発火）に使う。
  const toolbarOccludedIdsRef = useRef<Set<string>>(new Set());
  // 5-5 段階 4a: forceHiddenIds は stateRef.forceHiddenIds に集約
  const nativeHiddenByInteractionCaptureRef = useRef<Set<string>>(new Set());
  const interactionCaptureRetryNodeIdsRef = useRef<Set<string>>(new Set());
  const interactionCaptureRetryTimerRef = useRef<number | null>(null);
  const resizeObserverRafRef = useRef<number | null>(null);

  const knownNodeIdsRef = useRef<Set<string>>(new Set());
  const webPageIds = useMemo(() => webPageNodes.map((page) => page.id), [webPageNodes]);
  const webPageIdsKey = useMemo(() => webPageIds.join('|'), [webPageIds]);
  const webviewLabelSyncKey = useMemo(
    () =>
      webPageNodes.map((page) => `${page.id}:${webviewLabelsByNodeId[page.id] ?? ''}`).join('|'),
    [webPageNodes, webviewLabelsByNodeId],
  );

  const getWebviewLabel = useCallback(
    (nodeId: string) => webviewLabelsByNodeId[nodeId],
    [webviewLabelsByNodeId],
  );
  const warnMissingWebviewLabel = useCallback((nodeId: string, command: string) => {
    if (!import.meta.env.DEV) return;
    console.warn(`[useSiteboardDisplayEngine] ${command}: WebView label missing`, {
      nodeId,
    });
  }, []);

  const {
    isMacOsRef,
    cancelNativeReveal,
    cancelAllNativeReveals,
    hideNodeWebview,
    isNativeRevealPending,
    hasPendingReveals,
    beginNativeRevealFade,
  } = useNativeRevealController({
    containerRef,
    getWebviewLabel,
    setDisplayModes,
  });

  const sharedRefs = useMemo(
    () => ({
      stateRef,
      dispatch,
      interactionCaptureRetryNodeIdsRef,
      nativeHiddenByInteractionCaptureRef,
    }),
    [dispatch],
  );

  const {
    screenshotUrls,
    hasDisplayableScreenshot,
    handleScreenshotPresented,
    captureScreenshot,
    ensureScreenshotReady,
    cleanupScreenshot,
  } = useScreenshotCaptureQueue({
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
  });

  const cancelInteractionCaptureRetry = useCallback(() => {
    if (interactionCaptureRetryTimerRef.current === null) return;
    clearTimeout(interactionCaptureRetryTimerRef.current);
    interactionCaptureRetryTimerRef.current = null;
  }, []);

  const isPanOrZoomInteractionActive = useCallback(() => {
    return isPanOrZoomActive(stateRef.current);
  }, []);

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
            dispatch({ type: 'FORCE_HIDDEN_REMOVE', nodeId });
            interactionCaptureRetryNodeIdsRef.current.delete(nodeId);
            dispatch({ type: 'CAPTURE_RETRY_REMOVE', nodeId });
            return true;
          }

          dispatch({ type: 'FORCE_HIDDEN_ADD', nodeId });
          if (useNativeHideAfterSnapshot) {
            interactionCaptureRetryNodeIdsRef.current.add(nodeId);
            dispatch({ type: 'CAPTURE_RETRY_ADD', nodeId });
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
      dispatch,
      ensureScreenshotReady,
      getInteractionPreparationNodeIds,
      getWebviewLabel,
      hasDisplayableScreenshot,
    ],
  );

  const computeDisplayModes = useCallback(() => {
    // 操作中は applyPreparedInteractionModes + computeInteractionModes が表示を管理する。
    // ここで走ると native に復帰して webview が表示されてしまう。
    if (hasAnyInteraction(stateRef.current)) return;
    if (!containerRef.current || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const modes: Record<string, DisplayMode> = {};
    // 非 macOS: screenshot→native 遷移ページは show 後 1 フレーム待ってスクショを消す
    const deferredNativeSwaps: HTMLElement[] = [];

    // 選択中ノードのツールバー矩形。被られたページは native へ復帰させない。
    const toolbarRects = getSelectionToolbarRects(containerRef.current);
    const nextToolbarOccludedIds = new Set<string>();

    for (const page of webPageNodes) {
      const label = getWebviewLabel(page.id);
      const { wrapper, placeholder } = getWebPageElements(containerRef.current, page.id);
      if (!placeholder || !wrapper) {
        modes[page.id] = 'hidden';
        cancelNativeReveal(page.id);
        continue;
      }

      const placeholderRect = placeholder.getBoundingClientRect();
      const hasScreenshot = hasDisplayableScreenshot(page.id);
      const initialMode = resolveViewportDisplayMode(placeholderRect, containerRect, hasScreenshot);

      // unsaved / contextMenu / settling のいずれかで既に降格対象なら、toolbar 被り判定の
      // 副作用（fresh 撮影トリガと occluded 登録）はスキップする（元実装の順序を維持）。
      const preToolbarDemoted =
        initialMode === 'native' &&
        (stateRef.current.unsavedDialogOpen ||
          isContextMenuTarget(stateRef.current, page.id) ||
          settlingNodeIdsRef.current.has(page.id));

      // ノードツールバー（HTML）が被るページは native に復帰させない。
      // 被り開始時は webview がまだ native(可視) のうちに fresh 撮影を要求してから降格する。
      // hide 後はスナップショットできず古い stale のままになる（context メニューと同じ順序）。
      const occluded =
        !preToolbarDemoted &&
        initialMode === 'native' &&
        isToolbarOccluded(page.id, placeholderRect, toolbarRects);

      if (occluded) {
        if (label && !toolbarOccludedIdsRef.current.has(page.id)) {
          void ensureScreenshotReady(page.id, { source: 'interaction-start' });
        }
        nextToolbarOccludedIds.add(page.id);
      }

      let nextMode = applyDisplayModeDemotions(initialMode, hasScreenshot, {
        unsavedChangesDialogOpen: stateRef.current.unsavedDialogOpen,
        isContextMenuTarget: isContextMenuTarget(stateRef.current, page.id),
        isSettling: settlingNodeIdsRef.current.has(page.id),
        isToolbarOccluded: occluded,
      });

      if (!label && nextMode === 'native') {
        nextMode = getFallbackDisplayMode(page.id);
      }

      const currentAttr = wrapper.getAttribute('data-display-mode') ?? 'native';
      if (nextMode === 'native' || currentAttr !== nextMode || !label) {
        logDisplayEngineDebug('computeDisplayModes:decision', {
          nodeId: page.id,
          label: label ?? null,
          currentAttr,
          nextMode,
          hasDisplayableScreenshot: hasDisplayableScreenshot(page.id),
          zoom: roundDebugValue(zoomRef.current),
          canvasZoom: readCanvasZoomDebugValue(placeholder),
          placeholderRect: serializeRect(placeholderRect),
          wrapperRect: serializeRect(wrapper.getBoundingClientRect()),
          containerRect: serializeRect(containerRect),
        });
      }
      if (nextMode !== 'native' && isNativeRevealPending(page.id)) {
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
          // currentAttr は wrapper の data-display-mode 属性。'native' (default) / 'screenshot' / 'hidden' のいずれか。
          const useOpacityReveal = shouldUseOpacityReveal(
            isMacOsRef.current,
            currentAttr as DisplayMode,
            'native',
          );
          if (useOpacityReveal) {
            // macOS: show/hide の代わりに alpha を 0→1 へ遷移させて復帰時の白フラッシュを回避
            modes[page.id] = 'screenshot';
            beginNativeRevealFade(page.id, label);
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

    // 被り状態を更新する。被り開始（前パスで未被り）だけが上の fresh 撮影を発火させる。
    toolbarOccludedIdsRef.current = nextToolbarOccludedIds;
    dispatch({ type: 'TOOLBAR_OCCLUDED_IDS_SET', ids: nextToolbarOccludedIds });

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
    beginNativeRevealFade,
    cancelNativeReveal,
    containerRef,
    dispatch,
    ensureScreenshotReady,
    getFallbackDisplayMode,
    getWebviewLabel,
    hasDisplayableScreenshot,
    isMacOsRef,
    isNativeRevealPending,
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
      if (hasAnyInteraction(stateRef.current)) return;
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
      return isInteractionActive(stateRef.current, 'zoom') && isPanOrZoomInteractionActive();
    },
    [isPanOrZoomInteractionActive],
  );

  // 操作中・操作開始直後の表示モード適用ロジック（同型構造）。
  // 渡された containerRect を基準に、label / 拡張ビューポート外 / screenshot 有無で
  // mode を決め、setNodeDisplayMode と hideNodeWebview を呼ぶ。
  // - applyPrepared は操作開始直後の最新 containerRect で実行する
  // - computeInteraction は操作中 rAF で cached containerRectRef を使う
  // forceHiddenInteractionNodeIds は最終 else と同じく hidden + hide なので分岐不要。
  const applyInteractionDisplayModes = useCallback(
    (containerRect: DOMRect) => {
      if (!containerRef.current) return;

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

        let nextMode: DisplayMode;
        if (isOutsideExpanded) {
          nextMode = 'hidden';
        } else if (hasDisplayableScreenshot(page.id)) {
          nextMode = 'screenshot';
        } else {
          // 操作開始直後は native を残さず hidden に退避し、fresh capture 完了後に screenshot へ差し替える。
          nextMode = 'hidden';
        }

        setNodeDisplayMode(page.id, nextMode, wrapper);
        if (!shouldSkipImmediateInteractionHide(page.id)) {
          hideNodeWebview(label);
        }
      }
    },
    [
      containerRef,
      getFallbackDisplayMode,
      getWebviewLabel,
      hasDisplayableScreenshot,
      hideNodeWebview,
      setNodeDisplayMode,
      shouldSkipImmediateInteractionHide,
      webPageNodes,
    ],
  );

  const applyPreparedInteractionModes = useCallback(() => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    applyInteractionDisplayModes(containerRect);
  }, [applyInteractionDisplayModes, containerRef]);

  const computeInteractionModes = useCallback(() => {
    const containerRect = containerRectRef.current;
    if (!containerRect) return;
    applyInteractionDisplayModes(containerRect);
  }, [applyInteractionDisplayModes]);

  const scheduleInteractionCaptureRetry = useCallback(() => {
    cancelInteractionCaptureRetry();
    if (interactionCaptureRetryNodeIdsRef.current.size === 0) return;

    interactionCaptureRetryTimerRef.current = window.setTimeout(() => {
      interactionCaptureRetryTimerRef.current = null;
      if (hasAnyInteraction(stateRef.current) || !containerRef.current) return;

      const retryNodeIds = Array.from(interactionCaptureRetryNodeIdsRef.current);
      interactionCaptureRetryNodeIdsRef.current.clear();
      dispatch({ type: 'CAPTURE_RETRY_CLEAR_ALL' });

      for (const nodeId of retryNodeIds) {
        const label = getWebviewLabel(nodeId);
        const { wrapper } = getWebPageElements(containerRef.current, nodeId);
        if (!label || wrapper?.getAttribute('data-display-mode') !== 'native') continue;

        void captureScreenshot(nodeId, {
          source: 'default',
          waitForPresentation: false,
        });
      }
    }, WEBVIEW_REVEAL_DELAY_MS + 32);
  }, [cancelInteractionCaptureRetry, captureScreenshot, containerRef, dispatch, getWebviewLabel]);

  const scheduleInteractionUpdate = useCallback(() => {
    if (isDragOrResizeActive(stateRef.current)) return;
    if (interactionRafRef.current !== null) return;

    interactionRafRef.current = requestAnimationFrame(() => {
      interactionRafRef.current = null;
      computeInteractionModes();
    });
  }, [computeInteractionModes]);

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
      dispatch({ type: 'RESIZE_START', nodeId });
      const label = getWebviewLabel(nodeId);
      if (!label) return;

      cancelNativeReveal(nodeId);

      const { wrapper } = getWebPageElements(containerRef.current, nodeId);
      if (hasDisplayableScreenshot(nodeId)) {
        setNodeDisplayMode(nodeId, 'screenshot', wrapper);
        hideNodeWebview(label);
        void captureScreenshot(nodeId, {
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
      captureScreenshot,
      dispatch,
      getWebviewLabel,
      hasDisplayableScreenshot,
      hideNodeWebview,
      setNodeDisplayMode,
    ],
  );

  const handlePageResizeEnd = useCallback(
    (nodeId: string) => {
      dispatch({ type: 'RESIZE_END', nodeId });

      const label = getWebviewLabel(nodeId);
      if (!label) {
        if (!hasAnyInteraction(stateRef.current)) {
          computeDisplayModes();
        }
        return;
      }

      requestAnimationFrame(() => {
        if (isInteractionActive(stateRef.current, 'resize')) return;

        const { wrapper, placeholder } = getWebPageElements(containerRef.current, nodeId);
        if (!wrapper || !placeholder) {
          if (!hasAnyInteraction(stateRef.current)) {
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
          if (isInteractionActive(stateRef.current, 'resize')) return;

          await captureScreenshot(nodeId, {
            forceDuringInteraction: true,
            source: 'resize-end',
          });

          if (isMacOsRef.current) {
            void webviewApi.setOpacity(label, 1);
          }
          if (!hasAnyInteraction(stateRef.current)) {
            computeDisplayModes();
          }
        })();
      });
    },
    [
      containerRef,
      captureScreenshot,
      computeDisplayModes,
      dispatch,
      getWebviewLabel,
      isMacOsRef,
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
        dispatch({ type: 'INTERACTION_START', interactionType: type });

        applyPreparedInteractionModes();

        if (type === 'pan' || type === 'zoom') {
          containerRectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
          computeInteractionModes();
        }
        return;
      }

      dispatch({ type: 'INTERACTION_END', interactionType: type });
      if (!hasAnyInteraction(stateRef.current)) {
        if (interactionRafRef.current !== null) {
          cancelAnimationFrame(interactionRafRef.current);
          interactionRafRef.current = null;
        }
        containerRectRef.current = null;
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
      dispatch,
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

      dispatch({ type: 'CONTEXT_MENU_OPEN', nodeId });

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
      dispatch,
      ensureScreenshotReady,
      getWebviewLabel,
      hasDisplayableScreenshot,
      hideNodeWebview,
      setNodeDisplayMode,
    ],
  );

  const handleContextMenuClose = useCallback(() => {
    dispatch({ type: 'CONTEXT_MENU_CLOSE' });
    computeDisplayModes();
  }, [computeDisplayModes, dispatch]);

  const handleUnsavedChangesDialogOpen = useCallback(async () => {
    if (stateRef.current.unsavedDialogOpen) return;
    cancelInteractionCaptureRetry();
    cancelAllNativeReveals();
    await prepareInteractionStart('unsaved-changes-dialog');
    dispatch({ type: 'UNSAVED_DIALOG_OPEN' });
    computeDisplayModes();

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }, [
    cancelAllNativeReveals,
    cancelInteractionCaptureRetry,
    computeDisplayModes,
    dispatch,
    prepareInteractionStart,
  ]);

  const handleUnsavedChangesDialogClose = useCallback(() => {
    if (!stateRef.current.unsavedDialogOpen) return;
    dispatch({ type: 'UNSAVED_DIALOG_CLOSE' });
    if (!hasAnyInteraction(stateRef.current)) {
      computeDisplayModes();
    }
  }, [computeDisplayModes, dispatch]);

  const holdNodeDuringPositionSettle = useCallback(
    (nodeId: string) => {
      settlingNodeIdsRef.current.add(nodeId);
      dispatch({ type: 'SETTLE_NODE', nodeId });
      cancelNativeReveal(nodeId);
    },
    [cancelNativeReveal, dispatch],
  );

  const releaseNodeAfterPositionSettle = useCallback(
    (nodeId: string) => {
      if (!settlingNodeIdsRef.current.delete(nodeId)) return;
      dispatch({ type: 'RELEASE_NODE', nodeId });
      if (!hasAnyInteraction(stateRef.current)) {
        computeDisplayModes();
      }
    },
    [computeDisplayModes, dispatch],
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
      cleanupScreenshot(nodeId);
      nativeHiddenByInteractionCaptureRef.current.delete(nodeId);
      interactionCaptureRetryNodeIdsRef.current.delete(nodeId);
      settlingNodeIdsRef.current.delete(nodeId);
      clearCachedScreenshotUrl(projectId, nodeId);
      dispatch({ type: 'CLEANUP_NODE', nodeId });
      // スクリーンショットファイルをクリーンアップ
      void webviewApi.deleteScreenshot(nodeId, projectId);
    },
    [cancelNativeReveal, cleanupScreenshot, clearCachedScreenshotUrl, dispatch, projectId],
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
    computeDisplayModesRef.current = computeDisplayModes;
  }, [computeDisplayModes]);

  useEffect(() => {
    setNodeDisplayModeRef.current = setNodeDisplayMode;
  }, [setNodeDisplayMode]);

  useEffect(() => {
    hideNodeWebviewRef.current = hideNodeWebview;
  }, [hideNodeWebview]);

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
    logDisplayEngineDebug('label-sync:schedule', {
      webviewLabelSyncKey,
      labelsByNodeId: Object.fromEntries(
        webPageNodes.map((page) => [page.id, webviewLabelsByNodeId[page.id] ?? null]),
      ),
      activeInteractions: Array.from(stateRef.current.activeInteractions),
    });
    let secondFrameId: number | null = null;
    let firstFrameId: number | null = requestAnimationFrame(() => {
      firstFrameId = null;
      secondFrameId = requestAnimationFrame(() => {
        secondFrameId = null;
        if (hasAnyInteraction(stateRef.current)) return;
        logDisplayEngineDebug('label-sync:run', {
          webviewLabelSyncKey,
          labelsByNodeId: Object.fromEntries(
            webPageNodes.map((page) => [page.id, webviewLabelsByNodeId[page.id] ?? null]),
          ),
        });
        computeDisplayModesRef.current?.();
      });
    });

    return () => {
      if (firstFrameId !== null) {
        cancelAnimationFrame(firstFrameId);
      }
      if (secondFrameId !== null) {
        cancelAnimationFrame(secondFrameId);
      }
    };
  }, [webPageNodes, webviewLabelSyncKey, webviewLabelsByNodeId]);

  useEffect(() => {
    const handleBlur = () => {
      if (!hasAnyInteraction(stateRef.current) && !hasPendingReveals()) return;

      if (interactionRafRef.current !== null) {
        cancelAnimationFrame(interactionRafRef.current);
        interactionRafRef.current = null;
      }

      containerRectRef.current = null;
      cancelInteractionCaptureRetry();
      cancelZoomRestore();
      cancelAllNativeReveals();
      nativeHiddenByInteractionCaptureRef.current.clear();
      interactionCaptureRetryNodeIdsRef.current.clear();
      settlingNodeIdsRef.current.clear();
      dispatch({ type: 'INTERACTION_CLEAR_ALL' });
      computeDisplayModes();
    };

    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [
    cancelAllNativeReveals,
    cancelInteractionCaptureRetry,
    cancelZoomRestore,
    computeDisplayModes,
    dispatch,
    hasPendingReveals,
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

  // 選択変化でノードツールバーの表示/位置が変わるため、描画反映後に表示モードを再判定する。
  const selectionKey = selectedNodeIds.join(' ');
  useEffect(() => {
    const frameId = requestAnimationFrame(() => computeDisplayModes());
    return () => cancelAnimationFrame(frameId);
  }, [selectionKey, computeDisplayModes]);

  useEffect(() => {
    const settlingNodeIds = settlingNodeIdsRef.current;
    const nativeHiddenByInteractionCaptureNodeIds = nativeHiddenByInteractionCaptureRef.current;
    const interactionCaptureRetryNodeIds = interactionCaptureRetryNodeIdsRef.current;
    const toolbarOccludedNodeIds = toolbarOccludedIdsRef.current;
    return () => {
      cancelInteractionCaptureRetry();
      cancelAllNativeReveals();
      nativeHiddenByInteractionCaptureNodeIds.clear();
      interactionCaptureRetryNodeIds.clear();
      settlingNodeIds.clear();
      toolbarOccludedNodeIds.clear();
    };
  }, [cancelAllNativeReveals, cancelInteractionCaptureRetry]);

  return {
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
