import { useCallback, useState } from 'react';

import { PAGE_MIN_HEIGHT, PAGE_MIN_WIDTH } from '@/constants';
import { getNodeChromeHeight, getNodeChromeWidth } from '@/lib/sheltie-node-frame';
import { useProjectStore } from '@/store/tab-store';

interface ResizingState {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ResizeParams {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface UseSheltieResizeParams {
  prepareInteractionStart: (type: 'resize', nodeId: string) => void | Promise<unknown>;
  handleInteractionChange: (active: boolean, type: 'resize') => void;
  handlePageResizeStart: (nodeId: string) => void;
  handlePageResizeEnd: (nodeId: string) => void;
  updateNodeSize: (nodeId: string, width: number, height: number) => void;
  updateTextNodeWidthMode: (nodeId: string, widthMode: 'auto' | 'fixed') => void;
}

/**
 * WebPage / 付箋 / テキストノードの React Flow リサイズ中間状態とコールバックを
 * Sheltie から切り出したフック。controlled mode のリアルタイム追従用に各 resizing state を返す。
 */
export function useSheltieResize({
  prepareInteractionStart,
  handleInteractionChange,
  handlePageResizeStart,
  handlePageResizeEnd,
  updateNodeSize,
  updateTextNodeWidthMode,
}: UseSheltieResizeParams) {
  // 付箋リサイズ中の中間サイズ（height は本文高さ。sticky header 除く）
  const [stickyResizing, setStickyResizing] = useState<ResizingState | null>(null);
  // WebPage リサイズ中の中間サイズ（height はコンテンツ高さ。chrome 除く）
  const [webPageResizing, setWebPageResizing] = useState<ResizingState | null>(null);
  // テキストノードのリサイズ中間状態
  const [textResizing, setTextResizing] = useState<ResizingState | null>(null);

  // WebPage の React Flow resize control コールバック群
  const handleWebPageResizeStart = useCallback(
    (nodeId: string) => {
      // ドラッグと同じ fire-and-forget パターン
      void prepareInteractionStart('resize', nodeId);
      handleInteractionChange(true, 'resize');
      handlePageResizeStart(nodeId);
    },
    [handleInteractionChange, handlePageResizeStart, prepareInteractionStart],
  );

  const handleWebPageResize = useCallback((nodeId: string, params: ResizeParams) => {
    // React Flow の resize params.width / params.height は chrome 込みのフレーム外周サイズ
    const chromeWidth = getNodeChromeWidth({ type: 'webpage' });
    const chromeHeight = getNodeChromeHeight({ type: 'webpage' });
    const contentWidth = Math.max(PAGE_MIN_WIDTH, params.width - chromeWidth);
    const contentHeight = Math.max(PAGE_MIN_HEIGHT, params.height - chromeHeight);
    setWebPageResizing({
      nodeId,
      x: params.x,
      y: params.y,
      width: Math.round(contentWidth),
      height: Math.round(contentHeight),
    });
  }, []);

  const handleWebPageResizeEnd = useCallback(
    (nodeId: string, params: ResizeParams) => {
      const chromeWidth = getNodeChromeWidth({ type: 'webpage' });
      const chromeHeight = getNodeChromeHeight({ type: 'webpage' });
      const contentWidth = Math.max(PAGE_MIN_WIDTH, params.width - chromeWidth);
      const contentHeight = Math.max(PAGE_MIN_HEIGHT, params.height - chromeHeight);
      const nextX = Math.round(params.x);
      const nextY = Math.round(params.y);
      const nextWidth = Math.round(contentWidth);
      const nextHeight = Math.round(contentHeight);
      useProjectStore.getState().updateNodeBounds(nodeId, nextX, nextY, nextWidth, nextHeight);
      setWebPageResizing(null);
      handleInteractionChange(false, 'resize');
      handlePageResizeEnd(nodeId);
    },
    [handleInteractionChange, handlePageResizeEnd],
  );

  const handleStickyNoteResize = useCallback((nodeId: string, params: ResizeParams) => {
    setStickyResizing({ nodeId, ...params });
  }, []);

  const handleStickyNoteResizeEnd = useCallback(
    (nodeId: string, width: number, height: number) => {
      updateNodeSize(nodeId, width, height);
      setStickyResizing(null);
    },
    [updateNodeSize],
  );

  const handleTextNodeResize = useCallback(
    (nodeId: string, params: ResizeParams) => {
      setTextResizing({ nodeId, ...params });
      // ドラッグでリサイズした時点で fixed モードに切り替え
      updateTextNodeWidthMode(nodeId, 'fixed');
    },
    [updateTextNodeWidthMode],
  );

  const handleTextNodeResizeEnd = useCallback(
    (nodeId: string, width: number, height: number) => {
      updateNodeSize(nodeId, width, height);
      setTextResizing(null);
    },
    [updateNodeSize],
  );

  return {
    stickyResizing,
    webPageResizing,
    textResizing,
    handleWebPageResizeStart,
    handleWebPageResize,
    handleWebPageResizeEnd,
    handleStickyNoteResize,
    handleStickyNoteResizeEnd,
    handleTextNodeResize,
    handleTextNodeResizeEnd,
  };
}
