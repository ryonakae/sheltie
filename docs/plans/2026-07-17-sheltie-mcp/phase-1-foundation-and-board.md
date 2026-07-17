# Sheltie MCP Phase 1: Foundation, Board, and Overview Implementation Plan

> **Parent plan:** [`../2026-07-17-sheltie-mcp.md`](../2026-07-17-sheltie-mcp.md)
>
> **For implementers:** Execute this plan task-by-task. Complete each checkbox step, run the listed validation, and commit after each task.

**Goal:** Add an opt-in local Streamable HTTP MCP server that can address every open Sheltie document explicitly, inspect and atomically edit boards, focus requested nodes, and return cached multi-site and full-board screenshots without saving documents.

**Architecture:** Run the official Rust MCP SDK inside the Tauri process on loopback and route document-scoped commands through a request-ID broker to the owning renderer. Keep board mutation and screenshot composition in TypeScript, where Zustand and the rendered React Flow canvas are authoritative; keep transport, session lifecycle, document lookup, timeout enforcement, and MCP response shaping in Rust. Use cached per-WebPage screenshots for multi-site and board overview so hidden/offscreen WKWebViews are never shown or moved for capture.

**Tech Stack:** Rust 1.93.1, Tauri 2.10, `rmcp` 2.2.0, Axum 0.8, Tokio, React 19, TypeScript 5.7, Zustand 5, React Flow 12.10.1, `html-to-image` 1.11.13, Vitest 2.1.

## Global Constraints

- Bind exactly `127.0.0.1:29978`; expose Streamable HTTP at `http://127.0.0.1:29978/mcp`.
- Do not add authentication. Treat every connected local MCP client as trusted.
- Keep the server disabled by default. Persist the menu toggle in `sheltie.json` under exact key `mcpEnabled`.
- Add one checked menu item named `MCP Server` under `Sheltie > Settings`; changing it starts/stops the server and persists the setting. If startup fails, restore the unchecked state and persist `false`.
- Bind loopback only. Accept `Host` values `127.0.0.1:29978` and `localhost:29978`. Requests without `Origin` may pass; requests with `Origin` must match `http://127.0.0.1:29978` or `http://localhost:29978`. Do not add CORS headers.
- On disable, cancel the HTTP listener and all MCP sessions, fail outstanding renderer requests with `server_stopped`, and leave document windows open.
- Initial platform support is macOS only. On other platforms, the menu item stays disabled and MCP does not start.
- Every document-scoped MCP tool requires `documentId`; every WebPage-scoped tool introduced in later phases also requires `pageNodeId`.
- Runtime `documentId` is the current Tauri document window label (`document-*`). It is opaque and valid only while that window is open.
- MCP tools never infer a target from current focus after the call begins. Focus is returned only as metadata.
- MCP tools never save a document. Do not expose `save_document`, do not invoke Save/Save As, and do not auto-save after `batch_edit_board`.
- `batch_edit_board` is declarative, validates the entire batch before mutation, resolves `tempId` references, applies once, and creates exactly one Undo snapshot. Any invalid operation leaves nodes, edges, runtime screenshot state, and history unchanged.
- MCP edits mark the document dirty through the existing `isProjectDirty()` comparison and preserve normal native dirty indicators.
- Selection and viewport are readable. They are changed only by explicit `focus_nodes`; ordinary reads/edits must not change them.
- `focus_nodes` is runtime-only, does not enter Undo/Redo, and does not affect dirty state.
- Multi-site overview is cache-first. Never show, move, resize, or navigate a hidden/offscreen WKWebView to refresh it.
- `get_webpage_screenshots` returns one result for every requested WebPage: `cached` when a saved image exists, `missing` otherwise. It may capture a currently native/visible page before returning, but a failure falls back to its existing cache.
- Track screenshot metadata as `capturedAt` (RFC 3339), `capturedUrl`, and file path. Existing PNGs without sidecar metadata use file modification time and `capturedUrl: null`.
- `get_board_screenshot` renders the full node/edge union, not the current viewport. Use `64` world-unit padding, a maximum output dimension of `2048` px, `pixelRatio: 1`, and a background matching the current theme.
- A board screenshot uses cached WebPage images. A missing image renders the existing empty WebPage placeholder and its node ID is returned in `missingScreenshotNodeIds`.
- Keep all React Flow nodes rendered (`onlyRenderVisibleElements={false}`). Do not change the user's viewport to capture the board.
- Return JSON in both MCP `structuredContent` and backward-compatible text content. Return images as MCP image content blocks plus structured metadata.
- Tool errors use `{ code, message, retry? }` with stable snake-case codes. At minimum implement `document_not_found`, `renderer_unavailable`, `renderer_timeout`, `validation_failed`, `server_disabled`, `server_stopped`, and `screenshot_failed`.
- Apply MCP annotations: reads use `read_only_hint = true`; `batch_edit_board` uses `destructive_hint = true`; `focus_nodes` uses `idempotent_hint = true` and is not destructive.
- Serialize commands per document with a document-local Tokio mutex. Independent documents may run concurrently.
- Follow TDD for Rust state transitions, broker behavior, `src/lib/*`, and `src/store/*`: failing test → confirm RED → minimal implementation → confirm GREEN → refactor.
- Do not add React rendering tests. Verify native menus, Tauri event routing, WKWebView screenshots, and full-board image composition manually.
- Use `@/` aliases for cross-directory TypeScript imports.
- Do not touch the existing untracked icon PNG files.
- Update `docs/agents` in the same commits as the behavior they describe.

## Current Context

- `src-tauri/src/setup.rs` already owns menu setup, plugin registration, managed state, command registration, and process lifetime.
- `src-tauri/src/commands/store/document_manager.rs` tracks every open `document-*` window and file path, but currently has no public list snapshot.
- `src-tauri/src/commands/store/document_window.rs::focused_document_window_label` already resolves focus without assuming a `main` label.
- `src/lib/app-exit.ts` demonstrates request-ID, window-local request/response coordination. MCP reverses that direction: Rust emits to one renderer and the renderer completes a Rust oneshot through a Tauri command.
- `src/store/tab-store.ts` is the authoritative document store. Existing mutation helpers push history per action, so MCP needs one dedicated batch action rather than chaining current actions.
- `ProjectScreen` owns selected node IDs. `Sheltie` owns selected edge IDs and the React Flow viewport controller. An MCP editor adapter must be registered where both selection kinds and viewport handlers are available.
- `src/hooks/sheltie/useScreenshotCaptureQueue.ts` serializes capture per WebPage and stores cache URLs. Hidden Webview capture is explicitly unreliable in `src-tauri/src/commands/webview/snapshot.rs`.
- All React Flow nodes remain mounted outside the viewport. This permits offscreen DOM cloning for a whole-board image.
- The official `rmcp` 2.2.0 crate uses Rust edition 2024 internally; `mise.toml` already pins Rust 1.93.1 while `src-tauri/Cargo.toml` still declares 1.77.2.
- `rmcp::transport::streamable_http_server::StreamableHttpService` provides Host/Origin validation, local sessions, cancellation, and Tower/Axum integration.
- `html-to-image` 1.11.13 supports `toPng(node, { width, height, canvasWidth, canvasHeight, style, filter, pixelRatio })`.

## Public MCP Contract Introduced in Phase 1

```text
list_documents()
get_editor_state(documentId)
get_board(documentId, nodeIds?, nodeTypes?, includeEdges?)
batch_edit_board(documentId, operations[])
focus_nodes(documentId, nodeIds[])
get_webpage_screenshots(documentId, pageNodeIds?)
get_board_screenshot(documentId, nodeIds?)
```

`nodeIds` omitted means all matching nodes. `pageNodeIds` omitted means every WebPage in board order. `get_board_screenshot.nodeIds` omitted means the whole board; when present, include the requested nodes and edges whose endpoints are both included.

## File Structure

### Rust

- Modify: `src-tauri/Cargo.toml` — align Rust version and add MCP/Axum lifecycle dependencies.
- Modify: `src-tauri/Cargo.lock` — resolved dependencies.
- Modify: `src-tauri/src/lib.rs` — declare the MCP module.
- Modify: `src-tauri/src/setup.rs` — manage MCP states, configure persisted startup, handle menu toggle, register renderer completion command.
- Create: `src-tauri/src/mcp/mod.rs` — module exports and exact endpoint constants.
- Create: `src-tauri/src/mcp/types.rs` — MCP params/results, renderer envelopes, stable tool errors.
- Create: `src-tauri/src/mcp/broker.rs` — pending request map, document locks, renderer dispatch, timeout and completion verification.
- Create: `src-tauri/src/mcp/lifecycle.rs` — persisted setting, start/stop state machine, Axum listener and cancellation.
- Create: `src-tauri/src/mcp/service.rs` — `rmcp` tool router and response/image conversion.
- Modify: `src-tauri/src/commands/store/document_manager.rs` — list open document snapshots and focused state.
- Modify: `src-tauri/src/commands/webview/screenshots.rs` — sidecar metadata read/write and safe cached screenshot reads.
- Modify: `src-tauri/src/commands/webview/snapshot.rs` — expose reusable PNG byte helper without changing hidden behavior.
- Modify: `src-tauri/src/menus/mod.rs` — MCP menu IDs.
- Modify: `src-tauri/src/menus/app.rs` — Settings MCP section and check item.
- Create: `src-tauri/src/menus/mcp.rs` — check state and connected-session label updates.

### Renderer

- Modify: `package.json` / `package-lock.json` — add exact dependency `html-to-image@1.11.13`.
- Create: `src/lib/mcp/types.ts` — renderer command and declarative board operation contracts.
- Create: `src/lib/mcp/board-operations.ts` — pure all-or-nothing operation interpreter.
- Test: `src/lib/mcp/board-operations.test.ts` — creation, temp IDs, updates, edges, rollback and no-op cases.
- Create: `src/lib/mcp/editor-adapter.ts` — register/read editor context, focus nodes, and capture board image.
- Test: `src/lib/mcp/editor-adapter.test.ts` — registration replacement/cleanup and unavailable errors.
- Create: `src/lib/mcp/board-screenshot.ts` — board bounds, clone normalization, scale, filtering and PNG conversion.
- Test: `src/lib/mcp/board-screenshot.test.ts` — pure bounds/scale/filter decisions.
- Create: `src/lib/mcp/renderer-bridge.ts` — window-local `mcp-renderer-request` listener and response completion.
- Modify: `src/main.tsx` — initialize and clean up the renderer bridge once.
- Modify: `src/lib/tauri-bridge/events.ts` — MCP request listener.
- Modify: `src/lib/tauri-bridge/project.ts` — renderer completion invoke.
- Modify: `src/lib/tauri-bridge/types.ts` — bridge payload types.
- Modify: `src/store/tab-store.ts` — `applyMcpBoardBatch` action and screenshot metadata runtime map.
- Modify: `src/store/tab-store.test.ts` — one-history integration and runtime cleanup.
- Modify: `src/types/index.ts` — screenshot metadata runtime contract.
- Modify: `src/screens/Project.tsx` — expose current node selection to the editor adapter.
- Modify: `src/components/Sheltie/Sheltie.tsx` — expose edge selection, `focus_nodes`, screenshot capture and React Flow viewport DOM to the adapter.
- Modify: `src/hooks/sheltie/useSheltieViewportController.ts` — return an explicit `focusNodes` handler using existing fit calculations.
- Modify: `src/hooks/sheltie/useScreenshotCaptureQueue.ts` — record metadata and expose cache-first batch descriptors.
- Modify: `src/lib/tauri-bridge/webview.ts` — metadata arguments/results.

### Documentation

- Create: `docs/agents/mcp.md` — MCP lifecycle, trust boundary, endpoint, routing and tool contracts.
- Modify: `docs/agents/README.md` — add MCP guide entry.
- Modify: `docs/agents/architecture.md` — Rust MCP service, broker and renderer adapter responsibilities.
- Modify: `docs/agents/coding-rules.md` — explicit IDs, no implicit focus, atomic batch and no-save rules.
- Modify: `docs/agents/domain-models.md` — screenshot runtime metadata and batch history invariant.
- Modify: `docs/agents/tauri-ipc.md` — renderer request/response event and completion command.
- Modify: `docs/agents/sheltie-screenshots.md` — cache-first overview and full-board composition.

## Tasks

### Task 1: Add the MCP dependency baseline and typed protocol contracts

**Objective:** Compile the official MCP server stack and define one stable contract used by all later tasks.

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/mcp/mod.rs`
- Create: `src-tauri/src/mcp/types.rs`
- Modify: `docs/agents/architecture.md`

**Interfaces:**
- Produces: endpoint constants, `ToolError`, document/tool params/results, `RendererRequest`, `RendererResponse`.
- Consumed by: Tasks 2–8 and phases 2–3.

- [x] **Step 1: Write failing Rust serialization tests**

In `src-tauri/src/mcp/types.rs`, define tests first for camelCase JSON and stable errors. Use these exact expectations:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_request_uses_camel_case_contract() {
        let request = RendererRequest {
            request_id: "request-1".into(),
            command: RendererCommand::GetBoard,
            params: serde_json::json!({"includeEdges": true}),
        };
        assert_eq!(serde_json::to_value(request).unwrap(), serde_json::json!({
            "requestId": "request-1",
            "command": "getBoard",
            "params": {"includeEdges": true}
        }));
    }

    #[test]
    fn tool_error_is_stable_and_actionable() {
        let error = ToolError::new("document_not_found", "Document document-9 is not open")
            .with_retry("Call list_documents and use a returned documentId");
        assert_eq!(serde_json::to_value(error).unwrap(), serde_json::json!({
            "code": "document_not_found",
            "message": "Document document-9 is not open",
            "retry": "Call list_documents and use a returned documentId"
        }));
    }
}
```

- [x] **Step 2: Confirm RED**

Run: `(cd src-tauri && cargo test --lib mcp::types::tests)`

Expected: compilation fails because `mcp`, `RendererRequest`, `RendererCommand`, and `ToolError` do not exist.

- [x] **Step 3: Add exact dependency and module declarations**

Set `rust-version = "1.93.1"` and add:

```toml
axum = "0.8"
rmcp = { version = "=2.2.0", features = ["transport-streamable-http-server"] }
tokio = { version = "1", features = ["macros", "net", "rt", "sync", "time"] }
tokio-util = "0.7"
uuid = { version = "1", features = ["serde", "v4"] }
```

Keep current dependencies and add `mod mcp;` in `src-tauri/src/lib.rs`. In `mcp/mod.rs`, define:

```rust
pub const MCP_BIND_ADDRESS: &str = "127.0.0.1:29978";
pub const MCP_ENDPOINT: &str = "http://127.0.0.1:29978/mcp";
pub const MCP_RENDERER_REQUEST_EVENT: &str = "mcp-renderer-request";
pub const MCP_RENDERER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

pub mod broker;
pub mod lifecycle;
pub mod service;
pub mod types;
```

Implement the tested serde types with `#[serde(rename_all = "camelCase")]` and `RendererCommand` with `#[serde(rename_all = "camelCase")]`. Define all phase-1 input/result structs in this file so `service.rs` contains routing rather than ad-hoc JSON parsing.

- [x] **Step 4: Confirm GREEN and compile the dependency graph**

Run: `(cd src-tauri && cargo test --lib mcp::types::tests && cargo check)`

Expected: 2 tests pass and Cargo resolves `rmcp 2.2.0`; no MSRV or edition error remains.

- [x] **Step 5: Document and commit**

Document the new Rust module boundary in `docs/agents/architecture.md`.

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/mcp/mod.rs src-tauri/src/mcp/types.rs docs/agents/architecture.md
git commit -m "feat: define Sheltie MCP contracts"
```

### Task 2: Implement the opt-in Streamable HTTP lifecycle and menu

**Objective:** Start and stop a loopback-only MCP endpoint from a persisted, default-off macOS menu item.

**Files:**
- Create: `src-tauri/src/mcp/lifecycle.rs`
- Modify: `src-tauri/src/mcp/mod.rs`
- Modify: `src-tauri/src/setup.rs`
- Modify: `src-tauri/src/menus/mod.rs`
- Modify: `src-tauri/src/menus/app.rs`
- Create: `src-tauri/src/menus/mcp.rs`
- Test: inline Rust tests in `lifecycle.rs`
- Create: `docs/agents/mcp.md`
- Modify: `docs/agents/README.md`

**Interfaces:**
- Consumes: constants/types from Task 1.
- Produces: `McpServerState`, `load_mcp_enabled`, `set_mcp_enabled`, `start`, `stop`, menu update helpers.

- [x] **Step 1: Write failing lifecycle tests**

Test a pure reducer/state transition separated from the socket side effect:

```rust
#[test]
fn persisted_missing_value_defaults_to_disabled() {
    assert!(!parse_mcp_enabled(None));
}

#[test]
fn start_failure_returns_to_disabled() {
    let next = reduce_lifecycle(McpLifecycle::Starting, McpLifecycleEvent::StartFailed);
    assert_eq!(next, McpLifecycle::Disabled);
}

#[test]
fn disable_cancels_running_server() {
    let next = reduce_lifecycle(McpLifecycle::Running, McpLifecycleEvent::DisableRequested);
    assert_eq!(next, McpLifecycle::Stopping);
}
```

- [x] **Step 2: Confirm RED**

Run: `(cd src-tauri && cargo test --lib mcp::lifecycle::tests)`

Expected: missing lifecycle types/functions.

- [x] **Step 3: Implement lifecycle state and server task**

Use this ownership model:

```rust
#[derive(Default)]
pub struct McpServerState {
    inner: std::sync::Mutex<McpServerInner>,
}

#[derive(Default)]
struct McpServerInner {
    lifecycle: McpLifecycle,
    running: Option<RunningMcpServer>,
}

struct RunningMcpServer {
    cancellation: tokio_util::sync::CancellationToken,
    task: tauri::async_runtime::JoinHandle<()>,
}
```

`start(app)` must bind before marking Running, construct `StreamableHttpService` with `LocalSessionManager`, use `StreamableHttpServerConfig::default()` with a child cancellation token, explicit allowed hosts/origins, nest at `/mcp`, and call `axum::serve(listener, router).with_graceful_shutdown(...)`. `stop()` cancels and removes the handle. Treat a second start/stop as idempotent.

Use store constants:

```rust
pub const MCP_ENABLED_KEY: &str = "mcpEnabled";
```

Reuse `commands::theme::STORE_PATH`. Persist before returning from a menu toggle. On failed bind, persist `false`, uncheck the item, and show a native error message containing `127.0.0.1:29978`.

- [x] **Step 4: Add the menu contract**

Create IDs:

```rust
pub const MENU_ID_MCP_ENABLED: &str = "mcp.enabled";
pub const MENU_ID_MCP_CONNECTIONS: &str = "mcp.connections";
```

Add a separator after Theme, a checked `MCP Server` item, and disabled text item `MCP Connections: 0` under the existing Settings submenu. During setup, load persisted state after `tauri-plugin-store` initialization; on macOS start only when true. Handle the check item in `app.on_menu_event` by spawning the asynchronous transition. Non-macOS keeps it disabled and unchecked.

- [x] **Step 5: Confirm GREEN**

Run: `(cd src-tauri && cargo test --lib mcp::lifecycle::tests && cargo check)`

Expected: lifecycle tests pass and setup/menu compile.

Manual check:
1. Launch `npm run dev`.
2. Confirm `Sheltie > Settings > MCP Server` starts unchecked.
3. Enable it and verify `lsof -nP -iTCP:29978 -sTCP:LISTEN` shows only `127.0.0.1:29978`.
4. Restart Sheltie and verify the checked state/server are restored.
5. Disable it and verify the listener disappears.
6. Occupy port 29978 before enabling; verify the item returns unchecked and the error dialog names the port.

- [x] **Step 6: Document and commit**

Write `docs/agents/mcp.md` sections “Trust boundary”, “Lifecycle”, “Endpoint”, and “Menu setting”; link it from `docs/agents/README.md`.

```bash
git add src-tauri/src/mcp/lifecycle.rs src-tauri/src/mcp/mod.rs src-tauri/src/setup.rs src-tauri/src/menus/mod.rs src-tauri/src/menus/app.rs src-tauri/src/menus/mcp.rs docs/agents/mcp.md docs/agents/README.md
git commit -m "feat: add opt-in local MCP server"
```

### Task 3: Add document listing and the Rust-to-renderer request broker

**Objective:** Route explicit document commands safely to the correct renderer with per-document serialization and verified request completion.

**Files:**
- Create: `src-tauri/src/mcp/broker.rs`
- Modify: `src-tauri/src/mcp/types.rs`
- Modify: `src-tauri/src/commands/store/document_manager.rs`
- Modify: `src-tauri/src/setup.rs`
- Create: `src/lib/mcp/types.ts`
- Create: `src/lib/mcp/renderer-bridge.ts`
- Modify: `src/lib/tauri-bridge/events.ts`
- Modify: `src/lib/tauri-bridge/project.ts`
- Modify: `src/lib/tauri-bridge/types.ts`
- Modify: `src/main.tsx`
- Test: inline Rust tests in `broker.rs`
- Modify: `docs/agents/tauri-ipc.md`

**Interfaces:**
- Produces: `DocumentSummary`, `McpRequestBrokerState::request`, Tauri command `complete_mcp_renderer_request`, renderer `setupMcpRendererBridge`.
- Consumed by: Tasks 5–8 and phases 2–3.

- [x] **Step 1: Write failing broker tests**

Cover: successful matching completion; wrong document cannot complete; timeout removes pending entry; stop fails all pending; two commands for one document serialize while different documents proceed independently.

Use a fake emitter callback rather than constructing `AppHandle`; the broker core accepts `emit: impl FnOnce(RendererRequest) -> Result<(), String>`.

- [x] **Step 2: Confirm RED**

Run: `(cd src-tauri && cargo test --lib mcp::broker::tests)`

Expected: broker core and pending request contract are missing.

- [x] **Step 3: Implement document snapshots**

Add `DocumentManagerState::document_summaries(focused_label)` returning stable board order by window creation index:

```rust
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub document_id: String,
    pub file_path: Option<String>,
    pub untitled_index: usize,
    pub focused: bool,
}
```

Do not expose `Project.id`; it is renderer-local and regenerated.

- [x] **Step 4: Implement broker request/complete**

Store pending `uuid::Uuid` entries containing expected `document_id` and oneshot sender. Before emit, verify the document exists in `DocumentManagerState`. Acquire the document-local async mutex, insert pending, `app.emit_to(document_id, MCP_RENDERER_REQUEST_EVENT, request)`, and use `tokio::time::timeout(MCP_RENDERER_TIMEOUT, receiver)`.

Register:

```rust
#[tauri::command]
pub async fn complete_mcp_renderer_request(
    window: tauri::Window,
    state: tauri::State<'_, McpRequestBrokerState>,
    response: RendererResponse,
) -> Result<(), String>
```

Verify `window.label()` equals the pending document ID. Unknown/late request IDs return an error and never complete another request.

- [x] **Step 5: Implement the renderer listener**

`setupMcpRendererBridge()` listens through `getCurrentWebviewWindow().listen`, dispatches by the typed `RendererCommand`, catches errors, and always invokes `complete_mcp_renderer_request` with:

```ts
export type RendererResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string; retry?: string } };
```

Initialize once in `main.tsx` with the same HMR cleanup pattern used by edit/file/view/app-exit listeners. Initially support an injected command handler map and return `renderer_unavailable` for unregistered phase-1 commands; later tasks register handlers.

- [x] **Step 6: Confirm GREEN**

Run:
- `(cd src-tauri && cargo test --lib mcp::broker::tests)`
- `npm run typecheck`

Expected: broker tests pass; renderer payloads and Tauri bridge compile.

Manual check: emit a temporary test request from a Rust unit-accessible debug path only while developing, then remove that path before commit. Verify two native tabs answer only their own document ID.

- [x] **Step 7: Document and commit**

Add the exact event, command, timeout, window verification, and multi-window rule to `docs/agents/tauri-ipc.md` and `docs/agents/mcp.md`.

```bash
git add src-tauri/src/mcp/broker.rs src-tauri/src/mcp/types.rs src-tauri/src/commands/store/document_manager.rs src-tauri/src/setup.rs src/lib/mcp/types.ts src/lib/mcp/renderer-bridge.ts src/lib/tauri-bridge/events.ts src/lib/tauri-bridge/project.ts src/lib/tauri-bridge/types.ts src/main.tsx docs/agents/tauri-ipc.md docs/agents/mcp.md
git commit -m "feat: route MCP requests to document renderers"
```

### Task 4: Implement declarative atomic board operations

**Objective:** Apply a validated operation list to nodes/edges once and create one Undo entry.

**Files:**
- Create: `src/lib/mcp/board-operations.ts`
- Test: `src/lib/mcp/board-operations.test.ts`
- Modify: `src/store/tab-store.ts`
- Test: `src/store/tab-store.test.ts`
- Modify: `src/lib/mcp/types.ts`
- Modify: `docs/agents/domain-models.md`
- Modify: `docs/agents/coding-rules.md`

**Interfaces:**
- Produces: `BoardOperation`, `applyBoardOperations`, `BatchEditBoardResult`, store action `applyMcpBoardBatch`.
- Consumed by: Task 8 and Skill phase.

- [ ] **Step 1: Define the exact discriminated union and failing pure tests**

Use operations:

```ts
export type BoardOperation =
  | { op: 'create_node'; tempId: string; node: CreateNodeInput }
  | { op: 'update_node'; nodeId: string; patch: UpdateNodePatch }
  | { op: 'delete_node'; nodeId: string }
  | { op: 'create_edge'; tempId: string; edge: CreateEdgeInput }
  | { op: 'update_edge'; edgeId: string; patch: Partial<BoardEdgeStyle> }
  | { op: 'delete_edge'; edgeId: string }
  | { op: 'reverse_edge'; edgeId: string }
  | {
      op: 'reorder_node';
      nodeId: string;
      position: 'front' | 'forward' | 'backward' | 'back';
    };
```

`CreateNodeInput` is a type-discriminated union for webpage/stickynote/text. Coordinates and dimensions are optional and use existing defaults/placement when omitted. Text input accepts `text: string` and converts it to `{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }`; empty text produces an empty paragraph.

Tests must cover:
- create three node types and default placement;
- same-batch temp node IDs used by a new edge;
- duplicate temp IDs rejected;
- missing node/edge rejected;
- type-incompatible patch rejected;
- edges only connect WebPage nodes and use valid handles;
- delete node cascades edges and reports deleted IDs;
- any failing operation returns an error without changing the input snapshot;
- no-op batch reports `changed: false`;
- injected deterministic `createId()` generates stable test IDs.

- [ ] **Step 2: Confirm RED**

Run: `npm run test -- src/lib/mcp/board-operations.test.ts`

Expected: module/operation types do not exist.

- [ ] **Step 3: Implement the pure interpreter**

Use this signature:

```ts
export function applyBoardOperations(
  snapshot: Readonly<{ nodes: BoardNode[]; edges: BoardEdge[] }>,
  operations: readonly BoardOperation[],
  createId: () => string,
): BatchEditBoardResult;
```

Clone into local `nextNodes/nextEdges`, resolve temp IDs in order, and throw `BoardOperationError` with `{ operationIndex, code, message }`. Reuse `findNonOverlappingPosition`, `addOrReplaceBoardEdge`, `updateBoardEdgeStyle`, and `reverseBoardEdge`; do not duplicate their invariants. Return all created/mutated/deleted IDs and `tempIdMap`.

- [ ] **Step 4: Add one Zustand action and failing history tests**

Add `applyMcpBoardBatch(operations): BatchEditBoardResult` to `ProjectActions`. Test successful multi-op batch produces one `history.past` entry and one Undo reverts all; invalid batch leaves `project`, `history`, and `webviewRuntime` deeply equal; deleting pages removes their runtime labels/screenshots; a no-op does not add history.

- [ ] **Step 5: Confirm GREEN**

Run:
- `npm run test -- src/lib/mcp/board-operations.test.ts`
- `npm run test -- src/store/tab-store.test.ts`

Expected: all pure and store integration cases pass.

- [ ] **Step 6: Document and commit**

Document the operation union, temp IDs, all-or-nothing behavior, one-history invariant, and no-save behavior.

```bash
git add src/lib/mcp/board-operations.ts src/lib/mcp/board-operations.test.ts src/lib/mcp/types.ts src/store/tab-store.ts src/store/tab-store.test.ts docs/agents/domain-models.md docs/agents/coding-rules.md
git commit -m "feat: add atomic MCP board batches"
```

### Task 5: Expose editor state and explicit focus without implicit selection changes

**Objective:** Read current selection/viewport and focus requested nodes only through an explicit tool handler.

**Files:**
- Create: `src/lib/mcp/editor-adapter.ts`
- Test: `src/lib/mcp/editor-adapter.test.ts`
- Modify: `src/screens/Project.tsx`
- Modify: `src/components/Sheltie/Sheltie.tsx`
- Modify: `src/hooks/sheltie/useSheltieViewportController.ts`
- Modify: `src/lib/mcp/renderer-bridge.ts`
- Modify: `docs/agents/coding-rules.md`

**Interfaces:**
- Produces: `registerMcpEditorAdapter`, `getEditorState`, `focusNodes`.
- Consumed by: Task 8.

- [ ] **Step 1: Write failing adapter lifecycle tests**

Test that no registration returns `renderer_unavailable`; latest registration wins; cleanup restores unavailable only when cleaning the current registration; `getEditorState` forwards node and edge selections without mutation.

- [ ] **Step 2: Confirm RED**

Run: `npm run test -- src/lib/mcp/editor-adapter.test.ts`

Expected: adapter does not exist.

- [ ] **Step 3: Implement adapter registration**

Use the established command-handler pattern:

```ts
export interface McpEditorAdapter {
  getEditorState: () => {
    selectedNodeIds: string[];
    selectedEdgeIds: string[];
    viewport: Viewport;
  };
  focusNodes: (nodeIds: string[]) => Promise<{ focusedNodeIds: string[] }>;
  captureBoardScreenshot: (nodeIds?: string[]) => Promise<BoardScreenshotResult>;
}

export function registerMcpEditorAdapter(adapter: McpEditorAdapter): () => void;
export function requireMcpEditorAdapter(): McpEditorAdapter;
```

Register in `Sheltie`, where selected node IDs, selected edge IDs, project viewport, and viewport controller are present. `ProjectScreen` continues to own node selection; pass stable accessors rather than moving selection into persistent store.

- [ ] **Step 4: Add `focusNodes` to viewport controller**

Filter IDs against live nodes. Empty or entirely missing lists return `validation_failed`. Reuse `resolveFitViewport(selectedNodes, containerWidth, containerHeight)` and existing `applyViewportTarget`; after starting the viewport animation, set exactly those node IDs selected and clear edge selection. This is the only MCP path allowed to change selection.

- [ ] **Step 5: Confirm GREEN and manually verify**

Run:
- `npm run test -- src/lib/mcp/editor-adapter.test.ts`
- `npm run typecheck`

Manual check: select mixed node/edge states and confirm editor state reports them; run explicit focus and confirm only requested nodes become selected and fit; run `get_board`/batch later and confirm selection does not move.

- [ ] **Step 6: Document and commit**

```bash
git add src/lib/mcp/editor-adapter.ts src/lib/mcp/editor-adapter.test.ts src/screens/Project.tsx src/components/Sheltie/Sheltie.tsx src/hooks/sheltie/useSheltieViewportController.ts src/lib/mcp/renderer-bridge.ts docs/agents/coding-rules.md
git commit -m "feat: expose MCP editor context"
```

### Task 6: Track cache provenance and return all WebPage screenshots in one call

**Objective:** Return a cache-first multi-site visual overview with explicit freshness and missing states.

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/store/tab-store.ts`
- Test: `src/store/tab-store.test.ts`
- Modify: `src/hooks/sheltie/useScreenshotCaptureQueue.ts`
- Modify: `src-tauri/src/commands/webview/screenshots.rs`
- Modify: `src/lib/tauri-bridge/webview.ts`
- Modify: `src/lib/mcp/renderer-bridge.ts`
- Modify: `docs/agents/sheltie-screenshots.md`

**Interfaces:**
- Produces: `ScreenshotCacheEntry`, sidecar metadata, renderer command `getWebpageScreenshots`.
- Consumed by: Tasks 7–8.

- [ ] **Step 1: Write failing metadata/store tests**

Define:

```ts
export interface ScreenshotCacheEntry {
  assetUrl: string;
  filePath: string;
  capturedAt: string;
  capturedUrl: string | null;
}
```

Test hydrate does not overwrite newer in-memory metadata, capture updates all fields, node deletion removes metadata, and restored legacy PNG accepts `capturedUrl: null`.

- [ ] **Step 2: Confirm RED**

Run: `npm run test -- src/store/tab-store.test.ts`

Expected: runtime cache still stores URL strings only.

- [ ] **Step 3: Add PNG sidecar metadata**

Store `{pageId}.json` next to `{pageId}.png` with exact schema:

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-07-17T12:34:56Z",
  "capturedUrl": "https://example.com/path"
}
```

Change `save_webview_screenshot` to accept `captured_url` and return `{ filePath, capturedAt, capturedUrl }`. For an existing PNG without JSON, use filesystem modified time and null URL. Delete PNG and JSON together. Update Tauri bridge and queue calls to pass the node’s current URL.

- [ ] **Step 4: Implement cache-first batch retrieval**

Renderer command behavior:
1. Resolve requested IDs in board order; reject non-WebPage IDs.
2. If a page is currently `native`, call its existing capture queue and tolerate failure.
3. Never show a hidden/screenshot Webview.
4. For each cache entry, `fetch(assetUrl)`, convert to base64 without the Data URL prefix, and return image bytes plus metadata.
5. Return `freshness: 'cached'` for images and `'missing'` for absent cache. Phase 1 does not promise same-call recapture for hidden pages.

Limit each image’s longest side to `1024` px in a temporary canvas before base64 encoding; preserve aspect ratio and encode PNG.

- [ ] **Step 5: Confirm GREEN and manually verify**

Run:
- `npm run test -- src/store/tab-store.test.ts`
- `(cd src-tauri && cargo test --lib commands::webview::screenshots::tests)`
- `npm run typecheck`

Manual check with at least three WebPages, two outside viewport: one MCP call returns all three IDs; hidden pages remain hidden; cached/missing status is accurate; no viewport movement occurs.

- [ ] **Step 6: Document and commit**

```bash
git add src/types/index.ts src/store/tab-store.ts src/store/tab-store.test.ts src/hooks/sheltie/useScreenshotCaptureQueue.ts src-tauri/src/commands/webview/screenshots.rs src/lib/tauri-bridge/webview.ts src/lib/mcp/renderer-bridge.ts docs/agents/sheltie-screenshots.md
git commit -m "feat: expose cached multi-site screenshots"
```

### Task 7: Compose a full-board screenshot offscreen

**Objective:** Render WebPages, notes, text, and arrows across the whole board without changing the visible viewport.

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/mcp/board-screenshot.ts`
- Test: `src/lib/mcp/board-screenshot.test.ts`
- Modify: `src/lib/mcp/editor-adapter.ts`
- Modify: `src/components/Sheltie/Sheltie.tsx`
- Modify: `docs/agents/sheltie-screenshots.md`

**Interfaces:**
- Produces: `captureBoardScreenshot`, `BoardScreenshotResult`.
- Consumed by: Task 8.

- [ ] **Step 1: Add `html-to-image` and write failing geometry tests**

Run: `npm install --save-exact html-to-image@1.11.13`

Then test these pure helpers:

```ts
expect(resolveBoardCaptureBounds(nodes, 64)).toEqual({ x: -64, y: -64, width: 1128, height: 628 });
expect(resolveBoardCaptureScale({ width: 4096, height: 1024 }, 2048)).toBe(0.5);
expect(resolveBoardCaptureScale({ width: 800, height: 600 }, 2048)).toBe(1);
```

Include empty-board error, selected subset, and edge inclusion only when both endpoints are selected.

- [ ] **Step 2: Confirm RED**

Run: `npm run test -- src/lib/mcp/board-screenshot.test.ts`

Expected: helpers do not exist.

- [ ] **Step 3: Implement offscreen clone normalization**

Use `.react-flow__viewport` as the source. Clone it, attach beneath an offscreen host (`position: fixed; left: -100000px; top: 0`) without `visibility: hidden` or root opacity changes, and then:
- set clone transform to `translate(${-bounds.x}px, ${-bounds.y}px) scale(1)`;
- set width/height to capture bounds;
- remove toolbars, handles, resize controls, selection frames, drag connection lines, and temporary AI overlays using a filter/data attribute;
- set every cloned `[data-display-mode]` to `screenshot` so mounted cached `<img data-screenshot-img>` is visible;
- leave missing screenshots as the existing placeholder;
- call `toPng(clone, { width, height, canvasWidth: width * scale, canvasHeight: height * scale, backgroundColor, pixelRatio: 1, cacheBust: true, skipAutoScale: false })`;
- remove the offscreen host in `finally`.

Return base64 without prefix plus:

```ts
interface BoardScreenshotResult {
  mimeType: 'image/png';
  base64: string;
  width: number;
  height: number;
  worldBounds: { x: number; y: number; width: number; height: number };
  includedNodeIds: string[];
  missingScreenshotNodeIds: string[];
}
```

- [ ] **Step 4: Confirm GREEN and manually verify**

Run:
- `npm run test -- src/lib/mcp/board-screenshot.test.ts`
- `npm run typecheck`

Manual check:
1. Put nodes at negative and positive coordinates and outside the viewport.
2. Include WebPage, sticky, text, and styled edge.
3. Capture whole board and a subset.
4. Verify visible viewport/selection do not move, no native Webview flashes, output longest side is at most 2048, all requested nodes/edges appear, and missing screenshot IDs match placeholders.
5. Repeat in light and dark themes.

- [ ] **Step 5: Document and commit**

```bash
git add package.json package-lock.json src/lib/mcp/board-screenshot.ts src/lib/mcp/board-screenshot.test.ts src/lib/mcp/editor-adapter.ts src/components/Sheltie/Sheltie.tsx docs/agents/sheltie-screenshots.md
git commit -m "feat: capture full Sheltie boards for MCP"
```

### Task 8: Wire phase-1 MCP tools and verify real clients

**Objective:** Expose the seven public tools with schemas, annotations, structured results, images, and stable errors.

**Files:**
- Create: `src-tauri/src/mcp/service.rs`
- Modify: `src-tauri/src/mcp/lifecycle.rs`
- Modify: `src-tauri/src/mcp/types.rs`
- Modify: `src/lib/mcp/renderer-bridge.ts`
- Modify: `src-tauri/src/menus/mcp.rs`
- Modify: `docs/agents/mcp.md`
- Modify: `docs/agents/architecture.md`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces: complete phase-1 MCP server contract consumed by phases 2–4.

- [ ] **Step 1: Write failing tool schema/annotation tests**

Instantiate `SheltieMcpService` with fake broker/document provider and inspect `tool_router.list_all()`. Assert exact names, required `documentId`, output schemas, and annotations. Add behavior tests for document-not-found, renderer timeout, atomic batch error, multi-image ordering, and image content blocks.

- [ ] **Step 2: Confirm RED**

Run: `(cd src-tauri && cargo test --lib mcp::service::tests)`

Expected: service/router does not exist.

- [ ] **Step 3: Implement the `rmcp` service**

Use `#[tool_router]` plus `#[tool_handler]`. Each input derives `serde::Deserialize` and `rmcp::schemars::JsonSchema`. Reads return typed `rmcp::Json<T>` when no image is needed. Image tools build `CallToolResult` with one metadata text/structured payload and ordered `ContentBlock::image(base64, "image/png")` entries.

Apply annotations in each macro, for example:

```rust
#[tool(
    name = "get_board",
    description = "Read nodes and edges from one open Sheltie document without changing selection or viewport",
    annotations(read_only_hint = true, destructive_hint = false, open_world_hint = false)
)]
```

`batch_edit_board` and `focus_nodes` call the renderer broker. `list_documents` reads `DocumentManagerState` directly. Translate every `RendererResult` error into `CallToolResult::structured_error` without losing its code.

Increment connected session count when the service factory creates a session lease; decrement when the final clone drops. Update the disabled menu label to `MCP Connections: N` on the main thread. Do not log tool parameters or page/board content.

- [ ] **Step 4: Confirm GREEN**

Run:
- `(cd src-tauri && cargo test --lib mcp::service::tests)`
- `(cd src-tauri && cargo test --lib)`
- `npm run test`
- `npm run typecheck`

Expected: all focused/full tests pass; tool names/schemas/annotations are stable.

- [ ] **Step 5: Verify Streamable HTTP with supported clients**

Enable MCP and configure:

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

Verify in Claude Code, Codex, and one of Cursor/VS Code:
1. Tool discovery lists exactly the seven phase-1 tools.
2. `list_documents` identifies two open native tabs/windows and one focused document.
3. `get_board` does not change selection or viewport.
4. A valid multi-operation batch is one Undo; invalid operation changes nothing.
5. No file is saved automatically; dirty indicator appears.
6. `focus_nodes` alone changes selection/viewport.
7. Multi-site screenshot returns every WebPage in board order from cache without showing hidden pages.
8. Board screenshot includes offscreen nodes and respects 2048 px cap.
9. Disabling MCP disconnects all clients and stops the port.
10. Requests with a foreign `Origin` or disallowed `Host` receive HTTP 403.

- [ ] **Step 6: Finish docs and commit**

Complete the phase-1 tool tables, JSON contracts, errors, setup examples, no-save rule, and client verification in `docs/agents/mcp.md`; align architecture responsibilities.

```bash
git add src-tauri/src/mcp/service.rs src-tauri/src/mcp/lifecycle.rs src-tauri/src/mcp/types.rs src/lib/mcp/renderer-bridge.ts src-tauri/src/menus/mcp.rs docs/agents/mcp.md docs/agents/architecture.md
git commit -m "feat: expose Sheltie board MCP tools"
```

## Validation

Run all project-required checks after Task 8:

- `npm run lint` — no ESLint errors.
- `npm run format` — all changed TypeScript, Rust-adjacent JSON, Markdown, and config files pass Prettier.
- `npm run typecheck` — strict TypeScript passes.
- `npm run test` — all Vitest suites pass.
- `(cd src-tauri && cargo fmt --check)` — Rust formatting passes.
- `(cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings)` — no Rust warnings.
- `(cd src-tauri && cargo test --lib)` — MCP lifecycle, broker, service and existing Rust tests pass.
- Manual macOS Tauri/client matrix in Task 8 — all ten checks recorded in the PR description.

## Risks, Tradeoffs, and Resolved Decisions

- **No auth:** any process running as the user can connect while MCP is enabled. This is intentional; default-off persisted opt-in and loopback/Host/Origin controls are the boundary.
- **Fixed port:** a collision prevents startup and returns the menu to off. There is no fallback port because client configuration must remain stable.
- **Rust version:** `rmcp 2.2.0` requires an edition-2024-capable toolchain; the plan aligns Cargo metadata with the existing Rust 1.93.1 mise pin.
- **Renderer bridge:** board state remains in Zustand. Rust does not mirror document content, preventing two sources of truth at the cost of a request timeout boundary.
- **No saving:** MCP edits remain dirty until the user uses existing Save/Save As. This is intentional.
- **Cached overview:** hidden Webviews are not recaptured. `capturedAt`, `capturedUrl`, and missing IDs make staleness observable.
- **Board PNG fidelity:** the renderer captures a normalized clone of the existing React Flow DOM rather than recreating node visuals in Rust. Manual checks protect against portal/tooling elements leaking into output.
- **Image size:** 1024 px per WebPage and 2048 px for the board prevent unbounded MCP context growth; original persisted cache files remain unchanged.
- **Selection ownership:** Phase 1 keeps existing React ownership and registers a runtime adapter instead of moving ephemeral selection into persisted Zustand state.
