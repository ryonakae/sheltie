import { useEffect } from 'react';

interface UseSiteboardKeyboardParams {
  selectedPageId: string | null;
  onRemovePage: (pageId: string) => void;
}

/**
 * Delete / Backspace キーで選択中ノードを削除する。
 * input / textarea / contenteditable 内ではスキップ（useSiteboardPan と同パターン）。
 */
export function useSiteboardKeyboard({ selectedPageId, onRemovePage }: UseSiteboardKeyboardParams) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;

      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return;
      }

      if (!selectedPageId) return;
      e.preventDefault();
      onRemovePage(selectedPageId);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedPageId, onRemovePage]);
}
