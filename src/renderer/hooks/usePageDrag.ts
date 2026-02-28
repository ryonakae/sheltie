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
  /** mousedown 時は false。閾値を超えた mousemove で true になる */
  isDragging: boolean;
}

/** mousedown から実際の移動とみなす最小距離（px） */
const DRAG_THRESHOLD = 3;

/**
 * アートボード内のページをドラッグ移動する Hook。
 * タイトルバーの mousedown → mousemove（DOM 直接操作）→ mouseup（ストア同期）の流れ。
 * ズーム倍率で delta を補正してキャンバス座標を維持する。
 * 閾値未満の移動（単なるクリック）では Webview の hide/show を発生させない。
 */
export function usePageDrag({ zoom, onDragEnd, onInteractionChange }: UsePageDragOptions) {
  const dragState = useRef<DragState | null>(null);

  const startDrag = useCallback((e: React.MouseEvent, pageId: string) => {
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
      isDragging: false,
    };
    document.body.style.userSelect = 'none';
    // onInteractionChange(true) はドラッグ閾値を超えてから呼ぶ（単なるクリックで Webview を hide しない）
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const state = dragState.current;
      if (!state) return;

      // 閾値を超えた時点で初めてドラッグ開始とみなし Webview を隠す
      if (!state.isDragging) {
        const rawDx = e.clientX - state.startMouse.x;
        const rawDy = e.clientY - state.startMouse.y;
        if (Math.sqrt(rawDx * rawDx + rawDy * rawDy) < DRAG_THRESHOLD) return;
        state.isDragging = true;
        onInteractionChange(true);
      }

      // ズームを考慮してキャンバス座標系に変換
      const dx = (e.clientX - state.startMouse.x) / zoom.current;
      const dy = (e.clientY - state.startMouse.y) / zoom.current;

      state.frameEl.style.left = `${state.startPos.x + dx}px`;
      state.frameEl.style.top = `${state.startPos.y + dy}px`;
    };

    const handleMouseUp = () => {
      const state = dragState.current;
      if (!state) return;

      // クリーンアップは常に実行（ウィンドウ外でマウスアップした場合も含む）
      dragState.current = null;
      document.body.style.userSelect = '';

      // ドラッグが実際に発生した場合のみ Webview を再表示してストアを更新
      if (state.isDragging) {
        const x = parseInt(state.frameEl.style.left || '0', 10);
        const y = parseInt(state.frameEl.style.top || '0', 10);
        onInteractionChange(false);
        onDragEnd(state.pageId, x, y);
      }
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
