# Phase 2 — Copy / Cut / Paste / Duplicate Commands Implementation Plan

> **For implementers:** Execute this plan task-by-task. Complete each checkbox step, run the listed validation, and commit after each task. Phase 1 must be completed first.

**Goal:** Wire Cmd+C / Cmd+X / Cmd+V / Cmd+D (menu, keyboard, node context menu) end-to-end: FigJam-style paste placement, a single-history-entry store insert with screenshot seeding, and selection of the pasted nodes.

**Architecture:** A pure placement module (`board-paste-placement.ts`) decides where the pasted group lands; one new store action `insertBoardContent` mutates state; a `useSheltieClipboardCommands` hook orchestrates clipboard I/O → parse → materialize → place → insert → select, and is registered through the existing `edit-command` pattern (custom menu items + JS keydown complement + `hasEditableFocus` native fallback).

**Tech Stack:** TypeScript, Zustand, Vitest, Tauri v2 menus (Rust).

## Global Constraints

- Offset / gap unit: `DRAG_REPOSITION_GAP` (= 20, world px) from `@/constants`.
- Paste anchor priority: (1) last-pasted nodes of the same payload alive & bounding-box intersecting the viewport → their bbox top-left + (20, 20); (2) living source nodes intersecting the viewport → their current bbox top-left + (20, 20); (3) the payload's original bbox intersecting the viewport → original coordinates as-is; (4) otherwise center the group bbox on the viewport center.
- Rigid-group non-overlap: slide the whole group by (+20, +20) steps until no pasted webpage conflicts with any existing node and no pasted sticky/text conflicts with an existing webpage (`conflictsWithGap`, gap 20). Group-internal overlaps are never checked.
- One paste/duplicate = exactly one history entry (undo removes all inserted nodes, edges, in one step).
- Screenshot seeding only when `payload.sourceProjectId === project.id`.
- A parse failure or empty clipboard must be silent (dev-only `console.warn`), never a crash or dialog.
- Bounding boxes use node frame rects (`getNodeFrameRect`), not content rects.

## Current Context

- `src/lib/sheltie-node-placement.ts:36` — `conflictsWithGap(leftA, topA, widthA, heightA, leftB, topB, widthB, heightB, gap)` is module-private; export it.
- `src/store/tab-store.ts` — `export const useProjectStore = create<ProjectStore>()(...)` (line 257); helpers `pushHistory`, `omitKeys`; existing tests in `src/store/tab-store.test.ts`.
- `src/components/Sheltie/Sheltie.tsx` — owns `containerRef` (line 211), `getViewport` (from `useSheltieViewportController`, returns `{ zoom, panX, panY }`), props `getSelectedNodeIds` / `setSelection`, local `clearEdgeSelection`, and wires `useSheltieKeyboard` (line 582) and `useSheltieContextMenus`.
- `src/lib/edit-commands.ts` — `EditCommand = 'undo' | 'redo' | 'delete'`; `runEditCommand` returns `false` when `hasEditableFocus()`.
- `src/hooks/sheltie/useSheltieKeyboard.ts` — registers handlers + JS keydown complement (`preventDefault` only when handled).
- `src-tauri/src/menus/edit.rs` — custom Undo/Redo/Delete + predefined Cut/Copy/Paste/SelectAll; `src-tauri/src/menus/mod.rs` MENU_ID constants; `src-tauri/src/setup.rs:245-247` menu-event match arms.
- `src/hooks/sheltie/useSheltieContextMenus.ts:68` — node context menu (Change URL / z-order / Delete Node).
- Phase 1 provides `clipboardApi`, `BoardClipboardPayload`, `buildBoardClipboardPayload`, `buildBoardClipboardPlainText`, `parseBoardClipboardPayload`, `materializeBoardClipboardPayload`, `MaterializedClipboardContent`.

## File Structure

- Create: `src/lib/board-paste-placement.ts` — viewport rect math, group bbox, anchor priority, rigid slide.
- Test: `src/lib/board-paste-placement.test.ts`
- Modify: `src/lib/sheltie-node-placement.ts` — export `conflictsWithGap`.
- Modify: `src/store/tab-store.ts` — add `insertBoardContent` action.
- Test: `src/store/tab-store.test.ts` — new cases.
- Modify: `src/lib/edit-commands.ts` — extend `EditCommand` and handlers.
- Create: `src/hooks/sheltie/useSheltieClipboardCommands.ts` — command orchestration hook.
- Modify: `src/hooks/sheltie/useSheltieKeyboard.ts` — register new handlers + keydown complement.
- Modify: `src/components/Sheltie/Sheltie.tsx` — wire the hook.
- Modify: `src/hooks/sheltie/useSheltieContextMenus.ts` — Cut / Copy items.
- Modify: `src-tauri/src/menus/mod.rs`, `src-tauri/src/menus/edit.rs`, `src-tauri/src/menus/helpers.rs`, `src-tauri/src/setup.rs` — menu items and routing.
- Modify: `docs/agents/architecture.md`, `docs/agents/domain-models.md`, `docs/agents/tauri-ipc.md` — documentation.

## Tasks

### Task 1: Paste placement module (TDD)

**Objective:** Pure placement functions implementing the anchor priority and rigid-group slide.

**Files:**
- Modify: `src/lib/sheltie-node-placement.ts:36` (`function conflictsWithGap` → `export function conflictsWithGap`)
- Create: `src/lib/board-paste-placement.ts`
- Test: `src/lib/board-paste-placement.test.ts`

**Interfaces:**
- Produces:

```ts
export interface WorldRect { x: number; y: number; width: number; height: number }

export function getViewportWorldRect(
  viewport: Viewport,
  containerWidth: number,
  containerHeight: number,
): WorldRect;

export function getNodesFrameBounds(
  nodes: ReadonlyArray<Pick<BoardNode, 'type' | 'x' | 'y' | 'width' | 'height'>>,
): WorldRect | null;

export interface ResolvePastePlacementParams {
  existingNodes: BoardNode[];
  pastedNodes: BoardNode[]; // fresh ids, original coordinates
  sourceNodeIds: readonly string[];
  lastPastedNodeIds: readonly string[];
  viewportRect: WorldRect;
  gap: number;
}

export function resolvePastePlacement(
  params: ResolvePastePlacementParams,
): Array<{ nodeId: string; x: number; y: number }>;
```

- [ ] **Step 1: Write the failing tests**

`src/lib/board-paste-placement.test.ts`. Fixtures: webpage nodes get frame padding 16 on each side (`getNodeFrameRect`), sticky/text none — account for it in expectations. Cases:

- `getViewportWorldRect({ zoom: 2, panX: -100, panY: 50 }, 800, 600)` → `{ x: 50, y: -25, width: 400, height: 300 }`.
- `getNodesFrameBounds`: `[]` → `null`; a webpage at (0, 0, 393, 852) → `{ x: 0, y: 0, width: 425, height: 884 }`; mixed nodes → min/max envelope.
- Anchor priority (single sticky node, empty board unless noted, `gap: 20`):
  - last-pasted node exists in `existingNodes` and intersects the viewport → result = lastPasted bbox top-left + (20, 20).
  - no last-pasted, source node alive at a *moved* position intersecting the viewport → result = source's current bbox top-left + (20, 20) (proves current position is used, not payload coordinates).
  - source alive but fully outside the viewport, original coordinates inside → original coordinates unchanged.
  - nothing alive, original coordinates outside the viewport → group bbox centered on viewport center (assert exact x/y math).
  - both last-pasted and source alive & visible → last-pasted wins.
- Rigid slide:
  - pasting one webpage whose anchor position conflicts (< 20px gap) with an existing webpage → result slides by (+20, +20) steps until `conflictsWithGap` is false; assert the returned position no longer conflicts and lies on the diagonal from the anchor.
  - pasting a sticky onto an existing sticky → no slide (overlap allowed).
  - pasting a sticky onto an existing webpage → slides.
  - two pasted nodes keep their relative offset after sliding (delta between them unchanged).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- board-paste-placement`
Expected: module-not-found failure.

- [ ] **Step 3: Implement**

`src/lib/board-paste-placement.ts`:

```ts
import { getNodeFrameRect } from '@/lib/sheltie-node-frame';
import { conflictsWithGap } from '@/lib/sheltie-node-placement';
import type { BoardNode, Viewport } from '@/types';
import { isWebPageNode } from '@/types';

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getViewportWorldRect(
  viewport: Viewport,
  containerWidth: number,
  containerHeight: number,
): WorldRect {
  return {
    x: -viewport.panX / viewport.zoom,
    y: -viewport.panY / viewport.zoom,
    width: containerWidth / viewport.zoom,
    height: containerHeight / viewport.zoom,
  };
}

function rectsIntersect(a: WorldRect, b: WorldRect): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

export function getNodesFrameBounds(
  nodes: ReadonlyArray<Pick<BoardNode, 'type' | 'x' | 'y' | 'width' | 'height'>>,
): WorldRect | null {
  if (nodes.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    const rect = getNodeFrameRect(node);
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export interface ResolvePastePlacementParams {
  existingNodes: BoardNode[];
  pastedNodes: BoardNode[];
  sourceNodeIds: readonly string[];
  lastPastedNodeIds: readonly string[];
  viewportRect: WorldRect;
  gap: number;
}

/**
 * 貼り付けノード群（元座標のまま）を剛体として平行移動した衝突判定。
 * webpage は既存全ノードと、付箋/テキストは既存 webpage とだけ gap 制約を持つ。
 */
function hasPlacementConflict(
  existingNodes: BoardNode[],
  pastedNodes: BoardNode[],
  dx: number,
  dy: number,
  gap: number,
): boolean {
  return pastedNodes.some((pasted) => {
    const pastedRect = getNodeFrameRect({ ...pasted, x: pasted.x + dx, y: pasted.y + dy });
    return existingNodes.some((existing) => {
      if (!isWebPageNode(pasted) && !isWebPageNode(existing)) return false;
      const existingRect = getNodeFrameRect(existing);
      return conflictsWithGap(
        pastedRect.left,
        pastedRect.top,
        pastedRect.width,
        pastedRect.height,
        existingRect.left,
        existingRect.top,
        existingRect.width,
        existingRect.height,
        gap,
      );
    });
  });
}

export function resolvePastePlacement({
  existingNodes,
  pastedNodes,
  sourceNodeIds,
  lastPastedNodeIds,
  viewportRect,
  gap,
}: ResolvePastePlacementParams): Array<{ nodeId: string; x: number; y: number }> {
  const pastedBounds = getNodesFrameBounds(pastedNodes);
  if (!pastedBounds) return [];

  const lastPastedIdSet = new Set(lastPastedNodeIds);
  const sourceIdSet = new Set(sourceNodeIds);
  const lastPastedBounds = getNodesFrameBounds(
    existingNodes.filter((node) => lastPastedIdSet.has(node.id)),
  );
  const sourceBounds = getNodesFrameBounds(
    existingNodes.filter((node) => sourceIdSet.has(node.id)),
  );

  let targetX: number;
  let targetY: number;
  if (lastPastedBounds && rectsIntersect(lastPastedBounds, viewportRect)) {
    targetX = lastPastedBounds.x + gap;
    targetY = lastPastedBounds.y + gap;
  } else if (sourceBounds && rectsIntersect(sourceBounds, viewportRect)) {
    targetX = sourceBounds.x + gap;
    targetY = sourceBounds.y + gap;
  } else if (rectsIntersect(pastedBounds, viewportRect)) {
    // Cut / 削除済みの元座標が見えているなら、その場所へ「戻す」
    targetX = pastedBounds.x;
    targetY = pastedBounds.y;
  } else {
    targetX = viewportRect.x + (viewportRect.width - pastedBounds.width) / 2;
    targetY = viewportRect.y + (viewportRect.height - pastedBounds.height) / 2;
  }

  let dx = targetX - pastedBounds.x;
  let dy = targetY - pastedBounds.y;
  // 既存ノードの範囲は有限なので、右下対角へ進み続ければ必ず衝突が消えて停止する
  while (hasPlacementConflict(existingNodes, pastedNodes, dx, dy, gap)) {
    dx += gap;
    dy += gap;
  }

  return pastedNodes.map((node) => ({ nodeId: node.id, x: node.x + dx, y: node.y + dy }));
}
```

Also change `function conflictsWithGap` to `export function conflictsWithGap` in `src/lib/sheltie-node-placement.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- board-paste-placement`
Expected: all new tests pass; `sheltie-node-placement` tests stay green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/board-paste-placement.ts src/lib/board-paste-placement.test.ts src/lib/sheltie-node-placement.ts
git commit -m "feat(paste): add FigJam-style paste placement logic"
```

### Task 2: `insertBoardContent` store action (TDD)

**Objective:** Insert prepared nodes/edges as one history entry and merge screenshot seeds into runtime state.

**Files:**
- Modify: `src/store/tab-store.ts`
- Test: `src/store/tab-store.test.ts`

**Interfaces:**
- Produces:

```ts
insertBoardContent: (params: {
  nodes: BoardNode[];
  edges: BoardEdge[];
  screenshotSeedsByNodeId?: Record<string, ScreenshotCacheEntry>;
}) => void;
```

- [ ] **Step 1: Write the failing tests**

Add to `src/store/tab-store.test.ts` (follow the file's existing setup conventions for initializing a project):

- inserting 2 nodes + 1 edge appends them to `project.nodes` / `project.edges` in the given order (new nodes render frontmost).
- one `undoProject()` call removes all inserted nodes and edges at once; `redoProject()` restores them.
- `screenshotSeedsByNodeId` entries appear in `webviewRuntime.screenshotCacheByNodeId`; existing entries for other nodes are untouched.
- no-op cases (state unchanged, no history entry): empty `nodes` array; a node whose id already exists in the project.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tab-store`
Expected: new cases fail (`insertBoardContent is not a function`).

- [ ] **Step 3: Implement**

Add to `ProjectActions` in `src/store/tab-store.ts`:

```ts
insertBoardContent: (params: {
  nodes: BoardNode[];
  edges: BoardEdge[];
  screenshotSeedsByNodeId?: Record<string, ScreenshotCacheEntry>;
}) => void;
```

Implementation (place near `addWebNode`):

```ts
insertBoardContent: ({ nodes: newNodes, edges: newEdges, screenshotSeedsByNodeId }) =>
  set((state) => {
    if (!state.project) return state;
    if (newNodes.length === 0) return state;
    const existingIds = new Set(state.project.nodes.map((node) => node.id));
    // 呼び出し側の ID 再生成が壊れていた場合に store の不変条件を守る
    if (newNodes.some((node) => existingIds.has(node.id))) return state;

    return {
      project: {
        ...state.project,
        nodes: [...state.project.nodes, ...newNodes],
        edges: [...state.project.edges, ...newEdges],
      },
      history: pushHistory(state.history, {
        nodes: state.project.nodes,
        edges: state.project.edges,
      }),
      webviewRuntime: screenshotSeedsByNodeId
        ? {
            ...state.webviewRuntime,
            screenshotCacheByNodeId: {
              ...state.webviewRuntime.screenshotCacheByNodeId,
              ...screenshotSeedsByNodeId,
            },
          }
        : state.webviewRuntime,
    };
  }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tab-store`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/store/tab-store.ts src/store/tab-store.test.ts
git commit -m "feat(store): add insertBoardContent action for paste and duplicate"
```

### Task 3: Command orchestration hook and keyboard wiring

**Objective:** `useSheltieClipboardCommands` implements copy/cut/paste/duplicate; `edit-commands` and `useSheltieKeyboard` route menu events and key presses to it.

**Files:**
- Modify: `src/lib/edit-commands.ts`
- Create: `src/hooks/sheltie/useSheltieClipboardCommands.ts`
- Modify: `src/hooks/sheltie/useSheltieKeyboard.ts`
- Modify: `src/components/Sheltie/Sheltie.tsx`

**Interfaces:**
- Consumes: Phase 1 payload library, Task 1 placement, Task 2 `insertBoardContent`, `clipboardApi`.
- Produces:

```ts
// edit-commands.ts
export type EditCommand = 'undo' | 'redo' | 'delete' | 'cut' | 'copy' | 'paste' | 'duplicate';

// useSheltieClipboardCommands.ts
interface UseSheltieClipboardCommandsParams {
  getSelectedNodeIds: () => string[];
  setSelection: (idsOrUpdater: string[] | ((prev: string[]) => string[])) => void;
  clearEdgeSelection: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  getViewport: () => Viewport;
}
export function useSheltieClipboardCommands(params: UseSheltieClipboardCommandsParams): {
  handleCut: () => boolean;
  handleCopy: () => boolean;
  handlePaste: () => boolean;
  handleDuplicate: () => boolean;
};
```

- [ ] **Step 1: Extend edit-commands**

In `src/lib/edit-commands.ts`: extend the `EditCommand` union and `EditCommandHandlers` with `cut` / `copy` / `paste` / `duplicate` (each `() => boolean | void`), and generalize `runEditCommand` to `return currentHandlers[command]() !== false;` while keeping the `hasEditableFocus()` early return. If `onEditCommand` in `src/lib/tauri-bridge/events.ts` narrows the command string type, extend it identically.

- [ ] **Step 2: Implement the hook**

`src/hooks/sheltie/useSheltieClipboardCommands.ts` (all state reads via `useProjectStore.getState()` so async continuations never see stale data):

```ts
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

      // 同一ドキュメント内の複製だけスクリーンショットをシードする
      let screenshotSeedsByNodeId: Record<string, ScreenshotCacheEntry> | undefined;
      if (payload.sourceProjectId === project.id) {
        screenshotSeedsByNodeId = {};
        for (const [newId, sourceId] of Object.entries(materialized.sourceIdByNewId)) {
          const entry = webviewRuntime.screenshotCacheByNodeId[sourceId];
          if (entry) screenshotSeedsByNodeId[newId] = entry;
        }
        if (Object.keys(screenshotSeedsByNodeId).length === 0) {
          screenshotSeedsByNodeId = undefined;
        }
      }

      insertBoardContent({ nodes: placedNodes, edges: materialized.edges, screenshotSeedsByNodeId });
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
```

Note: repeated Cmd+D cascades naturally because each duplicate selects the new nodes, which become the sources of the next duplicate.

- [ ] **Step 3: Wire keyboard and registration**

`src/hooks/sheltie/useSheltieKeyboard.ts`:
- Add params `onCut`, `onCopy`, `onPaste`, `onDuplicate` (each `() => boolean`), register them in `registerEditCommandHandlers` alongside `delete`/`undo`/`redo`, and add them to the effect dependency array.
- In the keydown handler, after the undo/redo branch, add:

```ts
if (isModifierPressed && !e.altKey && !e.shiftKey) {
  const clipboardCommand = { c: 'copy', x: 'cut', v: 'paste', d: 'duplicate' }[lowerKey];
  if (clipboardCommand) {
    if (runEditCommand(clipboardCommand as EditCommand)) {
      e.preventDefault();
    }
    return;
  }
}
```

(`runEditCommand` returns `false` on editable focus, so native text copy/paste keeps its default behavior.)

`src/components/Sheltie/Sheltie.tsx`:
- Call `useSheltieClipboardCommands({ getSelectedNodeIds, setSelection, clearEdgeSelection, containerRef, getViewport })` after `useSheltieViewportController` (it needs `getViewport`).
- Pass the four handlers into `useSheltieKeyboard`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/edit-commands.ts src/hooks/sheltie/useSheltieClipboardCommands.ts src/hooks/sheltie/useSheltieKeyboard.ts src/components/Sheltie/Sheltie.tsx src/lib/tauri-bridge/events.ts
git commit -m "feat(clipboard): wire copy/cut/paste/duplicate commands"
```

### Task 4: Edit menu items (Rust) and manual verification

**Objective:** Replace the predefined Cut/Copy/Paste with custom items, add Duplicate, and route their menu events; verify the editable-focus assumption.

**Files:**
- Modify: `src-tauri/src/menus/mod.rs`
- Modify: `src-tauri/src/menus/edit.rs`
- Modify: `src-tauri/src/menus/helpers.rs`
- Modify: `src-tauri/src/setup.rs:245-247`

- [ ] **Step 1: Add menu IDs**

In `src-tauri/src/menus/mod.rs`:

```rust
pub const MENU_ID_EDIT_CUT: &str = "edit.cut";
pub const MENU_ID_EDIT_COPY: &str = "edit.copy";
pub const MENU_ID_EDIT_PASTE: &str = "edit.paste";
pub const MENU_ID_EDIT_DUPLICATE: &str = "edit.duplicate";
```

- [ ] **Step 2: Rebuild the Edit submenu deterministically**

In `src-tauri/src/menus/helpers.rs`, add:

```rust
/// Edit submenu の predefined item（Cut/Copy/Paste/Select All/separator）をすべて除去する。
/// custom item への置き換え前に呼び、再初期化でも重複しないようにする。
pub fn remove_default_edit_predefined_items<R: tauri::Runtime>(
    submenu: &Submenu<R>,
) -> tauri::Result<()> {
    for item in submenu.items()? {
        if let Some(predefined) = item.as_predefined_menuitem() {
            submenu.remove(predefined)?;
        }
    }
    Ok(())
}
```

In `src-tauri/src/menus/edit.rs`, rework `configure_edit_menu`:
1. Keep the existing `remove_submenu_item_by_id` calls and add the four new IDs to them.
2. Replace `remove_default_undo_redo(&edit_submenu)?` with `remove_default_edit_predefined_items(&edit_submenu)?` **plus** the existing `remove_default_undo_redo` (order: undo/redo first, then predefined sweep) so the submenu contains no leftover default items.
3. Append (not insert) in final order: Undo, Redo, Delete, separator, Cut (`CmdOrCtrl+X`), Copy (`CmdOrCtrl+C`), Paste (`CmdOrCtrl+V`), Duplicate (`CmdOrCtrl+D`), separator, `PredefinedMenuItem::select_all(app, None)?`. Drop the old `if edit_submenu.items()?.len() == 3` guard — the sweep above makes the rebuild idempotent.

```rust
let cut_item = MenuItemBuilder::with_id(MENU_ID_EDIT_CUT, "Cut")
    .accelerator("CmdOrCtrl+X")
    .build(app)?;
let copy_item = MenuItemBuilder::with_id(MENU_ID_EDIT_COPY, "Copy")
    .accelerator("CmdOrCtrl+C")
    .build(app)?;
let paste_item = MenuItemBuilder::with_id(MENU_ID_EDIT_PASTE, "Paste")
    .accelerator("CmdOrCtrl+V")
    .build(app)?;
let duplicate_item = MenuItemBuilder::with_id(MENU_ID_EDIT_DUPLICATE, "Duplicate")
    .accelerator("CmdOrCtrl+D")
    .build(app)?;
```

- [ ] **Step 3: Route the menu events**

In `src-tauri/src/setup.rs`, next to the existing edit arms (line 245-247):

```rust
MENU_ID_EDIT_CUT => emit_edit_command(app, "cut"),
MENU_ID_EDIT_COPY => emit_edit_command(app, "copy"),
MENU_ID_EDIT_PASTE => emit_edit_command(app, "paste"),
MENU_ID_EDIT_DUPLICATE => emit_edit_command(app, "duplicate"),
```

- [ ] **Step 4: Manual verification (record results in the PR description)**

Run: `npm run dev`, then verify:
1. Select a webpage node → Cmd+C → Cmd+V: a copy appears 20px bottom-right, selected, with the screenshot visible immediately; Cmd+V again cascades another 20px.
2. Cmd+V in a second document window (File > New Tab): the copy appears centered in that viewport, loads its own webview.
3. Cut a sticky → Cmd+V without panning: it reappears at its original position. Undo twice restores both steps.
4. Cmd+D duplicates in place; repeated Cmd+D cascades.
5. **Editable-focus assumption:** with the URL input focused, Cmd+C/Cmd+V copy/paste text natively (board handlers do not fire); same inside a Tiptap text node. With focus inside a child page WKWebView, Cmd+C copies the page selection.
6. External paste: copy a webpage node, paste into TextEdit/Slack → the URL text appears (not JSON). `pbpaste` in a terminal shows the same.
7. Select two connected webpage nodes → copy → paste: the arrow is reproduced between the new nodes with its style.

Expected: all 7 pass. If item 5 fails (menu steals the key from text fields), implement the documented fallback: in the `cut`/`copy` handlers call `document.execCommand('cut'/'copy')` when `hasEditableFocus()`, and for `paste` read the plain text via a new Rust command and insert it at the caret; re-run item 5.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/menus/mod.rs src-tauri/src/menus/edit.rs src-tauri/src/menus/helpers.rs src-tauri/src/setup.rs
git commit -m "feat(menu): add custom Cut/Copy/Paste/Duplicate edit menu items"
```

### Task 5: Node context menu Cut / Copy

**Objective:** Right-clicking a node offers Cut / Copy operating on the current selection.

**Files:**
- Modify: `src/hooks/sheltie/useSheltieContextMenus.ts:81`

- [ ] **Step 1: Add the items**

`handleNodeContextMenu` already normalizes selection before showing the menu (line 73). At the top of the `menuItems` construction (before the Change URL block), add:

```ts
menuItems.push(
  await MenuItem.new({
    text: 'Cut',
    accelerator: 'CmdOrCtrl+X',
    action: () => {
      handleContextMenuClose();
      runEditCommand('cut');
    },
  }),
  await MenuItem.new({
    text: 'Copy',
    accelerator: 'CmdOrCtrl+C',
    action: () => {
      handleContextMenuClose();
      runEditCommand('copy');
    },
  }),
  await PredefinedMenuItem.new({ item: 'Separator' }),
);
```

Import `runEditCommand` from `@/lib/edit-commands`. Reusing the registered command keeps a single execution path and always reads the live selection.

- [ ] **Step 2: Verify manually**

Run: `npm run dev`
Expected: right-click a node → Cut/Copy appear above Change URL and behave identically to the shortcuts, including with multiple nodes selected.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/sheltie/useSheltieContextMenus.ts
git commit -m "feat(context-menu): add Cut and Copy to the node context menu"
```

### Task 6: Documentation updates

**Objective:** Keep `docs/agents` consistent with the implementation in the same PR.

**Files:**
- Modify: `docs/agents/architecture.md` — add `lib/board-clipboard.ts`, `lib/board-paste-placement.ts`, `hooks/sheltie/useSheltieClipboardCommands.ts`, `commands/clipboard.rs` to the responsibility lists; note the Edit menu now uses custom Cut/Copy/Paste/Duplicate items.
- Modify: `docs/agents/domain-models.md` — document `BoardClipboardPayload` (type marker, version, untrusted-input validation via `parseDocumentNode`/`parseDocumentEdge`), the `insertBoardContent` action, and new invariants: "paste/duplicate is one history entry", "screenshot seeding only within the same document", "paste anchor priority: last-pasted → living sources → original coordinates → viewport center".
- Modify: `docs/agents/tauri-ipc.md` — document `write_board_clipboard` / `read_board_clipboard` and the new `edit-command` values (`cut` / `copy` / `paste` / `duplicate`).

- [ ] **Step 1: Update the three documents as described**
- [ ] **Step 2: Commit**

```bash
git add docs/agents/architecture.md docs/agents/domain-models.md docs/agents/tauri-ipc.md
git commit -m "docs(agents): document clipboard commands and paste placement"
```

## Validation

- `npm run lint && npm run format && npm run typecheck && npm run test` — all green.
- `(cd src-tauri && cargo check)` — compiles.
- Manual checklist from Task 4 Step 4 recorded in the PR description.

## Risks, Tradeoffs, and Open Questions

- The WKWebView-consumes-editing-shortcuts assumption is the main risk; Task 4 Step 4 verifies it early and names the concrete fallback.
- `remove_default_edit_predefined_items` sweeps all predefined items in the Edit submenu; if a future change adds a predefined item that must survive, it needs an explicit allowlist there.
- Paste is async (clipboard read) while `runEditCommand` is sync; `handlePaste` returns `true` optimistically so Cmd+V is `preventDefault`ed on the board even when the clipboard has no Sheltie payload. Harmless: the default action for Cmd+V outside editable elements is a no-op.
- Cross-window paste of a cut node cannot seed screenshots (source project differs); the copy shows the loading state. Accepted per design.
