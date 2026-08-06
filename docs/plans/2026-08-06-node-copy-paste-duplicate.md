# Node Copy/Paste & Alt-Drag Duplicate Implementation Plan

> **For implementers:** Execute the child plans in order. Update this progress list when each child plan is completed and verified.

**Goal:** Let users copy/cut/paste/duplicate board nodes (Cmd+C / Cmd+X / Cmd+V / Cmd+D) across document windows via the system clipboard, and duplicate nodes FigJam-style by holding Alt while dragging.

**Architecture:** Clipboard payloads reuse the `.sheltie` document node/edge serialization (`SheltieDocumentNode` / `SheltieDocumentEdge`) and its validation as the single trust boundary. macOS `NSPasteboard` is accessed through new Rust commands that write two representations (a custom UTI JSON payload plus human-readable plain text). Paste placement, clipboard payload handling, and alt-drag duplication are pure, unit-tested TypeScript modules; store mutation goes through one new `insertBoardContent` action that records a single history entry.

**Tech Stack:** Tauri v2 (Rust, objc2-app-kit), React 19, TypeScript, Zustand, @xyflow/react v12, Vitest.

## Shared Decisions (from design dig)

- System clipboard only; payload written as custom pasteboard type `com.sheltie.board-nodes` + `public.utf8-plain-text` (webpage → URL, sticky note → content, text node → extracted plain text, newline-joined).
- Paste accepts **only** the Sheltie payload. No URL-to-node or text-to-node creation.
- Clipboard data is untrusted input: parsing reuses the exact node/edge validators behind `parseProjectDocument`. Any violation rejects the whole paste silently (no crash).
- Copy includes edges whose both endpoints are in the selection (style included). Edge-only copy is not supported.
- Paste regenerates all IDs and remaps edge endpoints. `url` / `addedUrl` / title / `[Moved]` state are copied faithfully.
- Paste anchor priority (FigJam-style, all checks against the current viewport):
  1. last-pasted nodes of the same payload alive & visible → cascade another +20/+20 from them;
  2. living source nodes visible → +20/+20 from their current bounding box;
  3. original coordinates visible (cut/deleted source) → paste at the original coordinates as-is;
  4. otherwise → center the group's bounding box on the viewport center.
- Offset unit is world-fixed `DRAG_REPOSITION_GAP` (20px).
- WebViews must never overlap: when the pasted group contains a webpage node (or would cover an existing webpage), slide the whole group rigidly toward bottom-right in 20px steps until the existing gap rules hold (webpage vs all nodes ≥ 20px; sticky/text vs webpage ≥ 20px). Relative layout inside the group is always preserved.
- Same-document duplicates (paste, Cmd+D, alt-drag) seed the new node's runtime screenshot cache entry from the source node so webpage duplicates appear instantly. Cross-window pastes do not seed.
- Cmd+D duplicates the selection in place (no clipboard I/O) using the same placement pipeline.
- Alt-drag: decision at drop time (pressing/releasing Alt mid-drag toggles a static ghost clone at the original position). The dragged element becomes the **new** node; the original never moves, so its edges stay attached to it. Edges fully inside the dragged selection are cloned. Both drag paths (React Flow native + WebPage title-row pointer drag) support it.
- Each paste/duplicate/alt-drop is exactly one history entry and selects the newly created nodes.
- Menu/keyboard wiring follows the existing Undo/Redo/Delete pattern: custom Edit-menu items emitting `edit-command` events + a JS keydown complement, with `hasEditableFocus` deferring to native text editing behavior.
- Node context menu gains Cut / Copy items. No board-background "Paste Here" menu.

## Progress

- [ ] [Phase 1 — Clipboard foundation (Rust NSPasteboard commands + payload library)](2026-08-06-node-copy-paste-duplicate/phase-1-clipboard-foundation.md)
- [ ] [Phase 2 — Copy / Cut / Paste / Duplicate commands and placement](2026-08-06-node-copy-paste-duplicate/phase-2-copy-paste-commands.md)
- [ ] [Phase 3 — Alt-drag duplicate](2026-08-06-node-copy-paste-duplicate/phase-3-alt-drag-duplicate.md)

## Assumptions to verify during implementation

- With focus in an editable element (URL input, Tiptap), WKWebView consumes Cmd+C/X/V before the app menu accelerator fires, so native text copy/paste keeps working after the predefined menu items are replaced. Verify manually in Phase 2 Task 4; if it does not hold, the fallback is to perform the native operation from the JS handler (`document.execCommand('copy'/'cut')` and a Rust plain-text read + programmatic insert for paste).
- `objc2-app-kit`'s `NSPasteboard` bindings are callable from the main thread via the existing `run_on_app_main_thread` helper.

## Completion

After all three child plans pass their validation, move this parent file and its matching child directory to `docs/plans/archived/` preserving the same structure.
