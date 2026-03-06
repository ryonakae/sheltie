import { useCallback, useEffect, useRef } from 'react';

import { PAGE_MIN_HEIGHT, PAGE_MIN_WIDTH } from '@/constants';

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface UsePageResizeOptions {
  zoom: React.RefObject<number>;
  onResizeStart?: (nodeId: string) => void;
  onResizeMove?: (nodeId: string, width: number, height: number) => void;
  onResizeEnd: (nodeId: string, width: number, height: number) => void;
  onInteractionChange: (active: boolean, direction?: ResizeDirection) => void;
  /** リサイズ最小幅（デフォルト: PAGE_MIN_WIDTH = 320） */
  minWidth?: number;
  /** リサイズ最小高さ（デフォルト: PAGE_MIN_HEIGHT = 200） */
  minHeight?: number;
  /** リサイズ中の幅・DOM 状態に応じた動的最小高さ */
  resolveMinHeight?: (context: {
    nodeId: string;
    frameEl: HTMLElement;
    webviewEl: HTMLElement | null;
    width: number;
    direction: ResizeDirection;
  }) => number;
}

interface ResizeState {
  nodeId: string;
  frameEl: HTMLElement;
  webviewEl: HTMLElement | null;
  direction: ResizeDirection;
  startMouse: { x: number; y: number };
  startRect: { x: number; y: number; width: number; height: number };
  currentWidth: number;
  currentHeight: number;
}

/**
 * アートボード内のページをリサイズする Hook。
 * 8 方向リサイズハンドルの mousedown → mousemove（DOM 直接操作）→ mouseup（ストア同期）。
 */
export function usePageResize({
  zoom,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  onInteractionChange,
  minWidth = PAGE_MIN_WIDTH,
  minHeight = PAGE_MIN_HEIGHT,
  resolveMinHeight,
}: UsePageResizeOptions) {
  const resizeState = useRef<ResizeState | null>(null);
  const onResizeMoveRef = useRef(onResizeMove);
  const resolveMinHeightRef = useRef(resolveMinHeight);
  // レンダリング外で ref を更新（latest ref パターン: stale closure を回避）
  useEffect(() => {
    onResizeMoveRef.current = onResizeMove;
  });
  useEffect(() => {
    resolveMinHeightRef.current = resolveMinHeight;
  });

  const startResize = useCallback(
    (e: React.MouseEvent, nodeId: string, direction: ResizeDirection) => {
      if (e.button !== 0) return;
      const frameEl = (e.currentTarget as HTMLElement).closest('[data-node-id]') as HTMLElement;
      if (!frameEl) return;

      const webviewEl = frameEl.querySelector('[data-webview-placeholder]') as HTMLElement | null;
      const initialWidth = frameEl.offsetWidth;
      const initialHeight = webviewEl ? webviewEl.offsetHeight : frameEl.offsetHeight;

      e.preventDefault();
      resizeState.current = {
        nodeId,
        frameEl,
        webviewEl,
        direction,
        startMouse: { x: e.clientX, y: e.clientY },
        startRect: {
          x: parseInt(frameEl.style.left || '0', 10),
          y: parseInt(frameEl.style.top || '0', 10),
          width: initialWidth,
          height: initialHeight,
        },
        currentWidth: initialWidth,
        currentHeight: initialHeight,
      };
      onResizeStart?.(nodeId);
      document.body.style.userSelect = 'none';
      onInteractionChange(true, direction);
    },
    [onInteractionChange, onResizeStart],
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

      // 方向に応じて位置とサイズを計算（整数に丸めてサブピクセルずれを防ぐ）
      if (dir.includes('e')) newW = Math.max(minWidth, Math.round(width + dx));
      if (dir.includes('w')) {
        const clampedDx = Math.min(dx, width - minWidth);
        newW = Math.round(width - clampedDx);
        newX = Math.round(x + clampedDx);
      }
      const dynamicMinHeight = Math.max(
        minHeight,
        resolveMinHeightRef.current?.({
          nodeId: state.nodeId,
          frameEl: state.frameEl,
          webviewEl: state.webviewEl,
          width: newW,
          direction: dir,
        }) ?? minHeight,
      );
      if (dir.includes('s')) newH = Math.max(dynamicMinHeight, Math.round(height + dy));
      if (dir.includes('n')) {
        const clampedDy = Math.min(dy, height - dynamicMinHeight);
        newH = Math.round(height - clampedDy);
        newY = Math.round(y + clampedDy);
      }
      if (newH < dynamicMinHeight) {
        if (dir.includes('n') && !dir.includes('s')) {
          newY = Math.round(y + (height - dynamicMinHeight));
        }
        newH = dynamicMinHeight;
      }

      state.frameEl.style.left = `${newX}px`;
      state.frameEl.style.top = `${newY}px`;
      state.frameEl.style.width = `${newW}px`;
      if (state.webviewEl) {
        state.webviewEl.style.width = `${newW}px`;
        state.webviewEl.style.height = `${newH}px`;
      } else {
        state.frameEl.style.height = `${newH}px`;
      }
      state.currentWidth = newW;
      state.currentHeight = newH;
      onResizeMoveRef.current?.(state.nodeId, newW, newH);
    };

    const handleMouseUp = () => {
      const state = resizeState.current;
      if (!state) return;

      const width = state.currentWidth;
      const height = state.currentHeight;

      resizeState.current = null;
      document.body.style.userSelect = '';
      onInteractionChange(false);
      onResizeEnd(state.nodeId, width, height);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      resizeState.current = null;
      document.body.style.userSelect = '';
    };
  }, [zoom, onResizeEnd, onInteractionChange, minWidth, minHeight]);

  return { startResize };
}
