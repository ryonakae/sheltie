# MCP contract

## Availability and scope

The user enables the server from **Sheltie > Settings > MCP Server**. The local Streamable HTTP endpoint is `http://127.0.0.1:29978/mcp`; it binds only to loopback. This initial release runs only on macOS and only controls WebPage nodes already embedded in open Sheltie documents. On another platform, browser tools return `unsupported_platform`—do not emulate them with an external browser.

A connection is trusted by design. While the server is enabled, its connected local MCP client can read and operate board content and all embedded WebPages, including authenticated pages. Semantic snapshots omit password/OTP values and cookie/local/session storage, but `browser_evaluate` executes in the page origin and may read JavaScript state visible to that page. Never represent this as sandboxed or permission-scoped access.

## IDs and response conventions

Start with `list_documents({})`; choose a returned opaque `documentId` (currently an open `document-*` window label). Call `get_editor_state({ documentId })` before working in that document. Focused-document metadata is informational only.

Every board write includes `documentId`. Every page tool includes both `documentId` and `pageNodeId`. For semantic element actions, the chain is:

`documentId → pageNodeId → snapshotId → elementRef`

A successful snapshot or action result has a new current snapshot. Reuse `elementRef` only from that page's newest successful snapshot. On `stale_element`, call `browser_snapshot({ documentId, pageNodeId })` and select a fresh ref; do not retry the previous ref.

JSON results appear in `structuredContent` and compatible text content. Image tools return metadata plus PNG image blocks. Errors have `{ code, message, retry? }`; use the stated retry rather than guessing a target.

## Exact board and overview calls

| Tool | Exact arguments and constraints |
| --- | --- |
| `list_documents` | No arguments. |
| `get_editor_state` | `{ documentId }`. |
| `get_board` | `{ documentId, nodeIds?, nodeTypes?, includeEdges? }`. `nodeIds`, when supplied, is an array of non-empty IDs; omit it for all matching nodes. `nodeTypes` values are `webpage`, `stickynote`, or `text`. `includeEdges` is boolean and defaults to `true`. |
| `batch_edit_board` | `{ documentId, operations }`; `operations` must be an array. See the board reference for operation shapes. |
| `focus_nodes` | `{ documentId, nodeIds }`; `nodeIds` is a non-empty array of non-empty live node IDs. |
| `get_webpage_screenshots` | `{ documentId, pageNodeIds? }`; omit `pageNodeIds` for WebPages in board order; supplied IDs must be non-empty strings. Each result is `freshness: "cached"` with an image or `freshness: "missing"` with no image. |
| `get_board_screenshot` | `{ documentId, nodeIds? }`; omit `nodeIds` for the whole board. A supplied list contains non-empty IDs and may not be empty. |

`cached` is an existing cached image; `missing` means none exists. Neither status authorizes revealing hidden/offscreen WebPages to force a recapture. Board screenshots include `missingScreenshotNodeIds` so report incomplete composition plainly.

## Exact browser calls

All browser tools require `{ documentId, pageNodeId }` as shown below.

| Tool | Exact additional arguments and constraints |
| --- | --- |
| `browser_snapshot` | No additional arguments. |
| `browser_navigate` | `{ url }`, an absolute `http` or `https` URL. |
| `browser_go_back`, `browser_go_forward`, `browser_reload` | No additional arguments. |
| `browser_click`, `browser_hover` | `{ snapshotId, elementRef }` from the newest snapshot. |
| `browser_fill` | `{ snapshotId, elementRef, text }`; `text` is at most 10,000 UTF-16 code units. |
| `browser_fill_form` | `{ snapshotId, fields }`; `fields` is non-empty and each `{ elementRef, text }` has a distinct ref and text at most 10,000 UTF-16 code units. |
| `browser_select_option` | `{ snapshotId, elementRef, values }`; `values` contains 1–50 non-empty strings. |
| `browser_press_key` | `{ key }`; 1–64 UTF-16 code units. |
| `browser_scroll` | `{ deltaX, deltaY }`; each signed integer is from `-10000` through `10000`. |
| `browser_wait` | `{ condition, timeoutMs? }`; `timeoutMs` defaults to 5000 and is at most 10000. `condition` is one of `{ kind: "time", milliseconds }`, `{ kind: "url", contains }`, `{ kind: "selector", selector }`, or `{ kind: "text", text }`. |
| `browser_screenshot` | `{ mode, annotate, snapshotId?, elementRef? }`; `mode` is `viewport`, `element`, or `fullPage`. `annotate` defaults to `false`. `element` requires non-empty `snapshotId` and `elementRef`; those arguments are invalid for other modes. |
| `browser_click_coordinates` | `{ snapshotId, x, y, button, clickCount, highlight? }`; `x`/`y` are finite CSS viewport coordinates; `button` is `left`, `middle`, or `right` (default `left`); `clickCount` is 1 or 2 (default 1); optional `highlight` is `{ x, y, width, height }` with finite, non-negative dimensions. |
| `browser_evaluate` | `{ script }`; the non-empty script must return a JSON-safe value no larger than 256 KiB and settle within 10 seconds. |
| `browser_upload_file` | `{ snapshotId, elementRef, paths }`; `paths` is a non-empty list of absolute paths. The client may supply at most 10 canonical regular files, each up to 25 MiB and 100 MiB total. |
| `browser_handle_dialog` | `{ action, promptText? }`; `action` is `accept` or `dismiss`; `promptText` is valid only with `accept`. |

Browser actions are serialized per page, and successful actions return a fresh compact snapshot after settling. `browser_screenshot` on a hidden/screenshot WebPage can use a cached `viewport` image but cannot capture `element` or `fullPage` without a live native WebView. Coordinate clicks and upload events report `inputTrusted: false`.
