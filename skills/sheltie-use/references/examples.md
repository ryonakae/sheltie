# Examples

Use IDs returned during the current session. The IDs below are placeholders, not values to invent.

## Compare pages and create linked findings

1. Call `list_documents({})`, then `get_editor_state({ documentId })` and `get_board({ documentId, includeEdges: true })`.
2. Call `get_webpage_screenshots({ documentId, pageNodeIds: [productAId, productBId, productCId] })` and `get_board_screenshot({ documentId })`. Report that the first two images are `cached` and the third is `missing`; do not reveal the third page to manufacture an image.
3. Read the two target pages with `browser_snapshot({ documentId, pageNodeId: productAId })` and the equivalent call for `productBId`.
4. Create both notes and style the existing WebPage-to-WebPage comparison edge in one batch. Notes cannot be edge endpoints, so include source page titles/URLs in their content instead:

```json
{
  "documentId": "documentId",
  "operations": [
    {
      "op": "create_node",
      "tempId": "finding-a",
      "node": { "type": "stickynote", "title": "Product A", "content": "Price and availability finding" }
    },
    {
      "op": "create_node",
      "tempId": "finding-b",
      "node": { "type": "stickynote", "title": "Product B", "content": "Price and availability finding" }
    },
    {
      "op": "update_edge",
      "edgeId": "existingProductComparisonEdgeId",
      "patch": { "colorPreset": "warning", "lineStyle": "dashed", "strokeWidth": 6 }
    }
  ]
}
```

If `get_board` returned no comparison edge, use one `create_edge` from `productAId` to `productBId` instead; do not connect either note. Check `tempIdMap` and result IDs. Do not focus nodes unless the user asks to reveal them; explain that the board remains unsaved.

## Complete a semantic form

1. Call `browser_snapshot({ documentId, pageNodeId })` and find the labelled plan control and text field in `snapshot.elements`.
2. Call `browser_select_option({ documentId, pageNodeId, snapshotId, elementRef, values: ["pro"] })` using the first snapshot's values.
3. From that action's returned snapshot, obtain the new text-field ref. Call `browser_fill({ documentId, pageNodeId, snapshotId, elementRef, text: "Ada" })`.
4. From the fill result's snapshot, obtain the submit-button ref and call `browser_click({ documentId, pageNodeId, snapshotId, elementRef })`.
5. Verify the confirmation in the click result's snapshot. If needed, add one note through `batch_edit_board({ documentId, operations: [...] })`; do not use a stale initial ref or a coordinate click.

## Use a canvas-only control

1. Call `browser_snapshot({ documentId, pageNodeId })` and record the explanatory heading. Confirm the latest `snapshot.elements` has no semantic target for the canvas control.
2. Call `browser_screenshot({ documentId, pageNodeId, mode: "viewport", annotate: false })`.
3. Call `browser_click_coordinates({ documentId, pageNodeId, snapshotId, x, y, button: "left", clickCount: 1 })` with the screenshot-derived CSS viewport coordinate.
4. Inspect the returned fresh snapshot, then record the outcome in one `batch_edit_board` call. Do not use `browser_evaluate` when this visual path works.

## Reveal a result only on request

When the user says, “show me the note you added,” first create and validate it in `batch_edit_board`. Obtain its actual ID from `createdNodeIds` or `tempIdMap`, then call:

```json
{ "documentId": "documentId", "nodeIds": ["createdNoteId"] }
```

with `focus_nodes`. This is legitimate because the user explicitly requested a view change. A request merely to add or summarize a note is not enough.
