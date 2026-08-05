# Overview and board edits

## Read the board before narrowing the task

1. Call `list_documents({})`, choose the requested returned `documentId`, then call `get_editor_state({ documentId })`. The explicit ID prevents a later tab switch from changing the target.
2. Call `get_board({ documentId, includeEdges: true })` to identify real node IDs, node types, existing notes, and edges. For a filtered read, use `nodeIds` and/or `nodeTypes` (`webpage`, `stickynote`, `text`); omitting them reads all eligible nodes.
3. For a multi-page comparison, call both `get_webpage_screenshots({ documentId, pageNodeIds? })` and `get_board_screenshot({ documentId, nodeIds? })`. Page screenshots give cached cross-site evidence; the board image supplies placement, notes, and connecting edges that page images cannot show.

Treat `freshness: "cached"` as an available prior image and `freshness: "missing"` as absent evidence. State the limitation and continue with available information or a targeted live page read; do not move hidden WebPages into view to populate a cache. `get_board_screenshot` reports `missingScreenshotNodeIds`, which is also a reporting obligation.

## Plan one board mutation

Use exactly one `batch_edit_board({ documentId, operations })` for related changes. The full array validates before any mutation, resolves same-batch `tempId` references in order, applies all changes once, and creates one Undo entry. If it returns `validation_failed`, no partial state has been applied: report the error rather than issuing compensating mutations.

Valid operations use these exact shapes:

```json
{ "op": "create_node", "tempId": "finding-a", "node": { "type": "stickynote", "title": "Finding", "content": "…" } }
{ "op": "update_node", "nodeId": "existing-node-id", "patch": { "type": "stickynote", "title": "…" } }
{ "op": "delete_node", "nodeId": "existing-node-id" }
{ "op": "create_edge", "tempId": "link-a", "edge": { "source": "finding-a", "sourceHandle": "right", "target": "webpage-id", "targetHandle": "left" } }
{ "op": "update_edge", "edgeId": "existing-edge-id", "patch": { "colorPreset": "accent" } }
{ "op": "delete_edge", "edgeId": "existing-edge-id" }
{ "op": "reverse_edge", "edgeId": "existing-edge-id" }
{ "op": "reorder_node", "nodeId": "existing-node-id", "position": "front" }
```

- `tempId` is non-empty and unique within the batch. Later operations may refer to a preceding temporary node or edge ID.
- `create_node.node.type` is `webpage`, `stickynote`, or `text`. Coordinates and dimensions are optional; omit them when automatic placement is appropriate. Use only fields valid for the chosen type.
- `create_edge.edge.source` and `target` are existing WebPage IDs or preceding temp IDs for WebPages. Edges connect two different WebPage nodes; sticky-note and text nodes cannot be edge endpoints. `sourceHandle` and `targetHandle` are `top`, `right`, `bottom`, or `left`.
- `update_node.patch` must include the existing node's `type` and only fields valid for that type. `update_edge.patch` accepts `strokeWidth` (`3` or `6`), `lineStyle` (`solid` or `dashed`), and `colorPreset`. `reorder_node` applies only to non-WebPage nodes; `position` is `front`, `forward`, `backward`, or `back`.

Check the response's `changed`, created/updated/deleted ID lists, and `tempIdMap` before reporting success. The document is now dirty; do not call or suggest a nonexistent save tool. Say that the user can save through Sheltie's normal UI.

## Preserve selection and viewport

Reads and `batch_edit_board` do not select, fit, or pan. Call `focus_nodes({ documentId, nodeIds })` only if the user explicitly asks to **show**, **reveal**, or **focus** the result. Its `nodeIds` must name live nodes. It selects those nodes and fits the viewport, but does not alter board content, Undo history, or dirty state. An implicit wish to know what changed is not an explicit request to move the user's view.
