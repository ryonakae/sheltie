# Sheltie MCP evaluation fixtures

This directory is the deterministic, repository-tracked fixture contract for the `sheltie-use` Skill. All pages are synthetic, bind only to loopback, make no external requests, contain no credentials, and use in-memory DOM state only.

## Production MCP contract

Enable **Sheltie > Settings > MCP Server** on macOS, then connect the MCP client to the user-enabled local endpoint:

```json
{
  "mcpServers": {
    "sheltie": {
      "type": "http",
      "url": "http://127.0.0.1:29978/mcp"
    }
  }
}
```

The fixed overview reads are:

```text
list_documents()
get_editor_state(documentId)
get_board(documentId, nodeIds?, nodeTypes?, includeEdges?)
get_webpage_screenshots(documentId, pageNodeIds?)
get_board_screenshot(documentId, nodeIds?)
```

The board write is `batch_edit_board(documentId, operations)`. `focus_nodes(documentId, nodeIds)` is the only MCP operation that changes selection or viewport. There is no production save, board-export, or trace tool. MCP writes leave the document dirty; the user saves with the document UI.

Every browser tool requires `documentId` and `pageNodeId`:

```text
browser_snapshot(documentId, pageNodeId)
browser_navigate(documentId, pageNodeId, url)
browser_go_back(documentId, pageNodeId)
browser_go_forward(documentId, pageNodeId)
browser_reload(documentId, pageNodeId)
browser_click(documentId, pageNodeId, snapshotId, elementRef)
browser_hover(documentId, pageNodeId, snapshotId, elementRef)
browser_fill(documentId, pageNodeId, snapshotId, elementRef, text)
browser_fill_form(documentId, pageNodeId, snapshotId, fields: [{ elementRef, text }])
browser_select_option(documentId, pageNodeId, snapshotId, elementRef, values)
browser_press_key(documentId, pageNodeId, key)
browser_scroll(documentId, pageNodeId, deltaX, deltaY)
browser_wait(documentId, pageNodeId, condition, timeoutMs?)
browser_screenshot(documentId, pageNodeId, mode, snapshotId?, elementRef?, annotate?)
browser_click_coordinates(documentId, pageNodeId, snapshotId, x, y, button?, clickCount?, highlight?)
browser_evaluate(documentId, pageNodeId, script)
browser_upload_file(documentId, pageNodeId, snapshotId, elementRef, paths)
browser_handle_dialog(documentId, pageNodeId, action, promptText?)
```

`browser_screenshot.mode` is `viewport`, `element`, or `fullPage`; `element` requires `snapshotId` and `elementRef`. Coordinate `button` is `left`, `middle`, or `right`; `clickCount` is 1 or 2. Dialog `action` is `accept` or `dismiss`. A successful page-changing action returns a new compact snapshot, so every older `snapshotId`/`elementRef` pair is stale.

## Fixture server and board setup

Start the server in one terminal:

```bash
node skills/evals/fixtures/serve-local-sites.mjs
```

It prints exactly `http://127.0.0.1:4174`, serves only `sites/`, sends `Cache-Control: no-store`, and exits cleanly on `SIGINT` or `SIGTERM`. Load `boards/comparison-board.sheltie` after starting it. The board is valid schema version 2 with only synthetic URLs and has no serialized runtime screenshot state.

Before a comparison evaluation, visit `page-compare-a` and `page-compare-b` while they are native and wait for normal screenshot capture. Move both outside the visible native area. Leave `page-semantic-form` outside the visible area without visiting it. The next `get_webpage_screenshots` must report the first two pages as `cached` and the third as `missing`; do not force a capture, reveal a hidden page, or change the viewport to obtain it.

For each semantic eval, use `page-semantic-form` at its fixture URL `semantic-form/`. For each visual eval's fresh document, navigate that same third WebPage node to `canvas-fallback/` before the run; the evals never share a mutated document. The canvas control is painted at a fixed CSS coordinate without an actionable DOM or ARIA target. Its explanatory heading remains semantic so an agent can establish context before taking a viewport screenshot.

## Evidence path

For every completed Agent run, the orchestrator immediately calls `get_subagent_result(verbose: true)` and writes the complete response to:

```text
$RUN_DIR/agent-result.verbose.json
```

Pi also persists the complete subagent transcript as JSONL at the Agent task output path. When that path is the durable source, convert every record without filtering before normalization:

```bash
jq -s '.' "$AGENT_OUTPUT_PATH" > "$RUN_DIR/agent-result.verbose.json"
```

The normalizer supports direct MCP tool records and Pi MCP gateway call/result pairs. Then derive the only trace used for grading:

```bash
node skills/evals/fixtures/derive-redacted-mcp-trace.mjs \
  "$RUN_DIR/agent-result.verbose.json" \
  "$RUN_DIR/outputs/redacted-mcp-trace.json"
```

The normalizer preserves only tool name, call ordering, explicit document/page/snapshot/element IDs, screenshot freshness, batch-created node IDs, response status, and allowlisted fixture-state flags (`semantic_confirmation` / `canvas_target_activated`). It reads only known result paths, never `browser_evaluate.value`, redacts all other request/response data, and fails if the verbose result has no recognizable tool-call data. The orchestrator calls read-only `get_board(documentId, includeEdges: true)` for the known run document, then writes only its `structuredContent` to `$RUN_DIR/outputs/final-board.json`. It never reads credentials, cookies, `localStorage`, password values, or a board export.

Verify the persisted evidence without invoking MCP:

```bash
node skills/evals/fixtures/verify-run.mjs \
  comparison \
  "$RUN_DIR/outputs/redacted-mcp-trace.json" \
  "$RUN_DIR/outputs/final-board.json" \
  skills/evals/fixtures/expected/comparison.json
```

Replace `comparison` and its expected file with `semantic` or `visual` for those runs. The command writes `verification.json` and grader-facing `user_notes.md` beside the redacted trace. `verify-eval.ts` is pure and returns Skill Creator expectations as `{ text, passed, evidence }[]`; it never invokes a save or export tool.

## Local checks

```bash
npm run test -- skills/evals/fixtures/verify-eval.test.ts
node skills/evals/fixtures/serve-local-sites.mjs
curl --fail --silent http://127.0.0.1:4174/compare-a/ >/dev/null
curl --fail --silent http://127.0.0.1:4174/compare-b/ >/dev/null
curl --fail --silent http://127.0.0.1:4174/semantic-form/ >/dev/null
curl --fail --silent http://127.0.0.1:4174/canvas-fallback/ >/dev/null
```

Stop the server after the checks. The sibling workspace is generated evidence only and must remain ignored.
