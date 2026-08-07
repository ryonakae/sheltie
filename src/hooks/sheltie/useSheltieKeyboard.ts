import { useEffect } from 'react';

import {
  hasEditableFocus,
  registerEditCommandHandlers,
  runEditCommand,
  type EditCommand,
} from '@/lib/edit-commands';
import { runViewCommand } from '@/lib/view-commands';

interface UseSheltieKeyboardParams {
  selectedNodeIds: string[];
  selectedEdgeIds: Set<string>;
  onRemoveNode: (nodeId: string) => void;
  onRemoveNodes: (nodeIds: string[]) => void;
  onRemoveEdges: (edgeIds: string[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCut: () => boolean;
  onCopy: () => boolean;
  onPaste: () => boolean;
  onDuplicate: () => boolean;
  onBringNodeToFront: (nodeId: string) => void;
  onSendNodeToBack: (nodeId: string) => void;
  onBringNodeForward: (nodeId: string) => void;
  onSendNodeBackward: (nodeId: string) => void;
}

const CLIPBOARD_COMMAND_BY_KEY: Record<string, EditCommand> = {
  c: 'copy',
  x: 'cut',
  v: 'paste',
  d: 'duplicate',
};

/**
 * Sheltie の編集・ビューショートカットを処理する。
 * - Delete / Backspace: 選択中ノード削除 / 選択中エッジ削除
 * - Cmd/Ctrl + Z: Undo
 * - Cmd/Ctrl + Shift + Z: Redo
 * - Cmd/Ctrl + C / X / V / D: Copy / Cut / Paste / Duplicate
 * - Cmd/Ctrl + =: 拡大（Cmd+Shift+= のネイティブメニュー経路を補完）
 * - Cmd/Ctrl + ]: 1つ前面へ
 * - Cmd/Ctrl + [: 1つ背面へ
 * - Cmd/Ctrl + Alt + ]: 最前面へ
 * - Cmd/Ctrl + Alt + [: 最背面へ
 */
export function useSheltieKeyboard({
  selectedNodeIds,
  selectedEdgeIds,
  onRemoveNode,
  onRemoveNodes,
  onRemoveEdges,
  onUndo,
  onRedo,
  onCut,
  onCopy,
  onPaste,
  onDuplicate,
  onBringNodeToFront,
  onSendNodeToBack,
  onBringNodeForward,
  onSendNodeBackward,
}: UseSheltieKeyboardParams) {
  // 重なり順ショートカットは単独選択時のみ有効
  const soloSelectedNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;

  useEffect(() => {
    return registerEditCommandHandlers({
      delete: () => {
        // ノード削除時に connected edges を store.removeNode が cascade 削除するため、
        // ノードとエッジの両方が選択中ならノード削除を優先する（履歴を 1 ステップにまとめる）
        if (selectedNodeIds.length > 1) {
          onRemoveNodes(selectedNodeIds);
          return true;
        }
        if (selectedNodeIds.length === 1) {
          onRemoveNode(selectedNodeIds[0]);
          return true;
        }
        if (selectedEdgeIds.size > 0) {
          onRemoveEdges(Array.from(selectedEdgeIds));
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
      cut: onCut,
      copy: onCopy,
      paste: onPaste,
      duplicate: onDuplicate,
    });
  }, [
    onCopy,
    onCut,
    onDuplicate,
    onPaste,
    onRedo,
    onRemoveEdges,
    onRemoveNode,
    onRemoveNodes,
    onUndo,
    selectedEdgeIds,
    selectedNodeIds,
  ]);

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

      // Cmd+C/X/V/D: ノードのコピペ・複製。テキスト編集中は runEditCommand が false を返し、
      // preventDefault しないことで WKWebView のネイティブ動作に委ねる
      if (isModifierPressed && !e.altKey && !e.shiftKey) {
        const clipboardCommand = CLIPBOARD_COMMAND_BY_KEY[lowerKey];
        if (clipboardCommand) {
          if (runEditCommand(clipboardCommand)) {
            e.preventDefault();
          }
          return;
        }
      }

      // Cmd+= は Cmd+Shift+= のネイティブメニュー経路では拾えないため JS で補完
      if (isModifierPressed && !e.altKey && !e.shiftKey && e.key === '=') {
        runViewCommand('zoom-in');
        e.preventDefault();
        return;
      }

      // Cmd+]/[ / Cmd+Alt+]/[: ノードの重なり順変更（単独選択時のみ）
      if (isModifierPressed && soloSelectedNodeId && (e.key === ']' || e.key === '[')) {
        if (hasEditableFocus()) return;
        e.preventDefault();
        if (e.altKey) {
          if (e.key === ']') {
            onBringNodeToFront(soloSelectedNodeId);
          } else {
            onSendNodeToBack(soloSelectedNodeId);
          }
        } else {
          if (e.key === ']') {
            onBringNodeForward(soloSelectedNodeId);
          } else {
            onSendNodeBackward(soloSelectedNodeId);
          }
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
  }, [
    soloSelectedNodeId,
    onBringNodeToFront,
    onSendNodeToBack,
    onBringNodeForward,
    onSendNodeBackward,
  ]);
}
