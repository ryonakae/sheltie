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

- [x] [Phase 1 — Clipboard foundation (Rust NSPasteboard commands + payload library)](2026-08-06-node-copy-paste-duplicate/phase-1-clipboard-foundation.md)
- [x] [Phase 2 — Copy / Cut / Paste / Duplicate commands and placement](2026-08-06-node-copy-paste-duplicate/phase-2-copy-paste-commands.md)
- [x] [Phase 3 — Alt-drag duplicate](2026-08-06-node-copy-paste-duplicate/phase-3-alt-drag-duplicate.md)

All code is implemented and every automated check passes: `npm run lint` / `format` / `typecheck`, 381 Vitest tests (55 new), `cargo clippy --all-targets` with no warnings, and 162 Rust tests.

## Post-implementation review fixes

An adversarial review of the whole range found four real defects, all fixed in `fix(clipboard): harden cut, tiptap validation, ghost node ids, and async commands`:

1. **Cut could delete nodes with nothing on the clipboard.** `handleCopy` was fire-and-forget, so a failed pasteboard write still removed the nodes and only logged in dev builds. Cut now awaits the write and skips the removal on failure.
2. **Malformed `tiptapContent` could blank the board.** `parseDocumentNode` cast `tiptapContent` to `object` without validation, so a crafted pasteboard payload (or `.sheltie` file) made ProseMirror throw during `TextNode` render; `BoardErrorBoundary` then unmounted the board along with the keyboard handlers, leaving no reachable Undo. The document trust boundary now validates the ProseMirror JSON structure recursively (node / mark names stay the editor schema's job).
3. **Ghost clones duplicated `data-node-id`.** Alt-dragging a sticky or text node put two elements with the same `data-node-id` in the DOM. Ghosts now carry the flow node id.
4. **Clipboard commands broke the crate's async convention.** They were the only sync `#[tauri::command]`s and used the blocking main-thread helper, which the helper's own doc comment warns against from async contexts. Both are now `async fn` using `run_on_app_main_thread_async`.

## Fixed after the user's first GUI check

The user reported alt-drag and Cmd+D working but Cmd+C/Cmd+V doing nothing. That split isolated the fault to the clipboard I/O, since Cmd+D exercises the whole payload → placement → insert → select pipeline without touching the pasteboard.

Cause: `invoke_handler` registration is not sufficient. Local document webviews only reach commands listed in the `allow-local-app-commands` permission (`src-tauri/permissions/app-commands.toml`), so the ACL rejected both pasteboard calls. The dev-only `console.warn` made it look like nothing happened at all. Both commands are now listed, and clipboard failures always log. Verified headlessly by checking that the command names appear in the generated `target/debug/build/sheltie-*/out/acl-manifests.json`.

The same check surfaced a pre-existing bug in a separate commit: `prune_screenshot_cache` was invoked on every launch, was never in the allowlist, and its rejection was swallowed by an empty `catch`, so screenshot cache pruning had never run.

## Fixed after the user's second GUI check

Two ordering/placement bugs the automated tests could not have caught, both reported from real use:

1. **Ghost clones rendered behind every node.** Ghosts were prepended to the flow nodes array, and array order is stacking order. Alt-dragging a node that overlapped one below it made the ghost appear to sink under that node for the duration of the drag, snapping back on drop. Each ghost now goes immediately before the node it clones (`insertGhostFlowNodes`).
2. **Multi-node alt-drop could stack web pages.** Alt-dropping several nodes at once skipped overlap correction entirely (it matched plain multi-drag), so a selection containing a web page node could duplicate it on top of an existing node. The group now slides diagonally clear. The rigid-group slide moved out of `board-paste-placement.ts` into `sheltie-node-placement.ts` as `resolveNonOverlappingGroupOffset`, shared by paste and alt-drag.

Cmd+D was reported as affected too, but reproduction tests showed it already routed through paste placement and stayed clear, including across five cascading rounds. Only alt-drag was at fault.

## Verified by the user

Copy / Cut / Paste / Duplicate, alt-drag duplication (single and multi-node), ghost stacking order, and web page overlap avoidance all behave correctly in the running app.

## Left unverified

The agent environment could not launch the GUI (`tauri-plugin-log` hits `Operation not permitted` in the sandbox), so these were never exercised and are worth a spot-check if they ever look wrong:

- Editable focus: with the caret in the URL input or a Tiptap text node, Cmd+C/X/V should fall through to native text editing. The board handlers return `false` via `hasEditableFocus()` and skip `preventDefault`, so WKWebView should keep its default behavior. If it does not, run the native operation from the JS handler instead (`document.execCommand('copy'/'cut')`, plus a Rust plain-text read and programmatic insert for paste).
- Cross-window paste, Cut → Paste restoring a node at its original coordinates, external paste showing plain text rather than JSON, and edge duplication between two copied web page nodes.
- Alt state is tracked with `window` keydown/keyup listeners, so releasing Alt while the window is unfocused (Cmd+Tab mid-drag, then returning to finish) may drop as a duplicate instead of a move. One Cmd+Z undoes it. If it reproduces, read `altKey` off the drop event itself — guaranteed on the title-row path's `PointerEvent`; confirm what React Flow's `onNodeDragStop` actually passes before relying on it.

## Known gap left open (needs a product decision)

Plain multi-node dragging (no Alt) still lets a web page node land on top of another node: single drags get `resolveDraggedNodePosition`, but `updateNodePositions` commits multi-drags with no correction. This predates the feature and violates the same "webviews cannot overlap" rule. Fixing it would shift the group away from where the user dropped it, so it was left alone pending a decision.
