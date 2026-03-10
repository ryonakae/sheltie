import { useCallback, useEffect, useRef } from 'react';

interface UseSiteboardPanOptions {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  backgroundRef?: React.RefObject<HTMLDivElement | null>;
  zoom: React.RefObject<number>;
  panX: React.RefObject<number>;
  panY: React.RefObject<number>;
  onPanEnd: (panX: number, panY: number) => void;
  onInteractionChange: (active: boolean) => void;
  /** パン移動中に毎フレーム呼ばれる（Webview 座標リアルタイム同期用） */
  onPanMove?: () => void;
  beforePanStart?: () => Promise<boolean>;
}

/**
 * アートボードのパン操作（Space+ドラッグ / ミドルクリック+ドラッグ）を管理する Hook。
 * DOM 直接操作でパンを反映し、mouseup 時のみストアへ同期する。
 */
export function useSiteboardPan({
  canvasRef,
  backgroundRef,
  zoom,
  panX,
  panY,
  onPanEnd,
  onInteractionChange,
  onPanMove,
  beforePanStart,
}: UseSiteboardPanOptions) {
  const isPanMode = useRef(false);
  const isDragging = useRef(false);
  const isPreparing = useRef(false);
  const pendingPanStart = useRef<{
    startMouse: { x: number; y: number };
    startPan: { x: number; y: number };
  } | null>(null);
  const startMouse = useRef({ x: 0, y: 0 });
  const startPan = useRef({ x: 0, y: 0 });
  const currentCursor = useRef('default');

  const applyTransform = useCallback(() => {
    if (!canvasRef.current) return;
    canvasRef.current.style.transform = `translate(${panX.current}px, ${panY.current}px) scale(${zoom.current})`;
    canvasRef.current.style.setProperty('--canvas-zoom', String(zoom.current));
    if (!backgroundRef?.current) return;
    backgroundRef.current.style.setProperty('--siteboard-dot-scale', String(zoom.current));
    backgroundRef.current.style.setProperty('--siteboard-bg-x', `${panX.current}px`);
    backgroundRef.current.style.setProperty('--siteboard-bg-y', `${panY.current}px`);
  }, [backgroundRef, canvasRef, zoom, panX, panY]);

  const setCursor = useCallback((cursor: string) => {
    currentCursor.current = cursor;
    document.body.style.cursor = cursor;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // input/textarea 内ではパンモードを起動しない
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space' && !isPanMode.current) {
        e.preventDefault();
        isPanMode.current = true;
        setCursor('grab');
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isPanMode.current = false;
        if (!isDragging.current) {
          setCursor('default');
        }
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      const isSpacePan = isPanMode.current && e.button === 0;
      const isMiddleClick = e.button === 1;

      if (!isSpacePan && !isMiddleClick) return;

      e.preventDefault();
      if (isPreparing.current || isDragging.current) return;

      pendingPanStart.current = {
        startMouse: { x: e.clientX, y: e.clientY },
        startPan: { x: panX.current, y: panY.current },
      };
      isPreparing.current = true;

      void (async () => {
        const canStart = (await beforePanStart?.()) ?? true;
        const pending = pendingPanStart.current;
        isPreparing.current = false;
        if (!pending) return;

        pendingPanStart.current = null;
        if (!canStart) {
          setCursor(isPanMode.current ? 'grab' : 'default');
          return;
        }

        isDragging.current = true;
        startMouse.current = pending.startMouse;
        startPan.current = pending.startPan;
        setCursor('grabbing');
        onInteractionChange(true);
      })();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - startMouse.current.x;
      const dy = e.clientY - startMouse.current.y;
      panX.current = startPan.current.x + dx;
      panY.current = startPan.current.y + dy;
      applyTransform();
      onPanMove?.();
    };

    const handleMouseUp = () => {
      if (pendingPanStart.current) {
        pendingPanStart.current = null;
      }
      if (!isDragging.current) return;
      isDragging.current = false;
      onInteractionChange(false);
      onPanEnd(panX.current, panY.current);
      setCursor(isPanMode.current ? 'grab' : 'default');
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      isDragging.current = false;
      isPreparing.current = false;
      pendingPanStart.current = null;
      isPanMode.current = false;
      document.body.style.cursor = '';
    };
  }, [
    applyTransform,
    beforePanStart,
    setCursor,
    zoom,
    panX,
    panY,
    onPanEnd,
    onInteractionChange,
    onPanMove,
  ]);

  return { isPanMode, isDragging };
}
