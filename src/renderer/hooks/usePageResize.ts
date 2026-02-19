import { useCallback, useEffect, useRef } from 'react';

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const PAGE_MIN_WIDTH = 320;
const PAGE_MIN_HEIGHT = 200;

interface UsePageResizeOptions {
  zoom: React.RefObject<number>;
  onResizeEnd: (pageId: string, width: number, height: number) => void;
  onInteractionChange: (active: boolean) => void;
}

interface ResizeState {
  pageId: string;
  frameEl: HTMLElement;
  webviewEl: HTMLElement | null;
  direction: ResizeDirection;
  startMouse: { x: number; y: number };
  startRect: { x: number; y: number; width: number; height: number };
}

/**
 * アートボード内のページをリサイズする Hook。
 * 8 方向リサイズハンドルの mousedown → mousemove（DOM 直接操作）→ mouseup（ストア同期）。
 */
export function usePageResize({ zoom, onResizeEnd, onInteractionChange }: UsePageResizeOptions) {
  const resizeState = useRef<ResizeState | null>(null);

  const startResize = useCallback(
    (e: React.MouseEvent, pageId: string, direction: ResizeDirection) => {
      const frameEl = (e.currentTarget as HTMLElement).closest('[data-page-id]') as HTMLElement;
      if (!frameEl) return;

      e.preventDefault();
      resizeState.current = {
        pageId,
        frameEl,
        webviewEl: frameEl.querySelector('webview') as HTMLElement | null,
        direction,
        startMouse: { x: e.clientX, y: e.clientY },
        startRect: {
          x: parseInt(frameEl.style.left || '0', 10),
          y: parseInt(frameEl.style.top || '0', 10),
          width: frameEl.offsetWidth,
          height: frameEl.querySelector('webview')
            ? (frameEl.querySelector('webview') as HTMLElement).offsetHeight
            : frameEl.offsetHeight,
        },
      };
      document.body.style.userSelect = 'none';
      onInteractionChange(true);
    },
    [onInteractionChange],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const state = resizeState.current;
      if (!state) return;

      const dx = (e.clientX - state.startMouse.x) / zoom.current;
      const dy = (e.clientY - state.startMouse.y) / zoom.current;
      const { x, y, width, height } = state.startRect;
      const dir = state.direction;

      let newX = x;
      let newY = y;
      let newW = width;
      let newH = height;

      // 方向に応じて位置とサイズを計算
      if (dir.includes('e')) newW = Math.max(PAGE_MIN_WIDTH, width + dx);
      if (dir.includes('s')) newH = Math.max(PAGE_MIN_HEIGHT, height + dy);
      if (dir.includes('w')) {
        const clampedDx = Math.min(dx, width - PAGE_MIN_WIDTH);
        newW = width - clampedDx;
        newX = x + clampedDx;
      }
      if (dir.includes('n')) {
        const clampedDy = Math.min(dy, height - PAGE_MIN_HEIGHT);
        newH = height - clampedDy;
        newY = y + clampedDy;
      }

      state.frameEl.style.left = `${newX}px`;
      state.frameEl.style.top = `${newY}px`;
      state.frameEl.style.width = `${newW}px`;
      if (state.webviewEl) {
        state.webviewEl.style.width = `${newW}px`;
        state.webviewEl.style.height = `${newH}px`;
      }
    };

    const handleMouseUp = () => {
      const state = resizeState.current;
      if (!state) return;

      const width = parseInt(state.frameEl.style.width || '0', 10);
      const height = state.webviewEl ? state.webviewEl.offsetHeight : 0;

      resizeState.current = null;
      document.body.style.userSelect = '';
      onInteractionChange(false);
      onResizeEnd(state.pageId, width, height);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [zoom, onResizeEnd, onInteractionChange]);

  return { startResize };
}
