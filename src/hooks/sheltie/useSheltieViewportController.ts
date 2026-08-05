import { type ReactFlowInstance, type Viewport as FlowViewport } from '@xyflow/react';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { ZOOM_END_DEBOUNCE_MS, ZOOM_RESET_TARGET, ZOOM_STEPS } from '@/constants';
import {
  resolveCenteredViewport,
  resolveFitViewport,
  type SheltieViewportTarget,
} from '@/lib/sheltie-viewport';
import { registerViewCommandHandlers } from '@/lib/view-commands';
import type { BoardNode, Viewport } from '@/types';

type ViewportFlowInstance = Pick<ReactFlowInstance, 'setViewport'>;

const VIEWPORT_SYNC_EPSILON = 0.001;

function isSameViewport(a: FlowViewport | null, b: FlowViewport): boolean {
  if (!a) return false;

  return (
    Math.abs(a.x - b.x) < VIEWPORT_SYNC_EPSILON &&
    Math.abs(a.y - b.y) < VIEWPORT_SYNC_EPSILON &&
    Math.abs(a.zoom - b.zoom) < VIEWPORT_SYNC_EPSILON
  );
}

interface UseSheltieViewportControllerParams {
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoomRef: React.RefObject<number>;
  nodes: BoardNode[];
  /** store の viewport（panX/panY/zoom）。project 切り替え・centering・復元の同期元 */
  storeViewport: FlowViewport;
  updateViewport: (viewport: Partial<Viewport>) => void;
  getSelectedNodeIds: () => string[];
  setSelection: (nodeIds: string[]) => void;
  clearEdgeSelection: () => void;
  prepareMcpFocusSelection: (nodeIds: string[]) => void;
  // useSheltieDisplayEngine と連携する操作種別ハンドラ
  cancelZoomRestore: () => void;
  scheduleZoomRestoreAfterReflow: () => void;
  prepareInteractionStart: (type: 'pan' | 'zoom') => void | Promise<unknown>;
  handleInteractionChange: (active: boolean, type: 'pan' | 'zoom') => void;
  scheduleInteractionUpdate: () => void;
}

/**
 * React Flow のビューポート（pan/zoom）管理を Sheltie から切り出したフック。
 * - viewport 変更の zoomRef / uiZoom / --canvas-zoom 同期と store への debounce 反映
 * - store 側 viewport 変化時の setViewport 再同期
 * - fit / reset / zoom-in / zoom-out（View メニュー連携含む）
 * zoomRef と containerRef は display engine・ドラッグ・flowNodes と共有するため呼び出し側が保持する。
 */
export function useSheltieViewportController({
  containerRef,
  zoomRef,
  nodes,
  storeViewport,
  updateViewport,
  getSelectedNodeIds,
  setSelection,
  clearEdgeSelection,
  prepareMcpFocusSelection,
  cancelZoomRestore,
  scheduleZoomRestoreAfterReflow,
  prepareInteractionStart,
  handleInteractionChange,
  scheduleInteractionUpdate,
}: UseSheltieViewportControllerParams) {
  const [uiZoom, setUiZoom] = useState(() => storeViewport.zoom);
  const viewportUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uiZoomRafRef = useRef<number | null>(null);
  // edge/node の型に依存せず、実際に使う setViewport だけを保持する
  const reactFlowInstanceRef = useRef<ViewportFlowInstance | null>(null);
  const flowViewportRef = useRef<FlowViewport | null>(null);
  const moveInteractionTypeRef = useRef<'pan' | 'zoom' | null>(null);
  const prefersReducedMotion = useReducedMotion();

  // React Flow のビューポート変更ハンドラー
  const handleViewportChange = useCallback(
    (viewport: FlowViewport) => {
      flowViewportRef.current = viewport;
      zoomRef.current = viewport.zoom;
      // --canvas-zoom CSS 変数を同期（zoomPx() が引き続き動作するために必要）
      if (containerRef.current) {
        containerRef.current.style.setProperty('--canvas-zoom', String(viewport.zoom));
      }

      // setUiZoom は rAF で1フレームに1回に制限（毎フレームの re-render を防ぐ）
      if (uiZoomRafRef.current === null) {
        uiZoomRafRef.current = requestAnimationFrame(() => {
          uiZoomRafRef.current = null;
          setUiZoom(zoomRef.current);
        });
      }

      // debounce でストアへ永続化
      if (viewportUpdateTimerRef.current) clearTimeout(viewportUpdateTimerRef.current);
      viewportUpdateTimerRef.current = setTimeout(() => {
        viewportUpdateTimerRef.current = null;
        updateViewport({ zoom: viewport.zoom, panX: viewport.x, panY: viewport.y });
      }, ZOOM_END_DEBOUNCE_MS);
    },
    [containerRef, updateViewport, zoomRef],
  );

  const syncViewportFromStore = useCallback(
    (instance = reactFlowInstanceRef.current) => {
      if (!instance) return;
      if (isSameViewport(flowViewportRef.current, storeViewport)) return;

      flowViewportRef.current = storeViewport;
      zoomRef.current = storeViewport.zoom;
      setUiZoom(storeViewport.zoom);
      if (containerRef.current) {
        containerRef.current.style.setProperty('--canvas-zoom', String(storeViewport.zoom));
      }

      void instance.setViewport(storeViewport, { duration: 0 });
    },
    [containerRef, storeViewport, zoomRef],
  );

  useEffect(() => {
    syncViewportFromStore();
  }, [syncViewportFromStore]);

  // --canvas-zoom を mount 直後（子 useEffect より前）に初期化する。
  // syncViewportFromStore は useEffect のため子コンポーネントの useEffect より後に走り、
  // Webview 作成時に --canvas-zoom が未設定（fallback 1）になって TopBar 高さが崩れる。
  // useLayoutEffect は useEffect より先に実行されるため、Webview 作成前に正しい値が設定できる。
  useLayoutEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.setProperty('--canvas-zoom', String(zoomRef.current));
    }
    // containerRef / zoomRef は安定参照のため、実質 mount 時のみ実行される
  }, [containerRef, zoomRef]);

  // React Flow は pan/zoom を同じ onMove 系 callback で通知するため、event から操作種別を復元する。
  // 現構成ではホイールは pan、Cmd/Ctrl+ホイールとピンチは zoom、programmatic setViewport は zoom 扱いにする。
  // Tauri WKWebView 環境では TouchEvent グローバルが未定義のため typeof ガードが必須。
  const resolveViewportInteractionType = useCallback(
    (event: MouseEvent | TouchEvent | null | undefined): 'pan' | 'zoom' =>
      event == null
        ? 'zoom'
        : 'deltaY' in event
          ? event.metaKey || event.ctrlKey
            ? 'zoom'
            : 'pan'
          : typeof TouchEvent !== 'undefined' &&
              event instanceof TouchEvent &&
              event.touches.length >= 2
            ? 'zoom'
            : 'pan',
    [],
  );

  // pan/zoom のインタラクション開始を記録し display engine を起動する共通処理。
  // handleMoveStart（主経路）と handleMove（fallback）の両方から呼ばれる。
  const beginViewportInteraction = useCallback(
    (event: MouseEvent | TouchEvent | null | undefined) => {
      const type = resolveViewportInteractionType(event);
      moveInteractionTypeRef.current = type;
      void prepareInteractionStart(type);
      handleInteractionChange(true, type);
      return type;
    },
    [resolveViewportInteractionType, prepareInteractionStart, handleInteractionChange],
  );

  const handleMoveStart = useCallback(
    (_event: MouseEvent | TouchEvent | null, _viewport: FlowViewport) => {
      beginViewportInteraction(_event);
    },
    [beginViewportInteraction],
  );

  const handleMove = useCallback(
    (_event: MouseEvent | TouchEvent | null, _viewport: FlowViewport) => {
      // onMoveStart が取りこぼされた場合のフォールバック。
      // onMove は viewport が実際に動いた時のみ発火するためクリック誤発火がない。
      if (moveInteractionTypeRef.current === null) {
        beginViewportInteraction(_event);
      }
      scheduleInteractionUpdate();
    },
    [beginViewportInteraction, scheduleInteractionUpdate],
  );

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, _viewport: FlowViewport) => {
      // start が取りこぼされた場合も 'pan' にフォールバックして display engine を正常終了させる
      const type = moveInteractionTypeRef.current ?? 'pan';
      moveInteractionTypeRef.current = null;
      handleInteractionChange(false, type);
    },
    [handleInteractionChange],
  );

  const applyViewportTarget = useCallback(
    (target: SheltieViewportTarget): boolean => {
      const instance = reactFlowInstanceRef.current;
      if (!instance) return false;

      const currentViewport = flowViewportRef.current;
      const zoomChanged =
        !currentViewport || Math.abs(currentViewport.zoom - target.zoom) >= VIEWPORT_SYNC_EPSILON;
      const animationDurationMs = prefersReducedMotion ? 0 : 240;

      cancelZoomRestore();
      if (zoomRestoreTimerRef.current) clearTimeout(zoomRestoreTimerRef.current);
      instance.setViewport(target, { duration: animationDurationMs });

      if (!zoomChanged) return true;
      zoomRestoreTimerRef.current = setTimeout(
        () => {
          zoomRestoreTimerRef.current = null;
          scheduleZoomRestoreAfterReflow();
        },
        prefersReducedMotion ? 0 : animationDurationMs + 20,
      );
      return true;
    },
    [cancelZoomRestore, prefersReducedMotion, scheduleZoomRestoreAfterReflow],
  );

  const getViewport = useCallback((): Viewport => {
    const viewport = flowViewportRef.current ?? storeViewport;
    return { zoom: viewport.zoom, panX: viewport.x, panY: viewport.y };
  }, [storeViewport]);

  const focusNodes = useCallback(
    (nodeIds: string[]): { focusedNodeIds: string[] } => {
      const requestedIds = Array.from(new Set(nodeIds));
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      const focusedNodes = requestedIds.flatMap((nodeId) => {
        const node = nodeById.get(nodeId);
        return node ? [node] : [];
      });
      if (focusedNodes.length === 0) {
        throw {
          code: 'validation_failed',
          message: 'focusNodes requires at least one existing node ID',
        };
      }

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        throw {
          code: 'renderer_unavailable',
          message: 'Sheltie canvas is not ready for focus',
          retry: 'Wait for the document renderer to finish loading, then retry',
        };
      }

      const target = resolveFitViewport(focusedNodes, rect.width, rect.height);
      if (!target || !applyViewportTarget(target)) {
        throw {
          code: 'renderer_unavailable',
          message: 'Sheltie canvas is not ready for focus',
          retry: 'Wait for the document renderer to finish loading, then retry',
        };
      }

      const focusedNodeIds = focusedNodes.map((node) => node.id);
      const currentSelection = getSelectedNodeIds();
      const selectionChanged =
        currentSelection.length !== focusedNodeIds.length ||
        currentSelection.some((nodeId, index) => nodeId !== focusedNodeIds[index]);
      if (selectionChanged) {
        prepareMcpFocusSelection(focusedNodeIds);
        setSelection(focusedNodeIds);
      }
      clearEdgeSelection();

      return { focusedNodeIds };
    },
    [
      applyViewportTarget,
      clearEdgeSelection,
      containerRef,
      getSelectedNodeIds,
      nodes,
      prepareMcpFocusSelection,
      setSelection,
    ],
  );

  const handleCenterViewportAtDefaultZoom = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    applyViewportTarget(resolveCenteredViewport(nodes, rect.width, rect.height, ZOOM_RESET_TARGET));
  }, [applyViewportTarget, containerRef, nodes]);

  const handleFitAllNodes = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const target = resolveFitViewport(nodes, rect.width, rect.height);
    if (!target) return;
    applyViewportTarget(target);
  }, [applyViewportTarget, containerRef, nodes]);

  const handleResetViewport = useCallback(() => {
    handleCenterViewportAtDefaultZoom();
  }, [handleCenterViewportAtDefaultZoom]);

  const handleZoomIn = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const viewport = flowViewportRef.current;
    if (!viewport) return;

    const { x, y, zoom } = viewport;
    const nextZoom =
      ZOOM_STEPS.find((step) => step > zoom + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
    if (Math.abs(nextZoom - zoom) < 0.001) return;

    // ビューポート中心のワールド座標を固定してズーム
    const worldX = (rect.width / 2 - x) / zoom;
    const worldY = (rect.height / 2 - y) / zoom;
    applyViewportTarget({
      x: rect.width / 2 - worldX * nextZoom,
      y: rect.height / 2 - worldY * nextZoom,
      zoom: nextZoom,
    });
  }, [applyViewportTarget, containerRef]);

  const handleZoomOut = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const viewport = flowViewportRef.current;
    if (!viewport) return;

    const { x, y, zoom } = viewport;
    const prevZoom = [...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.001) ?? ZOOM_STEPS[0];
    if (Math.abs(prevZoom - zoom) < 0.001) return;

    // ビューポート中心のワールド座標を固定してズーム
    const worldX = (rect.width / 2 - x) / zoom;
    const worldY = (rect.height / 2 - y) / zoom;
    applyViewportTarget({
      x: rect.width / 2 - worldX * prevZoom,
      y: rect.height / 2 - worldY * prevZoom,
      zoom: prevZoom,
    });
  }, [applyViewportTarget, containerRef]);

  // ビューポートの debounce タイマーと rAF のクリーンアップ
  useEffect(() => {
    return () => {
      if (viewportUpdateTimerRef.current) clearTimeout(viewportUpdateTimerRef.current);
      if (zoomRestoreTimerRef.current) clearTimeout(zoomRestoreTimerRef.current);
      if (uiZoomRafRef.current !== null) cancelAnimationFrame(uiZoomRafRef.current);
    };
  }, []);

  useEffect(() => {
    return registerViewCommandHandlers({
      fitView: handleFitAllNodes,
      resetZoom: handleResetViewport,
      zoomIn: handleZoomIn,
      zoomOut: handleZoomOut,
    });
  }, [handleFitAllNodes, handleResetViewport, handleZoomIn, handleZoomOut]);

  // React Flow の onInit。インスタンス参照を保持し、store viewport を初回同期する
  const handleInit = useCallback(
    (instance: ViewportFlowInstance) => {
      reactFlowInstanceRef.current = instance;
      syncViewportFromStore(instance);
    },
    [syncViewportFromStore],
  );

  return {
    uiZoom,
    handleInit,
    handleViewportChange,
    handleMoveStart,
    handleMove,
    handleMoveEnd,
    getViewport,
    focusNodes,
    handleFitAllNodes,
    handleResetViewport,
    handleZoomIn,
    handleZoomOut,
  };
}
