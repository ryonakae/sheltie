# Phase 1 — Clipboard Foundation Implementation Plan

> **For implementers:** Execute this plan task-by-task. Complete each checkbox step, run the listed validation, and commit after each task.

**Goal:** Provide the clipboard plumbing: Rust NSPasteboard commands that write/read the Sheltie board payload plus plain text, a typed frontend bridge, and a fully unit-tested payload library (build / plain-text / parse / materialize).

**Architecture:** Rust owns raw pasteboard access only (two representations: custom type `com.sheltie.board-nodes` and `public.utf8-plain-text`); all payload semantics live in `src/lib/board-clipboard.ts`, which reuses the `.sheltie` serialization and validators from `src/lib/project-document.ts` as the single trust boundary.

**Tech Stack:** Rust (objc2-app-kit NSPasteboard), Tauri v2 commands, TypeScript, Vitest.

## Global Constraints

- Custom pasteboard type string: `com.sheltie.board-nodes`.
- Payload marker: `type: 'application/x-sheltie-board-nodes'`, `version: 1`.
- Clipboard JSON is untrusted: validation must go through the same `parseNode` / `parseEdge` logic used by `parseProjectDocument` (exported in Task 2). Any violation throws; callers treat a throw as "no Sheltie payload".
- Imports use the `@/` alias. Comments in code follow the existing style of each file (Japanese Why-comments in `src/`, English in plans).

## Current Context

- No clipboard dependency exists yet (no `tauri-plugin-clipboard-manager`, no `navigator.clipboard` usage).
- `src-tauri/Cargo.toml:47` — `objc2-app-kit = { version = "0.3", default-features = false, features = ["NSColor", "NSResponder", "NSView", "NSWindow", "NSWindowTab", "std"] }`. The `NSPasteboard` feature must be added.
- `src-tauri/src/commands/store/macos_tabs.rs:25` — `pub(super) fn run_on_app_main_thread` dispatches a closure to the main thread and returns its `Result<T, String>`. Visibility must widen to `pub(crate)` so `commands/clipboard.rs` can reuse it.
- `src-tauri/src/setup.rs:300-333` — `invoke_handler` registration list.
- `src/lib/tauri-bridge/` — one file per command domain (`webview.ts`, `theme.ts`, ...), re-exported from `src/lib/tauri-bridge.ts`.
- `src/lib/project-document.ts:70` `parseNode` and `:193` `parseEdge` are module-private.
- `src/types/index.ts:198` `extractTiptapText` is module-private.
- `boardNodeToDocumentNode` / `boardEdgeToDocumentEdge` / `documentNodeToBoardNode` / `documentEdgeToBoardEdge` are already exported from `src/lib/project-document.ts`.

## File Structure

- Create: `src-tauri/src/commands/clipboard.rs` — NSPasteboard write/read commands.
- Modify: `src-tauri/Cargo.toml` — add `NSPasteboard` feature to `objc2-app-kit`.
- Modify: `src-tauri/src/commands/mod.rs` — declare `pub mod clipboard;`.
- Modify: `src-tauri/src/commands/store/macos_tabs.rs` — widen `run_on_app_main_thread` to `pub(crate)`.
- Modify: `src-tauri/src/setup.rs` — register the two new commands.
- Create: `src/lib/tauri-bridge/clipboard.ts` — `clipboardApi` invoke wrapper.
- Modify: `src/lib/tauri-bridge.ts` — re-export `clipboardApi`.
- Modify: `src/lib/project-document.ts` — export `parseDocumentNode` / `parseDocumentEdge`.
- Modify: `src/types/index.ts` — export `extractTiptapText`.
- Create: `src/lib/board-clipboard.ts` — payload build / plain text / parse / materialize.
- Test: `src/lib/board-clipboard.test.ts`.

## Tasks

### Task 1: Rust NSPasteboard commands

**Objective:** `write_board_clipboard` writes both pasteboard representations atomically (one `clearContents` + two `setString_forType`); `read_board_clipboard` returns the custom-type string or `None`.

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/commands/store/macos_tabs.rs:25`
- Create: `src-tauri/src/commands/clipboard.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/setup.rs`

**Interfaces:**
- Produces: Tauri commands `write_board_clipboard(payloadJson, plainText)` and `read_board_clipboard() -> string | null` consumed by Task 2's bridge.

- [ ] **Step 1: Add the Cargo feature**

In `src-tauri/Cargo.toml`, extend the `objc2-app-kit` features with `"NSPasteboard"` (alphabetical position):

```toml
objc2-app-kit = { version = "0.3", default-features = false, features = ["NSColor", "NSPasteboard", "NSResponder", "NSView", "NSWindow", "NSWindowTab", "std"] }
```

- [ ] **Step 2: Widen the main-thread helper**

In `src-tauri/src/commands/store/macos_tabs.rs`, change `pub(super) fn run_on_app_main_thread` to `pub(crate) fn run_on_app_main_thread`. If the `store` or `macos_tabs` module declarations are not already `pub(crate)`-visible from `commands::clipboard`, widen those declarations in `src-tauri/src/commands/store/mod.rs` (or equivalent) the same way.

- [ ] **Step 3: Implement the commands**

Create `src-tauri/src/commands/clipboard.rs`:

```rust
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
#[cfg(target_os = "macos")]
use objc2_foundation::NSString;

#[cfg(target_os = "macos")]
use super::store::macos_tabs::run_on_app_main_thread;

/// Sheltie board payload 用のカスタム pasteboard type。
/// plain text と併記することで、外部アプリには人間向けテキストだけが見える。
#[cfg(target_os = "macos")]
const BOARD_PASTEBOARD_TYPE: &str = "com.sheltie.board-nodes";

#[tauri::command]
pub fn write_board_clipboard<R: Runtime>(
    app: AppHandle<R>,
    payload_json: String,
    plain_text: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        run_on_app_main_thread(&app, move |_| {
            // objc2-app-kit 0.3 では generalPasteboard / clearContents / setString_forType は
            // safe fn。unsafe が要るのは extern static NSPasteboardTypeString の参照だけ。
            let pasteboard = NSPasteboard::generalPasteboard();
            let board_type = NSString::from_str(BOARD_PASTEBOARD_TYPE);
            pasteboard.clearContents();
            if !pasteboard.setString_forType(&NSString::from_str(&payload_json), &board_type) {
                return Err("failed to write the board payload to the pasteboard".to_string());
            }
            let plain_text_type = unsafe { NSPasteboardTypeString };
            if !pasteboard.setString_forType(&NSString::from_str(&plain_text), plain_text_type) {
                return Err("failed to write plain text to the pasteboard".to_string());
            }
            Ok(())
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, payload_json, plain_text);
        Err("board clipboard is only supported on macOS".to_string())
    }
}

#[tauri::command]
pub fn read_board_clipboard<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        run_on_app_main_thread(&app, |_| {
            let pasteboard = NSPasteboard::generalPasteboard();
            let board_type = NSString::from_str(BOARD_PASTEBOARD_TYPE);
            let value = pasteboard.stringForType(&board_type);
            Ok(value.map(|string| string.to_string()))
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("board clipboard is only supported on macOS".to_string())
    }
}
```

Adapt method/static names to the exact objc2-app-kit 0.3 bindings if they differ (e.g. `NSPasteboardTypeString` may need an `unsafe` reference); the behavioral contract above is fixed.

- [ ] **Step 4: Register the module and commands**

In `src-tauri/src/commands/mod.rs` add `pub mod clipboard;`. In `src-tauri/src/setup.rs`, append to `invoke_handler`:

```rust
crate::commands::clipboard::write_board_clipboard,
crate::commands::clipboard::read_board_clipboard,
```

- [ ] **Step 5: Verify compilation**

Run: `(cd src-tauri && cargo check)`
Expected: compiles with no errors or new warnings.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/commands/clipboard.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/store/macos_tabs.rs src-tauri/src/commands/store/mod.rs src-tauri/src/setup.rs
git commit -m "feat(clipboard): add NSPasteboard board-payload commands"
```

### Task 2: Frontend bridge and exported validators

**Objective:** Expose `clipboardApi` to the renderer and export the node/edge validators and Tiptap text extractor needed by the payload library.

**Files:**
- Create: `src/lib/tauri-bridge/clipboard.ts`
- Modify: `src/lib/tauri-bridge.ts`
- Modify: `src/lib/project-document.ts`
- Modify: `src/types/index.ts:198`

**Interfaces:**
- Produces: `clipboardApi.writeBoardClipboard(payloadJson, plainText)`, `clipboardApi.readBoardClipboard()`, `parseDocumentNode(raw, index)`, `parseDocumentEdge(raw, index)`, `extractTiptapText(value)`.

- [ ] **Step 1: Create the bridge**

`src/lib/tauri-bridge/clipboard.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';

export const clipboardApi = {
  async writeBoardClipboard(payloadJson: string, plainText: string): Promise<void> {
    await invoke('write_board_clipboard', { payloadJson, plainText });
  },
  async readBoardClipboard(): Promise<string | null> {
    return await invoke<string | null>('read_board_clipboard');
  },
};
```

Add `export { clipboardApi } from '@/lib/tauri-bridge/clipboard';` to `src/lib/tauri-bridge.ts` alongside the existing re-exports.

- [ ] **Step 2: Export the validators**

In `src/lib/project-document.ts`, rename the private functions and export them (update the internal call sites in `parseProjectDocumentValue`):

- `function parseNode(...)` → `export function parseDocumentNode(...)`
- `function parseEdge(...)` → `export function parseDocumentEdge(...)`

In `src/types/index.ts`, add `export` to `function extractTiptapText(value: unknown): string`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run test`
Expected: no type errors; existing tests (including `project-document.test.ts`) stay green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tauri-bridge/clipboard.ts src/lib/tauri-bridge.ts src/lib/project-document.ts src/types/index.ts
git commit -m "feat(clipboard): expose clipboard bridge and document validators"
```

### Task 3: Board clipboard payload library (TDD)

**Objective:** Pure functions to build, textualize, parse, and materialize clipboard payloads.

**Files:**
- Create: `src/lib/board-clipboard.ts`
- Test: `src/lib/board-clipboard.test.ts`

**Interfaces:**
- Consumes: `boardNodeToDocumentNode`, `boardEdgeToDocumentEdge`, `documentNodeToBoardNode`, `documentEdgeToBoardEdge`, `parseDocumentNode`, `parseDocumentEdge`, `extractTiptapText`.
- Produces (used by Phase 2 & 3):

```ts
export const BOARD_CLIPBOARD_PAYLOAD_TYPE = 'application/x-sheltie-board-nodes';

export interface BoardClipboardPayload {
  type: typeof BOARD_CLIPBOARD_PAYLOAD_TYPE;
  version: 1;
  sourceProjectId: string;
  nodes: SheltieDocumentNode[]; // original ids and coordinates preserved
  edges: SheltieDocumentEdge[]; // both endpoints guaranteed inside nodes at build time
}

export interface MaterializedClipboardContent {
  nodes: BoardNode[]; // fresh ids, original coordinates
  edges: BoardEdge[]; // fresh ids, endpoints remapped
  sourceIdByNewId: Record<string, string>;
}

export function buildBoardClipboardPayload(
  project: Pick<Project, 'id' | 'nodes' | 'edges'>,
  selectedNodeIds: readonly string[],
): BoardClipboardPayload | null;
export function buildBoardClipboardPlainText(payload: BoardClipboardPayload): string;
export function parseBoardClipboardPayload(json: string): BoardClipboardPayload; // throws on any violation
export function materializeBoardClipboardPayload(
  payload: BoardClipboardPayload,
  createId?: () => string,
): MaterializedClipboardContent;
```

- [ ] **Step 1: Write the failing tests**

`src/lib/board-clipboard.test.ts`, covering at minimum:

- `buildBoardClipboardPayload`
  - returns `null` when no selected id exists in the project.
  - includes only selected nodes, preserving `project.nodes` array order (z-order).
  - includes an edge only when both endpoints are selected; drops an edge with one endpoint outside.
  - webpage nodes keep `url`, `addedUrl`, `title` (a `[Moved]` node — `addedUrl !== url` — round-trips both values).
- `buildBoardClipboardPlainText`
  - webpage → its `url`; sticky note → its `content`; text node → `extractTiptapText(...)` trimmed.
  - multiple nodes join with `\n`; empty parts (webpage with `url === ''`, empty sticky) are skipped.
- `parseBoardClipboardPayload`
  - round-trips `JSON.stringify(build(...))`.
  - throws on: non-JSON input; wrong `type` marker; `version !== 1`; missing `sourceProjectId`; empty `nodes` array; a node with `url: 'javascript:alert(1)'`; an edge with `strokeWidth: 4`.
- `materializeBoardClipboardPayload`
  - all node/edge ids are freshly generated (inject `createId` returning `'new-1'`, `'new-2'`, ... and assert).
  - edge `source`/`target` are remapped to the new node ids; edge style fields survive.
  - `sourceIdByNewId` maps every new node id to its payload node id.
  - coordinates are unchanged (placement happens later).

Use plain object literals for `BoardNode` fixtures (same style as `sheltie-node-placement.test.ts`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- board-clipboard`
Expected: fails with "Cannot find module '@/lib/board-clipboard'" (or equivalent).

- [ ] **Step 3: Implement**

`src/lib/board-clipboard.ts`:

```ts
import {
  boardEdgeToDocumentEdge,
  boardNodeToDocumentNode,
  documentEdgeToBoardEdge,
  documentNodeToBoardNode,
  parseDocumentEdge,
  parseDocumentNode,
} from '@/lib/project-document';
import type {
  BoardEdge,
  BoardNode,
  Project,
  SheltieDocumentEdge,
  SheltieDocumentNode,
} from '@/types';
import { extractTiptapText } from '@/types';

export const BOARD_CLIPBOARD_PAYLOAD_TYPE = 'application/x-sheltie-board-nodes';

export interface BoardClipboardPayload {
  type: typeof BOARD_CLIPBOARD_PAYLOAD_TYPE;
  version: 1;
  sourceProjectId: string;
  nodes: SheltieDocumentNode[];
  edges: SheltieDocumentEdge[];
}

export interface MaterializedClipboardContent {
  nodes: BoardNode[];
  edges: BoardEdge[];
  sourceIdByNewId: Record<string, string>;
}

export function buildBoardClipboardPayload(
  project: Pick<Project, 'id' | 'nodes' | 'edges'>,
  selectedNodeIds: readonly string[],
): BoardClipboardPayload | null {
  const selectedIdSet = new Set(selectedNodeIds);
  const nodes = project.nodes.filter((node) => selectedIdSet.has(node.id));
  if (nodes.length === 0) return null;

  const edges = project.edges.filter(
    (edge) => selectedIdSet.has(edge.source) && selectedIdSet.has(edge.target),
  );

  return {
    type: BOARD_CLIPBOARD_PAYLOAD_TYPE,
    version: 1,
    sourceProjectId: project.id,
    nodes: nodes.map(boardNodeToDocumentNode),
    edges: edges.map(boardEdgeToDocumentEdge),
  };
}

export function buildBoardClipboardPlainText(payload: BoardClipboardPayload): string {
  return payload.nodes
    .map((node) => {
      if (node.type === 'webpage') return node.url;
      if (node.type === 'stickynote') return node.content;
      return extractTiptapText(node.tiptapContent).trim();
    })
    .filter((part) => part !== '')
    .join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseBoardClipboardPayload(json: string): BoardClipboardPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`failed to parse clipboard JSON: ${error}`);
  }
  if (!isRecord(parsed)) throw new Error('clipboard root must be an object');
  if (parsed.type !== BOARD_CLIPBOARD_PAYLOAD_TYPE) {
    throw new Error('clipboard payload type mismatch');
  }
  if (parsed.version !== 1) throw new Error('clipboard payload version must be 1');
  if (typeof parsed.sourceProjectId !== 'string') {
    throw new Error('sourceProjectId must be a string');
  }
  if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
    throw new Error('nodes must be a non-empty array');
  }
  const nodes = parsed.nodes.map((node, index) => parseDocumentNode(node, index));
  const edges = Array.isArray(parsed.edges)
    ? parsed.edges.map((edge, index) => parseDocumentEdge(edge, index))
    : [];
  return {
    type: BOARD_CLIPBOARD_PAYLOAD_TYPE,
    version: 1,
    sourceProjectId: parsed.sourceProjectId,
    nodes,
    edges,
  };
}

export function materializeBoardClipboardPayload(
  payload: BoardClipboardPayload,
  createId: () => string = () => crypto.randomUUID(),
): MaterializedClipboardContent {
  const newIdBySourceId = new Map<string, string>();
  const sourceIdByNewId: Record<string, string> = {};
  const nodes = payload.nodes.map((documentNode) => {
    const newId = createId();
    newIdBySourceId.set(documentNode.id, newId);
    sourceIdByNewId[newId] = documentNode.id;
    return { ...documentNodeToBoardNode(documentNode), id: newId };
  });
  const edges = payload.edges.flatMap((documentEdge) => {
    const source = newIdBySourceId.get(documentEdge.source);
    const target = newIdBySourceId.get(documentEdge.target);
    // 貼り付け対象外のノードを参照する edge は黙って捨てる（不正 payload 耐性）
    if (!source || !target) return [];
    return [{ ...documentEdgeToBoardEdge(documentEdge), id: createId(), source, target }];
  });
  return { nodes, edges, sourceIdByNewId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- board-clipboard`
Expected: all new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/board-clipboard.ts src/lib/board-clipboard.test.ts
git commit -m "feat(clipboard): add board clipboard payload library"
```

## Validation

- `npm run lint && npm run format && npm run typecheck && npm run test` — all green.
- `(cd src-tauri && cargo check)` — compiles.
- End-to-end pasteboard behavior (custom type + `pbpaste` plain text) is verified manually in Phase 2 Task 4 once the commands are reachable from the UI.

## Risks, Tradeoffs, and Open Questions

- objc2-app-kit 0.3 binding names for `NSPasteboard` methods/statics may differ slightly from the sketch; the command contract (names, arguments, return types) must not change.
- `extractTiptapText` joins block nodes without separators, so multi-paragraph text nodes lose line breaks in the plain-text representation. Accepted: it reuses the existing helper and only affects pasting into external apps.
- `NSPasteboard` calls are dispatched to the main thread via `run_on_app_main_thread` for safety even though NSPasteboard is not marked MainThreadOnly.
