# Native Tab Dirty Indicator Implementation Plan

> **For implementers:** Execute this plan task-by-task with red → green → refactor. Do not commit unless the user requests it.

**Goal:** Show a CotEditor-style edited-document dot on each dirty Sheltie native tab and clear it whenever that document matches its last saved state.

**Architecture:** Keep `isProjectDirty()` as the only dirty-state definition. The renderer derives that Boolean from document data and sends transitions through a serialized window-local IPC queue; Rust updates the current tab’s `NSWindow` on the AppKit main thread. It keeps `setDocumentEdited:` in sync and explicitly sets `NSWindow.tab.accessoryView` to a 4pt tertiary circle inside a 20pt view, matching CotEditor’s implementation. Do not add a second dirty flag to Zustand or Rust state.

**Tech Stack:** React 19, Zustand, TypeScript, Vitest, Tauri 2.10, Rust, objc2/AppKit Objective-C messaging.

## Global Constraints

- Each native tab is one independent Tauri `Window` / AppKit `NSWindow`.
- `nodes`, `edges`, and `lastSavedDocument` determine dirty state; `viewport` and `webviewRuntime` must not affect it.
- Native edited-state updates must preserve request order across rapid edit/save/Undo transitions.
- The existing close and app-exit orchestration remains authoritative; `NSWindow.documentEdited` is a visual state only.
- macOS keeps `setDocumentEdited:` synchronized and uses `NSWindow.tab.accessoryView` for the visible tab dot. Non-macOS builds return success without changing native state.
- Commands that can run after child Webviews exist must accept `tauri::Window`, not `WebviewWindow`.
- Do not modify or remove unrelated untracked icon files.

## Current Context

- `src-tauri/src/commands/store/macos_tabs.rs` already provides `get_ns_window_object()` and `run_on_app_main_thread()` and creates native tab groups with `addTabbedWindow`.
- `src/lib/project-document.ts:isProjectDirty()` already compares the serializable document with `lastSavedDocument`.
- Successful save calls `markProjectSaved()`, while Undo/Redo can return the document to or away from the saved snapshot.
- `src-tauri/src/commands/store/file_io.rs:save_project_file` currently accepts `WebviewWindow`, contrary to the project’s documented multi-Webview command rule.
- Tauri’s public renderer API does not expose document-edited state or `NSWindow.tab.accessoryView`, so a window-local command is required.
- `setDocumentEdited:` alone does not add the CotEditor-style tab dot. CotEditor explicitly installs a SwiftUI circle as the tab accessory view.

## File Structure

- Create: `src/lib/document-edited-sync.ts` — serialize native edited-state updates.
- Create: `src/lib/document-edited-sync.test.ts` — verify ordering and failure recovery through the helper’s public interface.
- Modify: `src/App.tsx` — derive dirty state from document-only references and synchronize transitions.
- Modify: `src/lib/tauri-bridge/project.ts` — expose `api.setDocumentEdited(edited)`.
- Modify: `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` — add direct typed AppKit bindings for the tab accessory view.
- Modify: `src-tauri/src/commands/store/macos_tabs.rs` — apply `setDocumentEdited:` and the CotEditor-style accessory view to the current `NSWindow`.
- Modify: `src-tauri/src/setup.rs` — register the command.
- Modify: `src-tauri/src/commands/store/file_io.rs` — use `Window` for save commands with child Webviews.
- Modify: `docs/agents/architecture.md` — document renderer-to-native dirty synchronization.
- Modify: `docs/agents/coding-rules.md` — record the single-source and window-local synchronization rule.
- Modify: `docs/agents/tauri-ipc.md` — document the new command and corrected save command context.

## Tasks

### Task 1: Serialize edited-state updates

**Objective:** Guarantee that a later clean update cannot be overtaken by an earlier dirty update.

**Files:**
- Create: `src/lib/document-edited-sync.ts`
- Create: `src/lib/document-edited-sync.test.ts`

**Interfaces:**
- Produces: `createDocumentEditedSync(update: (edited: boolean) => Promise<void>): (edited: boolean) => Promise<void>`

- [ ] **Step 1: Write one failing ordering test**

Create a deferred Promise for the first update. Call the returned sync function with `true`, then `false`. Assert that only `true` reaches `update` before the first Promise resolves, and that `false` reaches it after resolution.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test -- src/lib/document-edited-sync.test.ts`

Expected: failure because `createDocumentEditedSync` does not exist.

- [ ] **Step 3: Implement the minimal serializer**

```ts
export function createDocumentEditedSync(
  update: (edited: boolean) => Promise<void>,
): (edited: boolean) => Promise<void> {
  let pending = Promise.resolve();

  return (edited) => {
    const execution = pending.catch(() => undefined).then(() => update(edited));
    pending = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm run test -- src/lib/document-edited-sync.test.ts`

Expected: ordering test passes.

- [ ] **Step 5: Add failure-recovery coverage**

Add one test where the first update rejects and the second update still executes. Run the same focused command and expect both tests to pass.

### Task 2: Add the window-local AppKit command

**Objective:** Set edited state and the visible accessory dot on the current tab’s own `NSWindow` without introducing native dirty state storage.

**Files:**
- Modify: `src-tauri/src/commands/store/macos_tabs.rs`
- Modify: `src-tauri/src/setup.rs`
- Modify: `src/lib/tauri-bridge/project.ts`

**Interfaces:**
- Produces Rust command: `set_document_edited(window: Window, edited: bool) -> Result<(), String>`
- Produces renderer API: `api.setDocumentEdited(edited: boolean): Promise<void>`

- [ ] **Step 1: Add the CotEditor-style AppKit accessory**

In `macos_tabs.rs`, create a 20pt `NSView` containing a centered 4pt circular layer filled with `NSColor.tertiaryLabelColor`, and add the unsaved-changes tooltip. When dirty, assign it to `NSWindow.tab.accessoryView`; when clean, assign `nil`. Keep `NSWindow.setDocumentEdited:` synchronized as the native edited-state flag. Avoid SF Symbols so the indicator remains compatible with the existing macOS 10.13+ tab API range.

- [ ] **Step 2: Add the window-local command**

Resolve the current window label, switch through `run_on_app_main_thread()`, reacquire that window with `app.get_window()`, obtain its `NSWindow`, and call the helper. The non-macOS branch must consume `window`/`edited` and return `Ok(())`.

- [ ] **Step 3: Register and expose the command**

Add the command to `tauri::generate_handler!` in `setup.rs`, then add:

```ts
setDocumentEdited: (edited: boolean): Promise<void> =>
  invoke('set_document_edited', { edited }),
```

to `src/lib/tauri-bridge/project.ts`.

- [ ] **Step 4: Verify Rust compilation and unit tests**

Run: `(cd src-tauri && cargo test --lib)`

Expected: all Rust tests pass and the Objective-C selector compiles on macOS.

### Task 3: Synchronize document dirty transitions from React

**Objective:** Reflect existing dirty semantics in the current native tab without serializing the document during viewport-only updates.

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `isProjectDirty`, `createDocumentEditedSync`, `api.setDocumentEdited`

- [ ] **Step 1: Subscribe to document-only references**

Select `project?.nodes`, `project?.edges`, and `project?.lastSavedDocument` separately from Zustand. Compute `isDirty` with `useMemo` from those three references. Return `false` while no project is loaded.

- [ ] **Step 2: Create one serializer per renderer window**

Initialize a stable sync function once with `useRef` and `createDocumentEditedSync(api.setDocumentEdited)`. Each native tab has its own renderer, so no window label parameter is needed.

- [ ] **Step 3: Send only Boolean transitions after load**

Add an effect depending on `isLoaded` and `isDirty`. When loaded, enqueue the value and log failures in development without changing the Zustand dirty source.

- [ ] **Step 4: Verify focused frontend tests and types**

Run:

```bash
npm run test -- src/lib/document-edited-sync.test.ts src/lib/project-document.test.ts
npm run typecheck
```

Expected: all focused tests and TypeScript checks pass.

### Task 4: Correct save command context

**Objective:** Ensure a project containing child Webviews can save successfully and therefore clear its native dirty indicator.

**Files:**
- Modify: `src-tauri/src/commands/store/file_io.rs`

- [ ] **Step 1: Replace `WebviewWindow` with `Window`**

Change the import and `save_project_file` command parameter only. Keep path validation, file writing, manager updates, and `window.set_title()` unchanged.

- [ ] **Step 2: Run Rust tests**

Run: `(cd src-tauri && cargo test --lib)`

Expected: all Rust tests pass.

### Task 5: Update permanent agent documentation

**Objective:** Keep IPC and document-window rules aligned with the implementation.

**Files:**
- Modify: `docs/agents/architecture.md`
- Modify: `docs/agents/coding-rules.md`
- Modify: `docs/agents/tauri-ipc.md`

- [ ] **Step 1: Document renderer responsibility**

Add native dirty synchronization to the `App.tsx` responsibility and state that `isProjectDirty()` remains the source of truth.

- [ ] **Step 2: Document the command contract**

Add `set_document_edited(edited)` under project/window commands, mark it macOS-native with a non-macOS no-op, and state that it targets the invoking document window.

- [ ] **Step 3: Correct save command context documentation**

Explicitly include `save_project_file` among commands that use `Window` after child Webviews may exist.

## Validation

Run all repository-required checks:

```bash
npm run lint
npm run format
npm run typecheck
npm run test
(cd src-tauri && cargo test --lib)
```

Expected: every command exits with status 0.

Manual macOS checks:

1. Open two native tabs and add a node in only one tab; only that tab shows the AppKit edited dot.
2. Save the dirty tab; its dot disappears and the other tab remains unchanged.
3. Edit, Undo back to the saved snapshot, then Redo; the dot disappears and reappears respectively.
4. Pan and zoom without document changes; no dot appears.
5. Create a webpage child Webview, edit the document, and Save/Save As; saving succeeds and clears the dot.
6. Close a dirty tab through Save, Discard, and Cancel paths; the existing dialog behavior remains unchanged.
7. Quit with multiple dirty tabs; the existing aggregated dialog remains authoritative.

## Risks and Tradeoffs

- AppKit controls dot color, placement, and one-tab window appearance; Sheltie should not overlay a custom React indicator.
- IPC completion order is not assumed; the serializer is required even though native calls are short.
- A failed native update is logged but does not alter dirty state. The next transition still executes because the queue recovers from rejection.
- Native UI behavior cannot be covered by Vitest or Rust unit tests, so multi-tab visual checks remain mandatory.
