import type { BoardNode } from '@/types';

import type { Node, NodeChange } from '@xyflow/react';

/**
 * BoardNode 配列を React Flow の Node 配列に変換する。
 * nodeTypes との対応: 'webpage' → 'webPageFlowNode', 'stickynote' → 'stickyNoteFlowNode'
 */
export function boardNodesToFlowNodes(nodes: BoardNode[], zoom: number): Node[] {
  return nodes.map(
    (node): Node => ({
      id: node.id,
      type: node.type === 'stickynote' ? 'stickyNoteFlowNode' : 'webPageFlowNode',
      position: { x: node.x, y: node.y },
      style: {
        width: node.width / zoom,
        height: node.height / zoom,
      },
      // 元の BoardNode 全体を data として保持し、カスタムノードコンポーネントから参照できるようにする
      // React Flow の Node<T> は T が Record<string, unknown> に割り当て可能であることを要求するため cast する
      data: node as unknown as Record<string, unknown>,
    }),
  );
}

/**
 * React Flow の NodeChange 配列を Zustand アクションに変換して適用する。
 *
 * @param changes - React Flow から渡される変更イベント
 * @param projectId - 操作対象のプロジェクト ID
 * @param store - Zustand ストアのアクション（updateNodePosition 等）
 * @param callbacks - 選択変更・削除など store 外のコールバック
 */
export function applyFlowChangesToStore(
  changes: NodeChange[],
  projectId: string,
  store: {
    updateNodePosition: (projectId: string, nodeId: string, x: number, y: number) => void;
    updateNodeSize: (projectId: string, nodeId: string, width: number, height: number) => void;
    updateNodeSizeWithoutHistory: (
      projectId: string,
      nodeId: string,
      width: number,
      height: number,
    ) => void;
    removeNode: (projectId: string, nodeId: string) => void;
  },
  callbacks: {
    onSelectNode: (nodeId: string) => void;
    onClearSelection: () => void;
  },
): void {
  for (const change of changes) {
    switch (change.type) {
      case 'position':
        // dragging=false のタイミング（ドラッグ完了時）のみ履歴付き確定更新
        if (!change.dragging && change.position) {
          store.updateNodePosition(projectId, change.id, change.position.x, change.position.y);
        }
        break;
      case 'dimensions':
        if (change.dimensions) {
          if (change.resizing) {
            // リサイズ中は履歴なし（ドラッグ完了前の中間状態）
            store.updateNodeSizeWithoutHistory(
              projectId,
              change.id,
              change.dimensions.width,
              change.dimensions.height,
            );
          } else {
            // リサイズ完了時に履歴付き確定更新
            store.updateNodeSize(
              projectId,
              change.id,
              change.dimensions.width,
              change.dimensions.height,
            );
          }
        }
        break;
      case 'select':
        if (change.selected) {
          callbacks.onSelectNode(change.id);
        } else {
          callbacks.onClearSelection();
        }
        break;
      case 'remove':
        store.removeNode(projectId, change.id);
        break;
    }
  }
}
