# Arrow Edge Toolbar Implementation Plan

> **For implementers:** Execute this plan task-by-task. Complete each checkbox step, run the listed validation, and commit after each task.

**Goal:** Allow a single selected website-node arrow to be styled from a zoom-invariant toolbar above its midpoint, while enforcing one styled arrow per unordered pair of connection points.

**Architecture:** Extend the persisted `BoardEdge` contract with explicit style fields, keep edge mutations and duplicate replacement in pure helpers called by the Zustand store, and pass typed edge data/callbacks from `Siteboard.tsx` into the existing custom `ArrowEdge`. Render the controls with React Flow 12.10.1 `EdgeToolbar`, and reuse the existing selection-toolbar/Webview occlusion pipeline after generalizing its DOM marker from node-only to any selected element.

**Tech Stack:** React 19, TypeScript 5.7 strict mode, Zustand 5, `@xyflow/react` 12.10.1, Tailwind CSS 4, Gravity UI icons, Vitest 2.1.

## Global Constraints

- Follow TDD for `src/lib/*`, `src/store/*`, and pure geometry/selection logic: failing test → confirm failure → minimal implementation → confirm success → refactor.
- Do not add component rendering tests. Project policy treats React component rendering and native Webview behavior as manual-test concerns.
- Do not add dependencies. Use `EdgeToolbar`, `BaseEdge`, and `getBezierPath` from the installed `@xyflow/react` 12.10.1, plus `ArrowRightArrowLeft` from the installed `@gravity-ui/icons` package.
- Keep the current Bezier path. “Solid/dashed” changes line style, not path geometry.
- Show the edge toolbar only when exactly one element is selected across both nodes and edges, and that element is an edge.
- Place the toolbar at the Bezier midpoint, entirely above the line with an `8px` screen-space gap. `EdgeToolbar` must keep it the same screen size at every canvas zoom.
- Match the existing `StickyNoteToolbar` / `TextNodeToolbar` design exactly: `h-7`, `min-w-7`, `gap-0.5`, `rounded-lg`, `bg-zinc-800`, `px-1 py-0.5`, `shadow-lg`, inactive `text-white/70`, active `bg-white/25 text-white`, and `h-4 w-px bg-white/20` separators.
- Render all controls in one row, in this exact order: stroke width → line style → reverse direction → color.
- Use visual previews/icons only. Do not add HeroUI `Tooltip`, `tooltipMessage`, or HTML `title`. Add non-visual `aria-label` text to every icon-only button.
- Stroke widths are exactly `3` and `6` world units. Default is `3`.
- For `3`: source dot radius `6`, arrow length `16`, arrow half-width `10` (full width `20`).
- For `6`: source dot radius `8`, arrow length `20`, arrow half-width `12` (full width `24`).
- Line styles are exactly `solid` and `dashed`. Default is `solid`.
- Dashed `3` uses `strokeDasharray="8 6"`; dashed `6` uses `strokeDasharray="12 8"`.
- Dashed edges keep a filled source dot and filled target arrowhead.
- Color presets, in this exact order, are `default`, `foreground`, `muted`, `accent`, `success`, `warning`, `danger`.
- Map colors to `var(--color-separator-tertiary)`, `var(--foreground)`, `var(--muted)`, `var(--accent)`, `var(--success)`, `var(--warning)`, and `var(--danger)` respectively. Default is `default`.
- A selected edge keeps its configured color. Show selection with a semi-transparent `var(--accent)` halo behind the path, source dot, and arrowhead; use opacity `0.35` and `6` extra world units of path/polygon stroke width (circle halo radius is configured radius + `3`). The halo path uses the same solid/dashed pattern as the configured edge.
- Reverse direction is one toolbar button. It swaps source/target node IDs and source/target handle IDs while preserving edge ID and all style fields.
- Define “same connection points” as the same two `(nodeId, handleId)` endpoints compared without direction. Different handles on the same nodes are different connection-point pairs.
- Adding an edge whose unordered connection-point pair already exists replaces the existing edge with the newly added edge’s ID/direction, but inherits the existing edge’s width, line style, and color. The replacement is one history entry and one Undo step.
- No pre-release `.siteboard` backward compatibility or migration is required. Edge style fields are required when parsing persisted edges; keep `schemaVersion: 2` and update its contract in place.
- The edge context menu contains only `Delete Arrow`. Do not add edge ordering. Remove `Reverse Arrow Direction` from the context menu.
- Keep keyboard/menu Delete and Undo/Redo behavior. Style changes and reversal are persisted, dirty-producing, and individually undoable.
- Generalize the existing toolbar/Webview occlusion marker to `data-selection-toolbar`. An edge toolbar overlapping a native Webview must trigger the same screenshot/hidden demotion and native restoration as node toolbars.
- Use `@/` aliases for cross-directory imports. Preserve existing local `./...` imports within the same feature directory where the code already follows that pattern.
- Update the canonical agent documentation in the same change: `docs/agents/architecture.md`, `docs/agents/domain-models.md`, `docs/agents/coding-rules.md`, and `docs/agents/siteboard-runtime.md`.
- Baseline verified before planning: `npm run test -- --reporter=dot` passes 10 files / 140 tests.

## Current Context

- `src/types/index.ts` currently stores only edge identity/endpoints.
- `src/lib/project-document.ts` parses and serializes five endpoint fields and writes schema version 2.
- `src/store/tab-store.ts` routes every edge mutation through `replaceProjectEdges`, so one successful helper return naturally creates one combined node/edge history snapshot.
- Current `addEdge` rejects only exact directed duplicates. Current `reverseEdge` refuses a reverse operation if the resulting directed edge already exists.
- `src/components/ReactFlowEdges/ArrowEdge.tsx` draws a Bezier `BaseEdge`, a source circle, and a target polygon; selection currently replaces the configured/default color instead of drawing a halo.
- `getBezierPath` returns `[path, centerX, centerY, ...]`. React Flow 12.10.1 `EdgeToolbar` accepts `edgeId`, `x`, `y`, `isVisible`, `alignX`, and `alignY`, portals interactive HTML, and applies inverse zoom so toolbar content stays screen-size invariant.
- `selectedEdgeIds` is local controlled state in `Siteboard.tsx`; `selectedNodeIds` comes from `Project.tsx`. Current node `activeNodeId` ignores selected edges.
- `useSiteboardDisplayEngine` recomputes toolbar occlusion after `selectedNodeIds` changes, and `getSelectionToolbarRects` currently scans `[data-node-toolbar]`.
- Existing node toolbar components use custom `<button>` elements rather than `AppButton`. Reuse their class contract instead of introducing a new toolbar design abstraction in this feature.
- The edge context menu currently contains reverse and delete. Edge ordering does not exist and remains out of scope.

## File Structure

- Create: `src/lib/siteboard-edge.ts` — pure endpoint identity, replacement, style patch, and direction reversal helpers.
- Test: `src/lib/siteboard-edge.test.ts` — endpoint-pair and immutable edge-mutation specifications.
- Create: `src/lib/siteboard-selection.ts` — pure exactly-one-total-selection resolver and stale edge-selection pruning.
- Test: `src/lib/siteboard-selection.test.ts` — node/edge/mixed selection and live-ID pruning cases.
- Create: `src/components/ReactFlowEdges/types.ts` — typed React Flow edge data/callback contract.
- Create: `src/components/ReactFlowEdges/ArrowToolbar.tsx` — existing-style toolbar controls.
- Create: `src/components/ReactFlowEdges/arrowGeometry.test.ts` — width-dependent geometry, dash pattern, and color mapping tests.
- Modify: `src/types/index.ts` — edge style types and persisted/runtime edge fields.
- Modify: `src/constants/siteboard.ts` — default style, options, and ordered color preset metadata.
- Modify: `src/lib/project-document.ts` — strict parse and round-trip of required edge styles.
- Modify: `src/lib/project-document.test.ts` — edge style persistence and invalid-value tests.
- Modify: `src/components/Siteboard/Siteboard.tsx` — add required defaults when creating an edge; later add typed edge data and selection wiring.
- Modify: `src/store/tab-store.ts` — `updateEdgeStyle`, replacement-on-add, and pure reverse helper integration.
- Modify: `src/store/tab-store.test.ts` — history/Undo integration tests for replacement and styling.
- Modify: `src/components/ReactFlowEdges/arrowGeometry.ts` — per-width geometry, dash, color, halo, and toolbar offset constants/helpers.
- Modify: `src/components/ReactFlowEdges/ArrowEdge.tsx` — configured rendering, halo, and `EdgeToolbar` composition.
- Modify: `src/components/ReactFlowEdges/ArrowConnectionLine.tsx` — consume the default geometry/style contract without changing the drag preview appearance.
- Modify: `src/components/Siteboard/Siteboard.tsx` — total-selection resolution, typed edge data, defaults, callbacks, and display-engine selection key.
- Modify: `src/hooks/siteboard/useSiteboardContextMenus.ts` — delete-only edge menu and cross-kind selection clearing.
- Modify: `src/hooks/siteboard/useSiteboardDisplayEngine.ts` — recompute occlusion for node or edge toolbar selection changes.
- Modify: `src/hooks/siteboard/display-engine/dom.ts` — query generic `data-selection-toolbar` roots.
- Modify: `src/components/ReactFlowNodes/WebPageToolbar.tsx` — generic toolbar DOM marker.
- Modify: `src/components/ReactFlowNodes/StickyNoteToolbar.tsx` — generic toolbar DOM marker.
- Modify: `src/components/ReactFlowNodes/TextNodeToolbar.tsx` — generic toolbar DOM marker.
- Modify: `docs/agents/architecture.md` — ArrowToolbar and styled edge responsibilities.
- Modify: `docs/agents/domain-models.md` — edge fields, defaults, actions, history, and uniqueness invariant.
- Modify: `docs/agents/coding-rules.md` — toolbar, selection, rendering, context menu, and duplicate connection rules.
- Modify: `docs/agents/siteboard-runtime.md` — generic selection-toolbar/Webview occlusion behavior.

## Tasks

### Task 1: Define and persist the styled edge contract

**Objective:** Make edge appearance an explicit required part of runtime and `.siteboard` schema version 2 data, with strict validation and round-trip coverage.

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/constants/siteboard.ts`
- Modify: `src/lib/project-document.ts`
- Test: `src/lib/project-document.test.ts`
- Modify: `src/components/Siteboard/Siteboard.tsx`

**Interfaces:**
- Produces: `EdgeStrokeWidth`, `EdgeLineStyle`, `EdgeColorPreset`, `BoardEdgeStyle`, required style fields on `BoardEdge` / `SiteboardDocumentEdge`, `EDGE_STROKE_WIDTHS`, `EDGE_LINE_STYLES`, `EDGE_COLOR_PRESETS`, and `DEFAULT_EDGE_STYLE`.
- Consumed by: Tasks 2–4.

- [ ] **Step 1: Write failing persistence and validation tests**

Update every `BoardEdge` test fixture in `src/lib/project-document.test.ts` to carry the required style fields. Add tests equivalent to:

```ts
const styledEdge: BoardEdge = {
  id: 'e1',
  source: 's',
  sourceHandle: 'right',
  target: 't',
  targetHandle: 'left',
  strokeWidth: 6,
  lineStyle: 'dashed',
  colorPreset: 'danger',
};

it('edge style fields survive board/document round-trip', () => {
  const documentEdge = boardEdgeToDocumentEdge(styledEdge);
  expect(documentEdge).toEqual(styledEdge);
  expect(documentEdgeToBoardEdge(documentEdge)).toEqual(styledEdge);
});

it.each([
  ['strokeWidth', 4],
  ['lineStyle', 'dotted'],
  ['colorPreset', 'purple'],
])('rejects invalid edge %s', (field, value) => {
  const edge = { ...styledEdge, [field]: value };
  const json = JSON.stringify({ schemaVersion: 2, nodes: [], edges: [edge] });
  expect(() => parseProjectDocument(json)).toThrow(new RegExp(`edges\\[0\\]\\.${field}`));
});

it('requires edge style fields because pre-release compatibility is out of scope', () => {
  const legacy: Record<string, unknown> = { ...styledEdge };
  delete legacy.strokeWidth;
  delete legacy.lineStyle;
  delete legacy.colorPreset;
  const json = JSON.stringify({ schemaVersion: 2, nodes: [], edges: [legacy] });
  expect(() => parseProjectDocument(json)).toThrow(/edges\[0\]\.strokeWidth/);
});
```

Also import and test `documentEdgeToBoardEdge`, which the current test file does not import.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run test -- src/lib/project-document.test.ts`

Expected: TypeScript/Vitest failures because the edge style types and parser mappings do not exist yet.

- [ ] **Step 3: Add the exact edge style types and ordered constants**

Add to `src/types/index.ts` before `BoardEdge`:

```ts
export type EdgeStrokeWidth = 3 | 6;
export type EdgeLineStyle = 'solid' | 'dashed';
export type EdgeColorPreset =
  | 'default'
  | 'foreground'
  | 'muted'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger';

export interface BoardEdgeStyle {
  strokeWidth: EdgeStrokeWidth;
  lineStyle: EdgeLineStyle;
  colorPreset: EdgeColorPreset;
}
```

Make both edge interfaces extend `BoardEdgeStyle`:

```ts
export interface BoardEdge extends BoardEdgeStyle {
  id: string;
  source: string;
  sourceHandle: string | null;
  target: string;
  targetHandle: string | null;
}

export interface SiteboardDocumentEdge extends BoardEdgeStyle {
  id: string;
  source: string;
  sourceHandle: string | null;
  target: string;
  targetHandle: string | null;
}
```

Append to `src/constants/siteboard.ts`, using type-only imports from `@/types`:

```ts
export const EDGE_STROKE_WIDTHS = [3, 6] as const;
export const EDGE_LINE_STYLES = ['solid', 'dashed'] as const;

export const EDGE_COLOR_PRESETS = [
  { key: 'default', value: 'var(--color-separator-tertiary)' },
  { key: 'foreground', value: 'var(--foreground)' },
  { key: 'muted', value: 'var(--muted)' },
  { key: 'accent', value: 'var(--accent)' },
  { key: 'success', value: 'var(--success)' },
  { key: 'warning', value: 'var(--warning)' },
  { key: 'danger', value: 'var(--danger)' },
] as const satisfies ReadonlyArray<{ key: EdgeColorPreset; value: string }>;

export const DEFAULT_EDGE_STYLE = {
  strokeWidth: 3,
  lineStyle: 'solid',
  colorPreset: 'default',
} as const satisfies BoardEdgeStyle;
```

- [ ] **Step 4: Parse and serialize all required fields**

In `src/lib/project-document.ts`, add narrow runtime parsers that report the full field path:

```ts
function parseEdgeStrokeWidth(value: unknown, field: string): EdgeStrokeWidth {
  if (value !== 3 && value !== 6) throw new Error(`${field} must be 3 or 6`);
  return value;
}

function parseEdgeLineStyle(value: unknown, field: string): EdgeLineStyle {
  if (value !== 'solid' && value !== 'dashed') {
    throw new Error(`${field} must be solid or dashed`);
  }
  return value;
}

function parseEdgeColorPreset(value: unknown, field: string): EdgeColorPreset {
  if (!EDGE_COLOR_PRESETS.some((preset) => preset.key === value)) {
    throw new Error(`${field} is not supported`);
  }
  return value as EdgeColorPreset;
}
```

Read these fields in `parseEdge`, include them in its return value, and copy them in both `boardEdgeToDocumentEdge` and `documentEdgeToBoardEdge`. Do not supply fallbacks for missing edge style fields.

In `Siteboard.tsx`, import `DEFAULT_EDGE_STYLE` and spread it into the object passed to `addEdgeToStore` in `handleConnect`. This keeps the app buildable as soon as `BoardEdge` style fields become required; Task 4 will add callbacks/data but must not repeat this defaulting change.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm run test -- src/lib/project-document.test.ts && npm run typecheck`

Expected: Project-document tests pass and strict TypeScript accepts all edge construction sites. If typecheck identifies test-only edge fixtures elsewhere, update those fixtures to use `...DEFAULT_EDGE_STYLE` without changing runtime behavior.

- [ ] **Step 6: Commit the edge contract**

```bash
git add src/types/index.ts src/constants/siteboard.ts src/lib/project-document.ts src/lib/project-document.test.ts src/components/Siteboard/Siteboard.tsx
git commit -m "feat: persist arrow edge styles"
```

### Task 2: Enforce connection-point uniqueness and undoable edge mutations

**Objective:** Replace an existing edge when a later edge uses the same unordered endpoints, inherit its style, and make style/reverse operations immutable no-ops when unchanged.

**Files:**
- Create: `src/lib/siteboard-edge.ts`
- Test: `src/lib/siteboard-edge.test.ts`
- Modify: `src/store/tab-store.ts`
- Modify: `src/store/tab-store.test.ts`

**Interfaces:**
- Consumes: Task 1 edge style types/defaults.
- Produces: `addOrReplaceBoardEdge`, `updateBoardEdgeStyle`, `reverseBoardEdge`, and store action `updateEdgeStyle(edgeId, patch)`.
- Consumed by: Tasks 3–4.

- [ ] **Step 1: Write failing pure edge-operation tests**

Create `src/lib/siteboard-edge.test.ts` with a helper that defaults style via `DEFAULT_EDGE_STYLE`. Cover these exact cases:

1. No matching unordered endpoint pair appends the incoming edge.
2. Re-adding the exact same edge returns `null` and does not create history-worthy work.
3. Adding `B:left → A:right` over `A:right → B:left` leaves one edge with the incoming ID/direction and the old edge’s `strokeWidth: 6`, `lineStyle: 'dashed'`, and `colorPreset: 'danger'`.
4. `A:top → B:bottom` and `A:right → B:left` coexist because their connection points differ.
5. `updateBoardEdgeStyle` patches only the requested fields and returns `null` for a missing edge or identical values.
6. `reverseBoardEdge` swaps both node and handle endpoints, preserves ID/style, and returns `null` for a missing edge.

Use concrete expectations, including source-array immutability:

```ts
expect(next).not.toBe(edges);
expect(edges[0]).toEqual(original);
expect(next).toHaveLength(1);
expect(next?.[0]).toMatchObject({
  id: 'new',
  source: 'b',
  sourceHandle: 'left',
  target: 'a',
  targetHandle: 'right',
  strokeWidth: 6,
  lineStyle: 'dashed',
  colorPreset: 'danger',
});
```

- [ ] **Step 2: Run the pure helper test and confirm RED**

Run: `npm run test -- src/lib/siteboard-edge.test.ts`

Expected: Import/module failures because `siteboard-edge.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure operations**

Create `src/lib/siteboard-edge.ts`. Use endpoint equality that includes both node and nullable handle IDs, compare endpoint pairs in both directions, and replace at the existing array index:

```ts
import type { BoardEdge, BoardEdgeStyle } from '@/types';

function endpointEquals(
  nodeA: string,
  handleA: string | null,
  nodeB: string,
  handleB: string | null,
): boolean {
  return nodeA === nodeB && handleA === handleB;
}

function hasSameDirection(a: BoardEdge, b: BoardEdge): boolean {
  return (
    endpointEquals(a.source, a.sourceHandle, b.source, b.sourceHandle) &&
    endpointEquals(a.target, a.targetHandle, b.target, b.targetHandle)
  );
}

export function hasSameUnorderedEndpoints(a: BoardEdge, b: BoardEdge): boolean {
  return (
    hasSameDirection(a, b) ||
    (endpointEquals(a.source, a.sourceHandle, b.target, b.targetHandle) &&
      endpointEquals(a.target, a.targetHandle, b.source, b.sourceHandle))
  );
}

export function addOrReplaceBoardEdge(
  edges: BoardEdge[],
  incoming: BoardEdge,
): BoardEdge[] | null {
  const index = edges.findIndex((edge) => hasSameUnorderedEndpoints(edge, incoming));
  if (index === -1) return [...edges, incoming];

  const existing = edges[index];
  const replacement: BoardEdge = {
    ...incoming,
    strokeWidth: existing.strokeWidth,
    lineStyle: existing.lineStyle,
    colorPreset: existing.colorPreset,
  };
  if (
    existing.id === replacement.id &&
    hasSameDirection(existing, replacement) &&
    existing.strokeWidth === replacement.strokeWidth &&
    existing.lineStyle === replacement.lineStyle &&
    existing.colorPreset === replacement.colorPreset
  ) {
    return null;
  }

  const next = [...edges];
  next[index] = replacement;
  return next;
}
```

Add the complete style/reverse helpers in the same module:

```ts
export function updateBoardEdgeStyle(
  edges: BoardEdge[],
  edgeId: string,
  style: Partial<BoardEdgeStyle>,
): BoardEdge[] | null {
  const index = edges.findIndex((edge) => edge.id === edgeId);
  if (index === -1) return null;

  const current = edges[index];
  const updated = { ...current, ...style };
  if (
    updated.strokeWidth === current.strokeWidth &&
    updated.lineStyle === current.lineStyle &&
    updated.colorPreset === current.colorPreset
  ) {
    return null;
  }

  const next = [...edges];
  next[index] = updated;
  return next;
}

export function reverseBoardEdge(edges: BoardEdge[], edgeId: string): BoardEdge[] | null {
  const index = edges.findIndex((edge) => edge.id === edgeId);
  if (index === -1) return null;

  const current = edges[index];
  const next = [...edges];
  next[index] = {
    ...current,
    source: current.target,
    sourceHandle: current.targetHandle,
    target: current.source,
    targetHandle: current.sourceHandle,
  };
  return next;
}
```

`updateBoardEdgeStyle` does not permit endpoint/ID changes. `reverseBoardEdge` preserves ID and all style fields through the spread.

- [ ] **Step 4: Confirm the pure tests pass**

Run: `npm run test -- src/lib/siteboard-edge.test.ts`

Expected: All unordered endpoint, style patch, reverse, no-op, and immutability cases pass.

- [ ] **Step 5: Write failing store history/Undo tests**

Extend `src/store/tab-store.test.ts` and initialize `useProjectStore` fresh in each test with a schema-2 document. Add integration assertions:

- `updateEdgeStyle('e1', { strokeWidth: 6 })` changes the edge and adds exactly one `history.past` snapshot; `undoProject()` restores `3`.
- Adding the opposite edge over a styled existing edge produces one incoming-direction edge with inherited style and adds exactly one history snapshot; one `undoProject()` restores the original ID/direction/style.
- Calling `updateEdgeStyle` with the current style does not increase history.
- Calling `reverseEdge` swaps direction, preserves style, and one Undo restores it.

- [ ] **Step 6: Run the store test and confirm RED**

Run: `npm run test -- src/store/tab-store.test.ts`

Expected: Failures because `updateEdgeStyle` is absent and the store still uses old duplicate/reverse logic.

- [ ] **Step 7: Wire helpers through `replaceProjectEdges`**

In `ProjectActions`, add:

```ts
updateEdgeStyle: (edgeId: string, style: Partial<BoardEdgeStyle>) => void;
```

Import the Task 2 helpers. Replace the current inline edge actions with:

```ts
addEdge: (edge) =>
  set((state) => replaceProjectEdges(state, (edges) => addOrReplaceBoardEdge(edges, edge))),

updateEdgeStyle: (edgeId, style) =>
  set((state) =>
    replaceProjectEdges(state, (edges) => updateBoardEdgeStyle(edges, edgeId, style)),
  ),

reverseEdge: (edgeId) =>
  set((state) => replaceProjectEdges(state, (edges) => reverseBoardEdge(edges, edgeId))),
```

Keep `removeEdges` unchanged. Do not add a separate history mechanism: `replaceProjectEdges` already pushes one combined snapshot for every non-null helper result.

- [ ] **Step 8: Run focused tests and verify the intermediate commit builds**

Run: `npm run test -- src/lib/siteboard-edge.test.ts src/store/tab-store.test.ts src/store/project-history.test.ts && npm run typecheck`

Expected: All tests pass; replacement, styling, and reversal each Undo in one step, while no-ops add no history. Strict TypeScript exits 0 before the Task 2 commit.

- [ ] **Step 9: Commit edge state semantics**

```bash
git add src/lib/siteboard-edge.ts src/lib/siteboard-edge.test.ts src/store/tab-store.ts src/store/tab-store.test.ts
git commit -m "feat: manage arrow edge styles and replacement"
```

### Task 3: Render configured arrows and the matching toolbar

**Objective:** Render persisted width/style/color, the selected halo, and a one-row edge toolbar that exactly matches existing node toolbars.

**Files:**
- Create: `src/components/ReactFlowEdges/types.ts`
- Create: `src/components/ReactFlowEdges/ArrowToolbar.tsx`
- Create: `src/components/ReactFlowEdges/arrowGeometry.test.ts`
- Modify: `src/components/ReactFlowEdges/arrowGeometry.ts`
- Modify: `src/components/ReactFlowEdges/ArrowEdge.tsx`
- Modify: `src/components/ReactFlowEdges/ArrowConnectionLine.tsx`

**Interfaces:**
- Consumes: Task 1 style contract and Task 2 callbacks.
- Produces: `ArrowFlowEdgeData`, `ArrowFlowEdge`, appearance helpers, configured SVG rendering, and toolbar controls.
- Consumed by: Task 4 `flowEdges` wiring.

- [ ] **Step 1: Write failing appearance-resolution tests**

Create `arrowGeometry.test.ts` covering exact values:

```ts
expect(getArrowGeometry(3)).toEqual({
  sourceDotRadius: 6,
  arrowLength: 16,
  arrowHalfWidth: 10,
});
expect(getArrowGeometry(6)).toEqual({
  sourceDotRadius: 8,
  arrowLength: 20,
  arrowHalfWidth: 12,
});
expect(getEdgeDashArray(3, 'solid')).toBeUndefined();
expect(getEdgeDashArray(3, 'dashed')).toBe('8 6');
expect(getEdgeDashArray(6, 'dashed')).toBe('12 8');
expect(getEdgeColor('default')).toBe('var(--color-separator-tertiary)');
expect(getEdgeColor('danger')).toBe('var(--danger)');
```

Also assert `EDGE_SELECTION_HALO_EXTRA_WIDTH === 6`, `EDGE_SELECTION_HALO_OPACITY === 0.35`, and `EDGE_TOOLBAR_OFFSET_PX === 8` so rendering code does not grow magic numbers.

- [ ] **Step 2: Run the geometry test and confirm RED**

Run: `npm run test -- src/components/ReactFlowEdges/arrowGeometry.test.ts`

Expected: Missing export failures.

- [ ] **Step 3: Refactor geometry into typed appearance helpers**

In `arrowGeometry.ts`:

- Retain `EDGE_STROKE_WIDTH = 3` as the drag-preview/default alias if existing callers still need it, but derive it from `DEFAULT_EDGE_STYLE.strokeWidth`.
- Replace single-size arrow constants in completed-edge rendering with `getArrowGeometry(width)`.
- Add `getEdgeDashArray(width, lineStyle)` and `getEdgeColor(colorPreset)`.
- Add `EDGE_SELECTION_COLOR = 'var(--accent)'`, `EDGE_SELECTION_HALO_EXTRA_WIDTH = 6`, `EDGE_SELECTION_HALO_OPACITY = 0.35`, and `EDGE_TOOLBAR_OFFSET_PX = 8`.
- Keep handle sizing and `ROTATION_BY_POSITION` unchanged.

Use exhaustive `Record<EdgeStrokeWidth, ...>` and `Record<EdgeColorPreset, string>` maps so adding a type member causes a compile error until its rendering is defined.

- [ ] **Step 4: Confirm geometry tests pass**

Run: `npm run test -- src/components/ReactFlowEdges/arrowGeometry.test.ts`

Expected: All exact geometry, dash, color, halo, and offset assertions pass.

- [ ] **Step 5: Define typed React Flow edge data**

Create `src/components/ReactFlowEdges/types.ts`:

```ts
import type { BoardEdge, BoardEdgeStyle } from '@/types';
import type { Edge } from '@xyflow/react';

export type ArrowFlowEdgeData = {
  edge: BoardEdge;
  isActive: boolean;
  onStyleChange: (edgeId: string, style: Partial<BoardEdgeStyle>) => void;
  onReverse: (edgeId: string) => void;
};

export type ArrowFlowEdge = Edge<ArrowFlowEdgeData, 'default'>;
```

- [ ] **Step 6: Build `ArrowToolbar` with the existing toolbar contract**

Create `ArrowToolbar.tsx` as a memoized component receiving `edge`, `onStyleChange`, and `onReverse`. The root must be:

```tsx
<div
  data-selection-toolbar={edge.id}
  className="nodrag nopan flex -translate-y-2 items-center gap-0.5 rounded-lg bg-zinc-800 px-1 py-0.5 shadow-lg"
>
```

Use the same class constants as existing node toolbars:

```ts
const buttonBase =
  'nodrag flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-medium transition-colors hover:bg-white/20';
const activeClass = 'bg-white/25 text-white';
const inactiveClass = 'text-white/70';
const separatorClass = 'mx-0.5 h-4 w-px bg-white/20';
```

Render groups in this exact order:

1. `EDGE_STROKE_WIDTHS`: two buttons with `aria-label="3px stroke"` / `"6px stroke"` and a centered `w-4 rounded-full bg-current` preview whose height is exactly the option value.
2. Separator.
3. `EDGE_LINE_STYLES`: two buttons with `aria-label="Solid line"` / `"Dashed line"`; render an 18×8 inline SVG line preview, using no dash array for solid and `4 3` for the compact dashed icon.
4. Separator.
5. One reverse button with `aria-label="Reverse direction"` and `<ArrowRightArrowLeft width={14} height={14} />`.
6. Separator.
7. `EDGE_COLOR_PRESETS`: seven buttons with `aria-label={`${key} color`}` and a `size-3.5 rounded-full border border-white/30` swatch using the preset CSS variable.

Do not set `title`, render `Tooltip`, or pass `tooltipMessage`. Each click calls one store callback. Add `onPointerDown={(event) => event.stopPropagation()}` to the root so toolbar interaction does not start canvas selection/pan.

- [ ] **Step 7: Render styles, selection halo, and `EdgeToolbar`**

Change `ArrowEdge` to `EdgeProps<ArrowFlowEdge>` and read `[edgePath, centerX, centerY]` from `getBezierPath`. Because React Flow’s `Edge.data` is optional and Task 4 supplies typed data in the next commit, resolve a safe temporary/runtime fallback before reading appearance:

```ts
const edge = data?.edge ?? {
  id,
  source,
  sourceHandle: sourceHandleId ?? null,
  target,
  targetHandle: targetHandleId ?? null,
  ...DEFAULT_EDGE_STYLE,
};
const canShowToolbar = !!selected && !!data?.isActive;
```

Resolve width, dash, color, and geometry from `edge`. Render the toolbar only when `data` exists; pass callbacks from `data` without non-null assertions.

Render in this order:

1. When selected, a raw non-interactive halo `<path>` behind the edge with configured dash pattern, `stroke: var(--accent)`, `strokeWidth + 6`, opacity `0.35`, `fill="none"`, and `pointerEvents: 'none'`.
2. When selected, source-circle and target-polygon halo shapes behind their configured-color shapes. Circle radius is configured radius + `3`; polygon uses accent fill/stroke with `strokeWidth={6}` and opacity `0.35`.
3. The configured `BaseEdge` with `interactionWidth={40}` and persisted `stroke`, `strokeWidth`, and optional `strokeDasharray` applied after incoming `style` so persisted values win.
4. The configured filled source circle and configured filled/stroked target polygon.
5. When `data` exists, `EdgeToolbar` with `edgeId={id}`, `x={centerX}`, `y={centerY}`, `alignX="center"`, `alignY="bottom"`, and `isVisible={canShowToolbar}`. Render `ArrowToolbar` inside it.

The halo dash pattern must match the edge dash pattern. Do not make the source dot or arrowhead dashed.

- [ ] **Step 8: Keep the connection preview visually unchanged**

Update `ArrowConnectionLine.tsx` to resolve `DEFAULT_EDGE_STYLE` through the new helpers. Its drag preview remains Default color, `3`, solid, source radius `6`, arrow length `16`, and full arrow width `20`.

- [ ] **Step 9: Run focused tests and static checks**

Run: `npm run test -- src/components/ReactFlowEdges/arrowGeometry.test.ts && npm run typecheck && npm run lint`

Expected: Geometry tests pass, typed edge component compiles against React Flow 12.10.1, and lint reports no errors. Existing arrows still render from `DEFAULT_EDGE_STYLE`; `ArrowEdge` does not display its toolbar yet because Task 4 has not supplied data, and the explicit fallback prevents an intermediate-commit runtime crash.

- [ ] **Step 10: Commit rendering and toolbar components**

```bash
git add src/components/ReactFlowEdges/types.ts src/components/ReactFlowEdges/ArrowToolbar.tsx src/components/ReactFlowEdges/arrowGeometry.ts src/components/ReactFlowEdges/arrowGeometry.test.ts src/components/ReactFlowEdges/ArrowEdge.tsx src/components/ReactFlowEdges/ArrowConnectionLine.tsx
git commit -m "feat: render arrow edge style toolbar"
```

### Task 4: Integrate total selection, context menu, Webview occlusion, and documentation

**Objective:** Supply edge data/callbacks, enforce exactly-one-total-element toolbar visibility, reduce the edge context menu to delete, and make edge toolbar occlusion demote native Webviews.

**Files:**
- Create: `src/lib/siteboard-selection.ts`
- Test: `src/lib/siteboard-selection.test.ts`
- Modify: `src/components/Siteboard/Siteboard.tsx`
- Modify: `src/hooks/siteboard/useSiteboardContextMenus.ts`
- Modify: `src/hooks/siteboard/useSiteboardDisplayEngine.ts`
- Modify: `src/hooks/siteboard/display-engine/dom.ts`
- Modify: `src/components/ReactFlowNodes/WebPageToolbar.tsx`
- Modify: `src/components/ReactFlowNodes/StickyNoteToolbar.tsx`
- Modify: `src/components/ReactFlowNodes/TextNodeToolbar.tsx`
- Modify: `docs/agents/architecture.md`
- Modify: `docs/agents/domain-models.md`
- Modify: `docs/agents/coding-rules.md`
- Modify: `docs/agents/siteboard-runtime.md`

**Interfaces:**
- Consumes: all prior task contracts.
- Produces: complete user-facing behavior and updated canonical documentation.

- [ ] **Step 1: Write failing total-selection tests**

Create `src/lib/siteboard-selection.test.ts` for a pure resolver with this contract:

```ts
resolveActiveSelection(selectedNodeIds: string[], selectedEdgeIds: ReadonlySet<string>): {
  activeNodeId: string | null;
  activeEdgeId: string | null;
}
```

Assert `resolveActiveSelection` cases:

- no selection → both null;
- one node only → that node active;
- one edge only → that edge active;
- two nodes → both null;
- two edges → both null;
- one node + one edge → both null.

Also specify `retainLiveSelectedIds(selectedIds: ReadonlySet<string>, liveIds: ReadonlySet<string>): Set<string>`:

- keeps selected IDs that still exist;
- removes IDs deleted directly, cascaded by node deletion, or replaced with a new edge ID;
- returns an empty set when no selected edge remains.

- [ ] **Step 2: Run the selection test and confirm RED**

Run: `npm run test -- src/lib/siteboard-selection.test.ts`

Expected: Missing module/export failure.

- [ ] **Step 3: Implement the minimal selection resolver**

Create `src/lib/siteboard-selection.ts`:

```ts
export function resolveActiveSelection(
  selectedNodeIds: string[],
  selectedEdgeIds: ReadonlySet<string>,
): { activeNodeId: string | null; activeEdgeId: string | null } {
  if (selectedNodeIds.length + selectedEdgeIds.size !== 1) {
    return { activeNodeId: null, activeEdgeId: null };
  }
  if (selectedNodeIds.length === 1) {
    return { activeNodeId: selectedNodeIds[0], activeEdgeId: null };
  }
  return {
    activeNodeId: null,
    activeEdgeId: selectedEdgeIds.values().next().value ?? null,
  };
}

export function retainLiveSelectedIds(
  selectedIds: ReadonlySet<string>,
  liveIds: ReadonlySet<string>,
): Set<string> {
  return new Set(Array.from(selectedIds).filter((id) => liveIds.has(id)));
}
```

Run: `npm run test -- src/lib/siteboard-selection.test.ts`

Expected: All six active-selection cases and all stale-ID pruning cases pass.

- [ ] **Step 4: Wire default creation, style callbacks, and typed `flowEdges`**

In `Siteboard.tsx`:

- Move `selectedEdgeIds` state initialization before active-selection derivation.
- Derive `{ activeNodeId, activeEdgeId }` with `resolveActiveSelection`.
- Add a cleanup effect matching `Project.tsx`’s existing node-selection pattern: build `liveEdgeIds` from `edges`, call `retainLiveSelectedIds`, and when the size changes use `queueMicrotask(() => setSelectedEdgeIds(filtered))` rather than synchronous `setState` in the effect. This must remove stale selections after direct edge deletion, node-cascade deletion, same-point replacement with a new edge ID, Undo, or Redo.
- Select `updateEdgeStyle` from the Zustand store.
- Keep the `DEFAULT_EDGE_STYLE` spread added to `handleConnect` in Task 1.
- Remove the now-redundant `defaultEdgeOptions.style.strokeWidth`; keep `{ type: 'default' }` only.
- Type `flowEdges` as `ArrowFlowEdge[]` and pass data for every edge:

```ts
data: {
  edge,
  isActive: edge.id === activeEdgeId,
  onStyleChange: updateEdgeStyle,
  onReverse: reverseEdge,
},
```

- Preserve controlled `selected: selectedEdgeIds.has(edge.id)`.
- Include `activeEdgeId`, `updateEdgeStyle`, and `reverseEdge` in `useMemo` dependencies.
- Do not change connection validity, handle positions, or edge deletion keyboard behavior.

- [ ] **Step 5: Make context menus single-kind and delete-only**

In `useSiteboardContextMenus.ts`:

- Remove `reverseEdge` from params and dependencies.
- On edge context menu, call `setSelection([])` and `setSelectedEdgeIds(new Set([edge.id]))` before opening the menu.
- Build exactly one item: `Delete Arrow`, accelerator `Backspace`, action `removeEdges([edge.id])`. Do not add a separator.
- On node context menu, clear `selectedEdgeIds` before applying node selection so right-click cannot leave a mixed toolbar state. Add `setSelectedEdgeIds` to `handleNodeContextMenu`’s `useCallback` dependency array; `react-hooks/exhaustive-deps` is enforced.
- Keep Webview context-menu preparation only for webpage nodes; edge native menus still must not call `handleContextMenuOpen`.
- Remove the obsolete `reverseEdge` argument at the `Siteboard.tsx` call site. Keep `reverseEdge` selected from the store for `ArrowToolbar` data.

- [ ] **Step 6: Generalize selection-toolbar Webview occlusion**

Rename the DOM contract everywhere:

- `data-node-toolbar` → `data-selection-toolbar` in `WebPageToolbar`, `StickyNoteToolbar`, and `TextNodeToolbar`.
- Query `[data-selection-toolbar]` and read that attribute in `getSelectionToolbarRects`.
- Keep `SelectionToolbarRect.ownerId`; edge IDs naturally differ from webpage node IDs, so an overlapping edge toolbar is never excluded as the webpage’s own toolbar.
- In `useSiteboardDisplayEngine`, rename optional `selectedNodeIds` input to `selectedElementIds`. It is used only to create the selection-change key.
- In `Siteboard.tsx`, memoize `selectedElementIds = [...selectedNodeIds, ...selectedEdgeIds]` and pass it to the display engine.
- Keep the existing requestAnimationFrame recomputation after selection changes. This ensures the `EdgeToolbar` portal DOM has mounted before overlap rectangles are measured.

Do not alter `isToolbarOccluded`, capture ordering, demotion rules, or native restoration; the existing pure mode tests must continue to pass unchanged.

- [ ] **Step 7: Update canonical agent documentation**

Apply these exact documentation changes:

- `architecture.md`: describe `ArrowToolbar.tsx`; update `ArrowEdge.tsx` to persisted width/style/color + selection halo + midpoint `EdgeToolbar`; update `tab-store.ts` with `updateEdgeStyle` and unordered endpoint replacement.
- `domain-models.md`: add all `BoardEdge` / `SiteboardDocumentEdge` style fields and unions; document defaults, required schema-2 persistence, `updateEdgeStyle`, style-preserving reverse, one-history-step replacement, and the unordered `(nodeId, handleId)` pair uniqueness invariant. State that no pre-release compatibility fallback is supported for missing edge styles.
- `coding-rules.md`: replace selected-color substitution with configured color + accent halo; document exact widths/geometries/dashes/colors, toolbar order/visibility/design/no-tooltip rule, delete-only context menu, and same-point replacement with style inheritance. Explicitly state edge ordering remains unsupported.
- `siteboard-runtime.md`: rename the DOM marker to `data-selection-toolbar`, describe both node and edge toolbar collection, and state that changes in either selected node IDs or selected edge IDs schedule overlap recomputation.

Do not add temporary implementation notes or duplicate the same normative rule across unrelated documents.

- [ ] **Step 8: Run focused and complete automated validation**

Run in order:

```bash
npm run test -- src/lib/siteboard-selection.test.ts src/lib/siteboard-edge.test.ts src/lib/project-document.test.ts src/store/tab-store.test.ts src/components/ReactFlowEdges/arrowGeometry.test.ts src/hooks/siteboard/display-engine/mode.test.ts
npm run lint
npm run format
npm run typecheck
npm run test
```

Expected:

- Focused tests prove selection exclusivity, endpoint replacement, style persistence/history, exact geometry/dashes/colors, and unchanged occlusion demotion logic.
- `lint`, `format`, and `typecheck` exit 0.
- Full Vitest suite exits 0 with all test files passing.

If `npm run format` reports differences, run `npm run format:fix` only on the implementation branch, inspect the diff, then rerun `npm run format`; do not weaken formatting rules.

- [ ] **Step 9: Perform manual Tauri UI verification**

Run: `npm run dev`

Verify all of the following in the desktop app:

1. Create two webpage nodes and connect them. A new arrow is Default color, `3`, solid, with the current `6`-radius dot and `16×20` arrowhead.
2. Select only the arrow. One toolbar appears at the Bezier midpoint, entirely above it with about `8px` visual gap.
3. Check zoom `25%`, `100%`, and `150%`: toolbar buttons remain the same screen size and the toolbar follows pan/zoom.
4. Confirm visual/control order is width → line style → reverse → seven colors, all in one row.
5. Confirm the toolbar matches node toolbars in height, spacing, background, rounded corners, shadow, separators, active/inactive treatment, and hover treatment.
6. Hover every control long enough to confirm no HeroUI or browser tooltip appears. Inspect that every button remains keyboard/screen-reader named via `aria-label`.
7. Choose `6`: path becomes twice as thick, source radius becomes `8`, and arrowhead becomes `20×24`; choose `3` to restore exact defaults.
8. Choose dashed at each width and confirm the visual patterns are `8 6` and `12 8`; dot and arrowhead remain filled.
9. Select every color preset in both light and dark themes. Configured color remains visible while selected; the semi-transparent accent halo remains outside it.
10. Reverse direction. Source dot/target arrowhead and attached handles swap while width, line style, color, edge ID selection, and toolbar visibility remain stable. Undo/Redo reverses exactly one operation.
11. Style an edge Danger + `6` + dashed. Draw the same two connection points from the opposite side. Only the later direction remains, it inherits Danger + `6` + dashed, and one Undo restores the prior edge/direction.
12. Connect the same two nodes using a different pair of handles and confirm both arrows coexist.
13. Select two arrows, two nodes, or one node plus one arrow with Shift. No node or edge style toolbar appears. Return to one edge selection and confirm its toolbar returns.
14. Right-click an arrow. The native menu contains only `Delete Arrow`; no reverse or ordering items appear. Right-clicking also makes that edge the only selected element.
15. Delete with the context menu and with Backspace/Delete. Confirm the deleted edge’s selection is pruned and selecting one node immediately shows its node toolbar. One Undo restores the edge and its style without resurrecting a stale edge selection.
16. Position/select an arrow so its toolbar overlaps a native Webview. Confirm the overlapping webpage switches to screenshot/hidden so the toolbar stays visible, then returns to native after selection/overlap ends.
17. Save and reopen a `.siteboard` file. Width, line style, color, endpoints, and direction round-trip. Changing any style marks the document dirty; saving clears dirty state.
18. Confirm connecting, selecting, panning, zooming, node toolbars, and existing webpage/付箋/text interactions still work.

Stop the dev process after verification.

- [ ] **Step 10: Commit the integration and documentation**

```bash
git add src/lib/siteboard-selection.ts src/lib/siteboard-selection.test.ts src/components/Siteboard/Siteboard.tsx src/hooks/siteboard/useSiteboardContextMenus.ts src/hooks/siteboard/useSiteboardDisplayEngine.ts src/hooks/siteboard/display-engine/dom.ts src/components/ReactFlowNodes/WebPageToolbar.tsx src/components/ReactFlowNodes/StickyNoteToolbar.tsx src/components/ReactFlowNodes/TextNodeToolbar.tsx docs/agents/architecture.md docs/agents/domain-models.md docs/agents/coding-rules.md docs/agents/siteboard-runtime.md
git commit -m "feat: integrate arrow edge toolbar"
```

## Validation

- `npm run test -- src/lib/project-document.test.ts` — required edge styles parse and round-trip; invalid/missing values fail.
- `npm run test -- src/lib/siteboard-edge.test.ts src/store/tab-store.test.ts` — unordered same-point replacement, style inheritance, no-op behavior, reverse, history, and Undo pass.
- `npm run test -- src/components/ReactFlowEdges/arrowGeometry.test.ts` — exact geometry, dashes, palette mapping, halo, and toolbar offset pass.
- `npm run test -- src/lib/siteboard-selection.test.ts` — exactly-one-total-element selection and stale edge-ID pruning rules pass.
- `npm run test -- src/hooks/siteboard/display-engine/mode.test.ts` — existing toolbar/Webview demotion behavior remains green.
- `npm run lint` — no ESLint errors.
- `npm run format` — no Prettier differences.
- `npm run typecheck` — strict TypeScript passes with typed React Flow edge data.
- `npm run test` — complete Vitest suite passes.
- Manual Tauri checklist in Task 4 — required because React components and native Webview layering are intentionally not covered by automated DOM tests.

## Risks, Tradeoffs, and Open Questions

- `EdgeToolbar` is the preferred React Flow 12.10.1 API because it supplies inverse-zoom positioning and interactive portal behavior. Do not hand-roll `EdgeLabelRenderer` transforms unless the installed API is proven defective.
- Schema version 2 is changed in place and old styled-edge-less files may fail to load. This is intentional because the product is unreleased and the user explicitly excluded compatibility work.
- The full one-row toolbar is intentionally wide. Do not replace it with popovers or tooltips; that would contradict the selected UX.
- Selection halo constants (`+6`, opacity `0.35`, circle `+3`) and the `8px` toolbar gap are implementation values fixed by this plan to avoid leaving visual guesswork. If visual verification shows clipping, adjust only these named constants and rerun geometry/static checks; do not change persisted style values.
- Edge ordering relative to edges or nodes is out of scope. All arrows remain in React Flow’s existing edge layer behind nodes.
- Existing `interactionWidth={40}` stays unchanged for reliable edge selection even when the visible stroke is `3`.
- No open questions block implementation.
