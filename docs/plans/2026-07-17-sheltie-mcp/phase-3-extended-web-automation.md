# Sheltie MCP Phase 3: Extended Web Automation Implementation Plan

> **Parent plan:** [`../2026-07-17-sheltie-mcp.md`](../2026-07-17-sheltie-mcp.md)
>
> **For implementers:** Execute this plan task-by-task with red → green → refactor. Complete every checkbox, run the listed validation, and commit after each task. Start only after Phases 1 and 2 are merged.

**Goal:** Extend Sheltie’s local MCP server with macOS/WKWebView coordinate fallback, bounded screenshots, in-page target highlighting, evaluation, trusted-client bounded upload, same-node popup navigation, and a nonblocking JavaScript-dialog policy.

**Architecture:** Phase 1 continues to own the HTTP lifecycle and Rust-to-renderer broker; Phase 2 continues to own the serial actor and all-frame page bridge. Phase 3 adds typed operations to `mcp/page_automation/{protocol,actor}.rs` and its existing injected script. It never creates a second automation queue, raw `eval` route, or temporary display-mode transition. Screenshot tools inspect the renderer’s existing display mode: native pages may be captured, while hidden/screenshot pages use Phase 1’s cache only or return a stable error.

**Tech Stack:** Rust 1.93.1, Tauri 2.10, rmcp 2.2.0, Tokio, macOS WKWebView/AppKit, React 19, TypeScript 5.7, Vitest, jsdom 29.1.1 from Phase 2, and `image` 0.25.10 for capped PNG processing.

## Global Constraints

- Phase 1 public Rust interfaces are exact:

  ```rust
  // src-tauri/src/mcp/lifecycle.rs
  pub struct McpServerState;

  // src-tauri/src/mcp/broker.rs
  pub struct McpRequestBrokerState;

  // src-tauri/src/mcp/types.rs
  pub struct ToolError { /* code, message, retry? */ }
  ```

  Use `ToolError` for every MCP-visible error and `McpRequestBrokerState` for renderer requests. Do not add a second automation namespace, HTTP lifecycle, or renderer request channel.

- Phase 2 public implementation paths are exact:

  ```text
  src-tauri/src/mcp/page_automation/mod.rs
  src-tauri/src/mcp/page_automation/protocol.rs
  src-tauri/src/mcp/page_automation/actor.rs
  src-tauri/src/mcp/tools/browser.rs
  src-tauri/src/commands/webview/page_automation.rs
  src-tauri/src/commands/webview/page_automation_script.js
  ```

  The script is installed with `initialization_script_for_all_frames` in `src-tauri/src/commands/webview/bounds.rs`. Extend this fixed all-frame script and fixed request-ID completion protocol; do not create `scripts.rs` automation code or another page script path.

- `src-tauri/Cargo.toml` has `rust-version = "1.93.1"` after Phase 1. Add exactly:

  ```toml
  image = { version = "0.25.10", default-features = false, features = ["png"] }
  ```

  `image` 0.25.10 requires Rust 1.88 or newer, which Rust 1.93.1 satisfies.

- Support macOS/WKWebView only. On any other platform, Phase 3 tools return `unsupported_platform` before renderer or actor dispatch. Do not add Windows/Linux behavior, OS accessibility permissions, or OS-level mouse/keyboard injection.
- Every page tool requires explicit `documentId` and `pageNodeId`. Resolve the page once through the Phase 2 page resolver; never use focus, selection, or a reconstructed label as the operation target.
- The Phase 2 `PageAutomationState` retains its FIFO queue per `PageKey`. All Phase 3 DOM operations and full-page capture tiles run through that actor. Operations for distinct pages may run concurrently.
- Semantic element references remain the preferred operation mechanism. `browser_click_coordinates` is only a fallback after a current compact snapshot cannot expose a usable semantic target. Its successful result always states `inputTrusted: false` because synthetic Pointer/Mouse events have `isTrusted === false`.
- Board edits and browser actions remain separate. Phase 3 does not change `batch_edit_board`, documents, Undo/Redo, save behavior, selection, viewport, Phase 1 multi-site overview, or Phase 1 full-board screenshots.
- **Never show, move, resize, navigate, or otherwise temporarily reveal a hidden/offscreen WKWebView for a screenshot.** Do not add a renderer temporary-live lease, `webviewApi.show()` path, or display-engine override.
  - `browser_screenshot` with `mode: "viewport"` returns the Phase 1 cached page PNG when the page is `screenshot` or `hidden`; if no cache exists, return `screenshot_failed`.
  - `browser_screenshot` with `mode: "element"` or `mode: "fullPage"` requires `displayMode === "native"`. For `screenshot` or `hidden`, return `live_webview_required` with retry `Bring the WebPage into the visible native area, then retry browser_screenshot.`
  - A currently native page may be captured through the existing visible-only WKWebView snapshot helper. A capture failure returns its current cache for `viewport`, but returns `screenshot_failed` for `element` and `fullPage`.
- Do not overwrite the persisted renderer cache in `~/Library/Application Support/.../screenshots` with a crop, annotated image, full-page stitch, or downscaled MCP result. Phase 3 image bytes are transient MCP output only.
- Centralize these limits in `src-tauri/src/mcp/page_automation/protocol.rs`:

  ```rust
  pub const PAGE_AUTOMATION_REQUEST_TIMEOUT_MS: u64 = 15_000; // Phase 2 existing
  pub const PAGE_AUTOMATION_EVALUATE_TIMEOUT_MS: u64 = 10_000;
  pub const PAGE_AUTOMATION_MAX_EVALUATE_RESPONSE_BYTES: usize = 256 * 1024;
  pub const PAGE_AUTOMATION_MAX_SCREENSHOT_EDGE_PX: u32 = 4_096;
  pub const PAGE_AUTOMATION_MAX_SCREENSHOT_PIXELS: u64 = 16_777_216;
  pub const PAGE_AUTOMATION_MAX_SCREENSHOT_PNG_BYTES: usize = 8 * 1024 * 1024;
  pub const PAGE_AUTOMATION_MAX_FULL_PAGE_TILES: usize = 64;
  pub const PAGE_AUTOMATION_MAX_UPLOAD_FILES: usize = 10;
  pub const PAGE_AUTOMATION_MAX_UPLOAD_FILE_BYTES: u64 = 25 * 1024 * 1024;
  pub const PAGE_AUTOMATION_MAX_UPLOAD_TOTAL_BYTES: u64 = 100 * 1024 * 1024;
  pub const PAGE_AUTOMATION_HIGHLIGHT_FADE_MS: u32 = 180;
  ```

  Downscale screenshots proportionally until all dimension, pixel, and encoded PNG-byte limits hold. Validate every upload count/size before reading any file.
- All successful actions that alter page state return the Phase 2 post-action compact snapshot with a new `snapshotId`; previous `snapshotId`/`elementRef` pairs are stale. `browser_evaluate` also returns this snapshot because arbitrary page code can mutate the DOM.
- Treat `target="_blank"` and `window.open()` as an in-place navigation of the existing WebPage node. It keeps `pageNodeId`, uses the normal navigation event path, advances the Phase 2 navigation epoch, and never creates a Tauri window or board node.
- Target highlighting is entirely in the injected page script: isolated fixed-position DOM, thin translucent fill, colored 2px rounded rectangle, `pointer-events: none`, scroll/resize tracking, and 180ms fade after the action. It must not affect page layout or require a renderer overlay.
- Native JavaScript dialogs cannot be safely paused then resumed through injected JavaScript. The page script replaces `alert`, `confirm`, and `prompt` with a synchronous shim: it records the dialog in the action result, returns an explicitly configured next response, then resets to safe defaults (`undefined`, `false`, and `null`). `browser_handle_dialog` configures the response before retrying an action; it never claims to resolve a dialog already blocking native WebKit UI.
- `browser_upload_file` follows the project-wide trusted-client boundary: the connected local client may name any absolute path readable by the Sheltie process. Phases 1–3 do not negotiate MCP roots, so do not invent a per-session roots contract. Canonicalize each path, require a regular file, enforce count/per-file/total limits before reads, keep bytes in memory only until the page bridge responds, and never log or return absolute paths or base64 content. Normal user clicks on `<input type=file>` retain Wry’s existing `NSOpenPanel` behavior.
- Do not return cookie values, request headers, password/OTP values, `localStorage`, `sessionStorage`, file bytes, absolute upload paths, or arbitrary object graphs through ordinary tools. `browser_evaluate` intentionally returns only a JSON-safe value explicitly produced by trusted page-origin JavaScript.

## Current Context

- Phase 1 binds and serves MCP through `src-tauri/src/mcp/lifecycle.rs::McpServerState`; it routes document renderer work through `src-tauri/src/mcp/broker.rs::McpRequestBrokerState`; stable MCP errors are `ToolError` in `src-tauri/src/mcp/types.rs`.
- Phase 1’s `get_webpage_screenshots` is cache-first: it may refresh a page already in `native` mode but does not reveal a `screenshot` or `hidden` WebView. Its result carries cached image bytes and freshness metadata.
- Phase 2 keeps `PageKey`, `PageAutomationOperation`, compact snapshots, request IDs, navigation epochs, and current element-reference validation in `mcp/page_automation/protocol.rs`; `PageAutomationState` in `actor.rs` serializes each live page.
- `src-tauri/src/commands/webview/page_automation.rs` owns fixed native dispatch and verifies completion against request ID, document ID, page node ID, document-window label, and child-Webview label.
- `src-tauri/src/commands/webview/page_automation_script.js` is the only automation script. It is injected in every frame through `initialization_script_for_all_frames`; descendants communicate with the top frame over `postMessage` and only the top frame invokes `complete_page_automation_request`.
- `src-tauri/src/commands/webview/snapshot.rs` already captures only visible native WKWebViews. Its `NSImage is null (Webview may be hidden)` failure is expected behavior, not a condition to work around.
- `src/hooks/sheltie/useSheltieDisplayEngine.ts` remains authoritative for `native`, `screenshot`, and `hidden`. Phase 3 only asks the existing Phase 1 renderer adapter to report the current mode/cache descriptor; it does not mutate mode.
- Tauri 2.10.2 exposes `WebviewBuilder::on_new_window`, and Wry 0.54.2 handles the normal macOS file chooser for user-initiated file inputs.

## File Structure

- Modify: `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` — add exact PNG-only `image` dependency; retain Rust 1.93.1 established by Phase 1.
- Modify: `src-tauri/src/mcp/page_automation/protocol.rs` — add Phase 3 operation variants, limits, screenshot/display descriptors, and `ToolError` constructors.
- Modify: `src-tauri/src/mcp/page_automation/actor.rs` — execute Phase 3 operations in the existing per-page queue, including native-only tile capture and timeout cleanup.
- Create: `src-tauri/src/mcp/page_automation/images.rs` — transient PNG crop, annotation, stitch, downscale, and encode helpers with inline Rust tests.
- Create: `src-tauri/src/mcp/page_automation/uploads.rs` — canonical regular-file validation and bounded upload payload reads with inline Rust tests.
- Modify: `src-tauri/src/mcp/page_automation/mod.rs` — export the new helpers without creating a second actor state.
- Modify: `src-tauri/src/mcp/tools/browser.rs` — add Phase 3 MCP schemas and handlers to the existing browser tool module.
- Modify: `src-tauri/src/commands/webview/page_automation.rs` — add fixed native capture dispatch helpers and completion-safe bridge operations.
- Modify: `src-tauri/src/commands/webview/scripts.rs` — replace Phase 2's no-evaluate source assertion with the Phase 3 typed-evaluate boundary checks.
- Modify: `src-tauri/src/commands/webview/page_automation_script.js` — extend the existing all-frame bridge with coordinate input, highlight, dialog policy, evaluate, upload, and full-page measurement/scroll helpers.
- Modify: `src-tauri/src/commands/webview/bounds.rs` — install the in-place popup policy in the existing child-Webview builder.
- Modify: `src/lib/mcp/types.ts` — add `getPageScreenshotSource` renderer command/result types.
- Modify: `src/lib/mcp/editor-adapter.ts` — expose current page display mode and cached screenshot descriptor without changing it.
- Modify: `src/lib/mcp/renderer-bridge.ts` — handle `getPageScreenshotSource` through the Phase 1 request/response route.
- Modify: `src/components/Sheltie/Sheltie.tsx` — register a read-only display/cache accessor with the existing editor adapter.
- Modify: `docs/agents/mcp.md` — add the Phase 3 tool contracts, error codes, visibility policy, and trust limitations.
- Modify: `docs/agents/architecture.md`, `docs/agents/tauri-ipc.md`, `docs/agents/sheltie-runtime.md`, `docs/agents/sheltie-screenshots.md`, `docs/agents/wkwebview-internals.md` — document only the permanent contracts changed by this phase.

## Tool Contracts

Use the Phase 1 `ToolError` envelope in `structuredContent` and text content:

```json
{
  "code": "live_webview_required",
  "message": "Element and full-page screenshots require a currently native WebPage.",
  "retry": "Bring the WebPage into the visible native area, then retry browser_screenshot."
}
```

Add these tools to the existing Phase 2 `src-tauri/src/mcp/tools/browser.rs` router:

```text
browser_screenshot(
  documentId, pageNodeId,
  mode: "viewport" | "element" | "fullPage",
  elementRef?, annotate?
)

browser_click_coordinates(
  documentId, pageNodeId, snapshotId,
  x, y,
  button?: "left" | "middle" | "right",
  clickCount?: 1 | 2,
  highlight?: { x, y, width, height }
)

browser_evaluate(documentId, pageNodeId, script)

browser_upload_file(documentId, pageNodeId, snapshotId, elementRef, paths[])

browser_handle_dialog(
  documentId, pageNodeId,
  action: "accept" | "dismiss",
  promptText?
)
```

Results:

```text
browser_screenshot
  viewport native/cache: { image, width, height, scaleApplied, source: "native" | "cached",
                           mode: "viewport", annotated, warning? }
  element/fullPage native: { image, width, height, scaleApplied, source: "native",
                             mode, annotated, warning? }

browser_click_coordinates
  { inputTrusted: false, snapshot, warning? }

browser_evaluate
  { value: JSONValue, snapshot }

browser_upload_file
  { files: [{ name, size }], inputTrusted: false, snapshot }

browser_handle_dialog
  { configured: true }
```

`browser_screenshot` rules:

| Mode | `native` page | `screenshot` / `hidden` page |
| --- | --- | --- |
| `viewport` | Capture visible WKWebView; on failure return Phase 1 cache if available. | Return Phase 1 cache; do not invoke/capture/reveal the WebView. |
| `element` | Resolve a current ref and crop a visible native capture. | `live_webview_required`. |
| `fullPage` | Serialize scroll/capture/stitch through the actor and restore scroll in `finally`. | `live_webview_required`. |

If `viewport` has no cached PNG while not native, return `screenshot_failed` with retry `Open the WebPage until a native screenshot is captured, then retry.` `annotate: true` is supported for native capture only; a cached response reports `annotated: false` with warning `Cached screenshot cannot be annotated without revealing the WebView.`

## Tasks

### Task 1: Extend the Phase 2 protocol using Phase 1 errors

**Objective:** Define all Phase 3 operations and stable failure behavior inside the existing protocol module before modifying WebKit or MCP handlers.

**Files:**
- Modify: `src-tauri/src/mcp/page_automation/protocol.rs`
- Modify: `src-tauri/src/mcp/page_automation/mod.rs`

**Interfaces:**
- Consumes: Phase 1 `ToolError`, Phase 2 `PageKey`, `CompactSnapshot`, and `PageAutomationOperation`.
- Produces: Phase 3 variants, limits, `PageScreenshotSource`, `CssRect`, and named `ToolError` constructors used by later tasks.

- [ ] **Step 1: Write failing inline Rust tests**

In `protocol.rs`, add a `#[cfg(test)] mod tests` that verifies:

1. `Screenshot { mode: Element }` without `element_ref` returns `invalid_argument`.
2. coordinate actions reject non-finite `x`/`y`, invalid button values, click counts outside 1–2, and negative/non-finite highlight dimensions as `invalid_argument`.
3. non-macOS checks return `unsupported_platform` before operation enqueue.
4. `live_webview_required()` serializes the exact retry sentence from the tool contract.
5. an evaluate JSON result over `PAGE_AUTOMATION_MAX_EVALUATE_RESPONSE_BYTES` becomes `evaluate_result_too_large`.
6. a `PageScreenshotSource { display_mode: "hidden", cached: None }` selects `screenshot_failed` for viewport and `live_webview_required` for element/fullPage.

- [ ] **Step 2: Confirm RED**

Run:

```bash
(cd src-tauri && cargo test mcp::page_automation::protocol::tests)
```

Expected: compilation fails because the Phase 3 types, constants, and error constructors do not exist.

- [ ] **Step 3: Add the typed variants and error constructors**

Add these variants to the existing enum rather than a new operation enum:

```rust
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PageAutomationOperation {
    // existing Phase 2 variants
    ScreenshotElement { snapshot_id: String, element_ref: String, annotate: bool },
    ScreenshotFullPage { annotate: bool },
    ClickCoordinates {
        snapshot_id: String,
        x: f64,
        y: f64,
        button: MouseButton,
        click_count: u8,
        highlight: Option<CssRect>,
    },
    Evaluate { script: String },
    UploadFiles {
        snapshot_id: String,
        element_ref: String,
        files: Vec<UploadFilePayload>,
    },
    SetDialogHandler { action: DialogAction, prompt_text: Option<String> },
}
```

Keep `ScreenshotElement` and `ScreenshotFullPage` actor-only operations. `browser_screenshot` decides whether its viewport result comes from a native capture or Phase 1 cache before it enqueues any page operation.

Define errors through `ToolError::new(code, message).with_retry(...)`, using exact codes: `unsupported_platform`, `invalid_argument`, `live_webview_required`, `screenshot_failed`, `screenshot_target_not_visible`, `page_changed_during_capture`, `screenshot_too_large`, `evaluate_not_json`, `evaluate_timeout`, `evaluate_result_too_large`, `upload_file_invalid`, `upload_target_not_file_input`, and existing Phase 2 `stale_element`/`element_not_found`/`webview_not_ready`.

- [ ] **Step 4: Confirm GREEN**

Run:

```bash
(cd src-tauri && cargo test mcp::page_automation::protocol::tests)
```

Expected: all protocol tests pass and every Phase 3 MCP failure can be constructed without an ad-hoc string envelope.

- [ ] **Step 5: Commit protocol changes**

```bash
git add src-tauri/src/mcp/page_automation/protocol.rs src-tauri/src/mcp/page_automation/mod.rs
git commit -m "feat(mcp): extend page automation protocol"
```

### Task 2: Add transient PNG processing with strict caps

**Objective:** Process native or cached PNG bytes into bounded MCP output without changing the persisted screenshot cache.

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src-tauri/src/mcp/page_automation/images.rs`
- Modify: `src-tauri/src/mcp/page_automation/mod.rs`

**Interfaces:**
- Consumes: `PageAutomationOperation` screenshot geometry and Phase 1 cached/native PNG bytes.
- Produces: `encode_capped_png`, `crop_css_rect`, `stitch_vertical_tiles`, and `annotate_css_rect`.

- [ ] **Step 1: Write failing inline image tests**

Add `#[cfg(test)] mod tests` in `images.rs`, creating source PNGs in memory. Cover:

1. a CSS crop `(1, 1, 2, 2)` at scale 2 maps to pixel crop `(2, 2, 4, 4)`;
2. a crop outside the visible image returns `screenshot_target_not_visible`, never a partial crop;
3. two vertical tiles with a 1px overlap stitch in order without duplicate overlap;
4. annotation adds translucent fill and a colored 2px border at the converted image coordinates;
5. a 5000×1000 PNG scales below the 4096px edge cap;
6. an output over the 8 MiB encoded cap is repeatedly reduced until it fits, retaining `scale_applied`.

- [ ] **Step 2: Confirm RED**

Run:

```bash
(cd src-tauri && cargo test mcp::page_automation::images::tests)
```

Expected: compilation fails because the image dependency and helper module do not exist.

- [ ] **Step 3: Add exact dependency and image helpers**

Add exactly this `Cargo.toml` dependency and update `Cargo.lock` through Cargo:

```toml
image = { version = "0.25.10", default-features = false, features = ["png"] }
```

Decode only PNG, use `image::imageops::FilterType::Lanczos3` for proportional downscaling, and encode a PNG after each reduction. Enforce edge, pixel, and encoded-byte caps. If a 1×1 image exceeds the encoded cap, return `screenshot_too_large` instead of looping.

Keep all decoded/stiched/annotated images in memory. Do not call `save_webview_screenshot`, write a file, or update Phase 1 cache metadata.

- [ ] **Step 4: Confirm GREEN**

Run:

```bash
(cd src-tauri && cargo test mcp::page_automation::images::tests)
(cd src-tauri && cargo test --lib)
```

Expected: all image tests and the complete Rust library suite pass.

- [ ] **Step 5: Commit image processing**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/mcp/page_automation/images.rs src-tauri/src/mcp/page_automation/mod.rs
git commit -m "feat(mcp): add bounded page screenshot encoding"
```

### Task 3: Extend the existing all-frame bridge for visual fallback

**Objective:** Add coordinate input, highlight, dialog policy, JSON-safe evaluation, upload assignment, and screenshot geometry to the exact Phase 2 script and completion route.

**Files:**
- Modify: `src-tauri/src/commands/webview/page_automation_script.js`
- Modify: `src-tauri/src/commands/webview/page_automation.rs`
- Modify: `src-tauri/src/commands/webview/scripts.rs`
- Modify: `src-tauri/src/mcp/page_automation/actor.rs`
- Modify: `src-tauri/src/mcp/page_automation/protocol.rs`
- Modify: `src/lib/mcp/page-automation-script.test.ts`

**Interfaces:**
- Consumes: Phase 2 fixed namespace `window.__SHELTIE_MCP_PAGE_AUTOMATION__.dispatch`, all-frame `postMessage` routing, and completion command.
- Produces: page bridge results for every new `PageAutomationOperation`; only the top frame calls `complete_page_automation_request`.

- [ ] **Step 1: Add failing jsdom and actor tests**

Extend `src/lib/mcp/page-automation-script.test.ts` to execute the exact script and test:

1. coordinate click dispatches pointer/mouse events at unchanged CSS viewport coordinates and returns `inputTrusted: false`;
2. an overlay has `pointer-events: none`, a 2px border, translucent background, tracks scroll/resize, and is removed after the configured fade;
3. `alert`, `confirm`, and `prompt` record a dialog and synchronously use configured accept/dismiss/prompt values, then reset to default dismiss;
4. `Promise.resolve({ ok: true })` evaluates to JSON; `undefined` and circular results return `evaluate_not_json`;
5. upload accepts only a resolved `input[type=file]`, assigns `DataTransfer.files`, emits `input` then `change`, and returns basename/size only;
6. full-page geometry reports viewport/document dimensions and restores the original scroll after a test tile sequence.
7. an unknown operation cannot reach the evaluation helper, while typed `Evaluate` reaches it once with the serialized `source` value.

In the existing `#[cfg(test)]` module in `actor.rs`, add a queue test proving an extended operation cannot interleave with a same-page semantic action and is removed after a timeout.

Update the Phase 2 source-safety test in `src-tauri/src/commands/webview/scripts.rs`: remove its now-obsolete assertion that the shared page script contains no `eval(`. Replace it with assertions that the script contains exactly one indirect evaluation site, the literal `(0, eval)(source)`, and contains neither `window.eval` nor `new Function`; verify `page_automation.rs` still builds only the fixed `window.__SHELTIE_MCP_PAGE_AUTOMATION__.dispatch({request_json});` native expression from a typed serialized request. This test documents the Phase 3 trust boundary rather than claiming evaluation is absent.

- [ ] **Step 2: Confirm RED**

Run:

```bash
npm run test -- src/lib/mcp/page-automation-script.test.ts
(cd src-tauri && cargo test mcp::page_automation::actor::tests)
(cd src-tauri && cargo test commands::webview::scripts::tests)
```

Expected: the new operation tests fail because bridge handlers and actor variants do not exist, and the updated source-boundary test fails until the exact typed evaluation route is added.

- [ ] **Step 3: Implement fixed page-side operations**

Extend the same strict-IIFE script; do not add imports, a second global namespace, or a direct arbitrary Tauri command. Dispatch all operations through the existing request JSON and send only JSON-safe results through its existing top-frame completion.

For coordinates, call `document.elementFromPoint(x, y)`, display the supplied highlight rectangle (or a 1 CSS-pixel rectangle at the point), then dispatch `PointerEvent` where supported and `MouseEvent` fallback for `pointerdown`, `mousedown`, `pointerup`, `mouseup`, and `click`. Return `{ inputTrusted: false }`; never imply trusted input.

For the overlay, append an isolated `div` to `document.documentElement` with this style contract:

```js
overlay.style.cssText = [
  'position:fixed', 'z-index:2147483647', 'pointer-events:none',
  'box-sizing:border-box', 'border:2px solid #6366f1',
  'background:rgba(99,102,241,.14)', 'border-radius:4px',
  'transition:opacity 180ms ease-out',
].join(';');
```

Use the original target’s `getBoundingClientRect()` when available; otherwise use the coordinate rectangle. Register capture-phase scroll and window resize listeners, update with `requestAnimationFrame`, then remove listeners and element after the post-action snapshot plus 180ms fade.

Replace `alert`, `confirm`, and `prompt` once. Preserve one pending next-response policy set by `SetDialogHandler`; `confirm` default is false and `prompt` default is null. Include a redacted `{ type, message, defaultValue? }` entry in the next action response. Do not call original dialog functions, persist prompt text, or claim the dialog was paused.

Evaluate only serialized `source` data from `Evaluate`, never source interpolated into native Rust JavaScript. In page JavaScript execute:

```js
async function evaluateForMcp(source) {
  const value = await (0, eval)(source);
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('evaluate_not_json');
  return JSON.parse(json);
}
```

Race the Promise against 10,000ms, apply the UTF-8 byte cap in Rust, and map circular/BigInt/undefined serialization to `evaluate_not_json`.

For uploads, accept Rust-prevalidated base64 payloads, construct `File` objects with sanitized basenames and MIME, assign a `DataTransfer` list to the resolved current `<input type=file>`, and dispatch bubbling `input` then `change`. Return names and sizes only. Do not replace the normal Wry `NSOpenPanel` route for user clicks.

For screenshots, return current element rect/viewport dimensions for `ScreenshotElement`, and implement `ScreenshotFullPage` as actor-directed measurement/scroll steps. It must wait two animation frames after each scroll, use a 1 CSS-pixel tile overlap, and restore original scroll coordinates in script `finally` handling. The script never captures pixels itself.

- [ ] **Step 4: Implement actor-side native capture sequencing**

In `actor.rs`, keep all requests within the existing queue. For a native `ScreenshotElement`, resolve current ref/rect through the bridge, verify it is completely inside `innerWidth`/`innerHeight`, call a fixed native helper in `page_automation.rs` that uses the existing visible-only `capture_webview_png_bytes`, then crop/annotate through `images.rs`.

For `ScreenshotFullPage`, get dimensions and initial scroll from the bridge, reject over `PAGE_AUTOMATION_MAX_FULL_PAGE_TILES`, direct each scroll via the bridge, capture one visible native tile through the fixed helper, stitch through `images.rs`, and restore original scroll in a `finally` cleanup request. If navigation epoch changes, restore scroll when possible and return `page_changed_during_capture`; do not replay tiles or the prior action.

The native helper resolves the Phase 2 expected child label and uses no renderer display APIs. It returns `webview_not_ready`/`screenshot_failed` on missing/hidden capture failure. It does not save PNG data.

- [ ] **Step 5: Confirm GREEN**

Run:

```bash
npm run test -- src/lib/mcp/page-automation-script.test.ts
(cd src-tauri && cargo test mcp::page_automation::actor::tests)
(cd src-tauri && cargo test commands::webview::page_automation::tests)
(cd src-tauri && cargo test commands::webview::scripts::tests)
```

Expected: exact-script jsdom tests, actor queue tests, native-helper validation tests, and the typed-evaluate source-boundary tests pass.

- [ ] **Step 6: Commit bridge extensions**

```bash
git add src-tauri/src/commands/webview/page_automation_script.js src-tauri/src/commands/webview/page_automation.rs src-tauri/src/commands/webview/scripts.rs src-tauri/src/mcp/page_automation/actor.rs src-tauri/src/mcp/page_automation/protocol.rs src/lib/mcp/page-automation-script.test.ts
git commit -m "feat(mcp): add visual page automation bridge"
```

### Task 4: Add renderer read-only screenshot-source lookup

**Objective:** Let browser screenshot handlers distinguish native capture from cache output without changing a page’s display state.

**Files:**
- Modify: `src/lib/mcp/types.ts`
- Modify: `src/lib/mcp/editor-adapter.ts`
- Modify: `src/lib/mcp/renderer-bridge.ts`
- Modify: `src/components/Sheltie/Sheltie.tsx`
- Modify: `src-tauri/src/mcp/types.rs`
- Modify: `src-tauri/src/mcp/broker.rs`

**Interfaces:**
- Consumes: Phase 1 renderer bridge and existing `webviewRuntime` display/cache state.
- Produces renderer command/result `getPageScreenshotSource(documentId, pageNodeId)`:

  ```ts
  type PageScreenshotSource = {
    displayMode: 'native' | 'screenshot' | 'hidden';
    cached?: {
      base64: string;
      width: number;
      height: number;
      capturedAt: string;
      capturedUrl: string | null;
    };
  };
  ```

- [ ] **Step 1: Write failing TypeScript adapter tests**

In `src/lib/mcp/editor-adapter.test.ts`, add pure registration tests that verify a registered source accessor returns the exact current display mode/cache descriptor, does not call focus/viewport/display setters, and returns `renderer_unavailable` after cleanup. Add a test that a cache descriptor without a native mode remains `screenshot`/`hidden`; do not normalize it to native.

- [ ] **Step 2: Confirm RED**

Run:

```bash
npm run test -- src/lib/mcp/editor-adapter.test.ts
```

Expected: TypeScript fails because `getPageScreenshotSource` is not part of the adapter contract.

- [ ] **Step 3: Implement read-only broker routing**

Add the typed `RendererCommand::GetPageScreenshotSource` and matching TypeScript command in Phase 1’s existing bridge types. Have the existing `McpRequestBrokerState` dispatch it to the document renderer exactly as any other request; do not add a Tauri command or direct Rust-to-Webview call.

Register the adapter in `Sheltie.tsx` using existing display-engine state and cached screenshot runtime metadata. It returns only current mode and decoded/transient cache bytes. It must not call `computeDisplayModes`, `show`, `hide`, `updateBounds`, `setViewport`, or any screenshot queue refresh function.

- [ ] **Step 4: Confirm GREEN**

Run:

```bash
npm run test -- src/lib/mcp/editor-adapter.test.ts
npm run typecheck
(cd src-tauri && cargo test mcp::broker::tests)
```

Expected: adapter, type, and broker tests pass; the lookup is read-only.

- [ ] **Step 5: Commit source lookup**

```bash
git add src/lib/mcp/types.ts src/lib/mcp/editor-adapter.ts src/lib/mcp/editor-adapter.test.ts src/lib/mcp/renderer-bridge.ts src/components/Sheltie/Sheltie.tsx src-tauri/src/mcp/types.rs src-tauri/src/mcp/broker.rs
git commit -m "feat(mcp): expose page screenshot sources"
```

### Task 5: Add trusted-client bounded uploads and evaluation helpers

**Objective:** Validate trusted-client local upload paths before page dispatch and ensure evaluation cannot hang or return non-JSON/unbounded data.

**Files:**
- Create: `src-tauri/src/mcp/page_automation/uploads.rs`
- Modify: `src-tauri/src/mcp/page_automation/mod.rs`
- Modify: `src-tauri/src/mcp/page_automation/actor.rs`
- Modify: `src-tauri/src/mcp/page_automation/protocol.rs`

**Interfaces:**
- Consumes: tool-provided absolute paths under the established trusted-client boundary and Phase 2 snapshot/ref validation.
- Produces: `read_upload_files(paths) -> Result<Vec<UploadFilePayload>, ToolError>`.

- [ ] **Step 1: Write failing inline upload tests**

In `uploads.rs`, use temporary directories and add `#[cfg(test)] mod tests` cases for:

1. an absolute path to a readable regular file succeeds with basename and exact byte count;
2. a relative path, directory, nonexistent path, or unreadable file returns `upload_file_invalid`;
3. a symlink is canonicalized and accepted only when its target is a readable regular file;
4. more than 10 files, a file above 25 MiB, or total size above 100 MiB fails before `std::fs::read`;
5. success and failure data contain basenames only, never absolute requested or canonical paths.

In the existing protocol tests, cover Promise timeout, `undefined`, circular, and oversized evaluation results.

- [ ] **Step 2: Confirm RED**

Run:

```bash
(cd src-tauri && cargo test mcp::page_automation::uploads::tests)
(cd src-tauri && cargo test mcp::page_automation::protocol::tests)
```

Expected: compilation fails because bounded upload reading does not exist.

- [ ] **Step 3: Implement validation before reads**

Reject non-absolute requested paths, canonicalize each path, and require canonical metadata to describe a readable regular file. Check the file count first, gather metadata, and apply per-file/total limits before reading any bytes. Only then read files, base64 encode them, and build internal `UploadFilePayload { name, mime_type, bytes_base64 }`. Use a small extension map and `application/octet-stream` fallback; do not add content sniffing.

Do not query `roots/list`, accept a roots list, or add a general filesystem tool: the no-auth loopback MCP connection is already the explicit trust boundary. Do not log requested/canonical path strings or base64 data; MCP results expose basenames and sizes only.

- [ ] **Step 4: Confirm GREEN**

Run:

```bash
(cd src-tauri && cargo test mcp::page_automation::uploads::tests)
(cd src-tauri && cargo test mcp::page_automation::protocol::tests)
(cd src-tauri && cargo test --lib)
```

Expected: all upload/protocol/Rust tests pass.

- [ ] **Step 5: Commit safe upload/evaluate plumbing**

```bash
git add src-tauri/src/mcp/page_automation/uploads.rs src-tauri/src/mcp/page_automation/mod.rs src-tauri/src/mcp/page_automation/actor.rs src-tauri/src/mcp/page_automation/protocol.rs
git commit -m "feat(mcp): add bounded evaluation and uploads"
```

### Task 6: Add in-place popup navigation and Phase 3 MCP tools

**Objective:** Expose the completed operations through the established browser tool router while ensuring popup navigation remains in the existing page node.

**Files:**
- Modify: `src-tauri/src/commands/webview/bounds.rs`
- Modify: `src-tauri/src/mcp/tools/browser.rs`
- Modify: `src-tauri/src/mcp/page_automation/actor.rs`
- Modify: `src-tauri/src/mcp/page_automation/protocol.rs`

**Interfaces:**
- Consumes: Phase 1 `McpServerState` service registration, `McpRequestBrokerState`, Phase 2 page resolver/actor, Tasks 1–5.
- Produces: the five Phase 3 MCP tools and in-place `on_new_window` behavior.

- [ ] **Step 1: Write failing inline Rust handler tests**

In the existing `#[cfg(test)]` module in `src-tauri/src/mcp/tools/browser.rs`, add tests using the Phase 2 fake resolver/actor traits:

1. every new tool rejects missing `documentId`/`pageNodeId` before actor or broker dispatch;
2. `browser_screenshot` uses cached bytes for hidden `viewport`, returns `live_webview_required` for hidden `element`/`fullPage`, and never calls native capture in either hidden case;
3. native `viewport` calls capture once and falls back to cache only after a capture failure;
4. coordinate input validates button/count/rect and returns `inputTrusted: false`;
5. upload validates a nonempty absolute-path list and delegates canonicalization, regular-file checks, and byte limits only to `read_upload_files`;
6. evaluate rejects empty script, and dialog handler accepts only `accept`/`dismiss`;
7. annotations: screenshot is read-only, coordinate/upload/dialog/evaluate are destructive, and evaluate description explicitly says arbitrary page-origin JavaScript runs;
8. all action results use the existing Phase 2 post-action snapshot path exactly once.

- [ ] **Step 2: Confirm RED**

Run:

```bash
(cd src-tauri && cargo test mcp::tools::browser::tests)
```

Expected: the existing router lacks Phase 3 tool schemas and handlers.

- [ ] **Step 3: Implement screenshot routing without reveal**

Resolve page ownership using the existing Phase 2 resolver, then request `GetPageScreenshotSource` through `McpRequestBrokerState`.

- For `viewport` plus `native`, call the fixed native visible-capture helper. If it succeeds, process it through `images.rs` and return `source: "native"`. If it fails and renderer cache exists, process that PNG and return `source: "cached"` plus warning `Native screenshot failed; returned the existing cached image.` If both fail, return `screenshot_failed`.
- For `viewport` plus `screenshot`/`hidden`, process the renderer-provided cached PNG directly. If missing, return `screenshot_failed`. Never enqueue a bridge call, call native capture, or change renderer mode in this branch.
- For `element`/`fullPage`, require `native` first. Otherwise return `live_webview_required` before actor enqueue. For native pages, enqueue the corresponding Phase 3 actor operation. Do not substitute a cache because it cannot provide a current element crop/full-page capture.
- For cached viewport responses, set `annotated: false` and warning when `annotate: true`; never reveal the page merely to render an annotation.

Do not call Phase 1 `get_webpage_screenshots` recursively from the tool handler. Reuse its cache descriptor via the read-only renderer command so all visibility decisions are explicit and the result metadata stays consistent.

- [ ] **Step 4: Implement popup interception**

In `create_page_webview`’s existing `WebviewBuilder` chain, add `.on_new_window(...)`. Capture the originating child-Webview label and `AppHandle`; when WebKit supplies a valid URL, schedule navigation of that same resolved child Webview to the URL, then return `tauri::webview::NewWindowResponse::Deny`.

Use the same `page-navigated-{pageId}` event as ordinary navigation; do not advance actor state from the pre-commit popup callback. The Phase 2 `on_page_load(PageLoadEvent::Finished)` route records the committed navigation, final URL, and new document token after the in-place load finishes. Do not return `Allow`, build a `WebviewWindow`, modify the board, or create a page actor. Log native navigation failure only in development; ordinary snapshot/timeout behavior reports it to MCP callers.

- [ ] **Step 5: Implement schemas, annotations, and post-action results**

Add typed `Deserialize`/`JsonSchema` inputs to the existing `browser.rs` service. Validate at the MCP boundary; never receive untyped `serde_json::Value` for user inputs. Preserve all Phase 2 tools.

Use annotations:

| Tool | read_only_hint | destructive_hint |
| --- | ---: | ---: |
| `browser_screenshot` | true | false |
| `browser_click_coordinates` | false | true |
| `browser_evaluate` | false | true |
| `browser_upload_file` | false | true |
| `browser_handle_dialog` | false | true |

`browser_click_coordinates`, `browser_evaluate`, and `browser_upload_file` return the actor-provided post-action compact snapshot. `browser_handle_dialog` only configures the next script policy and returns `{ configured: true }`; it does not create a snapshot or mutate a page. Every handler converts `ToolError` without losing `code`, `message`, or `retry`.

- [ ] **Step 6: Confirm GREEN**

Run:

```bash
(cd src-tauri && cargo test mcp::tools::browser::tests)
(cd src-tauri && cargo test mcp::page_automation::tests)
(cd src-tauri && cargo test --lib)
```

Expected: handlers, page automation, and full Rust library tests pass.

- [ ] **Step 7: Commit tool and popup behavior**

```bash
git add src-tauri/src/commands/webview/bounds.rs src-tauri/src/mcp/tools/browser.rs src-tauri/src/mcp/page_automation/actor.rs src-tauri/src/mcp/page_automation/protocol.rs
git commit -m "feat(mcp): expose extended browser automation"
```

### Task 7: Document the permanent contract and complete verification

**Objective:** Record the visibility, actor, browser bridge, and security limits in their authoritative guides, then verify the macOS behavior end-to-end.

**Files:**
- Modify: `docs/agents/mcp.md`
- Modify: `docs/agents/architecture.md`
- Modify: `docs/agents/tauri-ipc.md`
- Modify: `docs/agents/sheltie-runtime.md`
- Modify: `docs/agents/sheltie-screenshots.md`
- Modify: `docs/agents/wkwebview-internals.md`

**Interfaces:**
- Consumes: final Phase 3 contracts.
- Produces: durable guidance without duplicating Phase 1 multi-site/board overview implementation details.

- [ ] **Step 1: Document MCP and architecture ownership**

In `docs/agents/mcp.md`, add the five tools, input contracts, annotations, errors, trusted-client absolute-path upload policy and byte limits, evaluation trust warning, synthetic-input warning, and dialog-shim retry behavior. In `architecture.md`, state that Phase 1 owns server/broker, Phase 2 owns the per-page actor, and Phase 3 extends that same actor/script.

- [ ] **Step 2: Document IPC, runtime, screenshots, and WKWebView behavior**

In `tauri-ipc.md`, document only the additional fixed page-automation operation payloads; no renderer command may show a hidden WebView. In `sheltie-runtime.md`, state that MCP capture reads the current display mode and never changes it. In `sheltie-screenshots.md`, distinguish transient Phase 3 bytes from persisted cache and document native/cache mode behavior plus output caps. In `wkwebview-internals.md`, record all-frame script extension, synthetic `isTrusted === false`, `target=_blank`/`window.open()` in-place navigation, Wry’s normal `NSOpenPanel`, and nonblocking dialog shim.

- [ ] **Step 3: Run complete automated validation**

Run:

```bash
npm run lint
npm run format
npm run typecheck
npm run test
(cd src-tauri && cargo fmt --check)
(cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings)
(cd src-tauri && cargo test --lib)
```

Expected: every command exits 0.

- [ ] **Step 4: Run manual macOS/WKWebView checks**

1. Open two document windows and two WebPages. Call each tool with explicit IDs; verify it never touches the focused-but-unaddressed page.
2. Put one page in native mode and another outside the board’s native area (`screenshot` or `hidden`). Call `browser_screenshot(mode: "viewport")` for both. Verify the native page can capture and the non-native page returns only its cache; the hidden WebView never flashes, moves, resizes, or becomes visible.
3. Call `browser_screenshot(mode: "element")` and `fullPage` for the non-native page. Verify each returns exact `live_webview_required`; no bridge action, capture, viewport movement, or display-mode transition occurs.
4. For a native page, capture a fully visible element and a tall full page. Verify crop geometry, 1px tile-overlap stitch, original page scroll restoration, output caps, and `page_changed_during_capture` when navigating mid-capture.
5. On a canvas fixture, use `browser_click_coordinates`. Verify the highlight tracks scroll/resize, fades after 180ms, and the response says `inputTrusted: false`. Verify a fixture that checks `event.isTrusted` can reject the action without a false success claim.
6. Open a `target="_blank"` link and a `window.open()` fixture. Verify neither creates a window/tab/node, the original page node navigates, and the next snapshot has a new navigation epoch.
7. Run evaluate with `Promise.resolve({ ok: true })`, `undefined`, a circular object, and a slow Promise. Verify JSON success plus `evaluate_not_json` and `evaluate_timeout`, then a later action succeeds without a blocked queue.
8. Configure dismiss with `browser_handle_dialog`, trigger a fixture `confirm()`, and verify cancellation/dialog data. Configure accept/prompt text, retry, and verify the page receives it synchronously without a native dialog blocking the actor.
9. Upload a readable absolute regular-file path to a current file-input ref. Verify basename/size plus synthetic `input`/`change`. Verify a canonicalized symlink to another readable regular file also succeeds. Then verify relative, nonexistent, directory, unreadable, oversized, over-count, and non-file-input cases fail before page mutation. Manually click the input and verify Wry’s standard chooser still works.
10. Confirm Phase 1 multi-site and full-board screenshot tools retain cache-first behavior and are unchanged by Phase 3.

- [ ] **Step 5: Commit docs and validation state**

```bash
git add docs/agents/mcp.md docs/agents/architecture.md docs/agents/tauri-ipc.md docs/agents/sheltie-runtime.md docs/agents/sheltie-screenshots.md docs/agents/wkwebview-internals.md
git commit -m "docs: document extended MCP automation"
```

## Risks and Tradeoffs

- The cache-first hidden-WebView rule means element/full-page captures are unavailable until the user has already brought the page into native view. This is intentional: a stale cache is safer and less disruptive than showing or moving an offscreen WebView.
- A cached viewport image can be stale and cannot be annotated. Its Phase 1 freshness metadata and the explicit `source: "cached"` result make that limitation observable.
- Full-page capture temporarily scrolls a page only when that page is already native. It restores scroll in `finally`, serializes through the page actor, caps at 64 tiles, and aborts rather than replaying if navigation changes.
- Synthetic clicks and file input assignment are untrusted page events. Websites that require browser/OS-trusted interaction, native drag-and-drop, canvas/WebGL input, CAPTCHA, payment confirmation, or a browser-native file chooser can reject them.
- `browser_evaluate` is deliberately an arbitrary page-origin JavaScript escape hatch for the trusted MCP client selected in Phase 1. It can access page-origin data such as storage; response caps and JSON serialization limit transport shape but do not create a confidentiality boundary.
- The dialog shim prevents deadlocked automation but cannot preserve a real paused `alert`/`confirm`/`prompt` flow. It only configures the next synchronous response before retry.
- Tauri’s `on_new_window` API is available in the pinned Tauri 2.10 dependency. If upgrading Tauri changes that API, preserve same-node navigation and rerun the popup manual checks rather than allowing a new native window.
