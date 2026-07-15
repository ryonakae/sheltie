import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { useCallback } from 'react';

import type { BoardNode } from '@/types';
import { isNodeEmpty, isStickyNoteNode, isTextNode, isWebPageNode } from '@/types';

import type { Edge } from '@xyflow/react';

interface UseSiteboardContextMenusParams {
  nodes: BoardNode[];
  setSelection: (idsOrUpdater: string[] | ((prev: string[]) => string[])) => void;
  setSelectedEdgeIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setEditingUrlNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  // display engine 連携
  handleContextMenuOpen: (nodeId: string) => Promise<void> | void;
  handleContextMenuClose: () => void;
  // ノード削除（settle リセット込み）
  onRemoveNode: (nodeId: string) => void;
  // store アクション
  removeEdges: (edgeIds: string[]) => void;
  bringNodeToFront: (nodeId: string) => void;
  sendNodeToBack: (nodeId: string) => void;
  bringNodeForward: (nodeId: string) => void;
  sendNodeBackward: (nodeId: string) => void;
}

/**
 * ノード／エッジの右クリックメニュー（macOS ネイティブメニュー）を Siteboard から切り出したフック。
 * Webview 表示制御はノード向けの仕組みなので、エッジメニューでは handleContextMenuOpen を呼ばない。
 */
export function useSiteboardContextMenus({
  nodes,
  setSelection,
  setSelectedEdgeIds,
  setEditingUrlNodeId,
  handleContextMenuOpen,
  handleContextMenuClose,
  onRemoveNode,
  removeEdges,
  bringNodeToFront,
  sendNodeToBack,
  bringNodeForward,
  sendNodeBackward,
}: UseSiteboardContextMenusParams) {
  const handleEdgeContextMenu = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      e.preventDefault();
      setSelection([]);
      setSelectedEdgeIds(new Set([edge.id]));

      const showMenu = async () => {
        const deleteItem = await MenuItem.new({
          text: 'Delete Arrow',
          accelerator: 'Backspace',
          action: () => {
            removeEdges([edge.id]);
          },
        });
        const menu = await Menu.new({ items: [deleteItem] });
        await menu.popup();
      };

      void showMenu();
    },
    [removeEdges, setSelectedEdgeIds, setSelection],
  );

  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.preventDefault();
      setSelectedEdgeIds(new Set());
      // 複数選択中の右クリック対象が選択メンバーなら選択を保持し、そうでなければ単独選択に切り替える
      setSelection((prev) => (prev.includes(nodeId) ? prev : [nodeId]));

      const node = nodes.find((candidate) => candidate.id === nodeId);
      const showMenu = async () => {
        if (node && !isStickyNoteNode(node) && !isTextNode(node)) {
          await handleContextMenuOpen(nodeId);
        }

        const menuItems: (MenuItem | PredefinedMenuItem)[] = [];

        if (node && isWebPageNode(node) && !isNodeEmpty(node)) {
          menuItems.push(
            await MenuItem.new({
              text: 'Change URL',
              action: () => {
                setEditingUrlNodeId(nodeId);
                handleContextMenuClose();
              },
            }),
          );
          menuItems.push(await PredefinedMenuItem.new({ item: 'Separator' }));
        }

        // 付箋・テキストノードの重なり順メニュー
        if (node && !isWebPageNode(node)) {
          const isAtFront = nodes[nodes.length - 1]?.id === nodeId;
          const isAtBack = nodes[0]?.id === nodeId;

          menuItems.push(
            await MenuItem.new({
              text: 'Bring to Front',
              accelerator: 'CmdOrCtrl+Alt+]',
              enabled: !isAtFront,
              action: () => {
                handleContextMenuClose();
                bringNodeToFront(nodeId);
              },
            }),
          );
          menuItems.push(
            await MenuItem.new({
              text: 'Bring Forward',
              accelerator: 'CmdOrCtrl+]',
              enabled: !isAtFront,
              action: () => {
                handleContextMenuClose();
                bringNodeForward(nodeId);
              },
            }),
          );
          menuItems.push(
            await MenuItem.new({
              text: 'Send Backward',
              accelerator: 'CmdOrCtrl+[',
              enabled: !isAtBack,
              action: () => {
                handleContextMenuClose();
                sendNodeBackward(nodeId);
              },
            }),
          );
          menuItems.push(
            await MenuItem.new({
              text: 'Send to Back',
              accelerator: 'CmdOrCtrl+Alt+[',
              enabled: !isAtBack,
              action: () => {
                handleContextMenuClose();
                sendNodeToBack(nodeId);
              },
            }),
          );
          menuItems.push(await PredefinedMenuItem.new({ item: 'Separator' }));
        }

        menuItems.push(
          await MenuItem.new({
            text: 'Delete Node',
            accelerator: 'Backspace',
            action: () => {
              handleContextMenuClose();
              onRemoveNode(nodeId);
            },
          }),
        );

        const menu = await Menu.new({ items: menuItems });
        await menu.popup();
        handleContextMenuClose();
      };

      void showMenu();
    },
    [
      handleContextMenuOpen,
      handleContextMenuClose,
      onRemoveNode,
      setSelection,
      setSelectedEdgeIds,
      setEditingUrlNodeId,
      nodes,
      bringNodeToFront,
      sendNodeToBack,
      bringNodeForward,
      sendNodeBackward,
    ],
  );

  return { handleNodeContextMenu, handleEdgeContextMenu };
}
