import { useCallback, useEffect, useRef, useState } from 'react';

import { usePageResize } from '@/hooks/usePageResize';

import { RESIZE_CURSOR_MAP, type InteractionType, type NodeResizeDirection } from './types';

interface UseSiteboardViewportEngineParams {
  zoomRef: React.RefObject<number>;
  activeId: string;
  onInteractionChange: (active: boolean, cursor: string, type: InteractionType) => void;
  prepareInteractionStart: (type: InteractionType, nodeId?: string) => Promise<boolean>;
  onNodeResizeStart?: (nodeId: string) => void;
  onNodeResizeEnd?: (nodeId: string) => void;
  updateNodeSize: (projectId: string, nodeId: string, width: number, height: number) => void;
}

export function useSiteboardViewportEngine({
  zoomRef,
  activeId,
  onInteractionChange,
  prepareInteractionStart,
  onNodeResizeStart,
  onNodeResizeEnd,
  updateNodeSize,
}: UseSiteboardViewportEngineParams) {
  const [resizingSize, setResizingSize] = useState<{
    nodeId: string;
    width: number;
    height: number;
  } | null>(null);

  const resizingNodeIdRef = useRef<string | null>(null);

  const { startResize } = usePageResize({
    zoom: zoomRef,
    beforeResizeStart: useCallback(
      (nodeId: string) => prepareInteractionStart('resize', nodeId),
      [prepareInteractionStart],
    ),
    onResizeStart: useCallback(
      (nodeId: string) => {
        resizingNodeIdRef.current = nodeId;
        onNodeResizeStart?.(nodeId);
      },
      [onNodeResizeStart],
    ),
    onResizeMove: useCallback((nodeId: string, width: number, height: number) => {
      setResizingSize({ nodeId, width, height });
    }, []),
    onResizeEnd: useCallback(
      (nodeId, width, height) => {
        resizingNodeIdRef.current = null;
        updateNodeSize(activeId, nodeId, width, height);
        setResizingSize(null);
        onNodeResizeEnd?.(nodeId);
      },
      [activeId, onNodeResizeEnd, updateNodeSize],
    ),
    onInteractionChange: useCallback(
      (active: boolean, direction?: NodeResizeDirection) => {
        const cursor = active && direction ? RESIZE_CURSOR_MAP[direction] : 'default';
        onInteractionChange(active, cursor, 'resize');
      },
      [onInteractionChange],
    ),
  });

  // resizingSize が残ったままノードが削除された場合のクリーンアップ
  useEffect(() => {
    if (!resizingSize) return;
    return () => {
      setResizingSize(null);
    };
  }, [resizingSize]);

  return {
    resizingSize,
    startResize,
  };
}
