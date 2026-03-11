import { useEffect } from 'react';

import { registerEditCommandHandlers, runEditCommand } from '@/lib/edit-commands';

interface UseSiteboardKeyboardParams {
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  onRemoveNodes: (nodeIds: string[]) => void;
  onRemoveEdges: (edgeIds: string[]) => void;
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
  selectedNodeIds,
  selectedEdgeIds,
  onRemoveNodes,
  onRemoveEdges,
  onUndo,
  onRedo,
}: UseSiteboardKeyboardParams) {
  useEffect(() => {
    return registerEditCommandHandlers({
      delete: () => {
        if (selectedNodeIds.length > 0) {
          onRemoveNodes(selectedNodeIds);
          return true;
        }
        if (selectedEdgeIds.length > 0) {
          onRemoveEdges(selectedEdgeIds);
          return true;
        }
        return false;
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
  }, [onRedo, onRemoveEdges, onRemoveNodes, onUndo, selectedEdgeIds, selectedNodeIds]);

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
