# Sheltie MCP Phase 2: Semantic Web Automation Implementation Plan

> **Parent plan:** [`../2026-07-17-sheltie-mcp.md`](../2026-07-17-sheltie-mcp.md)
>
> **For implementers:** Execute this plan task-by-task with red → green → refactor. Complete every checkbox, run the listed validation, and commit after each task.

**Goal:** Add macOS WKWebView semantic browser automation to the embedded MCP server: compact DOM/ARIA snapshots, stable short-lived element references, typed page actions, automatic post-action snapshots, and cross-origin iframe observation.

**Architecture:** Phase 1 owns the loopback Streamable HTTP transport, trusted-client policy, explicit `documentId` routing, and the Rust renderer broker. Phase 2 adds a page-automation actor per `(documentId, pageNodeId)` that serializes MCP actions for one live child WKWebView while different pages can run independently. Rust dispatches a request-ID-tagged operation with `Webview::eval`; an injected script installed in every frame performs DOM work, aggregates child-frame results in the top frame using `postMessage`, and only the top frame returns a JSON result through a Tauri command. Rust accepts that result only when the pending request, document window, page node, and invoking child-Webview label all agree.

**Tech Stack:** Rust 1.93.1, Tauri 2.10, rmcp 2.2.0, Tokio, React 19/TypeScript, Vitest 2.1.9, jsdom 29.1.1, macOS WKWebView.

## Global Constraints

- This is **Phase 2 only**. Do not add coordinate/vision interaction, `browser_evaluate`, file upload, JavaScript dialog handling, `target="_blank"` handling, or the final in-page visual highlight. All Phase 3 extension points stay under `src-tauri/src/mcp/page_automation/`; Phase 3 may reuse its typed bridge, actor queue, error envelope, and `PageAutomationOperation` enum.
- Support macOS only. Non-macOS commands must fail with `unsupported_platform`; they must not simulate browser actions.
- The Phase 1 Streamable HTTP server remains loopback-only, has no authentication, and treats the connected MCP client as trusted. Do not add confirmation UI or a save tool.
- Preserve Phase 1's no-save and cache-first overview rules: browser tools never save a document, and this phase must not show, move, resize, or navigate hidden/offscreen Webviews for `get_webpage_screenshots` or `get_board_screenshot` capture.
- Every browser tool requires both `documentId` and `pageNodeId`; never infer either from focused window, current selection, or viewport.
- A page operation affects only the existing live `page-{windowLabel}-{pageNodeId}` child Webview. Do not create a Webview, change a board node, persist a document, or move the viewport.
- All page-local actions are FIFO. A second tool call for the same page waits behind the first; calls for different pages may proceed in parallel.
- The injected bridge runs in untrusted page origins. It exposes no arbitrary Rust command and returns no cookies, storage, request headers, or page-global objects. Its only native invoke is a pending-request completion with JSON-safe result data.
- `browser_snapshot` and every successful typed action return a compact semantic snapshot. A newer snapshot invalidates all prior `snapshotId`/`elementRef` pairs; the server must never silently re-find an element.
- Use native `Webview::eval` only to invoke the fixed injected bridge with serialized data. Do not add an MCP tool that accepts arbitrary page JavaScript.
- Preserve the existing `SPA_URL_DETECTION_SCRIPT` (`\x01`) and `SCROLL_DETECTION_SCRIPT` (`\x02`) title-notification protocols. Page automation must not use document-title mutation for replies.
- Use `tauri::Window` rather than `WebviewWindow` for commands that can execute after child Webviews exist. The completion command additionally receives the invoking `tauri::Webview` so it can verify the child label.
- Add `jsdom` at exactly `29.1.1` to `devDependencies` and update the lockfile with npm. Do not change the Vitest default environment; injected-script tests construct `JSDOM` explicitly.

## Phase 1 Prerequisite Contract

Phase 2 starts only after Phase 1 has these public interfaces. Keep their names and semantics stable; Phase 2 extends the existing MCP service rather than opening another HTTP server, renderer bridge, or request broker.

```text
src-tauri/src/mcp/broker.rs
  McpRequestBrokerState::request(...)

src-tauri/src/mcp/types.rs
  ToolError { code, message, retry? }
  RendererCommand::GetBoard
  RendererRequest / RendererResponse

src-tauri/src/mcp/service.rs
  SheltieMcpService and the Phase 1 rmcp tool router

src/lib/mcp/renderer-bridge.ts
  setupMcpRendererBridge(), which listens for mcp-renderer-request
```

`documentId` is the opaque, currently open Tauri document window label (`document-*`), exactly as Phase 1 defines it. Before any browser action, Phase 2 calls `McpRequestBrokerState::request` once with `RendererCommand::GetBoard` to verify that `pageNodeId` exists and is a WebPage node in that document. After that verification, it resolves `scoped_page_label(documentId, pageNodeId)` and dispatches directly from Rust to the child `Webview`; page-operation requests and replies never transit through `mcp-renderer-request` or `setupMcpRendererBridge`.

All browser failures use `ToolError` with its required `code` and `message` fields and optional `retry`. This phase adds no further error fields. If a later implementation needs structured error payload data, add one optional field to `ToolError` in `src-tauri/src/mcp/types.rs`, update Phase 1 serialization tests and MCP response shaping, and preserve the existing `code`, `message`, and `retry` fields unchanged.

## Protocol and Constants

Create the following shared protocol in Rust. MCP tool input/output derives from these types; do not duplicate JSON field names in each tool handler.

```rust
// src-tauri/src/mcp/page_automation/protocol.rs
pub const PAGE_AUTOMATION_REQUEST_TIMEOUT_MS: u64 = 15_000;
pub const PAGE_AUTOMATION_SETTLE_DELAY_MS: u64 = 250;
pub const PAGE_AUTOMATION_SETTLE_POLL_MS: u64 = 50;
pub const PAGE_AUTOMATION_SETTLE_TIMEOUT_MS: u64 = 5_000;
pub const PAGE_AUTOMATION_FRAME_RESPONSE_TIMEOUT_MS: u64 = 750;
pub const PAGE_AUTOMATION_MAX_SNAPSHOT_ELEMENTS: usize = 200;
pub const PAGE_AUTOMATION_MAX_SNAPSHOT_CHARS: usize = 20_000;
pub const PAGE_AUTOMATION_MAX_TEXT_CHARS: usize = 512;
pub const PAGE_AUTOMATION_MAX_FILL_CHARS: usize = 10_000;
pub const PAGE_AUTOMATION_MAX_WAIT_TIMEOUT_MS: u64 = 10_000;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct PageKey {
    pub document_id: String,
    pub page_node_id: String,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PageAutomationOperation {
    Snapshot,
    Click { snapshot_id: String, element_ref: String },
    Hover { snapshot_id: String, element_ref: String },
    Fill { snapshot_id: String, element_ref: String, text: String },
    FillForm { snapshot_id: String, fields: Vec<FillField> },
    SelectOption { snapshot_id: String, element_ref: String, values: Vec<String> },
    PressKey { key: String },
    Scroll { delta_x: i64, delta_y: i64 },
    Wait { condition: WaitCondition, timeout_ms: u64 },
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
pub struct FillField {
    pub element_ref: String,
    pub text: String,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WaitCondition {
    Time { milliseconds: u64 },
    Url { contains: String },
    Selector { selector: String },
    Text { text: String },
}
```

All tool failures use Phase 1's `ToolError { code, message, retry? }` shape with one of these exact codes:

| Code | Meaning | Retry behavior |
| --- | --- | --- |
| `unsupported_platform` | The app is not running on macOS. | Do not retry on the same platform. |
| `document_not_found` | `documentId` is not an open Phase 1 document. | Call `list_documents`. |
| `page_not_found` | The specified node is absent or not a WebPage node in that document. | Call `get_board`. |
| `webview_not_ready` | The page node exists but its live child Webview has not been created or was destroyed. | Wait, then call `browser_snapshot`. |
| `request_timeout` | The page did not complete the bridge request within 15,000 ms. | Call `browser_snapshot`; do not replay a side-effecting operation automatically. |
| `bridge_rejected` | A completion did not match the pending request, document, page, or invoking Webview label. | Treat as a failed operation and inspect the current page. |
| `stale_element` | The supplied `snapshotId` is not current, or `elementRef` was not issued by it. | Call `browser_snapshot` and use a returned ref. |
| `element_not_found` | The current snapshot issued the ref but the target no longer exists. | Call `browser_snapshot`. |
| `element_not_interactable` | The target is disabled, hidden, inert, or has an incompatible element type. | Inspect a new snapshot. |
| `invalid_argument` | A URL, key, selector, value length, scroll delta, or wait request is outside this contract. | Correct the input. |
| `wait_timeout` | `browser_wait` did not meet its condition before its timeout. | Call `browser_snapshot` and choose a new condition. |
| `snapshot_too_large` | The compacted semantic tree exceeds the fixed limits after deterministic truncation. | Use the returned truncated snapshot and narrower page state. |

`browser_snapshot` uses `snapshot_too_large` only when no valid prefix can be encoded. Normal truncation succeeds with `truncated: true` in the snapshot. Each error uses `ToolError::new(code, message).with_retry(retry_message)` when the retry column above is non-empty.

## Semantic Snapshot Contract

The top-frame bridge returns this JSON-safe shape. `compactText` is a deterministic, newline-separated representation suitable for MCP text content; `elements` provides the same data structurally for tool validation. Preserve document order. Do not expose `password` values or values from elements with `autocomplete` containing `one-time-code`.

```ts
type SemanticElement = {
  ref: string;                 // top frame: "e1"; child frame: "f1:e1"
  role: string;
  name: string;
  tagName: string;
  value?: string;              // never for password/OTP inputs
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  href?: string;
  placeholder?: string;
  frameId: "top" | `f${number}`;
};

type CompactSnapshot = {
  navigationEpoch: number;
  documentToken: string;       // 128-bit random hex generated once by this top-frame document
  snapshotId: string;          // `s${navigationEpoch}-${sequence}`
  url: string;
  title: string;
  compactText: string;
  elements: SemanticElement[];
  frames: Array<{ frameId: "top" | `f${number}`; url: string; status: "ok" | "unavailable" }>;
  truncated: boolean;
};
```

The bridge collects visible, actionable native controls (`a[href]`, `button`, `input` except hidden, `textarea`, `select`, `[role]` controls, `[contenteditable="true"]`, and elements with `tabindex >= 0`) plus headings, landmarks, labels, and text necessary to name controls. It computes role/name using explicit ARIA first, then `<label>`, `aria-labelledby`, visible text, `alt`, `title`, and placeholder. It excludes `script`, `style`, `template`, `noscript`, `aria-hidden="true"`, hidden/inert ancestors, and non-rendered elements. It normalizes whitespace, truncates each name/value/text to the constants above, emits at most 200 actionable elements, and truncates `compactText` at 20,000 Unicode code units without splitting a surrogate pair.

The current snapshot table lives only inside the injected top-frame bridge. Creating a new snapshot replaces the table; all refs from previous snapshots become stale. Child frame refs are routed by their `fN:` prefix through `postMessage`; top-frame refs are resolved locally. Do not use DOM indexes, CSS selectors, or `getBoundingClientRect()` as persistent references.

## File Structure

- Create: `src-tauri/src/mcp/page_automation/mod.rs` — exports page actor state, bridge protocol, and MCP-facing service.
- Create: `src-tauri/src/mcp/page_automation/protocol.rs` — `PageKey`, operation payloads, constants, bridge request/result types, snapshot result validation, and error constructors.
- Create: `src-tauri/src/mcp/page_automation/actor.rs` — one Tokio mpsc actor per page, pending request registry, dispatch/settle state machine, and Rust unit tests.
- Create: `src-tauri/src/mcp/tools/mod.rs` — export browser tools for the existing rmcp service.
- Create: `src-tauri/src/mcp/tools/browser.rs` — own Phase 2 browser schemas, resolver, handlers, and inline tests.
- Modify: `src-tauri/src/mcp/service.rs` — compose the browser router into the existing `SheltieMcpService`; keep lifecycle and shared service state here.
- Create: `src-tauri/src/commands/webview/page_automation.rs` — direct `complete_page_automation_request` and `unregister_page_automation_page` Tauri commands plus native helpers for fixed bridge dispatch and navigation.
- Create: `src-tauri/src/commands/webview/page_automation_script.js` — self-contained initialization script installed in all frames.
- Create: `src/lib/mcp/page-automation-script.test.ts` — jsdom tests that execute the exact script loaded by Rust.
- Create: `public/mcp-fixtures/semantic-controls.html` — deterministic local form, button, select, contenteditable, and landmark fixture.
- Create: `public/mcp-fixtures/semantic-iframe-parent.html` — deterministic parent with same-origin and cross-origin iframe URLs.
- Create: `public/mcp-fixtures/semantic-iframe-child.html` — deterministic frame fixture whose title and controls identify it.
- Create: `public/mcp-fixtures/semantic-navigation-a.html` — deterministic local navigation origin page.
- Create: `public/mcp-fixtures/semantic-navigation-b.html` — deterministic local navigation destination page.
- Create: `scripts/mcp-fixtures/serve-semantic-fixtures.mjs` — deterministic dual-origin static server bound to `127.0.0.1:1420` and `127.0.0.1:1421`.
- Modify: `src-tauri/Cargo.toml` — enable Tokio `time` and runtime features required by the actor; retain the Phase 1 rmcp dependency.
- Modify: `src-tauri/src/mcp/mod.rs` — export `page_automation` and register Phase 2 browser tools with the Phase 1 MCP service.
- Modify: `src-tauri/src/commands/webview.rs` — export the new command module.
- Modify: `src-tauri/src/commands/webview/bounds.rs` — install the page-automation script with `initialization_script_for_all_frames` and notify actors about committed navigation.
- Modify: `src-tauri/src/setup.rs` — manage `PageAutomationState` and register direct page-automation commands.
- Modify: `src/lib/tauri-bridge/webview.ts` — expose `unregisterPageAutomationPage(pageId)` for lifecycle cleanup.
- Modify: `src/hooks/sheltie/useWebPageWebviewLifecycle.ts` — call that cleanup before closing a child Webview.
- Modify: `package.json` / `package-lock.json` — add `jsdom@29.1.1` as a development dependency.
- Modify: `docs/agents/architecture.md` — record Phase 2 ownership, actor isolation, and trusted-client boundary.
- Modify: `docs/agents/tauri-ipc.md` — document the renderer-independent completion command and its validation contract.
- Modify: `docs/agents/sheltie-runtime.md` — document all-frame initialization, semantic snapshot behavior, and the fact that no display-mode/viewport transition occurs.
- Modify: `docs/agents/wkwebview-internals.md` — document the all-frame `postMessage` bridge and why title notifications remain reserved for existing runtime signals.

## Tasks

### Task 1: Define the page-automation protocol and deterministic error behavior

**Objective:** Establish one typed operation/result contract used by the actor, injected script, and rmcp tools before wiring a live Webview.

**Files:**
- Create: `src-tauri/src/mcp/page_automation/mod.rs`
- Create: `src-tauri/src/mcp/page_automation/protocol.rs`
- Test: `src-tauri/src/mcp/page_automation/protocol.rs` (`#[cfg(test)]` module)

**Interfaces:**
- Consumes: Phase 1 `ToolError`, `RendererCommand::GetBoard`, and `McpRequestBrokerState`.
- Produces: `PageKey`, `PageAutomationOperation`, `CompactSnapshot`, `PageAutomationBridgeRequest`, `PageAutomationBridgeResult`, and the exact constants/error codes documented above.

- [x] **Step 1: Write failing protocol tests**

Add tests that deserialize each operation, reject a `Fill` string of 10,001 characters, reject `Wait.timeoutMs` above 10,000, reject a negative time wait, and serialize `ToolError::new("stale_element", "The page changed after this element was observed.").with_retry("Call browser_snapshot and use a returned elementRef")`. Add a snapshot test that accepts `f2:e7` but rejects `frame-2:e7`, a snapshot ID other than `s<epoch>-<sequence>`, and a `documentToken` that is not 32 lowercase hexadecimal characters. Verify `PageAutomationBridgeRequest.navigationEpoch` is required and serialized as camelCase.

- [x] **Step 2: Run the focused Rust test and verify RED**

Run:

```bash
(cd src-tauri && cargo test mcp::page_automation::protocol::tests)
```

Expected: compilation fails because the `mcp::page_automation` module and protocol types do not exist.

- [x] **Step 3: Implement the complete protocol module**

Use `#[serde(rename_all = "camelCase")]` only for JSON payload structs so MCP receives `snapshotId`, `elementRef`, `navigationEpoch`, and `pageNodeId`; retain snake_case only in the internally tagged `kind` enum values. Put bounds checks in constructors used by MCP handlers rather than relying on `serde` alone.

Implement this error helper exactly, then add the remaining named helpers with the same envelope:

```rust
pub fn stale_element(_snapshot_id: &str, _element_ref: &str) -> ToolError {
    ToolError::new(
        "stale_element",
        "The page changed after this element was observed.",
    )
    .with_retry("Call browser_snapshot and use a returned elementRef")
}
```

Define bridge payloads so the injected script cannot choose a destination:

```rust
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageAutomationBridgeRequest {
    pub request_id: String,
    pub document_id: String,
    pub page_node_id: String,
    pub navigation_epoch: u64,
    pub operation: PageAutomationOperation,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageAutomationBridgeResult {
    pub request_id: String,
    pub document_id: String,
    pub page_node_id: String,
    pub result: serde_json::Value,
}
```

- [x] **Step 4: Run the focused Rust test and verify GREEN**

Run:

```bash
(cd src-tauri && cargo test mcp::page_automation::protocol::tests)
```

Expected: all protocol tests pass and no error code is represented by an ad-hoc string outside `protocol.rs`.

- [x] **Step 5: Commit the protocol boundary**

```bash
git add src-tauri/src/mcp/page_automation/mod.rs src-tauri/src/mcp/page_automation/protocol.rs
git commit -m "feat(mcp): define semantic page automation protocol"
```

### Task 2: Build and test the all-frame injected semantic bridge

**Objective:** Add one self-contained script that can snapshot and operate controls in the top frame and collect/route cross-origin iframe results without exposing a general evaluation API.

**Files:**
- Create: `src-tauri/src/commands/webview/page_automation_script.js`
- Create: `src/lib/mcp/page-automation-script.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: JSON `PageAutomationBridgeRequest` passed by native `eval` as `window.__SHELTIE_MCP_PAGE_AUTOMATION__.dispatch(request)`.
- Produces: one top-frame `window.__TAURI__.core.invoke('complete_page_automation_request', { result })` call containing `PageAutomationBridgeResult`.

- [x] **Step 1: Add jsdom and write failing script tests**

Run `npm install --save-dev --save-exact jsdom@29.1.1` so `package.json` and `package-lock.json` agree. In `page-automation-script.test.ts`, load the exact JavaScript with `readFileSync(new URL('../../../src-tauri/src/commands/webview/page_automation_script.js', import.meta.url), 'utf8')`, instantiate `JSDOM` with `runScripts: 'outside-only'`, stub `window.__TAURI__.core.invoke`, evaluate the script, and dispatch requests.

Write deterministic tests for:

1. A fixture DOM emits roles, accessible names, `e1`/`e2` refs, normalized text, and no hidden or password value.
2. A new `Snapshot` replaces the ref table; clicking a ref from the first snapshot returns `stale_element` without dispatching a click event.
3. `Fill` sets an input value and emits `input` then `change`; `FillForm` validates every ref before emitting any event.
4. `SelectOption` updates a `<select>` and rejects a non-select target as `element_not_interactable`.
5. `PressKey` emits `keydown`, `keypress`, and `keyup` with the requested key; `Scroll` calls `scrollBy` with the supplied deltas.
6. A child-frame message registered from a distinct `WindowProxy` becomes `f1:e1`; an unregistered source is ignored and a missing child response produces `frames: [{ frameId: 'f1', status: 'unavailable' }]` after 750 ms.
7. Stub `crypto.getRandomValues`, load two independent `JSDOM` documents, and verify each top frame keeps one stable 32-hex `documentToken`, the two documents differ, and every snapshot echoes the request's `navigationEpoch` rather than accepting an epoch from page code.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run test -- src/lib/mcp/page-automation-script.test.ts
```

Expected: the test fails because the script file and jsdom dependency are absent.

- [x] **Step 3: Implement the script as a strict IIFE**

The file must contain no imports, no build-time substitutions, and no access to Node APIs because Rust includes it verbatim. Begin with the following top-frame/frame split and retain the fixed namespace:

```js
(function installSheltiePageAutomationBridge() {
  'use strict';
  const CHANNEL = 'sheltie-mcp-page-automation-v1';
  const isTopFrame = window.top === window;
  const state = {
    documentToken: createDocumentToken(),
    snapshotSequence: 0,
    currentSnapshotId: null,
    elements: new Map(),
    frames: new Map(),
  };

  function complete(result) {
    if (!isTopFrame) return;
    return window.__TAURI__.core.invoke('complete_page_automation_request', { result });
  }

  window.__SHELTIE_MCP_PAGE_AUTOMATION__ = {
    dispatch(request) {
      if (!isTopFrame) throw new Error('Only the top frame accepts native dispatch.');
      return dispatchTopFrame(request);
    },
  };
})();
```

Generate `documentToken` once at script installation from 16 bytes filled by `crypto.getRandomValues` and encode it as 32 lowercase hexadecimal characters. It identifies a concrete top-frame document instance; it is not an authentication secret. On `pageshow`, `popstate`, `hashchange`, and monkey-patched `history.pushState`/`replaceState`, reset `currentSnapshotId` and the element map. The actor, not page JavaScript, owns `navigationEpoch`: every request supplies it and every compact snapshot echoes it alongside the fixed `documentToken`. This is independent of the existing title-based SPA observer.

Use `window.addEventListener('message', ...)` and source-object identity, not `event.origin`, to associate a descendant frame. A child announces `frame-ready`; the top frame assigns `f1`, `f2`, and so on, then sends `frame-assigned` back to that exact source. For each top-frame snapshot/action request, the top frame forwards an operation message to registered children and waits at most `PAGE_AUTOMATION_FRAME_RESPONSE_TIMEOUT_MS`. Prefix child refs as `fN:<childRef>` and route child actions back to their owning source. A child never calls Tauri; it only sends its JSON-safe response to the top frame.

Implement native semantics only:

- `Click`: focus then call `.click()` only after verifying the ref belongs to the current snapshot and is visible/enabled.
- `Hover`: dispatch `pointerover`, `mouseover`, and `mousemove` with `bubbles: true`.
- `Fill`: support `<input>`, `<textarea>`, and `[contenteditable="true"]`; reject password and OTP fields; update the native value setter where applicable, then emit `input` and `change`.
- `FillForm`: pre-resolve and validate every field before the first mutation. It is validation-atomic, not rollback-atomic.
- `SelectOption`: support native `<select>` only; select matching option values in order, then emit `input` and `change`.
- `PressKey`: dispatch `keydown`, `keypress`, and `keyup` to `document.activeElement` or `document.body`.
- `Scroll`: call `window.scrollBy({ left: deltaX, top: deltaY, behavior: 'instant' })`.
- `Wait`: poll at 50 ms for `time`, URL substring, `document.querySelector(selector)`, or visible normalized text; stop at the requested timeout.

After any successful operation (including `Wait`), wait 250 ms, create a new compact snapshot, and return `{ action: { kind: request.operation.kind }, snapshot }`. Do not wait for network idle because WKWebView exposes no reliable page-network lifecycle here. For `Wait`, return the Phase 1-compatible `ToolError` fields `{ code: "wait_timeout", message, retry }` rather than throwing an unstructured JavaScript error.

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm run test -- src/lib/mcp/page-automation-script.test.ts
```

Expected: all seven jsdom cases pass using the exact script that Rust will inject.

- [x] **Step 5: Commit the tested page bridge**

```bash
git add package.json package-lock.json src-tauri/src/commands/webview/page_automation_script.js src/lib/mcp/page-automation-script.test.ts
git commit -m "feat(mcp): add semantic WKWebView bridge"
```

### Task 3: Implement page-scoped actors, pending-request verification, and timeout cleanup

**Objective:** Serialize operations per page and prove that only a matching top-frame completion can resolve a pending request.

**Files:**
- Create: `src-tauri/src/mcp/page_automation/actor.rs`
- Modify: `src-tauri/src/mcp/page_automation/mod.rs`
- Test: `src-tauri/src/mcp/page_automation/actor.rs` (`#[cfg(test)]` module)
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: `PageKey`, bridge types/constants, Phase 1 `ToolError`, and a direct-Webview dispatch closure abstracted for unit tests.
- Produces: `PageAutomationState::enqueue`, `PageAutomationState::prepare_navigation`, `PageAutomationState::snapshot_after_navigation`, `PageAutomationState::complete`, `PageAutomationState::note_committed_navigation`, `PageAutomationState::note_spa_navigation`, and `PageAutomationState::remove_page`.

- [x] **Step 1: Write failing actor tests**

Write Rust unit tests using a fake dispatcher and `tokio::time::pause/advance` for these cases:

1. Two enqueued operations for the same `PageKey` call the dispatcher in FIFO order; the second starts only after the first reply settles.
2. Operations for two distinct `PageKey` values start independently.
3. A completion with the correct `requestId` but wrong `documentId`, wrong `pageNodeId`, or wrong invoking webview label returns `bridge_rejected` and leaves the original pending request unresolved.
4. A correct completion resolves exactly once; a duplicate completion returns `bridge_rejected`.
5. A request without completion returns `request_timeout` after exactly 15,000 ms and removes its pending entry; the next queued operation still starts.
6. A committed full-navigation notification increments that page's observed epoch and causes the actor's post-action snapshot dispatch to require a changed `documentToken`, matching committed URL, and fresh bridge generation; a delayed old-document reply is rejected even if it echoes the new request epoch.
7. An SPA notification increments the epoch but permits the same `documentToken`; the accepted snapshot must match the reported SPA URL and new epoch.
8. `prepare_navigation(page)` returns the current `{ epoch, documentToken }`, first obtaining a read-only snapshot if the actor has no accepted token. `snapshot_after_navigation(page, marker)` waits until `note_committed_navigation` reports an epoch greater than the marker, then rejects the marker token and retries only snapshot dispatch until the new document token, committed URL, and epoch match. Timeout returns `request_timeout` without replaying navigation.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
(cd src-tauri && cargo test mcp::page_automation::actor::tests)
```

Expected: compilation fails because `PageAutomationState` and its actor APIs do not exist.

- [x] **Step 3: Implement the actor state machine**

Enable the required Tokio features without changing the minimum Rust version:

```toml
tokio = { version = "1", features = ["sync", "time", "rt"] }
```

Implement one lazily-created `tokio::sync::mpsc::Sender<QueuedPageOperation>` per `PageKey`. The actor owns one operation at a time. Each queued operation contains a `oneshot::Sender<Result<CompactSnapshot, ToolError>>`; the service awaits this sender and never blocks the HTTP accept loop.

Keep pending requests in a mutex-protected map keyed by monotonically allocated `pa-<u64>` IDs. Each pending record contains all values that the completion must match:

```rust
struct PendingPageRequest {
    page_key: PageKey,
    document_window_label: String,
    webview_label: String,
    reply: tokio::sync::oneshot::Sender<Result<serde_json::Value, ToolError>>,
}
```

The actor calls a native dispatch function with a fully serialized `PageAutomationBridgeRequest`, then awaits the exact pending reply with `tokio::time::timeout(Duration::from_millis(PAGE_AUTOMATION_REQUEST_TIMEOUT_MS), receiver)`. Always remove the entry in a finally-style cleanup path, including dispatch failure, receiver cancellation, timeout, page removal, and Webview destruction.

For an action, the actor first waits for the action response, then sleeps `PAGE_AUTOMATION_SETTLE_DELAY_MS`, and sends a new `Snapshot` bridge request. If navigation changed while settling, retry only the fixed Snapshot dispatch every 50 ms until a bridge response or `PAGE_AUTOMATION_SETTLE_TIMEOUT_MS`; do not replay the original action. Return the new snapshot for both no-navigation and navigation paths.

Keep per-`PageKey` actor state containing the monotonic navigation epoch, last accepted top-frame `documentToken`, committed URL, navigation kind (`full` or `spa`), and a Tokio watch/notify signal. Every bridge request carries the actor's current epoch; the injected top frame echoes it into `CompactSnapshot.navigationEpoch` and derives `snapshotId` from it, while independently returning its fixed document token. A full-navigation snapshot is accepted only after `PageLoadEvent::Finished`, when its URL equals the callback's normalized final URL, its epoch equals the actor epoch, and its token differs from the pre-navigation marker. Thus a delayed reply from the old document remains rejectable even if it receives and echoes a newer request epoch. An SPA snapshot uses the title-observer URL and new epoch but may retain its token. The same 5,000 ms settlement deadline covers commit notification and replacement-bridge readiness. `prepare_navigation` plus `snapshot_after_navigation` is the only post-navigation route for native navigate/back/forward/reload handlers.

`remove_page` must cancel the current pending request and drain queued requests as `webview_not_ready`; call it when a page Webview is destroyed. Keep this and every future coordinate-action extension in `src-tauri/src/mcp/page_automation/`, but do not define coordinate variants now.

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
(cd src-tauri && cargo test mcp::page_automation::actor::tests)
```

Expected: FIFO, cross-page independence, mismatch rejection, timeout cleanup, and navigation-settle tests pass.

- [x] **Step 5: Commit actor isolation**

```bash
git add src-tauri/Cargo.toml src-tauri/src/mcp/page_automation/mod.rs src-tauri/src/mcp/page_automation/actor.rs
git commit -m "feat(mcp): serialize semantic page operations"
```

### Task 4: Add native dispatch and the completion command

**Objective:** Connect the Rust actor to the live child WKWebView while enforcing the request/document/page/Webview validation boundary.

**Files:**
- Create: `src-tauri/src/commands/webview/page_automation.rs`
- Modify: `src-tauri/src/commands/webview.rs`
- Modify: `src-tauri/src/setup.rs`
- Modify: `src/lib/tauri-bridge/webview.ts`
- Test: `src-tauri/src/commands/webview/page_automation.rs` (`#[cfg(test)]` helpers only)

**Interfaces:**
- Consumes: `PageAutomationState`, `PageAutomationBridgeRequest`, `PageAutomationBridgeResult`, existing `scoped_page_label`, and the Phase 1 document-ID/window-label contract.
- Produces Tauri commands: `complete_page_automation_request(webview: Webview, result: PageAutomationBridgeResult) -> Result<(), String>` and `unregister_page_automation_page(window: Window, page_id: String) -> Result<(), String>`. Both operate directly on `PageAutomationState`; neither uses `McpRequestBrokerState` after page verification.

- [ ] **Step 1: Write failing validation tests**

Extract a pure `validate_completion` helper taking `&PendingPageRequest`, `invoking_webview_label`, and `&PageAutomationBridgeResult`. Test exact success, wrong child label, wrong parent document label, wrong document ID, wrong page ID, and unknown request ID. Each failing case must produce `bridge_rejected`; it must not complete or remove a different request.

- [ ] **Step 2: Run the focused Rust test and verify RED**

Run:

```bash
(cd src-tauri && cargo test commands::webview::page_automation::tests)
```

Expected: compilation fails because the command module and helper do not exist.

- [ ] **Step 3: Implement fixed native dispatch and completion**

Embed the script once using:

```rust
pub const PAGE_AUTOMATION_SCRIPT: &str = include_str!("page_automation_script.js");
```

Create a dispatch helper that resolves the expected child via `resolve_page_webview(app, document_window_label, expected_webview_label)`, serializes the request with `serde_json::to_string`, and executes only this fixed expression:

```rust
let script = format!(
    "window.__SHELTIE_MCP_PAGE_AUTOMATION__.dispatch({request_json});"
);
webview.eval(&script)
    .map_err(|error| format!("failed to dispatch page automation: {error}"))?;
```

Never interpolate an MCP-provided expression into executable JavaScript. The only interpolated value is the JSON serialization of the typed bridge request.

The completion command receives `tauri::Webview`, not `Window`, so use both `webview.label()` and `webview.window().label()` as authoritative native identities. It must call `PageAutomationState::complete` with those labels and the deserialized result. The state compares all of the following before signaling the pending one-shot sender:

```text
requestId
result.documentId == pending.page_key.document_id
result.pageNodeId == pending.page_key.page_node_id
webview.window().label() == pending.document_window_label
webview.label() == pending.webview_label
```

Register `PageAutomationState::default()` with `.manage(...)` and add both direct page-automation commands to `tauri::generate_handler!`. Export the module from `commands/webview.rs`. `complete_page_automation_request` returns `Ok(())` only for a matched completion; malformed or unmatched calls return a Rust error string while the actor independently reports `bridge_rejected` to the MCP operation that owns the pending request. `unregister_page_automation_page` calls `remove_page(PageKey { document_id: window.label().into(), page_node_id: page_id })` before Webview close.

- [ ] **Step 4: Run focused Rust tests and verify GREEN**

Run:

```bash
(cd src-tauri && cargo test commands::webview::page_automation::tests)
(cd src-tauri && cargo test mcp::page_automation::actor::tests)
```

Expected: completion validation and actor tests pass; no command accepts a page response without a matching pending request.

- [ ] **Step 5: Commit the native bridge endpoint**

```bash
git add src-tauri/src/commands/webview.rs src-tauri/src/commands/webview/page_automation.rs src-tauri/src/setup.rs src/lib/tauri-bridge/webview.ts
git commit -m "feat(mcp): verify WKWebView automation replies"
```

### Task 5: Install the bridge in every frame and synchronize native navigation

**Objective:** Ensure cross-origin descendants receive the bridge before page code and ensure page actors observe real WKWebView navigation changes.

**Files:**
- Modify: `src-tauri/src/commands/webview/bounds.rs`
- Modify: `src-tauri/src/commands/webview/scripts.rs`
- Modify: `src-tauri/src/commands/webview/page_automation.rs`
- Modify: `src/hooks/sheltie/useWebPageWebviewLifecycle.ts`
- Test: `src-tauri/src/commands/webview/scripts.rs` (`#[cfg(test)]` source-presence checks)

**Interfaces:**
- Consumes: `PAGE_AUTOMATION_SCRIPT`, `PageAutomationState`, existing `on_navigation` and `on_document_title_changed` callbacks, and Tauri `on_page_load` with `PageLoadEvent::Finished`.
- Produces: all-frame WKWebView bridge injection plus `PageAutomationState::note_committed_navigation(PageKey, url)` and `note_spa_navigation(PageKey, url)` calls.

- [ ] **Step 1: Write failing source and helper tests**

Add a pure test that the script source contains the fixed namespace, `CHANNEL`, `postMessage`, `crypto.getRandomValues`, and `complete_page_automation_request`, but does not contain `document.cookie`, `localStorage`, `sessionStorage`, or `eval(`. Add unit tests for helpers that map `(document_window_label, page_id)` to the same `PageKey` and normalize the final URLs used by `on_page_load` and title-based SPA changes.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
(cd src-tauri && cargo test commands::webview::scripts::tests)
```

Expected: it fails because the script is not yet exposed and navigation-to-actor helper is absent.

- [ ] **Step 3: Add the all-frame initialization and navigation hooks**

In `create_page_webview`, retain the two existing `.initialization_script(...)` calls and add this separate call:

```rust
.initialization_script_for_all_frames(
    crate::commands::webview::page_automation::PAGE_AUTOMATION_SCRIPT,
)
```

Do not replace the existing top-frame scripts: their title notifications are still used by `useSheltieNodeRuntime` for URL and screenshot freshness.

Keep the existing `on_navigation` callback for allow/cancel and renderer event behavior, but do not advance the actor there because Tauri invokes it before commit. Add `on_page_load`; only `PageLoadEvent::Finished` calls `note_committed_navigation(PageKey, payload.url())`. In the `\x01` SPA branch of `on_document_title_changed`, call `note_spa_navigation` with the URL decoded by the existing observer before emitting the renderer event. Do not treat `PageLoadEvent::Started`, `\x02` scroll notifications, or normal title updates as committed navigation. This gives the actor a post-load full-navigation signal and a post-history-change SPA signal.

When a child Webview is closed, call `remove_page` through a new direct `unregister_page_automation_page` Tauri command from the existing `useWebPageWebviewLifecycle` cleanup path; do not send this lifecycle signal through `mcp-renderer-request` or infer it from a renderer event. The command resolves its invoking `Window`, derives the document ID from `window.label()`, and rejects queued work as `webview_not_ready`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
(cd src-tauri && cargo test commands::webview::scripts::tests)
(cd src-tauri && cargo test mcp::page_automation::actor::tests)
npm run test -- src/lib/mcp/page-automation-script.test.ts
```

Expected: the source checks, actor navigation test, and exact-script jsdom tests pass.

- [ ] **Step 5: Commit all-frame injection**

```bash
git add src-tauri/src/commands/webview/bounds.rs src-tauri/src/commands/webview/scripts.rs src-tauri/src/commands/webview/page_automation.rs src/hooks/sheltie/useWebPageWebviewLifecycle.ts
git commit -m "feat(mcp): inject semantic bridge into page frames"
```

### Task 6: Expose typed navigation and semantic-action MCP tools

**Objective:** Register the complete Phase 2 tool surface with strict inputs, explicit routing, and automatic post-action snapshots.

**Files:**
- Create: `src-tauri/src/mcp/tools/mod.rs`
- Create: `src-tauri/src/mcp/tools/browser.rs`
- Modify: `src-tauri/src/mcp/service.rs`
- Modify: `src-tauri/src/mcp/mod.rs`
- Modify: `src-tauri/src/mcp/page_automation/mod.rs`
- Test: `src-tauri/src/mcp/tools/browser.rs` (`#[cfg(test)]` Phase 2 schema/handler tests)

**Interfaces:**
- Consumes: the Phase 1 `SheltieMcpService`, `McpRequestBrokerState` for one explicit `GetBoard` verification, `PageAutomationState`, protocol types, and existing native navigation commands/helpers. All subsequent page dispatch is direct Rust-to-Webview.
- Produces exactly these MCP tools:

```text
browser_snapshot
browser_navigate
browser_go_back
browser_go_forward
browser_reload
browser_click
browser_hover
browser_fill
browser_fill_form
browser_select_option
browser_press_key
browser_scroll
browser_wait
```

- [ ] **Step 1: Write failing handler tests**

Use a fake Phase 1 `McpRequestBrokerState` GetBoard verifier and a fake direct-Webview dispatcher to test:

1. Every tool rejects a missing `documentId` or `pageNodeId` before dispatch.
2. A sticky-note ID produces `page_not_found` and does not enqueue an actor message.
3. `browser_click` passes `snapshotId` and `elementRef` unchanged and returns the new snapshot from the actor.
4. `browser_navigate` validates an absolute `http` or `https` URL, obtains a pre-navigation epoch/document token marker, calls native navigation once, rejects a delayed reply with the old token, and returns only a snapshot whose token changed and whose URL/epoch match the finished page load; `javascript:`, `file:`, `data:`, and relative URLs produce `invalid_argument`.
5. Back, forward, and reload use the same commit barrier. Fake navigation emits a pre-commit `on_navigation`, then a delayed old-document reply, then a finished-load URL and new-token snapshot; each handler must return only the final snapshot and must not dispatch navigation twice.
6. `browser_fill_form` rejects duplicate `elementRef` values and overlong values before dispatch.
7. Tool metadata marks snapshots read-only and all actions destructive; no tool claims that a browser-side action can be undone by board Undo.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
(cd src-tauri && cargo test mcp::tools::browser::tests)
```

Expected: compilation fails because the Phase 2 browser tool module, methods, and registrations do not exist.

- [ ] **Step 3: Implement the tool schemas and handlers**

Define the input contracts exactly:

```text
browser_snapshot(documentId, pageNodeId)
browser_navigate(documentId, pageNodeId, url)
browser_go_back(documentId, pageNodeId)
browser_go_forward(documentId, pageNodeId)
browser_reload(documentId, pageNodeId)
browser_click(documentId, pageNodeId, snapshotId, elementRef)
browser_hover(documentId, pageNodeId, snapshotId, elementRef)
browser_fill(documentId, pageNodeId, snapshotId, elementRef, text)
browser_fill_form(documentId, pageNodeId, snapshotId, fields[{ elementRef, text }])
browser_select_option(documentId, pageNodeId, snapshotId, elementRef, values[string, ...])
browser_press_key(documentId, pageNodeId, key)
browser_scroll(documentId, pageNodeId, deltaX, deltaY)
browser_wait(documentId, pageNodeId, condition, timeoutMs?)
```

`browser_wait.timeoutMs` defaults to 5,000 and cannot exceed 10,000. `browser_scroll` accepts signed integer deltas in `[-10000, 10000]`; reject other values. `browser_press_key` accepts a non-empty key string no longer than 64 code units. `browser_select_option.values` must contain 1–50 non-empty values.

All handlers first call one `resolve_page(document_id, page_node_id)` service method that:

1. calls `McpRequestBrokerState::request` with `RendererCommand::GetBoard` exactly once;
2. verifies the returned node is a WebPage node;
3. treats `document_id` itself as the Phase 1 native document window label;
4. derives `scoped_page_label(document_id, page_node_id)`;
5. verifies that child Webview exists before queuing the operation.

After `resolve_page` returns, use the page actor for `browser_snapshot` and every DOM action. The actor calls `Webview::eval` and accepts `complete_page_automation_request` directly; it must not submit another `RendererRequest` or use `mcp-renderer-request`. For navigation tools, call `prepare_navigation(page)` before invoking the existing native helper (`navigate`, `history.back`, `history.forward`, or reload of the current URL), then call `snapshot_after_navigation(page, marker)`. It waits for `on_page_load(PageLoadEvent::Finished)` to report a committed epoch/final URL greater than the marker, rejects the marker's document token even if an old page echoes the new request epoch, and returns only a snapshot from the replacement document whose token, URL, and epoch match the committed state. Do not enqueue an ordinary immediate `Snapshot`, infer completion from `on_navigation` or helper return, or replay navigation on timeout. Do not update Zustand node URL/title from MCP handlers; the existing navigation/title event path remains the renderer's source of truth.

Return the action name and `CompactSnapshot` as structured JSON in the MCP response. For navigation, use `{ "action": { "kind": "navigate", "url": "…" }, "snapshot": { … } }`; for DOM actions, preserve the bridge's `{ action, snapshot }`. Include `navigationEpoch` and `snapshotId` in every success response.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
(cd src-tauri && cargo test mcp::tools::browser::tests)
(cd src-tauri && cargo test mcp::page_automation::)
```

Expected: handler validation, schema metadata, protocol, and actor tests pass.

- [ ] **Step 5: Commit the typed MCP interface**

```bash
git add src-tauri/src/mcp/mod.rs src-tauri/src/mcp/page_automation src-tauri/src/mcp/service.rs src-tauri/src/mcp/tools
git commit -m "feat(mcp): expose typed semantic browser tools"
```

### Task 7: Add deterministic local fixtures and perform the first live WKWebView checks

**Objective:** Make manual MCP verification reproducible without using external websites or credentials.

**Files:**
- Create: `public/mcp-fixtures/semantic-controls.html`
- Create: `public/mcp-fixtures/semantic-iframe-parent.html`
- Create: `public/mcp-fixtures/semantic-iframe-child.html`
- Create: `public/mcp-fixtures/semantic-navigation-a.html`
- Create: `public/mcp-fixtures/semantic-navigation-b.html`
- Create: `scripts/mcp-fixtures/serve-semantic-fixtures.mjs`

**Interfaces:**
- Consumes: static fixture files under `public/mcp-fixtures/` and the Phase 2 MCP tools.
- Produces: stable DOM content, explicit `window.__fixtureLog` observability, and two independently served loopback origins for required cross-origin frame checks.

- [ ] **Step 1: Create deterministic fixture content**

Create `semantic-controls.html` with unique accessible names and a visible `#result` region. Include a named button, text input, password input, textarea, select with three option values, contenteditable element, checkbox, disabled button, hidden button, and landmarks/headings. Each allowed interaction appends a deterministic token to `window.__fixtureLog` and to `#result`; no network requests, timers, randomized IDs, or third-party assets.

Create the navigation pair so `semantic-navigation-a.html` links to `semantic-navigation-b.html` through a named same-window link, and B links back. The iframe parent loaded from `http://127.0.0.1:1420` embeds one child from port `1420` and one child from `http://127.0.0.1:1421`; the differing port makes the second frame cross-origin. The child contains heading `Frame fixture` and a named `Frame action` button.

Implement `serve-semantic-fixtures.mjs` with Node's built-in HTTP/file APIs only. By default start two servers in one process, both bound explicitly to `127.0.0.1`; support `--primary-only` to start only port 1420 for the unavailable-frame negative check. Serve only normalized paths below `public/`, reject traversal, set deterministic content types, print every ready URL, and close all started servers on `SIGINT`/`SIGTERM`. Port conflicts must fail startup rather than silently selecting another port.

- [ ] **Step 2: Verify fixture formatting and static references**

Run:

```bash
npm run format
node scripts/mcp-fixtures/serve-semantic-fixtures.mjs
```

Expected: Prettier exits 0; the server reports both `http://127.0.0.1:1420` and `http://127.0.0.1:1421`; both same-origin and cross-origin child URLs return the fixture; no fixture refers to an external host. Stop the fixture server after this check.

- [ ] **Step 3: Run manual macOS Tauri/MCP checks**

1. In separate terminals run `node scripts/mcp-fixtures/serve-semantic-fixtures.mjs` and `npm run dev`. Open a document, create one WebPage for `http://127.0.0.1:1420/mcp-fixtures/semantic-controls.html`, and enable MCP Server from the persisted Settings menu added in Phase 1.
2. Connect an MCP inspector or configured local client to Phase 1's loopback endpoint. Call `browser_snapshot` with the `documentId` from `list_documents` and the WebPage node ID from `get_board`. Confirm controls have readable names, password values are absent, and the response has `snapshotId`, `navigationEpoch`, and a valid `documentToken`.
3. Call `browser_fill`, `browser_select_option`, `browser_click`, `browser_press_key`, and `browser_scroll` with refs from the immediately preceding snapshot. Confirm each action response contains a different snapshot ID and the fixture log has the expected sequence.
4. Reuse the first snapshot's ref. Confirm `stale_element`; confirm the fixture log did not gain an event.
5. Call `browser_fill_form` with one valid and one invalid ref. Confirm no field changed and no input/change event was logged.
6. Use the navigation fixture with `browser_navigate`, `browser_click`, `browser_go_back`, `browser_go_forward`, and `browser_reload`. For every native navigation response, confirm the returned URL belongs to the finished destination, its epoch is greater than the pre-navigation snapshot, its `documentToken` differs from the pre-navigation token, and no old-document refs are returned. Confirm the page node remains the same.
7. Call `browser_snapshot` on the iframe fixture while both fixture origins are running. Require both the same-origin child and a cross-origin `fN:eN` reference, click each frame action, and confirm each post-action snapshot. Then stop only the port-1421 listener (or run the script's documented single-origin test mode) and confirm that frame alone becomes `unavailable` without failing the top snapshot; the successful cross-origin path is mandatory, not optional.
8. Queue two actions for one page and one action for a second open page. Confirm the first page's effects are ordered while the second page remains responsive.
9. Close a page node while an intentionally delayed `browser_wait` is pending. Confirm `webview_not_ready` and no stranded actor blocks a subsequent call after recreating the page.

- [ ] **Step 4: Commit fixtures after manual checks**

```bash
git add public/mcp-fixtures scripts/mcp-fixtures/serve-semantic-fixtures.mjs
git commit -m "test(mcp): add semantic web automation fixtures"
```

### Task 8: Update permanent agent documentation and run the complete validation suite

**Objective:** Record stable contracts and prove the implementation preserves the existing app checks.

**Files:**
- Modify: `docs/agents/architecture.md`
- Modify: `docs/agents/tauri-ipc.md`
- Modify: `docs/agents/sheltie-runtime.md`
- Modify: `docs/agents/wkwebview-internals.md`

**Interfaces:**
- Consumes: final Phase 2 implementation and manual results from Task 7.
- Produces: one authoritative description per concern, without duplicating transient fixture data.

- [ ] **Step 1: Update architecture documentation**

In `architecture.md`, add the MCP page-automation service under backend responsibilities. State that Phase 1 owns HTTP/renderer routing, Phase 2 owns one serial actor per page, and native Webview results are correlated by request ID. State that page actions do not alter board Undo/Redo or document save state.

- [ ] **Step 2: Update IPC documentation**

In `tauri-ipc.md`, add `complete_page_automation_request(result)` under Webview commands. Document that it is called only by the injected top frame, receives the invoking `Webview`, checks request/document/page/window/Webview label equality, and does not expose a general page-evaluation endpoint. Add the new all-frame bridge behavior to the multiwebview command context section.

- [ ] **Step 3: Update runtime and WKWebView documentation**

In `sheltie-runtime.md`, state that semantic automation does not force a native/screenshot transition, does not change selection or viewport, and requires a currently live child Webview. In `wkwebview-internals.md`, document `initialization_script_for_all_frames`, frame-to-top `postMessage` aggregation, the 750 ms frame response bound, and the prohibition on using the title sentinel channel for automation replies.

- [ ] **Step 4: Run all required automated validation**

Run:

```bash
npm run lint
npm run format
npm run typecheck
npm run test
(cd src-tauri && cargo test --lib)
```

Expected: every command exits 0. `npm run test` includes jsdom bridge tests; Rust tests include protocol, actor, completion validation, tool handler, and existing application tests.

- [ ] **Step 5: Commit documentation and final validation state**

```bash
git add docs/agents/architecture.md docs/agents/tauri-ipc.md docs/agents/sheltie-runtime.md docs/agents/wkwebview-internals.md
git commit -m "docs: document semantic MCP web automation"
```

## Validation

Automated checks:

```bash
npm run lint
npm run format
npm run typecheck
npm run test
(cd src-tauri && cargo test --lib)
```

Expected: status 0 from all commands.

Manual macOS checks:

1. With MCP disabled, open the semantic fixture in a WebPage and confirm normal navigation, screenshots, title updates, and scroll freshness behavior are unchanged.
2. Enable MCP, connect one local client, and exercise every Phase 2 tool using explicit `documentId` and `pageNodeId`; no call may operate on a different focused tab after switching native tabs.
3. Confirm `browser_snapshot` omits password values, hidden controls, cookies, local/session storage, and arbitrary page objects.
4. Confirm each successful typed action returns a new compact snapshot and a stale ref is rejected rather than re-resolved.
5. Confirm close/destroy, timeout, malformed completion, and cross-origin-frame timeout leave no pending request or blocked page queue.
6. Confirm no phase-3 UI appears: no coordinate click tool, no screenshot-driven action, no evaluate tool, no upload/dialog tool, no popup/new-tab behavior change, and no page highlight overlay.

## Risks and Tradeoffs

- A trusted local MCP client can read and act on the visible DOM of authenticated pages. The bridge does not create a new confidentiality boundary; it only avoids accidentally publishing credential stores through normal snapshots.
- `event.isTrusted` is false for injected DOM events. Sites that require trusted OS-level input, canvas/WebGL controls, drag-and-drop, CAPTCHA, payment confirmation, or native dialogs are intentionally outside Phase 2.
- Web navigation can destroy the initial injected execution context before it replies. The actor therefore never replays an original action and only retries the fixed post-action snapshot during the 5,000 ms settle window.
- Cross-origin iframe collection depends on each frame loading the initialization script and participating in `postMessage`; a blocked or not-yet-loaded frame is reported as `unavailable` without making the top-page snapshot fail.
- A fresh snapshot invalidates all previous refs. This increases MCP calls but prevents an agent from clicking an element that now represents a different control.
- The actor queue guarantees order for one page, not global ordering. This preserves responsiveness when Sheltie displays multiple independent WebPages.
- Native `Webview::eval` and all-frame initialization are macOS WKWebView paths. Windows/Linux adapters can implement the same protocol later, but they are not part of this phase.
