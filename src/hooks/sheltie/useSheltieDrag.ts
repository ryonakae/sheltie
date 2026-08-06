import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DRAG_REPOSITION_GAP } from '@/constants';
import { buildAltDragDuplicate } from '@/lib/alt-drag-duplicate';
import { resolveDraggedNodePosition } from '@/lib/sheltie-node-placement';
import type { BoardEdge, BoardNode, ScreenshotCacheEntry, WebPageNode } from '@/types';
import { isWebPageNode } from '@/types';

import type { Node, NodeChange, NodePositionChange } from '@xyflow/react';

export interface PositionCorrectionAnimation {
  token: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

interface UseSheltieDragParams {
  nodes: BoardNode[];
  edges: BoardEdge[];
  webPageNodes: WebPageNode[];
  selectedNodeIds: string[];
  setSelection: (idsOrUpdater: string[] | ((prev: string[]) => string[])) => void;
  clearEdgeSelection: () => void;
  zoomRef: React.RefObject<number>;
  // display engine 連携
  prepareInteractionStart: (type: 'drag', nodeId: string) => void | Promise<unknown>;
  handleInteractionChange: (active: boolean, type: 'drag') => void;
  holdNodeDuringPositionSettle: (nodeId: string) => void;
  releaseNodeAfterPositionSettle: (nodeId: string) => void;
  // store アクション
  updateNodePosition: (nodeId: string, x: number, y: number) => void;
  updateNodePositions: (updates: Array<{ nodeId: string; x: number; y: number }>) => void;
  insertBoardContent: (params: {
    nodes: BoardNode[];
    edges: BoardEdge[];
    screenshotSeedsByNodeId?: Record<string, ScreenshotCacheEntry>;
  }) => void;
  screenshotCacheByNodeId: Record<string, ScreenshotCacheEntry>;
}

/**
 * ノードのドラッグ移動を Sheltie から切り出したフック。
 * - React Flow ネイティブドラッグ（onNodeDragStart/Stop）と、NodeToolbar タイトル段の自前 pointer ドラッグ
 * - ドラッグ中の一時位置（draggingNodePositions）と、重なり補正アニメーション（positionCorrectionAnimations）
 * draggingNodePositions / positionCorrectionAnimations は flowNodes 構築で参照するため呼び出し側へ返す。
 */
export function useSheltieDrag({
  nodes,
  edges,
  webPageNodes,
  selectedNodeIds,
  setSelection,
  clearEdgeSelection,
  zoomRef,
  prepareInteractionStart,
  handleInteractionChange,
  holdNodeDuringPositionSettle,
  releaseNodeAfterPositionSettle,
  updateNodePosition,
  updateNodePositions,
  insertBoardContent,
  screenshotCacheByNodeId,
}: UseSheltieDragParams) {
  // React Flow ネイティブドラッグ中のノード位置（ストアへの反映は dragStop 時のみ）
  const [draggingNodePositions, setDraggingNodePositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [positionCorrectionAnimations, setPositionCorrectionAnimations] = useState<
    Record<string, PositionCorrectionAnimation>
  >({});
  const positionCorrectionAnimationsRef = useRef<Record<string, PositionCorrectionAnimation>>({});
  const positionCorrectionSequenceRef = useRef(0);

  // alt ドラッグ複製: ドラッグ中の対象 id と、ドロップ時判定に使う alt 押下状態。
  // Figma と同様にドラッグ開始後の alt 押下/解放も反映する
  const [altDragState, setAltDragState] = useState<{
    draggedNodeIds: string[];
    altPressed: boolean;
  } | null>(null);
  const altDragStateRef = useRef(altDragState);
  altDragStateRef.current = altDragState;

  const isAltDragging = altDragState !== null;
  useEffect(() => {
    if (!isAltDragging) return;

    const handleAltKeyChange = (event: KeyboardEvent) => {
      if (event.key !== 'Alt') return;
      // macOS では Option 単押しでメニューへフォーカスが移るため抑止する
      event.preventDefault();
      const altPressed = event.type === 'keydown';
      setAltDragState((prev) =>
        prev === null || prev.altPressed === altPressed ? prev : { ...prev, altPressed },
      );
    };

    window.addEventListener('keydown', handleAltKeyChange);
    window.addEventListener('keyup', handleAltKeyChange);
    return () => {
      window.removeEventListener('keydown', handleAltKeyChange);
      window.removeEventListener('keyup', handleAltKeyChange);
    };
  }, [isAltDragging]);

  const altDuplicateSourceNodes = useMemo(() => {
    if (!altDragState?.altPressed) return [];
    const draggedIdSet = new Set(altDragState.draggedNodeIds);
    return nodes.filter((node) => draggedIdSet.has(node.id));
  }, [altDragState, nodes]);

  // ドラッグ対象の決定ルールは React Flow ネイティブ経路とタイトル段経路で共通
  const resolveDraggedNodeIds = useCallback(
    (nodeId: string): string[] =>
      selectedNodeIds.includes(nodeId) && selectedNodeIds.length > 1 ? selectedNodeIds : [nodeId],
    [selectedNodeIds],
  );

  const commitAltDragDuplicate = useCallback(
    (
      draggedNodeIds: readonly string[],
      droppedPositionByNodeId: Record<string, { x: number; y: number }>,
    ) => {
      const result = buildAltDragDuplicate({
        nodes,
        edges,
        draggedNodeIds,
        droppedPositionByNodeId,
      });
      if (result.nodes.length === 0) return;

      const screenshotSeedsByNodeId: Record<string, ScreenshotCacheEntry> = {};
      for (const [newId, sourceId] of Object.entries(result.sourceIdByNewId)) {
        const entry = screenshotCacheByNodeId[sourceId];
        if (entry) screenshotSeedsByNodeId[newId] = entry;
      }

      insertBoardContent({
        nodes: result.nodes,
        edges: result.edges,
        screenshotSeedsByNodeId:
          Object.keys(screenshotSeedsByNodeId).length > 0 ? screenshotSeedsByNodeId : undefined,
      });
      clearEdgeSelection();
      setSelection(result.nodes.map((node) => node.id));
    },
    [nodes, edges, screenshotCacheByNodeId, insertBoardContent, clearEdgeSelection, setSelection],
  );

  const clearPositionCorrectionAnimation = useCallback(
    (nodeId: string) => {
      if (!(nodeId in positionCorrectionAnimationsRef.current)) return;
      const { [nodeId]: _removedAnimation, ...rest } = positionCorrectionAnimationsRef.current;
      positionCorrectionAnimationsRef.current = rest;
      setPositionCorrectionAnimations((prev) => {
        if (!(nodeId in prev)) return prev;
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      releaseNodeAfterPositionSettle(nodeId);
    },
    [releaseNodeAfterPositionSettle],
  );

  const handlePositionCorrectionAnimationComplete = useCallback(
    (nodeId: string, token: number) => {
      if (positionCorrectionAnimationsRef.current[nodeId]?.token !== token) return;
      clearPositionCorrectionAnimation(nodeId);
    },
    [clearPositionCorrectionAnimation],
  );

  // React Flow ネイティブドラッグ開始: スクリーンショット準備 + インタラクション開始
  const handleNodeDragStart = useCallback(
    async (event: React.MouseEvent, node: Node) => {
      clearPositionCorrectionAnimation(node.id);
      setAltDragState({
        draggedNodeIds: resolveDraggedNodeIds(node.id),
        altPressed: event.altKey,
      });
      await prepareInteractionStart('drag', node.id);
      handleInteractionChange(true, 'drag');
    },
    [
      clearPositionCorrectionAnimation,
      resolveDraggedNodeIds,
      prepareInteractionStart,
      handleInteractionChange,
    ],
  );

  // React Flow ネイティブドラッグ終了: 位置補正後にストアへ反映
  // 第3引数 draggedNodes は、複数選択時に同時に動かしたノード全てを含む
  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node, draggedNodes: Node[]) => {
      handleInteractionChange(false, 'drag');

      // ドラッグ中の一時位置をクリア（複数選択時は全ノード分）
      setDraggingNodePositions((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const dragged of draggedNodes) {
          if (dragged.id in next) {
            delete next[dragged.id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      // alt が押されたままドロップされたら、動かしていた側を新ノードとして作る。
      // 元ノードの store 位置は書かないので元位置に留まり、既存エッジもそのまま残る
      const altState = altDragStateRef.current;
      setAltDragState(null);
      if (altState?.altPressed) {
        commitAltDragDuplicate(
          altState.draggedNodeIds,
          Object.fromEntries(draggedNodes.map((dragged) => [dragged.id, dragged.position])),
        );
        return;
      }

      // 複数ノードを同時に動かしている場合、位置補正アニメーションは複雑になるため省略し、
      // 1 つの履歴エントリに集約してコミットする
      if (draggedNodes.length > 1) {
        updateNodePositions(
          draggedNodes.map((dragged) => ({
            nodeId: dragged.id,
            x: dragged.position.x,
            y: dragged.position.y,
          })),
        );
        return;
      }

      const movingNode = nodes.find((candidate) => candidate.id === node.id);
      if (!movingNode) return;

      const resolvedPosition = resolveDraggedNodePosition({
        nodes,
        movingNode,
        proposedX: node.position.x,
        proposedY: node.position.y,
        gap: DRAG_REPOSITION_GAP,
      });
      if (resolvedPosition.corrected && isWebPageNode(movingNode)) {
        positionCorrectionSequenceRef.current += 1;
        const nextAnimation = {
          token: positionCorrectionSequenceRef.current,
          fromX: node.position.x,
          fromY: node.position.y,
          toX: resolvedPosition.x,
          toY: resolvedPosition.y,
        };
        positionCorrectionAnimationsRef.current = {
          ...positionCorrectionAnimationsRef.current,
          [node.id]: nextAnimation,
        };
        setPositionCorrectionAnimations((prev) => ({ ...prev, [node.id]: nextAnimation }));
        holdNodeDuringPositionSettle(node.id);
        if (movingNode.x !== resolvedPosition.x || movingNode.y !== resolvedPosition.y) {
          updateNodePosition(node.id, resolvedPosition.x, resolvedPosition.y);
        }
        return;
      }

      updateNodePosition(node.id, resolvedPosition.x, resolvedPosition.y);
    },
    [
      commitAltDragDuplicate,
      handleInteractionChange,
      holdNodeDuringPositionSettle,
      nodes,
      updateNodePosition,
      updateNodePositions,
    ],
  );

  // ノード mousedown 時の選択更新（Shift 押下で追加、それ以外は単独選択へ切替）
  // 既に複数選択メンバーをクリックした場合は選択を維持し、その後の drag で全選択を一括移動できるようにする
  const handleNodeActivate = useCallback(
    (nodeId: string, addToSelection: boolean) => {
      if (!addToSelection) clearEdgeSelection();
      setSelection((prev) => {
        if (addToSelection) {
          return prev.includes(nodeId) ? prev : [...prev, nodeId];
        }
        if (prev.length > 1 && prev.includes(nodeId)) return prev;
        return [nodeId];
      });
    },
    [clearEdgeSelection, setSelection],
  );

  // ドラッグ中にアンマウントされると pointerup が来ないため、window リスナーが残って
  // 古い nodes / selectedNodeIds を参照し続ける。解除関数を保持して確実に外す
  const releaseTitleDragListenersRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      releaseTitleDragListenersRef.current?.();
      releaseTitleDragListenersRef.current = null;
    },
    [],
  );

  // タイトル段ドラッグ。React Flow の NodeToolbar はノード DOM サブツリー外に portal 配置されるため
  // dragHandle が効かない。ここで pointer 系イベントを直接取り、draggingNodePositions を更新する
  const handleTitlePointerDown = useCallback(
    (nodeId: string, event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.stopPropagation();

      handleNodeActivate(nodeId, event.shiftKey);

      const startClientX = event.clientX;
      const startClientY = event.clientY;
      const startZoom = zoomRef.current;

      const movingIds = resolveDraggedNodeIds(nodeId);
      const startPositions = new Map<string, { x: number; y: number }>();
      for (const id of movingIds) {
        const target = nodes.find((candidate) => candidate.id === id);
        if (target) startPositions.set(id, { x: target.x, y: target.y });
      }
      if (startPositions.size === 0) return;

      let dragStarted = false;
      const DRAG_THRESHOLD_PX = 3;

      const handleMove = (ev: PointerEvent) => {
        const screenDx = ev.clientX - startClientX;
        const screenDy = ev.clientY - startClientY;
        if (!dragStarted) {
          if (Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD_PX) return;
          dragStarted = true;
          // 以降の alt 押下/解放は共通の window リスナーが追跡する
          setAltDragState({ draggedNodeIds: movingIds, altPressed: ev.altKey });
          void prepareInteractionStart('drag', nodeId);
          handleInteractionChange(true, 'drag');
        }
        const dx = screenDx / startZoom;
        const dy = screenDy / startZoom;
        setDraggingNodePositions((prev) => {
          const next = { ...prev };
          for (const [id, start] of startPositions) {
            next[id] = { x: start.x + dx, y: start.y + dy };
          }
          return next;
        });
      };

      const release = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        releaseTitleDragListenersRef.current = null;
      };

      const handleUp = (ev: PointerEvent) => {
        release();

        if (!dragStarted) return;

        handleInteractionChange(false, 'drag');

        const dx = (ev.clientX - startClientX) / startZoom;
        const dy = (ev.clientY - startClientY) / startZoom;

        setDraggingNodePositions((prev) => {
          const next = { ...prev };
          for (const id of startPositions.keys()) delete next[id];
          return next;
        });

        const altState = altDragStateRef.current;
        setAltDragState(null);
        if (altState?.altPressed) {
          commitAltDragDuplicate(
            altState.draggedNodeIds,
            Object.fromEntries(
              Array.from(startPositions.entries()).map(([id, start]) => [
                id,
                { x: start.x + dx, y: start.y + dy },
              ]),
            ),
          );
          return;
        }

        if (startPositions.size > 1) {
          updateNodePositions(
            Array.from(startPositions.entries()).map(([id, start]) => ({
              nodeId: id,
              x: start.x + dx,
              y: start.y + dy,
            })),
          );
        } else {
          const start = startPositions.get(nodeId);
          if (start) {
            updateNodePosition(nodeId, start.x + dx, start.y + dy);
          }
        }
      };

      releaseTitleDragListenersRef.current?.();
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      releaseTitleDragListenersRef.current = release;
    },
    [
      nodes,
      resolveDraggedNodeIds,
      commitAltDragDuplicate,
      handleNodeActivate,
      prepareInteractionStart,
      handleInteractionChange,
      updateNodePosition,
      updateNodePositions,
      zoomRef,
    ],
  );

  // onNodesChange の position 変更（ドラッグ中）を一時ステートへ反映する。
  // ストアは dragStop 時のみ更新する。
  const trackDraggingPositions = useCallback((changes: NodeChange[]) => {
    const positionChanges = changes.filter(
      (c): c is NodePositionChange => c.type === 'position' && c.dragging === true,
    );
    if (positionChanges.length === 0) return;
    setDraggingNodePositions((prev) => {
      const next = { ...prev };
      for (const change of positionChanges) {
        if (change.position) next[change.id] = change.position;
      }
      return next;
    });
  }, []);

  // 削除済みノードに紐づく補正アニメーションを掃除する
  useEffect(() => {
    const liveNodeIds = new Set(webPageNodes.map((node) => node.id));
    const staleAnimationNodeIds = Object.keys(positionCorrectionAnimationsRef.current).filter(
      (nodeId) => !liveNodeIds.has(nodeId),
    );
    if (staleAnimationNodeIds.length === 0) return;

    let nextAnimations = positionCorrectionAnimationsRef.current;
    for (const nodeId of staleAnimationNodeIds) {
      const { [nodeId]: _removedAnimation, ...rest } = nextAnimations;
      nextAnimations = rest;
      releaseNodeAfterPositionSettle(nodeId);
    }

    positionCorrectionAnimationsRef.current = nextAnimations;
    setPositionCorrectionAnimations((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const nodeId of staleAnimationNodeIds) {
        if (!(nodeId in next)) continue;
        delete next[nodeId];
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [releaseNodeAfterPositionSettle, webPageNodes]);

  return {
    draggingNodePositions,
    altDuplicateSourceNodes,
    positionCorrectionAnimations,
    clearPositionCorrectionAnimation,
    handlePositionCorrectionAnimationComplete,
    handleNodeDragStart,
    handleNodeDragStop,
    handleNodeActivate,
    handleTitlePointerDown,
    trackDraggingPositions,
  };
}
