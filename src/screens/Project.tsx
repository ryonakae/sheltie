import { animate, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Siteboard } from '@/components/Siteboard/Siteboard';
import {
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  DEFAULT_STICKY_NOTE_HEIGHT,
  DEFAULT_STICKY_NOTE_WIDTH,
  DEFAULT_TEXT_NODE_HEIGHT,
  DEFAULT_TEXT_NODE_WIDTH,
  CANVAS_CENTER_ANIMATION_DURATION_SEC,
  CANVAS_CENTER_ANIMATION_EASE,
  MIN_ZOOM,
} from '@/constants';
import {
  getNodeFrameHeight,
  getNodeFrameRect,
  getNodeFrameWidth,
} from '@/lib/siteboard-node-frame';
import { selectProject, useProjectStore } from '@/store/tab-store';
import { type BoardNode } from '@/types';

/** 現在のビューポート中央のワールド座標を起点とした、指定サイズの要素の配置位置を算出する */
function getViewportCenterPos(
  viewportZoom: number,
  viewportPanX: number,
  viewportPanY: number,
  targetWidth: number,
  targetHeight: number,
): { x: number; y: number } | null {
  const siteboard = document.querySelector<HTMLElement>('[data-siteboard-container]');
  if (!siteboard) return null;

  const rect = siteboard.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || viewportZoom <= 0) return null;

  // ビューポート中央のワールド座標（要素左上を起点とするため半サイズ分ずらす）
  const centerWorldX = (rect.width / 2 - viewportPanX) / viewportZoom;
  const centerWorldY = (rect.height / 2 - viewportPanY) / viewportZoom;
  return {
    x: centerWorldX - targetWidth / 2,
    y: centerWorldY - targetHeight / 2,
  };
}

export function ProjectScreen() {
  const project = useProjectStore(selectProject);
  const addWebNode = useProjectStore((s) => s.addWebNode);
  const addStickyNoteNode = useProjectStore((s) => s.addStickyNoteNode);
  const addTextNode = useProjectStore((s) => s.addTextNode);
  const updateViewport = useProjectStore((s) => s.updateViewport);
  const viewport = project?.viewport;
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [centeredNodeId, setCenteredNodeId] = useState<string | null>(null);
  const [autoEditTextNodeId, setAutoEditTextNodeId] = useState<string | null>(null);
  const [autoEditStickyNoteId, setAutoEditStickyNoteId] = useState<string | null>(null);
  const centeringAnimationRef = useRef<Array<{ stop: () => void }>>([]);
  const prefersReducedMotion = useReducedMotion();

  const setSelection = useCallback((idsOrUpdater: string[] | ((prev: string[]) => string[])) => {
    setSelectedNodeIds(idsOrUpdater);
  }, []);

  const handleCenteredNode = useCallback((nodeId: string) => {
    setCenteredNodeId(nodeId);
  }, []);

  const handleCenteredNodeHandled = useCallback(() => {
    setCenteredNodeId(null);
  }, []);

  const handleAutoEditTextNodeHandled = useCallback(() => {
    setAutoEditTextNodeId(null);
  }, []);

  const handleAutoEditStickyNoteHandled = useCallback(() => {
    setAutoEditStickyNoteId(null);
  }, []);

  const cancelCentering = useCallback(() => {
    centeringAnimationRef.current.forEach((animation) => animation.stop());
    centeringAnimationRef.current = [];
  }, []);

  useEffect(() => cancelCentering, [cancelCentering]);

  /**
   * ページ追加後にビューポートをアニメーションしてページを中央・フィット表示する。
   * ズームとパンを同時にアニメーションし、常にアニメーションが発火する（isFullyVisible チェックなし）。
   */
  const centerOnNewNode = useCallback(
    (
      node: Pick<BoardNode, 'id' | 'type' | 'x' | 'y' | 'width' | 'height'>,
      onComplete?: () => void,
    ) => {
      const siteboard = document.querySelector<HTMLElement>('[data-siteboard-container]');
      if (!siteboard || !viewport) return;
      const rect = siteboard.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const frameRect = getNodeFrameRect(node);
      // フレーム全体（=ノード矩形）がビューポートに 80% フィットするズームを計算（最大 1 倍）
      const targetZoom = Math.max(
        MIN_ZOOM,
        Math.min((rect.width * 0.8) / frameRect.width, (rect.height * 0.8) / frameRect.height, 1),
      );
      // フレーム中心がビューポート中心に来るパンを計算
      const targetPanX = rect.width / 2 - (frameRect.x + frameRect.width / 2) * targetZoom;
      const targetPanY = rect.height / 2 - (frameRect.y + frameRect.height / 2) * targetZoom;

      cancelCentering();
      if (prefersReducedMotion) {
        updateViewport({ zoom: targetZoom, panX: targetPanX, panY: targetPanY });
        onComplete?.();
        return;
      }

      let completed = false;
      const latestState = { x: viewport.panX, y: viewport.panY, zoom: viewport.zoom };
      const updateAll = () => {
        updateViewport({
          zoom: latestState.zoom,
          panX: latestState.x,
          panY: latestState.y,
        });
      };
      const handleComplete = () => {
        if (completed) return;
        completed = true;
        centeringAnimationRef.current = [];
        updateViewport({ zoom: targetZoom, panX: targetPanX, panY: targetPanY });
        onComplete?.();
      };

      const xControls = animate(viewport.panX, targetPanX, {
        duration: CANVAS_CENTER_ANIMATION_DURATION_SEC,
        ease: CANVAS_CENTER_ANIMATION_EASE,
        onUpdate: (v: number) => {
          latestState.x = v;
          updateAll();
        },
        onComplete: handleComplete,
      });
      const yControls = animate(viewport.panY, targetPanY, {
        duration: CANVAS_CENTER_ANIMATION_DURATION_SEC,
        ease: CANVAS_CENTER_ANIMATION_EASE,
        onUpdate: (v: number) => {
          latestState.y = v;
          updateAll();
        },
        onComplete: handleComplete,
      });
      const zoomControls = animate(viewport.zoom, targetZoom, {
        duration: CANVAS_CENTER_ANIMATION_DURATION_SEC,
        ease: CANVAS_CENTER_ANIMATION_EASE,
        onUpdate: (v: number) => {
          latestState.zoom = v;
          updateAll();
        },
        onComplete: handleComplete,
      });

      centeringAnimationRef.current = [xControls, yControls, zoomControls];
    },
    [updateViewport, viewport, cancelCentering, prefersReducedMotion],
  );

  /** FloatingToolbar の＋ボタンから呼ばれる: 空フレームをキャンバス中央に追加してセンタリング */
  const handleAddWebNode = useCallback(() => {
    const centerPos = getViewportCenterPos(
      viewport?.zoom ?? 1,
      viewport?.panX ?? 0,
      viewport?.panY ?? 0,
      getNodeFrameWidth({ type: 'webpage', width: DEFAULT_PAGE_WIDTH }),
      getNodeFrameHeight({ type: 'webpage', height: DEFAULT_PAGE_HEIGHT }),
    );
    const created = addWebNode(
      undefined,
      centerPos
        ? { x: centerPos.x, y: centerPos.y, width: DEFAULT_PAGE_WIDTH, height: DEFAULT_PAGE_HEIGHT }
        : undefined,
    );
    if (created) {
      setSelection([created.id]);
      centerOnNewNode(created, () => handleCenteredNode(created.id));
    }
  }, [addWebNode, viewport, centerOnNewNode, setSelection, handleCenteredNode]);

  /** FloatingToolbar の付箋ボタンから呼ばれる: 付箋をキャンバス中央に追加してセンタリング */
  const handleAddStickyNote = useCallback(() => {
    const centerPos = getViewportCenterPos(
      viewport?.zoom ?? 1,
      viewport?.panX ?? 0,
      viewport?.panY ?? 0,
      getNodeFrameWidth({ type: 'stickynote', width: DEFAULT_STICKY_NOTE_WIDTH }),
      getNodeFrameHeight({ type: 'stickynote', height: DEFAULT_STICKY_NOTE_HEIGHT }),
    );
    const created = addStickyNoteNode(
      centerPos
        ? {
            x: centerPos.x,
            y: centerPos.y,
            width: DEFAULT_STICKY_NOTE_WIDTH,
            height: DEFAULT_STICKY_NOTE_HEIGHT,
          }
        : undefined,
    );
    if (created) {
      setSelection([created.id]);
      setAutoEditStickyNoteId(created.id);
      centerOnNewNode(created, () => handleCenteredNode(created.id));
    }
  }, [addStickyNoteNode, viewport, centerOnNewNode, setSelection, handleCenteredNode]);

  /** FloatingToolbar のテキストボタンから呼ばれる: テキストノードをキャンバス中央に追加してセンタリング */
  const handleAddTextNode = useCallback(() => {
    const centerPos = getViewportCenterPos(
      viewport?.zoom ?? 1,
      viewport?.panX ?? 0,
      viewport?.panY ?? 0,
      getNodeFrameWidth({ type: 'text', width: DEFAULT_TEXT_NODE_WIDTH }),
      getNodeFrameHeight({ type: 'text', height: DEFAULT_TEXT_NODE_HEIGHT }),
    );
    const created = addTextNode(
      centerPos
        ? {
            x: centerPos.x,
            y: centerPos.y,
            width: DEFAULT_TEXT_NODE_WIDTH,
            height: DEFAULT_TEXT_NODE_HEIGHT,
          }
        : undefined,
    );
    if (created) {
      setSelection([created.id]);
      setAutoEditTextNodeId(created.id);
      centerOnNewNode(created, () => handleCenteredNode(created.id));
    }
  }, [addTextNode, viewport, centerOnNewNode, setSelection, handleCenteredNode]);

  useEffect(() => {
    if (selectedNodeIds.length === 0) return;
    const liveIds = new Set(project?.nodes.map((node) => node.id) ?? []);
    const filtered = selectedNodeIds.filter((id) => liveIds.has(id));
    if (filtered.length !== selectedNodeIds.length) {
      // effect 内での直接 setState を避けるため非同期で実行
      queueMicrotask(() => setSelectedNodeIds(filtered));
    }
  }, [selectedNodeIds, project?.nodes]);

  return (
    <div className="relative flex flex-1 overflow-hidden">
      <Siteboard
        selectedNodeIds={selectedNodeIds}
        setSelection={setSelection}
        centeredNodeId={centeredNodeId}
        onCenteredNodeHandled={handleCenteredNodeHandled}
        autoEditTextNodeId={autoEditTextNodeId}
        onAutoEditTextNodeHandled={handleAutoEditTextNodeHandled}
        autoEditStickyNoteId={autoEditStickyNoteId}
        onAutoEditStickyNoteHandled={handleAutoEditStickyNoteHandled}
        onAddWebNode={handleAddWebNode}
        onAddStickyNote={handleAddStickyNote}
        onAddTextNode={handleAddTextNode}
      />
    </div>
  );
}
