import { useCallback, useEffect, useRef } from 'react';

interface UsePageDragOptions {
  zoom: React.RefObject<number>;
  onDragEnd: (pageId: string, x: number, y: number) => void;
  onInteractionChange: (active: boolean) => void;
}

interface DragState {
  pageId: string;
  frameEl: HTMLElement;
  startMouse: { x: number; y: number };
  startPos: { x: number; y: number };
}

/**
 * アートボード内のページをドラッグ移動する Hook。
 * タイトルバーの mousedown → mousemove（DOM 直接操作）→ mouseup（ストア同期）の流れ。
 * ズーム倍率で delta を補正してキャンバス座標を維持する。
 */
export function usePageDrag({ zoom, onDragEnd, onInteractionChange }: UsePageDragOptions) {
  const dragState = useRef<DragState | null>(null);

  const startDrag = useCallback(
    (e: React.MouseEvent, pageId: string) => {
      const frameEl = (e.currentTarget as HTMLElement).closest('[data-page-id]') as HTMLElement;
      if (!frameEl) return;

      e.preventDefault();
      dragState.current = {
        pageId,
        frameEl,
        startMouse: { x: e.clientX, y: e.clientY },
        startPos: {
          x: parseInt(frameEl.style.left || '0', 10),
          y: parseInt(frameEl.style.top || '0', 10),
        },
      };
      document.body.style.userSelect = 'none';
      onInteractionChange(true);
    },
    [onInteractionChange],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const state = dragState.current;
      if (!state) return;

      // ズームを考慮してキャンバス座標系に変換
      const dx = (e.clientX - state.startMouse.x) / zoom.current;
      const dy = (e.clientY - state.startMouse.y) / zoom.current;

      state.frameEl.style.left = `${state.startPos.x + dx}px`;
      state.frameEl.style.top = `${state.startPos.y + dy}px`;
    };

    const handleMouseUp = () => {
      const state = dragState.current;
      if (!state) return;

      const x = parseInt(state.frameEl.style.left || '0', 10);
      const y = parseInt(state.frameEl.style.top || '0', 10);

      dragState.current = null;
      document.body.style.userSelect = '';
      onInteractionChange(false);
      onDragEnd(state.pageId, x, y);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [zoom, onDragEnd, onInteractionChange]);

  return { startDrag };
}
