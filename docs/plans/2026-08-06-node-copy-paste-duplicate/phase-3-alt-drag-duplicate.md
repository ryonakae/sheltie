# Phase 3 — Alt-Drag Duplicate Implementation Plan

> **For implementers:** Execute this plan task-by-task. Complete each checkbox step, run the listed validation, and commit after each task. Phases 1 and 2 must be completed first.

**Goal:** FigJam-style Alt-drag duplication: while dragging nodes with Alt held, a static ghost clone stays at the original position; on drop the dragged element becomes a new node (original never moves, keeps its edges), decided by the Alt state at drop time, on both drag paths (React Flow native and the WebPage title-row pointer drag).

**Architecture:** The drop commit is a pure function (`buildAltDragDuplicate`) reusing the Phase 2 `insertBoardContent` action and the existing single-node overlap correction. `useSheltieDrag` owns Alt-state tracking for both drag paths and exposes the ghost source nodes; ghosts render as a new non-interactive `ghost` React Flow node type.

**Tech Stack:** TypeScript, React 19, @xyflow/react v12, Zustand, Vitest.

## Global Constraints

- The decision is made at drop time: pressing Alt mid-drag shows ghosts and arms duplication; releasing Alt mid-drag hides them and reverts to a normal move.
- The dragged element becomes the **new** node. The original's store position is never written during an alt-drop, so it stays put and keeps all its edges.
- Edges whose both endpoints are inside the dragged set are cloned (style included); edges to outside nodes are not.
- Single-node alt-drop applies `resolveDraggedNodePosition` (gap `DRAG_REPOSITION_GAP`); multi-node alt-drop skips correction, matching the existing multi-drag behavior.
- One alt-drop = one history entry; the new nodes become the selection.
- Webpage duplicates always seed the source node's screenshot cache entry (same document by definition).
- Ghost nodes are fully non-interactive: `draggable: false`, `selectable: false`, `focusable: false`, `pointer-events-none`, no Handles, no NodeToolbar.

## Current Context

- `src/hooks/sheltie/useSheltieDrag.ts` — both drag paths. RF native: `handleNodeDragStart(event, node)` / `handleNodeDragStop(event, node, draggedNodes)`; store writes happen only at stop. Title-row: `handleTitlePointerDown` computes `movingIds` (selection if the pressed node is part of a multi-selection, else the single node) and commits at `pointerup`. During either drag the store positions are untouched (`draggingNodePositions` overrides rendering), so the store node itself is the ghost's position source.
- `src/hooks/sheltie/useSheltieFlowNodes.ts` — builds the React Flow `Node[]`; `Sheltie.tsx` passes `screenshotUrls` (display engine) and spreads the result into `<ReactFlow nodes={...}>`.
- `src/components/ReactFlowNodes/nodeTypes.ts` — `nodeTypes` registry; `types.ts` — flow node data types.
- `src/components/Node/StickyNoteNode.tsx:12` / `src/components/Node/TextNode.tsx:10` — body components reusable with no-op handlers.
- `src/lib/sheltie-node-placement.ts:149` — `resolveDraggedNodePosition({ nodes, movingNode, proposedX, proposedY, gap })`; blockers are derived internally by filtering out `movingNode.id`.
- Phase 2 provides `insertBoardContent` and the screenshot-seeding pattern (`sourceIdByNewId` → runtime cache entries).
- `WEB_PAGE_FRAME_PADDING = 16`, `DRAG_REPOSITION_GAP = 20` from `@/constants`; frame helpers in `@/lib/sheltie-node-frame`.

## File Structure

- Create: `src/lib/alt-drag-duplicate.ts` — pure drop-commit builder.
- Test: `src/lib/alt-drag-duplicate.test.ts`
- Create: `src/components/ReactFlowNodes/GhostFlowNode.tsx` — static ghost rendering for all three node types.
- Modify: `src/components/ReactFlowNodes/nodeTypes.ts`, `src/components/ReactFlowNodes/types.ts` — register the `ghost` type and its data type.
- Modify: `src/hooks/sheltie/useSheltieFlowNodes.ts` — append ghost flow nodes.
- Modify: `src/hooks/sheltie/useSheltieDrag.ts` — Alt tracking, ghost exposure, alt-drop commit on both paths.
- Modify: `src/components/Sheltie/Sheltie.tsx` — wire ghost data and new hook params.
- Modify: `docs/agents/architecture.md`, `docs/agents/domain-models.md` — documentation.

## Tasks

### Task 1: Drop-commit builder (TDD)

**Objective:** Pure function that turns the dragged set + dropped positions into insertable duplicates.

**Files:**
- Create: `src/lib/alt-drag-duplicate.ts`
- Test: `src/lib/alt-drag-duplicate.test.ts`

**Interfaces:**
- Produces:

```ts
export interface BuildAltDragDuplicateParams {
  nodes: BoardNode[]; // current store nodes (originals, at rest positions)
  edges: BoardEdge[];
  draggedNodeIds: readonly string[];
  droppedPositionByNodeId: Record<string, { x: number; y: number }>;
  createId?: () => string;
}

export interface AltDragDuplicateResult {
  nodes: BoardNode[]; // duplicates at dropped (corrected) positions
  edges: BoardEdge[]; // internal edges, remapped
  sourceIdByNewId: Record<string, string>;
}

export function buildAltDragDuplicate(params: BuildAltDragDuplicateParams): AltDragDuplicateResult;
```

- [ ] **Step 1: Write the failing tests**

`src/lib/alt-drag-duplicate.test.ts` (inject `createId` returning `'new-1'`, `'new-2'`, ...):

- duplicates carry the source node's content (`url`, `addedUrl`, `title`, size, sticky `content`/`colorIndex`) with fresh ids; the originals are not in the result.
- each duplicate sits at its `droppedPositionByNodeId` entry (multi-node case, overlapping positions allowed — no correction).
- single-node case: a webpage dropped closer than 20px to an existing webpage is corrected (result position differs from the dropped one and satisfies the gap; mirror an existing `resolveDraggedNodePosition` test fixture).
- single-node case with no conflict: dropped position is used as-is.
- an edge between two dragged nodes is cloned with remapped endpoints and identical style fields; an edge from a dragged node to an outside node is not cloned.
- `sourceIdByNewId` maps every new id to its source id.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- alt-drag-duplicate`
Expected: module-not-found failure.

- [ ] **Step 3: Implement**

`src/lib/alt-drag-duplicate.ts`:

```ts
import { DRAG_REPOSITION_GAP } from '@/constants';
import { resolveDraggedNodePosition } from '@/lib/sheltie-node-placement';
import type { BoardEdge, BoardNode } from '@/types';

export interface BuildAltDragDuplicateParams {
  nodes: BoardNode[];
  edges: BoardEdge[];
  draggedNodeIds: readonly string[];
  droppedPositionByNodeId: Record<string, { x: number; y: number }>;
  createId?: () => string;
}

export interface AltDragDuplicateResult {
  nodes: BoardNode[];
  edges: BoardEdge[];
  sourceIdByNewId: Record<string, string>;
}

export function buildAltDragDuplicate({
  nodes,
  edges,
  draggedNodeIds,
  droppedPositionByNodeId,
  createId = () => crypto.randomUUID(),
}: BuildAltDragDuplicateParams): AltDragDuplicateResult {
  const draggedIdSet = new Set(draggedNodeIds);
  const newIdBySourceId = new Map<string, string>();
  const sourceIdByNewId: Record<string, string> = {};

  let duplicates = nodes
    .filter((node) => draggedIdSet.has(node.id))
    .map((source) => {
      const newId = createId();
      newIdBySourceId.set(source.id, newId);
      sourceIdByNewId[newId] = source.id;
      const dropped = droppedPositionByNodeId[source.id] ?? { x: source.x, y: source.y };
      return { ...source, id: newId, x: dropped.x, y: dropped.y };
    });

  // 単独ドラッグは通常ドラッグ終了と同じ重なり補正。複数同時は既存挙動に合わせて省略する
  if (duplicates.length === 1) {
    const duplicate = duplicates[0];
    const resolved = resolveDraggedNodePosition({
      nodes,
      movingNode: duplicate,
      proposedX: duplicate.x,
      proposedY: duplicate.y,
      gap: DRAG_REPOSITION_GAP,
    });
    duplicates = [{ ...duplicate, x: resolved.x, y: resolved.y }];
  }

  const duplicatedEdges = edges.flatMap((edge) => {
    const source = newIdBySourceId.get(edge.source);
    const target = newIdBySourceId.get(edge.target);
    if (!source || !target) return [];
    return [{ ...edge, id: createId(), source, target }];
  });

  return { nodes: duplicates, edges: duplicatedEdges, sourceIdByNewId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- alt-drag-duplicate`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/alt-drag-duplicate.ts src/lib/alt-drag-duplicate.test.ts
git commit -m "feat(alt-drag): add pure drop-commit builder for alt-drag duplication"
```

### Task 2: Ghost flow node

**Objective:** A non-interactive React Flow node type rendering a static clone of any board node.

**Files:**
- Create: `src/components/ReactFlowNodes/GhostFlowNode.tsx`
- Modify: `src/components/ReactFlowNodes/types.ts` — add `GhostFlowNodeData`.
- Modify: `src/components/ReactFlowNodes/nodeTypes.ts` — register `ghost: GhostFlowNode`.
- Modify: `src/hooks/sheltie/useSheltieFlowNodes.ts` — new `ghostNodes` param.

**Interfaces:**
- Produces:

```ts
// types.ts
export interface GhostFlowNodeData {
  node: BoardNode;
  screenshotUrl?: string; // webpage のみ
  [key: string]: unknown;
}

// useSheltieFlowNodes.ts — new param
ghostNodes: Array<{ node: BoardNode; screenshotUrl?: string }>;
```

- [ ] **Step 1: Implement GhostFlowNode**

`src/components/ReactFlowNodes/GhostFlowNode.tsx`, rendering by node type inside a `pointer-events-none` wrapper sized to the frame:

- **webpage**: replicate the frame look with existing classes — outer `div` with `bg-default` rounded corners and `WEB_PAGE_FRAME_PADDING` padding (match `WebPageNode.tsx`'s frame classes; world-fixed values, no zoom-dependent border needed for a transient ghost); inner content area `width: node.width / height: node.height` showing `<img src={screenshotUrl} className="size-full object-cover object-top" />` when available, else the same `bg` placeholder tone as an unloaded page.
- **stickynote**: `<StickyNoteNode node={node} isActive={false} onActivate={noop} onContextMenu={noop} onContentChange={noop} onAutoHeightChange={noop} />`.
- **text**: `<TextNode node={node} isActive={false} isEditing={false} onActivate={noop} onContextMenu={noop} onStartEditing={noop} onStopEditing={noop} onAutoHeightChange={noop} onAutoWidthChange={noop} />`.

Use a module-level `const noop = () => {};`. No `Handle`, no `NodeToolbar`, no resize controls. Export `memo`-wrapped like the other flow nodes and register in `nodeTypes.ts`.

- [ ] **Step 2: Append ghosts in useSheltieFlowNodes**

Add the `ghostNodes` param and prepend ghost entries to the array returned by the existing `useMemo` (so ghosts render beneath real nodes). Concretely, where the memo currently ends with `return nodes.map(...)` (or equivalent), change it to:

```ts
const ghostFlowNodes: Node[] = ghostNodes.map(({ node, screenshotUrl }) => ({
  id: `ghost-${node.id}`,
  type: 'ghost' as const,
  position: { x: node.x, y: node.y },
  draggable: false,
  selectable: false,
  focusable: false,
  data: { node, screenshotUrl } satisfies GhostFlowNodeData,
  width: getNodeFrameWidth(node),
  height: getNodeFrameHeight(node),
}));
return [...ghostFlowNodes, ...boardFlowNodes];
```

(`boardFlowNodes` = the array the memo built before this change.) Add `ghostNodes` to the `useMemo` dependency array — `npm run lint`'s `exhaustive-deps` rule will flag it if missed.

In `Sheltie.tsx`, pass `ghostNodes: []` for now (wired for real in Task 3).

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: green (rendering is DOM-dependent and covered by manual verification in Task 4).

- [ ] **Step 4: Commit**

```bash
git add src/components/ReactFlowNodes/GhostFlowNode.tsx src/components/ReactFlowNodes/types.ts src/components/ReactFlowNodes/nodeTypes.ts src/hooks/sheltie/useSheltieFlowNodes.ts src/components/Sheltie/Sheltie.tsx
git commit -m "feat(alt-drag): add non-interactive ghost flow node"
```

### Task 3: Alt tracking and commit — React Flow native path

**Objective:** `useSheltieDrag` tracks the Alt state during a native drag, exposes ghost source nodes, and commits duplicates at drop instead of moving the originals.

**Files:**
- Modify: `src/hooks/sheltie/useSheltieDrag.ts`
- Modify: `src/components/Sheltie/Sheltie.tsx`

**Interfaces:**
- New `UseSheltieDragParams` (add): `edges: BoardEdge[]`, `insertBoardContent` (Phase 2 action signature), `screenshotCacheByNodeId: Record<string, ScreenshotCacheEntry>`.
- New return value (add): `altDuplicateSourceNodes: BoardNode[]` — dragged store nodes while dragging with Alt held; empty otherwise.

- [ ] **Step 1: Add Alt-state tracking**

In `useSheltieDrag`:

```ts
// alt ドラッグ複製: ドラッグ中の対象 id と、ドロップ時判定用の alt 押下状態
const [altDragState, setAltDragState] = useState<{
  draggedNodeIds: string[];
  altPressed: boolean;
} | null>(null);
const altDragStateRef = useRef(altDragState);
altDragStateRef.current = altDragState;
```

- Effect: while `altDragState !== null`, listen on `window` for `keydown`/`keyup` with `e.key === 'Alt'` and update `altPressed` (also `e.preventDefault()` on keydown to suppress macOS menu focus). Remove listeners when the state returns to `null`.
- In `handleNodeDragStart` (rename its first parameter `_event` → `event`, since it becomes used): compute the dragged set with the same rule as the title path (`selectedNodeIds.includes(node.id) && selectedNodeIds.length > 1 ? selectedNodeIds : [node.id]`) and `setAltDragState({ draggedNodeIds, altPressed: event.altKey })`.
- Derive the exposed ghosts:

```ts
const altDuplicateSourceNodes = useMemo(() => {
  if (!altDragState?.altPressed) return [];
  const draggedIdSet = new Set(altDragState.draggedNodeIds);
  return nodes.filter((node) => draggedIdSet.has(node.id));
}, [altDragState, nodes]);
```

- [ ] **Step 2: Commit duplicates at drop**

Add a commit helper used by both paths:

```ts
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
```

In `handleNodeDragStop`, insert the alt-drop branch **after** the `setDraggingNodePositions` cleanup but **before** the existing `if (draggedNodes.length > 1) { updateNodePositions(...); return; }` early return — otherwise multi-node alt-drags would fall into the normal move commit:

```ts
const altState = altDragStateRef.current;
setAltDragState(null);
if (altState?.altPressed) {
  commitAltDragDuplicate(
    altState.draggedNodeIds,
    Object.fromEntries(draggedNodes.map((dragged) => [dragged.id, dragged.position])),
  );
  return; // 元ノードの store 位置は書かない = 元位置へ戻る
}
```

(The existing `setDraggingNodePositions` cleanup must still run before this branch so the originals snap back.) Also clear `altDragState` in the non-alt path.

- [ ] **Step 3: Wire Sheltie**

In `Sheltie.tsx`:
- Pass `edges`, `insertBoardContent`, and `projectWebviewRuntime.screenshotCacheByNodeId` into `useSheltieDrag`.
- Build ghost data and replace the Task 2 placeholder:

```ts
const ghostNodes = useMemo(
  () =>
    altDuplicateSourceNodes.map((node) => ({
      node,
      screenshotUrl: screenshotUrls[node.id],
    })),
  [altDuplicateSourceNodes, screenshotUrls],
);
```

(`screenshotUrls` comes from `useSheltieDisplayEngine`; declare `ghostNodes` after it.)

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/sheltie/useSheltieDrag.ts src/components/Sheltie/Sheltie.tsx
git commit -m "feat(alt-drag): duplicate nodes on alt-drop via the React Flow drag path"
```

### Task 4: Title-row drag path and manual verification

**Objective:** The WebPage title-row pointer drag supports the same Alt semantics; full manual QA of both paths.

**Files:**
- Modify: `src/hooks/sheltie/useSheltieDrag.ts` (`handleTitlePointerDown`)

- [ ] **Step 1: Extend handleTitlePointerDown**

- After computing `movingIds` and passing the drag threshold (`dragStarted = true`), call `setAltDragState({ draggedNodeIds: movingIds, altPressed: ev.altKey })` so the shared Alt key listeners and ghost derivation activate (initialize `altPressed` from the `pointermove` event's `altKey`; the window listeners take over from there).
- In `handleUp`, mirror the native path:

```ts
const altState = altDragStateRef.current;
setAltDragState(null);
if (dragStarted && altState?.altPressed) {
  const droppedPositionByNodeId = Object.fromEntries(
    Array.from(startPositions.entries()).map(([id, start]) => [
      id,
      { x: start.x + dx, y: start.y + dy },
    ]),
  );
  commitAltDragDuplicate(altState.draggedNodeIds, droppedPositionByNodeId);
  return; // updateNodePosition(s) を呼ばない
}
```

(Keep the existing `setDraggingNodePositions` cleanup before this branch, and note `dx`/`dy` are already divided by `startZoom` there.)

- [ ] **Step 2: Manual verification (record results in the PR description)**

Run: `npm run dev`, then verify:
1. Alt held before dragging a webpage node (frame padding grab): ghost stays at the origin with the screenshot; drop creates a duplicate at the drop point, original unmoved, duplicate selected, screenshot visible immediately.
2. Start a normal drag, press Alt mid-drag → ghost appears; release Alt mid-drag → ghost disappears; drop without Alt = normal move (store position updated once).
3. Same as (1) via the title row of a webpage node.
4. Multi-selection (webpage + sticky) alt-drag: all duplicated, relative layout kept, one Cmd+Z removes all duplicates.
5. Two connected webpage nodes alt-dragged together: the arrow is duplicated between the copies; an arrow to a non-dragged node stays only on the original.
6. Single webpage alt-dropped onto another webpage: the duplicate is pushed to keep the 20px gap.
7. Sticky/text alt-drag ghosts render their content (color, text formatting).

Expected: all 7 pass.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/sheltie/useSheltieDrag.ts
git commit -m "feat(alt-drag): support alt-drop duplication on the title-row drag path"
```

### Task 5: Documentation updates

**Objective:** Keep `docs/agents` consistent in the same PR.

**Files:**
- Modify: `docs/agents/architecture.md` — add `GhostFlowNode.tsx` and `lib/alt-drag-duplicate.ts`; extend the `useSheltieDrag` description (Alt tracking, ghost exposure, alt-drop commit on both drag paths).
- Modify: `docs/agents/domain-models.md` — invariants: "the dragged element becomes the new node on alt-drop; the original's position is never written", "alt-drop is one history entry via `insertBoardContent`", "ghost nodes are runtime-only render artifacts, never stored".

- [ ] **Step 1: Update the two documents as described**
- [ ] **Step 2: Commit**

```bash
git add docs/agents/architecture.md docs/agents/domain-models.md
git commit -m "docs(agents): document alt-drag duplication and ghost nodes"
```

## Validation

- `npm run lint && npm run format && npm run typecheck && npm run test` — all green.
- Manual checklist from Task 4 Step 2 recorded in the PR description.
- Regression: normal drag (no Alt) on both paths still moves nodes with one history entry; overlap-correction animation still plays for single webpage moves.

## Risks, Tradeoffs, and Open Questions

- While alt-dragging, edges attached to the original visually follow the dragged element (React Flow tracks node ids) and snap back on drop. FigJam keeps them on the stationary original; accepted as a v1 tradeoff — fixing it would require remapping edge endpoints mid-drag.
- The ghost webpage frame replicates `WebPageNode` styling rather than reusing the component (which is entangled with webview placeholder logic). If `WebPageNode`'s frame look changes, the ghost needs a matching touch-up; keep the class lists adjacent-looking and note it in the component comment.
- `Alt` keydown/keyup can be missed if the app loses focus mid-drag; the state resets on every drag start and drop, so a stale `altPressed` cannot leak across drags.
- No copy-cursor feedback while Alt is held (Figma shows one); out of scope, can be added later via a CSS class on the pane.
