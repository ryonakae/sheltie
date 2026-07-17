---
name: sheltie-use
description: Use this skill whenever a user asks to inspect, compare, research, navigate, interact with, or organize WebPage nodes already open on a Sheltie board through an AI or MCP client—even when they only ask to compare several open sites or turn findings into linked board notes. Do not use it to implement Sheltie, automate Chrome or another external browser, or create standalone design-tool work.
compatibility: Requires Sheltie on macOS with its user-enabled local MCP server and WebPage nodes already open in a Sheltie document.
---

# Sheltie WebPage workflow

Operate only WebPage nodes already embedded in an open Sheltie document. This is a macOS-only workflow; do not substitute Chrome, Playwright, a browser extension, or an external browser.

Read the relevant reference before acting:

- Read [MCP contract](references/mcp-contract.md) to connect, select IDs, understand trust, or recover from errors.
- Read [Overview and board](references/overview-and-board.md) to compare pages, interpret overview images, create notes or edges, or decide whether focus is allowed.
- Read [Browser actions](references/browser-actions.md) to navigate or interact with a page, capture an image, handle an upload or dialog, or consider coordinates/evaluation.
- Read [Examples](references/examples.md) for an end-to-end pattern matching the request.

## Guardrails

- Ask the user to enable **Sheltie > Settings > MCP Server** if the local endpoint is unavailable. Do not enable it on their behalf.
- Treat a connected client as trusted. It can read and act on all open embedded WebPages and board content, including authenticated pages. Do not claim that authentication, secrets, or page state are isolated from this connection.
- `browser_evaluate` runs JavaScript in a trusted page origin and can read JavaScript state visible to that page. Use it only as the final fallback, and never imply it bypasses the trust boundary.
- Use IDs returned by tools, never names or the focused tab as a target. Explicit `documentId` prevents a user tab switch from retargeting a write; page actions also require `pageNodeId`.
- There is no save, Save As, board-export, or production trace MCP tool. Board edits leave the document dirty; saving remains the user's action.

## Default workflow

1. Call `list_documents`, select the requested open document, then call `get_editor_state` with its `documentId`. This establishes explicit scope without treating focus metadata as permission to write.
2. Call `get_board` with that `documentId`. For a comparison, call both `get_webpage_screenshots` and `get_board_screenshot` before narrow page work: cached page images show relationships across sites, while the board image adds layout, notes, and edges.
3. Report overview evidence accurately. `cached` is an existing image, not a new capture; `missing` means no cached image exists. Do not reveal, move, resize, navigate, or otherwise force a hidden WebPage into view merely to obtain an image.
4. For a specific page, call `browser_snapshot` first. Keep the returned `snapshotId` and use only its `elementRef` values. A newer successful snapshot replaces every older ref; this prevents stale actions. On `stale_element`, snapshot again rather than retrying an old ref.
5. Prefer semantic actions in this order: navigation; click or hover; fill/fill-form; select; key; scroll; wait. Typed controls preserve the page's semantic intent and make the result inspectable. After every action that returns a snapshot, inspect that snapshot before the next action.
6. Use `browser_screenshot` and then `browser_click_coordinates` only when the current semantic snapshot exposes no target. Coordinates are CSS viewport coordinates and synthetic input is untrusted.
7. Use `browser_evaluate` only when neither semantic controls nor the coordinate path can express the task. Keep its script bounded and report its result as page-visible state, not privileged application state.
8. Plan all related board changes before calling `batch_edit_board`, then send one complete `operations` array. Atomic validation preserves one Undo entry; if it fails, report the error and do not issue compensating partial writes.
9. Call `focus_nodes` only when the user explicitly asks to show, reveal, or focus the result. It changes selection and viewport, so ordinary research and edits must leave the user's view alone.
10. State findings, source limitations (`cached`/`missing`), actions performed, and that any board edit is unsaved for the user to save if desired.

## Action decision

- Need document, selection, node, or overview context: use the overview-and-board reference.
- Need a page control: snapshot, select a fresh semantic ref, and use the browser-actions reference.
- Cannot find a semantic control: verify that absence in the latest snapshot; capture a screenshot before coordinate interaction.
- Need to change board content: use one atomic batch with explicit IDs; never use focus as an implicit result-selection step.
- Encounter a validation, document, page, or stale-reference error: refresh only the necessary read and retain the user's unchanged board/view.
