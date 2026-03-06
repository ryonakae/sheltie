import { useEffect } from 'react';

import { registerEditCommandHandlers, runEditCommand } from '@/lib/edit-commands';

interface UseSiteboardKeyboardParams {
  selectedNodeId: string | null;
  onRemoveNode: (nodeId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

/**
 * Siteboard の編集ショートカットを処理する。
 * - Delete / Backspace: 選択中ノード削除
 * - Cmd/Ctrl + Z: Undo
 * - Cmd/Ctrl + Shift + Z: Redo
 */
export function useSiteboardKeyboard({
  selectedNodeId,
  onRemoveNode,
  onUndo,
  onRedo,
}: UseSiteboardKeyboardParams) {
  useEffect(() => {
    return registerEditCommandHandlers({
      delete: () => {
        if (!selectedNodeId) return false;
        onRemoveNode(selectedNodeId);
        return true;
      },
      redo: () => {
        onRedo();
        return true;
      },
      undo: () => {
        onUndo();
        return true;
      },
    });
  }, [onRedo, onRemoveNode, onUndo, selectedNodeId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isModifierPressed = e.metaKey || e.ctrlKey;
      const lowerKey = e.key.toLowerCase();

      if (isModifierPressed && !e.altKey && lowerKey === 'z') {
        const handled = e.shiftKey ? runEditCommand('redo') : runEditCommand('undo');
        if (handled) {
          e.preventDefault();
        }
        return;
      }

      if (e.altKey || isModifierPressed) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') {
        return;
      }

      if (runEditCommand('delete')) {
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}
