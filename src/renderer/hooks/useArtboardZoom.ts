import { useCallback, useEffect } from 'react';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3.0;
const ZOOM_SENSITIVITY = 0.001;

interface UseArtboardZoomOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  zoom: React.RefObject<number>;
  panX: React.RefObject<number>;
  panY: React.RefObject<number>;
  onZoomEnd: (zoom: number, panX: number, panY: number) => void;
  /** transform 変更ごとに呼ばれる。WebContentsView の bounds 同期に使用 */
  onTransformChange?: () => void;
}

/**
 * アートボードのズーム操作（Ctrl/Cmd + ホイール）を管理する Hook。
 * マウスカーソル位置を中心にズームし、DOM 直接操作で反映する。
 * mousewheel 終了は debounce で検知してストアへ同期する。
 */
export function useArtboardZoom({
  containerRef,
  canvasRef,
  zoom,
  panX,
  panY,
  onZoomEnd,
  onTransformChange,
}: UseArtboardZoomOptions) {
  const applyTransform = useCallback(() => {
    if (!canvasRef.current) return;
    canvasRef.current.style.transform = `translate(${panX.current}px, ${panY.current}px) scale(${zoom.current})`;
    onTransformChange?.();
  }, [canvasRef, zoom, panX, panY, onTransformChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let commitTimer: ReturnType<typeof setTimeout> | null = null;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

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

      applyTransform();

      // ホイール操作が止まってから 150ms 後にストアへ同期
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = setTimeout(() => {
        onZoomEnd(zoom.current, panX.current, panY.current);
      }, 150);
    };

    // { passive: false } で preventDefault が効くようにする
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (commitTimer) clearTimeout(commitTimer);
    };
  }, [containerRef, applyTransform, zoom, panX, panY, onZoomEnd]);
}
