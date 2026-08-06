import { useCallback, useRef } from 'react';

import { DRAG_REPOSITION_GAP } from '@/constants';
import {
  buildBoardClipboardPayload,
  buildBoardClipboardPlainText,
  materializeBoardClipboardPayload,
  parseBoardClipboardPayload,
  type BoardClipboardPayload,
  type MaterializedClipboardContent,
} from '@/lib/board-clipboard';
import { getViewportWorldRect, resolvePastePlacement } from '@/lib/board-paste-placement';
import { clipboardApi } from '@/lib/tauri-bridge';
import { useProjectStore } from '@/store/tab-store';
import type { ScreenshotCacheEntry, Viewport } from '@/types';

interface UseSheltieClipboardCommandsParams {
  getSelectedNodeIds: () => string[];
  setSelection: (idsOrUpdater: string[] | ((prev: string[]) => string[])) => void;
  clearEdgeSelection: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  getViewport: () => Viewport;
}

function warnDev(message: string, error?: unknown): void {
  if (!import.meta.env.DEV) return;
  console.warn(`[clipboard] ${message}`, error ?? '');
}

/**
 * ノードの Cut / Copy / Paste / Duplicate を担当する。
 * クリップボード I/O はシステム pasteboard 経由なので、別 document window との
 * やり取りでも同じ経路を通る。state は常に store の getState() から読み、
 * クリップボード読み取り待ちの間に古い project を参照しないようにする。
 */
export function useSheltieClipboardCommands({
  getSelectedNodeIds,
  setSelection,
  clearEdgeSelection,
  containerRef,
  getViewport,
}: UseSheltieClipboardCommandsParams) {
  // 同一 payload の連続ペーストをカスケードさせるための直前ペースト記録
  const lastPasteRef = useRef<{ payloadJson: string; pastedNodeIds: string[] } | null>(null);

  const getViewportRect = useCallback(() => {
    const container = containerRef.current;
    return getViewportWorldRect(
      getViewport(),
      container?.clientWidth ?? 0,
      container?.clientHeight ?? 0,
    );
  }, [containerRef, getViewport]);

  const insertMaterialized = useCallback(
    (
      payload: BoardClipboardPayload,
      materialized: MaterializedClipboardContent,
      lastPastedNodeIds: readonly string[],
    ): string[] => {
      const { project, webviewRuntime, insertBoardContent } = useProjectStore.getState();
      if (!project) return [];

      const positions = resolvePastePlacement({
        existingNodes: project.nodes,
        pastedNodes: materialized.nodes,
        sourceNodeIds: payload.nodes.map((node) => node.id),
        lastPastedNodeIds: [...lastPastedNodeIds],
        viewportRect: getViewportRect(),
        gap: DRAG_REPOSITION_GAP,
      });
      const positionByNodeId = new Map(positions.map(({ nodeId, x, y }) => [nodeId, { x, y }]));
      const placedNodes = materialized.nodes.map((node) => {
        const position = positionByNodeId.get(node.id);
        return position ? { ...node, x: position.x, y: position.y } : node;
      });

      // 同一ドキュメント内の複製だけスクリーンショットをシードする。
      // 別 window の screenshot ファイルは prune / 削除で寿命が読めない。
      let screenshotSeedsByNodeId: Record<string, ScreenshotCacheEntry> | undefined;
      if (payload.sourceProjectId === project.id) {
        const seeds: Record<string, ScreenshotCacheEntry> = {};
        for (const [newId, sourceId] of Object.entries(materialized.sourceIdByNewId)) {
          const entry = webviewRuntime.screenshotCacheByNodeId[sourceId];
          if (entry) seeds[newId] = entry;
        }
        if (Object.keys(seeds).length > 0) screenshotSeedsByNodeId = seeds;
      }

      insertBoardContent({
        nodes: placedNodes,
        edges: materialized.edges,
        screenshotSeedsByNodeId,
      });

      const newNodeIds = placedNodes.map((node) => node.id);
      clearEdgeSelection();
      setSelection(newNodeIds);
      return newNodeIds;
    },
    [clearEdgeSelection, getViewportRect, setSelection],
  );

  const handleCopy = useCallback((): boolean => {
    const { project } = useProjectStore.getState();
    if (!project) return false;

    const payload = buildBoardClipboardPayload(project, getSelectedNodeIds());
    if (!payload) return false;

    lastPasteRef.current = null;
    void clipboardApi
      .writeBoardClipboard(JSON.stringify(payload), buildBoardClipboardPlainText(payload))
      .catch((error) => warnDev('failed to write clipboard', error));
    return true;
  }, [getSelectedNodeIds]);

  const handleCut = useCallback((): boolean => {
    const selectedNodeIds = getSelectedNodeIds();
    if (!handleCopy()) return false;

    useProjectStore.getState().removeNodes(selectedNodeIds);
    setSelection([]);
    return true;
  }, [getSelectedNodeIds, handleCopy, setSelection]);

  const handlePaste = useCallback((): boolean => {
    if (!useProjectStore.getState().project) return false;

    void (async () => {
      const json = await clipboardApi.readBoardClipboard().catch((error): null => {
        warnDev('failed to read clipboard', error);
        return null;
      });
      if (!json) return;

      let payload: BoardClipboardPayload;
      try {
        payload = parseBoardClipboardPayload(json);
      } catch (error) {
        warnDev('clipboard payload rejected', error);
        return;
      }

      const materialized = materializeBoardClipboardPayload(payload);
      const lastPastedNodeIds =
        lastPasteRef.current?.payloadJson === json ? lastPasteRef.current.pastedNodeIds : [];
      const pastedNodeIds = insertMaterialized(payload, materialized, lastPastedNodeIds);
      if (pastedNodeIds.length > 0) {
        lastPasteRef.current = { payloadJson: json, pastedNodeIds };
      }
    })();

    return true;
  }, [insertMaterialized]);

  const handleDuplicate = useCallback((): boolean => {
    const { project } = useProjectStore.getState();
    if (!project) return false;

    const payload = buildBoardClipboardPayload(project, getSelectedNodeIds());
    if (!payload) return false;

    const materialized = materializeBoardClipboardPayload(payload);
    return insertMaterialized(payload, materialized, []).length > 0;
  }, [getSelectedNodeIds, insertMaterialized]);

  return { handleCut, handleCopy, handlePaste, handleDuplicate };
}
