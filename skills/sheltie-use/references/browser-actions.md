# Browser actions

## Snapshot and ref lifecycle

For one embedded page, begin with:

```json
{ "documentId": "…", "pageNodeId": "…" }
```

in `browser_snapshot`. Inspect `snapshot.snapshotId`, `snapshot.url`, `snapshot.compactText`, and semantic `snapshot.elements`. Element objects expose `ref` (used as the tool argument `elementRef`), role, accessible name, `tagName`, and applicable state.

Pass the newest response's `snapshotId` and `elementRef` to an element action. Each successful semantic action returns a new `snapshot`; replace the old snapshot and refs immediately, then inspect the returned state before acting again. On `stale_element`, snapshot again—never guess, refresh a ref by name, or retry the stale pair.

## Choose the least invasive action

Use the first path that can express the task:

1. `browser_navigate({ documentId, pageNodeId, url })` for an absolute HTTP/HTTPS URL, or `browser_go_back`, `browser_go_forward`, and `browser_reload` with just the two IDs.
2. `browser_click` / `browser_hover` with fresh `{ snapshotId, elementRef }`.
3. `browser_fill` with `{ snapshotId, elementRef, text }`, or `browser_fill_form` with `{ snapshotId, fields: [{ elementRef, text }] }` when multiple fields belong in one validated fill. A fill text is limited to 10,000 UTF-16 code units; form fields are non-empty and may not repeat a ref.
4. `browser_select_option` with fresh `{ snapshotId, elementRef, values }`; provide 1–50 non-empty option values.
5. `browser_press_key({ documentId, pageNodeId, key })`, then `browser_scroll({ documentId, pageNodeId, deltaX, deltaY })` within `-10000…10000` per axis, or `browser_wait({ documentId, pageNodeId, condition, timeoutMs? })` with a timeout no greater than 10000 ms.

Typed actions preserve accessible intent, make state reviewable in the returned snapshot, and avoid bypassing page behavior.

## Visual fallback

Use coordinates only after the latest semantic snapshot shows that no semantic target exists.

1. Capture `browser_screenshot({ documentId, pageNodeId, mode: "viewport", annotate: false })`.
2. Call `browser_click_coordinates({ documentId, pageNodeId, snapshotId, x, y, button: "left", clickCount: 1 })` using finite CSS **viewport** coordinates. `button` may be `left`, `middle`, or `right`; `clickCount` is 1 or 2. Optional `highlight: { x, y, width, height }` is visual-only and needs finite non-negative values.
3. Inspect the returned fresh snapshot. The synthetic event has `inputTrusted: false`, so report a site limitation if that prevented completion.

A viewport screenshot of a native page is live when possible and falls back to its cache. A hidden or screenshot-mode page only serves cached viewport images; element and full-page captures require a live native WebView. `mode: "element"` additionally requires fresh `snapshotId` and `elementRef`; those fields are invalid for `viewport` and `fullPage`. Do not reveal a WebView merely to bypass this constraint.

## Final fallback: page evaluation

Use `browser_evaluate({ documentId, pageNodeId, script })` only after semantic and coordinate paths cannot express the needed interaction or observation. `script` is non-empty, runs in the page origin, must resolve within 10 seconds, and returns only a JSON-safe value up to 256 KiB plus a fresh snapshot. It can observe page-visible JavaScript state, including state on an authenticated page; treat that as trusted-client access and report it precisely. Do not send an event-loop-blocking script.

## Dialogs, uploads, and navigation limits

- Before retrying an action that triggers a dialog, configure `browser_handle_dialog({ documentId, pageNodeId, action, promptText? })`. `action` is `accept` or `dismiss`; `promptText` is allowed only for `accept`. The policy is one-shot for the next dialog. Alerts are reported; confirm/prompt otherwise dismiss by default.
- Upload only through a fresh semantic file-input ref: `browser_upload_file({ documentId, pageNodeId, snapshotId, elementRef, paths })`. `paths` must be absolute, readable regular files; the tool accepts at most 10, each at most 25 MiB and 100 MiB total. Events are synthetic (`inputTrusted: false`) and paths are not returned.
- Popups and `target="_blank"` navigation open in the same `pageNodeId`; no new WebPage node is created. Report this behavior when a task expects a separate window.
- Browser tools do not change board selection, viewport, Undo/Redo, dirty state, or save state. Review actual error codes such as `webview_not_ready`, `live_webview_required`, `screenshot_target_not_visible`, `evaluate_timeout`, or `upload_target_not_file_input` rather than claiming the operation succeeded.
