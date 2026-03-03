import { useCallback, useEffect } from 'react';

import {
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_SENSITIVITY,
  ZOOM_END_DEBOUNCE_MS,
  WHEEL_PAN_END_DEBOUNCE_MS,
} from '@/renderer/constants';

interface UseSiteboardZoomOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  backgroundRef?: React.RefObject<HTMLDivElement | null>;
  zoom: React.RefObject<number>;
  panX: React.RefObject<number>;
  panY: React.RefObject<number>;
  onZoomEnd: (zoom: number, panX: number, panY: number) => void;
  /** ズーム/パン操作の開始/終了を通知 */
  onInteractionChange?: (active: boolean) => void;
  /** ホイール操作中に毎フレーム呼ばれる（Webview 座標リアルタイム同期用） */
  onBoundsUpdate?: () => void;
}

/**
 * アートボードのホイール操作（ズーム・パン）を管理する Hook。
 * - Ctrl/Cmd + ホイール: マウスカーソル位置を中心にズーム
 * - ホイール（修飾キーなし）: deltaX/deltaY でパン（スクロール移動）
 * DOM 直接操作で反映し、操作停止後 debounce でストアへ同期する。
 */
export function useSiteboardZoom({
  containerRef,
  canvasRef,
  backgroundRef,
  zoom,
  panX,
  panY,
  onZoomEnd,
  onInteractionChange,
  onBoundsUpdate,
}: UseSiteboardZoomOptions) {
  const applyTransform = useCallback(() => {
    if (!canvasRef.current) return;
    canvasRef.current.style.transform = `translate(${panX.current}px, ${panY.current}px) scale(${zoom.current})`;
    canvasRef.current.style.setProperty('--canvas-zoom', String(zoom.current));
    if (!backgroundRef?.current) return;
    backgroundRef.current.style.setProperty('--siteboard-dot-scale', String(zoom.current));
    backgroundRef.current.style.setProperty('--siteboard-bg-x', `${panX.current}px`);
    backgroundRef.current.style.setProperty('--siteboard-bg-y', `${panY.current}px`);
  }, [backgroundRef, canvasRef, zoom, panX, panY]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let commitTimer: ReturnType<typeof setTimeout> | null = null;
    let isInteracting = false;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      // 最初のホイールイベントで操作開始を通知（Webview を hide）
      if (!isInteracting) {
        isInteracting = true;
        onInteractionChange?.(true);
      }

      const isZoomGesture = e.ctrlKey || e.metaKey;
      if (isZoomGesture) {
        const rect = container.getBoundingClientRect();
        // コンテナ左上を基準としたマウス座標
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const prevZoom = zoom.current;
        const nextZoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, prevZoom * (1 - e.deltaY * ZOOM_SENSITIVITY)),
        );
        const scaleRatio = nextZoom / prevZoom;

        // マウスカーソル位置を中心にズームするための pan 補正
        panX.current = mx - (mx - panX.current) * scaleRatio;
        panY.current = my - (my - panY.current) * scaleRatio;
        zoom.current = nextZoom;
      } else {
        // 修飾キーなし: スクロール量をそのままパンに反映
        panX.current -= e.deltaX;
        panY.current -= e.deltaY;
      }

      applyTransform();
      onBoundsUpdate?.();

      // ホイール操作が止まってから debounce 後にストアへ同期して操作終了を通知
      // ズームは切替チラつき抑制のため長め、ホイールパンは従来どおり短めにする
      const interactionEndDebounceMs = isZoomGesture
        ? ZOOM_END_DEBOUNCE_MS
        : WHEEL_PAN_END_DEBOUNCE_MS;
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = setTimeout(() => {
        commitTimer = null;
        isInteracting = false;
        onZoomEnd(zoom.current, panX.current, panY.current);
        onInteractionChange?.(false);
      }, interactionEndDebounceMs);
    };

    // { passive: false } で preventDefault が効くようにする
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (commitTimer) clearTimeout(commitTimer);
    };
  }, [
    containerRef,
    applyTransform,
    zoom,
    panX,
    panY,
    onZoomEnd,
    onInteractionChange,
    onBoundsUpdate,
  ]);
}
