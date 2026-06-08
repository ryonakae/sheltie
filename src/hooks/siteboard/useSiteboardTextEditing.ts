import { useCallback, useEffect, useRef, useState } from 'react';

import { TEXT_NODE_MIN_WIDTH } from '@/constants';
import { useProjectStore } from '@/store/tab-store';
import type { BoardNode, TextNodeFontSizePreset } from '@/types';
import { isTextNode, isTextNodeEmpty } from '@/types';

interface TextNodeStyle {
  fontSizePreset?: TextNodeFontSizePreset;
  fontWeight?: 'normal' | 'bold';
  italic?: boolean;
  strikethrough?: boolean;
  textColorIndex?: number;
}

interface UseSiteboardTextEditingParams {
  nodes: BoardNode[];
  selectedNodeIds: string[];
  autoEditTextNodeId: string | null;
  onAutoEditTextNodeHandled?: () => void;
  autoEditStickyNoteId: string | null;
  onAutoEditStickyNoteHandled?: () => void;
  updateTextNodeContent: (nodeId: string, tiptapContent: object) => void;
  updateNodeSizeWithoutHistory: (nodeId: string, width: number, height: number) => void;
  updateTextNodeWidthMode: (nodeId: string, widthMode: 'auto' | 'fixed') => void;
  updateTextNodeStyle: (nodeId: string, style: TextNodeStyle) => void;
  changeWebNodeUrl: (nodeId: string, url: string) => void;
  removeNode: (nodeId: string) => void;
  removeNodes: (nodeIds: string[]) => void;
}

/**
 * テキストノードの編集状態（Tiptap 編集モード）と、WebPage の URL 編集モードを
 * Siteboard から切り出したフック。新規作成時の自動編集開始・空テキストノードの自動削除も担う。
 */
export function useSiteboardTextEditing({
  nodes,
  selectedNodeIds,
  autoEditTextNodeId,
  onAutoEditTextNodeHandled,
  autoEditStickyNoteId,
  onAutoEditStickyNoteHandled,
  updateTextNodeContent,
  updateNodeSizeWithoutHistory,
  updateTextNodeWidthMode,
  updateTextNodeStyle,
  changeWebNodeUrl,
  removeNode,
  removeNodes,
}: UseSiteboardTextEditingParams) {
  const [editingUrlNodeId, setEditingUrlNodeId] = useState<string | null>(null);
  const [editingTextNodeId, setEditingTextNodeId] = useState<string | null>(null);

  // 新規テキストノード作成時に親からリクエストされた編集開始を反映する。
  // effect 内での直接 setState を避けるため非同期で実行する（ProjectScreen と同じ方針）
  useEffect(() => {
    if (!autoEditTextNodeId) return;
    queueMicrotask(() => setEditingTextNodeId(autoEditTextNodeId));
    onAutoEditTextNodeHandled?.();
  }, [autoEditTextNodeId, onAutoEditTextNodeHandled]);

  // 付箋は内部 state で編集状態を持つため、flowNodes 構築時に autoStartEditing を渡す。
  // 渡した直後に親へ ack して再 render で false に戻し、二度起動を防ぐ
  useEffect(() => {
    if (!autoEditStickyNoteId) return;
    onAutoEditStickyNoteHandled?.();
  }, [autoEditStickyNoteId, onAutoEditStickyNoteHandled]);

  const handleTextNodeStartEditing = useCallback((nodeId: string) => {
    setEditingTextNodeId(nodeId);
  }, []);

  const handleTextNodeStopEditing = useCallback(
    (nodeId: string, tiptapContent: object) => {
      updateTextNodeContent(nodeId, tiptapContent);
      setEditingTextNodeId(null);
    },
    [updateTextNodeContent],
  );

  // 直前の選択を保持し、テキストノードが選択解除されたタイミングで空なら削除する
  const previousSelectedNodeIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const previous = previousSelectedNodeIdsRef.current;
    previousSelectedNodeIdsRef.current = selectedNodeIds;

    const currentSet = new Set(selectedNodeIds);
    const deselected = previous.filter((id) => !currentSet.has(id));
    if (deselected.length === 0) return;

    const emptyTextNodeIds = deselected.filter((id) => {
      if (id === editingTextNodeId) return false;
      const node = nodes.find((candidate) => candidate.id === id);
      return !!node && isTextNode(node) && isTextNodeEmpty(node);
    });
    if (emptyTextNodeIds.length === 0) return;

    if (emptyTextNodeIds.length === 1) {
      removeNode(emptyTextNodeIds[0]);
    } else {
      removeNodes(emptyTextNodeIds);
    }
  }, [editingTextNodeId, nodes, removeNode, removeNodes, selectedNodeIds]);

  const handleTextNodeAutoHeightChange = useCallback(
    (nodeId: string, height: number) => {
      updateNodeSizeWithoutHistory(
        nodeId,
        useProjectStore.getState().project?.nodes.find((n) => n.id === nodeId)?.width ?? 200,
        height,
      );
    },
    [updateNodeSizeWithoutHistory],
  );

  const handleTextNodeAutoWidthChange = useCallback(
    (nodeId: string, width: number) => {
      const node = useProjectStore.getState().project?.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      updateNodeSizeWithoutHistory(nodeId, Math.max(width, TEXT_NODE_MIN_WIDTH), node.height);
    },
    [updateNodeSizeWithoutHistory],
  );

  const handleTextNodeWidthModeChange = useCallback(
    (nodeId: string, mode: 'auto' | 'fixed') => {
      updateTextNodeWidthMode(nodeId, mode);
    },
    [updateTextNodeWidthMode],
  );

  const handleTextNodeStyleChange = useCallback(
    (nodeId: string, style: TextNodeStyle) => {
      updateTextNodeStyle(nodeId, style);
    },
    [updateTextNodeStyle],
  );

  const handleChangeUrlSubmit = useCallback(
    (nodeId: string, url: string) => {
      changeWebNodeUrl(nodeId, url);
      setEditingUrlNodeId(null);
    },
    [changeWebNodeUrl],
  );

  return {
    editingTextNodeId,
    editingUrlNodeId,
    setEditingUrlNodeId,
    handleTextNodeStartEditing,
    handleTextNodeStopEditing,
    handleTextNodeAutoHeightChange,
    handleTextNodeAutoWidthChange,
    handleTextNodeWidthModeChange,
    handleTextNodeStyleChange,
    handleChangeUrlSubmit,
  };
}
