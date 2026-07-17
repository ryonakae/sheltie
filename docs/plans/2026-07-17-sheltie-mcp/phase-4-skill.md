# Sheltie MCP Phase 4: Distributable Skill Implementation Plan

> **Parent plan:** [`../2026-07-17-sheltie-mcp.md`](../2026-07-17-sheltie-mcp.md)
>
> **For implementers:** Execute this plan only after MCP Phases 1–3 are merged and locally usable. Complete each checkbox in order, run the listed checks, and commit source artifacts after each reviewable milestone. Do not commit the ignored evaluation workspace.

**Goal:** Ship and validate a distributable `sheltie-use` Skill that teaches an AI agent to operate the completed Sheltie MCP workflow safely and efficiently: inspect multiple web pages together, use semantic browser controls first, organize results atomically on the board, and preserve the user's document and viewport intent.

**Architecture:** Keep the installable Skill small: `SKILL.md` contains trigger metadata and the decision workflow, while focused documents in `references/` provide the tool-contract, comparison, browser-action, and board-edit details only when needed. Keep deterministic local-site fixtures and evaluation definitions under `skills/sheltie-use/evals/`; the Skill Creator packager excludes this root `evals/` directory. Store all run transcripts, outputs, timings, grading, benchmarks, viewer feedback, and release packages in the ignored sibling workspace `skills/sheltie-use-workspace/`.

**Tech Stack:** Markdown Skill package, completed Sheltie Streamable HTTP MCP server, deterministic local HTML fixtures served by Node.js, JSON fixture manifests, verbose Agent-result transcript normalization, Vitest for pure fixture-verifier logic, Skill Creator Python scripts, Agent subagents, and `eval-viewer/generate_review.py`.

## Global Constraints

- Begin only after phases 1–3 expose and document the finalized local MCP endpoint, tool schemas, error format, and menu-controlled enablement. Their implemented schemas are authoritative; do not invent alternate argument or response shapes in the Skill.
- The Skill targets the initial macOS/WKWebView release. It controls only WebPage nodes already open inside Sheltie; it does not attach to Chrome, Playwright, or external browsers.
- A connection is trusted by product design. The Skill must still state that page contents and actions, including authenticated pages, are available to the connected MCP client and that `browser_evaluate` can read page-visible JavaScript state.
- Every write action names `documentId`; every page action names both `documentId` and `pageNodeId`. Never use focused selection as an implicit write target.
- The normal workflow is: `list_documents` / `get_editor_state`; inspect the selected document with `get_board`; compare pages with cached `get_webpage_screenshots` and `get_board_screenshot`; inspect a page with `browser_snapshot`; use typed semantic actions; use screenshot-coordinate interaction only when semantic inspection cannot expose the control; use `browser_evaluate` only as the final fallback.
- Reuse only `elementRef` values from the newest successful snapshot for that page. After an action returns a new snapshot, discard all older refs. On a stale-reference error, snapshot again rather than guessing or retrying the old ref.
- Use `batch_edit_board` for every related board mutation. It is atomic and must represent one Undo entry. If validation fails, report the error and issue no compensating partial mutations.
- The Skill must not mention, request, or call a save tool. MCP edits leave the document dirty; saving remains a user action.
- Call `focus_nodes` only when the user explicitly asks to show, reveal, or focus the result. Do not change selection or viewport while researching, browsing, or editing normally.
- Prefer cached multi-site screenshots for overview. Phase 1 returns `freshness: "cached"` when an image exists and `freshness: "missing"` when it does not; do not force hidden WKWebViews into view just to capture images. Use the composed board screenshot to understand layout, notes, and edges.
- Evaluation sites must bind to loopback only, be deterministic, contain no credentials or network requests, and not depend on third-party services. Fixture board files must contain only synthetic content.
- Do not package test fixtures: the Skill Creator packager excludes `skills/sheltie-use/evals/` at the Skill root by design. Package `SKILL.md` and `references/` only.

## Current Context and Phase-4 Entry Criteria

- Board documents have `webpage`, `stickynote`, and `text` nodes. WebPage screenshot assets are runtime-only and may be unavailable for hidden Webviews; the overview MCP tool therefore returns cached-image freshness rather than trying to capture every page live.
- A document's board mutations are undoable; viewport is not part of dirty-state persistence. This is why AI editing should be one `batch_edit_board` call and `focus_nodes` must be exceptional.
- Existing screenshots are retained at `webviewRuntime.screenshotUrlsByNodeId`; Phase 1’s overview tools surface only `cached` and `missing` freshness, so the Skill can make an informed comparison without recapturing hidden Webviews.
- Phase 1 introduces exactly `list_documents`, `get_editor_state`, `get_board`, `batch_edit_board`, `focus_nodes`, `get_webpage_screenshots`, and `get_board_screenshot`. Phase 4 must use those names and their implemented schemas; Phase 2–3 browser tool names and schemas are read from their completed contracts before drafting browser references.
- Production MCP tools do not expose test-only traces or board export. The evaluation orchestrator owns evidence collection: it saves each verbose Agent result, derives a redacted MCP trace locally, and obtains final board state through read-only `get_board`.
- The repository currently has no product `skills/` directory and `.gitignore` does not ignore a Skill Creator workspace. This phase introduces both deliberately.

## File Structure

- Create: `skills/sheltie-use/SKILL.md` — installable frontmatter and compact decision workflow.
- Create: `skills/sheltie-use/references/mcp-contract.md` — finalized endpoint enablement, scope, IDs, response freshness, and stale-reference contract.
- Create: `skills/sheltie-use/references/overview-and-board.md` — multi-site comparison, board screenshot interpretation, atomic board edits, and focus rules.
- Create: `skills/sheltie-use/references/browser-actions.md` — semantic snapshots, latest-ref lifecycle, typed actions, coordinate fallback, evaluate fallback, and operation-result review.
- Create: `skills/sheltie-use/references/examples.md` — concise end-to-end examples for research/comparison, form interaction, visual fallback, and reporting unsaved changes.
- Create: `skills/sheltie-use/evals/evals.json` — three realistic evaluation prompts and discriminating expectations.
- Create: `skills/sheltie-use/evals/fixtures/sites/compare-a/index.html` — deterministic first comparison site.
- Create: `skills/sheltie-use/evals/fixtures/sites/compare-b/index.html` — deterministic second comparison site.
- Create: `skills/sheltie-use/evals/fixtures/sites/semantic-form/index.html` — deterministic accessible form and state-changing controls.
- Create: `skills/sheltie-use/evals/fixtures/sites/canvas-fallback/index.html` — deterministic canvas-only visual target with no semantic target for the test control.
- Create: `skills/sheltie-use/evals/fixtures/boards/comparison-board.sheltie` — synthetic board with positioned WebPage nodes, an existing note, and cache-seeding setup instructions; it contains no runtime screenshot state.
- Create: `skills/sheltie-use/evals/fixtures/expected/{comparison,semantic,visual}.json` — expected final board/page state and permitted MCP call ordering for each eval.
- Create: `skills/sheltie-use/evals/fixtures/serve-local-sites.mjs` — loopback-only static fixture server that reports one deterministic base URL.
- Create: `skills/sheltie-use/evals/fixtures/derive-redacted-mcp-trace.mjs` — converts a persisted verbose Agent result into a normalized, redacted MCP trace.
- Create: `skills/sheltie-use/evals/fixtures/verify-eval.ts` — pure trace/state assertion functions.
- Create: `skills/sheltie-use/evals/fixtures/verify-eval.test.ts` — Vitest coverage for each accepted and rejected trace condition.
- Create: `skills/sheltie-use/evals/fixtures/verify-run.mjs` — CLI that verifies the locally derived trace and orchestrator-read `get_board` result, then writes assertion evidence for the grader.
- Create: `skills/sheltie-use/evals/fixtures/README.md` — repeatable fixture setup, Sheltie loading steps, and generated-output locations.
- Create: `skills/sheltie-use/evals/trigger-evals.json` — 20 reviewed trigger-description queries.
- Modify: `.gitignore` — ignore `/skills/sheltie-use-workspace/` and no committed Skill source.
- Generate only (ignored): `skills/sheltie-use-workspace/iteration-N/...` — paired agent outputs, transcripts, timing, grading, benchmark, analysis, review, and feedback files.
- Generate only (ignored): `skills/sheltie-use-workspace/release/sheltie-use.skill` — installable archive made after final validation.

For evaluation steps, use this fixed mapping: `eval-0` → `cross-site-price-comparison`, `eval-1` → `semantic-form-with-ref-refresh`, and `eval-2` → `canvas-control-and-explicit-reveal`. Set `EVAL_DIR` to the `eval-N` name, `EVAL_NAME` to its descriptive name, `CONFIG` to `with_skill` or `without_skill`, and `RUN_NUMBER` to `1`, `2`, or `3`. Set `RUN_DIR` to `skills/sheltie-use-workspace/iteration-1/$EVAL_DIR/$CONFIG/run-$RUN_NUMBER`. These are shell-style variables for the procedures below, not paths that must be committed.

## Tasks

### Task 1: Establish the packaged-Skill boundary and deterministic evaluation harness

**Objective:** Create a repository-tracked Skill source tree, ignore its ephemeral sibling workspace, and provide local fixture contracts that can determine whether an execution actually followed the intended MCP workflow.

**Files:**
- Create: `skills/sheltie-use/evals/fixtures/sites/compare-a/index.html`
- Create: `skills/sheltie-use/evals/fixtures/sites/compare-b/index.html`
- Create: `skills/sheltie-use/evals/fixtures/sites/semantic-form/index.html`
- Create: `skills/sheltie-use/evals/fixtures/sites/canvas-fallback/index.html`
- Create: `skills/sheltie-use/evals/fixtures/boards/comparison-board.sheltie`
- Create: `skills/sheltie-use/evals/fixtures/expected/comparison.json`
- Create: `skills/sheltie-use/evals/fixtures/expected/semantic.json`
- Create: `skills/sheltie-use/evals/fixtures/expected/visual.json`
- Create: `skills/sheltie-use/evals/fixtures/serve-local-sites.mjs`
- Create: `skills/sheltie-use/evals/fixtures/verify-eval.ts`
- Create: `skills/sheltie-use/evals/fixtures/verify-eval.test.ts`
- Create: `skills/sheltie-use/evals/fixtures/verify-run.mjs`
- Create: `skills/sheltie-use/evals/fixtures/README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the finalized Phase 1–3 MCP schemas, `get_subagent_result(verbose: true)` output, and the `.sheltie` schema.
- Produces: loopback pages, board setup instructions, normalized redacted traces, read-only final board snapshots, and a verifier used by all later Agent runs.

- [x] **Step 1: Freeze the production tool contract and evaluation evidence path before creating fixtures.**

  Record the exact Phase 1 endpoint and enablement procedure in `fixtures/README.md`, along with the fixed read tools: `list_documents()`, `get_editor_state(documentId)`, `get_board(documentId, nodeIds?, nodeTypes?, includeEdges?)`, `get_webpage_screenshots(documentId, pageNodeIds?)`, and `get_board_screenshot(documentId, nodeIds?)`. Add the completed Phase 2–3 browser schemas without renaming them. State explicitly that no save, board-export, or production trace tool exists.

  For each Agent run, the evaluation orchestrator must call `get_subagent_result` with `verbose: true` immediately after completion and save the complete returned transcript/tool-call data at `$RUN_DIR/agent-result.verbose.json`. It then runs `derive-redacted-mcp-trace.mjs` to create `$RUN_DIR/outputs/redacted-mcp-trace.json`. The script retains only tool name, explicit IDs, snapshot ID, element ref, batch ID, response status, and ordering; it redacts all other arguments and results. The orchestrator invokes the existing read-only `get_board` with that run’s known `documentId` and `includeEdges: true`, then writes its `structuredContent` to `$RUN_DIR/outputs/final-board.json`. The verifier must not inspect page credentials, cookies, `localStorage`, or password values.

- [x] **Step 2: Define local sites and board setup with observable, deterministic differences.**

  Implement four sites served from one `127.0.0.1` static server:

  - `compare-a` and `compare-b` use distinct titles, prices, availability, and feature tables so comparison requires reading both pages rather than copying a shared string.
  - `semantic-form` exposes labelled text fields, a select, a submit button, and an accessible result region. Submitting changes only in-memory DOM state and never performs a network request.
  - `canvas-fallback` renders the task target in `<canvas>` at a fixed CSS viewport coordinate. The target must have no DOM/ARIA control, while the page still has an explanatory semantic heading so the agent can establish context before requesting a screenshot.
  - `comparison-board.sheltie` contains three named local WebPage nodes, an existing note, and an edge. It does not try to serialize runtime screenshot state. Before every comparison eval, open/visit the first two local pages while they are native so the normal screenshot queue seeds their caches; then move those two nodes outside the viewport, where their cached images are used. Leave the third node outside the viewport without visiting it so no cache exists. `get_webpage_screenshots` must therefore report the first two as `cached` and the third as `missing`, with no forced capture or viewport movement.

  Use explicit expected state files. Each expected file lists the required final note text fragments, required or forbidden tool categories, required browser evidence available in the normalized trace, and whether `focus_nodes` is permitted.

- [x] **Step 3: Write the failing pure verifier tests.**

  In `verify-eval.test.ts`, add at least these cases before implementing `verify-eval.ts`:

  1. comparison passes only when the normalized Agent-result trace lists `list_documents` then `get_editor_state(documentId)`, uses explicit IDs, requests `get_webpage_screenshots` and `get_board_screenshot`, records two `cached` and one `missing` page result, contains one successful `batch_edit_board`, has no attempt to invoke a nonexistent save tool, and has no `focus_nodes`;
  2. semantic interaction passes only when a latest snapshot ref is used after every state-changing action and a typed action is selected instead of coordinate/evaluate fallback;
  3. visual interaction passes only when a semantic snapshot precedes the screenshot-coordinate action, and `focus_nodes` is allowed only because that prompt explicitly asks to reveal the result;
  4. an old ref used after a newer snapshot, a partial board-write sequence, an attempted nonexistent save tool, or an unrequested focus action each fails with a named evidence message.

  Run:

  ```bash
  npm run test -- skills/sheltie-use/evals/fixtures/verify-eval.test.ts
  ```

  Expected: Vitest reports failing tests because the verifier module does not exist yet.

- [x] **Step 4: Implement the minimal verifier and the fixture server.**

  Implement `derive-redacted-mcp-trace.mjs` first as the sole converter from `$RUN_DIR/agent-result.verbose.json` to `$RUN_DIR/outputs/redacted-mcp-trace.json`; it must fail when the verbose result lacks tool-call data rather than invent evidence. Export deterministic functions from `verify-eval.ts` that accept that normalized trace and the orchestrator-written `final-board.json`, then return the Skill Creator `expectations` form: `{ text, passed, evidence }[]`. `verify-run.mjs` must write `outputs/verification.json` and `outputs/user_notes.md`, allowing graders to verify outcomes without trusting a prose claim by the executor. It must never invoke a save/export MCP tool.

  `serve-local-sites.mjs` must bind to `127.0.0.1`, set deterministic no-cache headers, print its URL once, and terminate cleanly on `SIGINT`/`SIGTERM`. Do not add a production dependency.

- [x] **Step 5: Verify the harness and isolation.**

  Run:

  ```bash
  npm run test -- skills/sheltie-use/evals/fixtures/verify-eval.test.ts
  node skills/sheltie-use/evals/fixtures/serve-local-sites.mjs
  ```

  Expected: all verifier tests pass; the server prints a `http://127.0.0.1:<port>` URL; loading each fixture does not initiate an external request. Stop the server after checking.

  Add exactly this ignore entry:

  ```gitignore
  /skills/sheltie-use-workspace/
  ```

  Then run:

  ```bash
  git check-ignore -v skills/sheltie-use-workspace/iteration-1/example/timing.json
  git check-ignore -v skills/sheltie-use/SKILL.md || true
  ```

  Expected: the workspace path is ignored by the new root rule; a future Skill source file is not ignored.

- [x] **Step 6: Commit the fixture harness.**

  ```bash
  git add .gitignore skills/sheltie-use/evals
  git commit -m "test(skill): add deterministic sheltie MCP fixtures"
  ```

### Task 2: Author the progressive-disclosure Skill and its initial eval definitions

**Objective:** Turn the agreed product workflow into a short installable Skill whose references teach detailed choices without bloating every invocation.

**Files:**
- Create: `skills/sheltie-use/SKILL.md`
- Create: `skills/sheltie-use/references/mcp-contract.md`
- Create: `skills/sheltie-use/references/overview-and-board.md`
- Create: `skills/sheltie-use/references/browser-actions.md`
- Create: `skills/sheltie-use/references/examples.md`
- Create: `skills/sheltie-use/evals/evals.json`

**Interfaces:**
- Consumes: Phase 1–3 final tool schemas and Task 1 fixture contract.
- Produces: a package-valid `sheltie-use` Skill and three executable test prompts with objective expectations.

- [ ] **Step 1: Draft the frontmatter and bounded main workflow.**

  Give `SKILL.md` the name `sheltie-use` and a deliberately broad, pushy description that triggers when a user asks to inspect, compare, research, navigate, interact with, or organize WebPage nodes in a Sheltie board through an AI/MCP client, including requests that only describe comparing several open websites or turning findings into board notes. Exclude implementation of Sheltie itself, general browser automation outside Sheltie, and standalone design-tool tasks from the description.

  Keep the body below 500 lines. State the reason for every ordering rule: explicit IDs prevent a user tab switch from retargeting writes; cached overview reveals cross-site relationships before narrow page work; current refs prevent stale actions; typed controls preserve semantic intent; atomic batches preserve one-step Undo; no save preserves user ownership; limited focus avoids stealing the viewport.

- [ ] **Step 2: Put details in four conditional references.**

  Write these exact responsibilities:

  - `mcp-contract.md`: how to ensure the user-enabled local server is available, Phase 1’s exact document/overview reads, Phase 2–3 browser schemas, `documentId → pageNodeId → snapshotId → elementRef`, stale-ref recovery, `cached`/`missing` screenshot meaning, trusted-connection scope, and the macOS-only boundary.
  - `overview-and-board.md`: `list_documents`, `get_editor_state`, `get_board`, `get_webpage_screenshots`, and `get_board_screenshot`; when comparison needs both overview images and board composition; how to state missing/cached evidence; valid `batch_edit_board` planning and response checks; no save; and the precise explicit-user-request gate for `focus_nodes`.
  - `browser-actions.md`: snapshot first, use the latest returned refs, inspect the operation-returned snapshot, typed navigation/click/type/fill/select/key/scroll/wait before coordinates, screenshot-coordinate fallback only after no semantic target, `browser_evaluate` only after typed and coordinate paths cannot express the task, and how to report navigation/dialog/upload limitations from the actual schema.
  - `examples.md`: one comparison that creates linked notes in a single batch, one semantic form task, one canvas coordinate task, and one request that legitimately ends with `focus_nodes`. Each example uses the final Phase 1–3 argument names, not hypothetical ones.

- [ ] **Step 3: Create three realistic `evals/evals.json` entries without assertions at first.**

  Follow the Skill Creator schema and create these descriptive IDs and prompts, each using only Task 1 local fixtures:

  1. `cross-site-price-comparison`: compare the two cached local product pages while reporting the third page’s missing screenshot, add two linked findings to the existing board in a single atomic edit, and do not move the user's view; saving remains the user's action and no save MCP tool exists.
  2. `semantic-form-with-ref-refresh`: use the local form to choose a supplied plan and fill a labelled field, verify the confirmation state after action-returned snapshots, then add one note to the board; the prompt contains a stale initial element reference so the agent must obtain and use a newer ref.
  3. `canvas-control-and-explicit-reveal`: inspect the canvas fixture, use semantic inspection first, operate the visually rendered target by CSS viewport coordinates only when no semantic ref exists, record the result on the board atomically, then reveal the created note because the user explicitly asks to show it.

  Set `files` to the corresponding fixture paths and write concise `expected_output` text. Leave `expectations` empty in this first draft as required by the Skill Creator process.

- [ ] **Step 4: Validate packaging shape and source formatting.**

  From the Skill Creator directory, run the actual validator invoked by packaging, then verify the root packaging exclusion:

  ```bash
  cd /Users/ryo.nakae/.agents/skills/skill-creator
  python -m scripts.package_skill \
    /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use \
    /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use-workspace/release
  unzip -l /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use-workspace/release/sheltie-use.skill
  ```

  Expected: the package command validates successfully, creates the ignored `.skill` archive, includes `sheltie-use/SKILL.md` and `sheltie-use/references/*`, and contains no `sheltie-use/evals/` entries.

- [ ] **Step 5: Commit the installable source and initial eval prompts.**

  ```bash
  git add skills/sheltie-use/SKILL.md skills/sheltie-use/references skills/sheltie-use/evals/evals.json
  git commit -m "feat(skill): add sheltie MCP workflow skill"
  ```

### Task 3: Run paired baseline and with-Skill evaluation iteration 1

**Objective:** Test whether the Skill changes agent behavior against the same local board and sites, while creating measurable evidence rather than relying on a final narrative.

**Files:**
- Create (ignored as runs begin): `skills/sheltie-use-workspace/iteration-1/$EVAL_DIR/eval_metadata.json`
- Create (ignored as runs complete): `skills/sheltie-use-workspace/iteration-1/$EVAL_DIR/{with_skill,without_skill}/run-{1,2,3}/agent-result.verbose.json` and `outputs/`.
- Create (ignored per run): matching `setup.md`, `timing.json`, and `grading.json`.
- Create (ignored at iteration root): `benchmark.json`, `benchmark.md`, `analysis.json`, and reviewer output.
- Modify: `skills/sheltie-use/evals/evals.json` — add finalized expectations after runs start.
- Modify: `skills/sheltie-use-workspace/iteration-1/$EVAL_DIR/eval_metadata.json` — add the same finalized assertions.

**Interfaces:**
- Consumes: Task 1 local server and verifier, Task 2 Skill and prompts.
- Produces: comparable paired runs, timing data, machine-checked evidence, human-reviewable outputs, and a benchmark.

- [ ] **Step 1: Start a clean local evaluation session.**

  Create only the required run directories as work begins, not all future iterations. Start `serve-local-sites.mjs`, launch the completed Sheltie app, turn on **Sheltie > Settings > MCP Server**, load `comparison-board.sheltie`, and create the setup described for each eval in a fresh document window. Record the exact endpoint, server process ID, and assigned `documentId` in the relevant run’s `setup.md`; do not record tokens, cookies, or page content not in fixtures.

  The `.sheltie` fixture cannot and must not preload runtime screenshot state. For each comparison run, navigate the first two local WebPage nodes while native and wait for their ordinary load/freshness screenshot capture to complete. Move both nodes outside the viewport, verify their display mode is no longer native, and leave a third never-visited local WebPage node outside the viewport. The first two must be `cached` and the third `missing` when the Agent later calls `get_webpage_screenshots`; do not bring any hidden node on screen or force a capture during evaluation.

  Create one `eval_metadata.json` per `eval-N` directory with its numeric `eval_id`, descriptive `eval_name`, prompt, and an empty `assertions` array. Directory names must be exactly `eval-0`, `eval-1`, and `eval-2` because `aggregate_benchmark.py` discovers only `eval-*`; preserve the descriptive names in metadata and the fixed mapping above.

- [ ] **Step 2: Launch three paired repetitions without configuration-order bias.**

  Run three independent repetitions for every prompt/configuration so the aggregator can report nonzero variability when behavior differs. For each `RUN_NUMBER` from 1 through 3, launch the six calls for all three evals in one tool turn: each eval gets one Agent with `skills/sheltie-use` and one without a Skill. Wait for that six-run wave to finish and persist its evidence before starting the next run number. Never run all with-Skill calls before baselines. Give all 18 runs their own fresh fixture board/document so no run changes another run’s page or Undo history.

  Use this exact with-Skill Agent instruction, substituting the actual eval prompt, mapped `EVAL_DIR`, and run number:

  ```text
  Execute this task:
  - Skill path: /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use
  - Task: the literal `prompt` value for `$EVAL_NAME` in `skills/sheltie-use/evals/evals.json`
  - Input files: the literal `files` array for `$EVAL_NAME` in `skills/sheltie-use/evals/evals.json`
  - Save outputs to: /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use-workspace/iteration-1/$EVAL_DIR/with_skill/run-$RUN_NUMBER/outputs/
  - Outputs to save: summary.md, executor-notes.md, and metrics.json
  ```

  Use this exact baseline Agent instruction, changing only the lack of a Skill path and output directory:

  ```text
  Execute this task:
  - Task: the literal `prompt` value for `$EVAL_NAME` in `skills/sheltie-use/evals/evals.json`
  - Input files: the literal `files` array for `$EVAL_NAME` in `skills/sheltie-use/evals/evals.json`
  - Save outputs to: /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use-workspace/iteration-1/$EVAL_DIR/without_skill/run-$RUN_NUMBER/outputs/
  - Outputs to save: summary.md, executor-notes.md, and metrics.json
  ```

  Agent calls are used here rather than a shell command because they must independently decide how to operate the real MCP client; shell commands only serve static fixtures and normalize/validate their results. The executor must not create evidence by calling an export or save tool; neither tool exists.

- [ ] **Step 3: Draft discriminating assertions while the first six-run wave executes.**

  Update both `evals/evals.json` and each iteration’s `eval_metadata.json` with these objective assertions, adjusted only for finalized Phase 1–3 tool names:

  - Cross-site: the derived trace begins with `list_documents` then `get_editor_state(documentId)`; all writes contain explicit `documentId`; overview contains both `get_webpage_screenshots` and `get_board_screenshot`; it records two `cached` and one `missing` result; exactly one successful `batch_edit_board` creates the expected notes/edge in `get_board` output; no `focus_nodes` or attempted nonexistent save tool appears.
  - Semantic: action sequence includes a snapshot before interaction and uses a ref from the newest snapshot after each state change; the expected submitted form confirmation appears in an action-returned snapshot in the derived trace; coordinate and evaluate tools are absent; exactly one batch creates the expected note in `get_board` output; no `focus_nodes` or attempted nonexistent save tool appears.
  - Visual: semantic snapshot precedes screenshot retrieval; coordinate action occurs only after the fixture confirms no semantic target; the successful coordinate-action response and final screenshot evidence appear in the derived trace; exactly one batch creates the expected note in `get_board` output; `focus_nodes` names only the new note and is allowed because the prompt asks to reveal it; evaluate and attempted nonexistent save tools are absent.

  Explain to the user that the viewer will show the actual outputs and per-assertion proof, while the benchmark tab compares pass rate, time, tokens, and variability. Do not mark a prose claim as passed without verifier or trace evidence.

- [ ] **Step 4: Capture Agent results, final board reads, and timing at completion.**

  As each Agent completion notification arrives, immediately write the notification values into that exact `eval-N/{with_skill|without_skill}/run-N/` directory’s `timing.json`:

  ```json
  {
    "total_tokens": 0,
    "duration_ms": 0,
    "total_duration_seconds": 0
  }
  ```

  Replace the zeroes with the notification values and calculated seconds; do not defer this step because the notification is the only durable source for those values. Capture all six runs in each wave independently, for 18 timing files total.

  Next, call `get_subagent_result` with that run’s Agent ID and `verbose: true`, and save the returned complete result at `$RUN_DIR/agent-result.verbose.json`. Run `derive-redacted-mcp-trace.mjs` to write `$RUN_DIR/outputs/redacted-mcp-trace.json`. Through the configured Sheltie MCP client, call `get_board` with the `documentId` recorded in `setup.md` and `includeEdges: true`; serialize only its `structuredContent` to `$RUN_DIR/outputs/final-board.json`. Run `verify-run.mjs` with those two files and `$RUN_DIR/outputs/executor-notes.md` so it creates `verification.json` and the grader-facing `user_notes.md` before grading. The verbose Agent result is the durable source for tool calls; `get_board` is the only final-board-state source.

- [ ] **Step 5: Grade outputs and aggregate iteration 1.**

  For each of the 18 runs, launch a grader Agent with `/Users/ryo.nakae/.agents/skills/skill-creator/agents/grader.md`, the exact expectations, persisted verbose Agent result, and outputs directory. Require `grading.json` beside `outputs/`; its `expectations` entries must use exactly `text`, `passed`, and `evidence`. The grader must read `agent-result.verbose.json`, `verification.json`, the derived redacted trace, `get_board` result in `final-board.json`, metrics, timing, and `user_notes.md`, and must flag weak assertions in `eval_feedback`.

  Then run the Skill Creator aggregation command exactly as follows:

  ```bash
  cd /Users/ryo.nakae/.agents/skills/skill-creator
  python -m scripts.aggregate_benchmark \
    /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use-workspace/iteration-1 \
    --skill-name sheltie-use
  ```

  Expected: the script discovers all three `eval-*` directories and all 18 `run-*` grading files. `benchmark.json` and `benchmark.md` compare `with_skill` with `without_skill` and include pass-rate, timing, token, min/max, standard-deviation, and delta statistics.

- [ ] **Step 6: Perform the analyst pass and open the prescribed reviewer.**

  Launch an analyst Agent with the benchmark-data section of `/Users/ryo.nakae/.agents/skills/skill-creator/agents/analyzer.md`. It must read `benchmark.json` and write `analysis.json` as a JSON string array that identifies non-discriminating assertions, persistent failures, per-eval variance, and time/token outliers without proposing changes yet.

  Generate the review UI; do not build custom HTML:

  ```bash
  nohup python /Users/ryo.nakae/.agents/skills/skill-creator/eval-viewer/generate_review.py \
    /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use-workspace/iteration-1 \
    --skill-name "sheltie-use" \
    --benchmark /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use-workspace/iteration-1/benchmark.json \
    > /dev/null 2>&1 &
  VIEWER_PID=$!
  ```

  Expected: the viewer opens with **Outputs** and **Benchmark** tabs. Tell the user that they can inspect paired results, see formal grades, and submit `feedback.json`; the agent must wait for user feedback before revising the Skill.

### Task 4: Iterate from benchmark evidence and user review

**Objective:** Improve only instructions or references that evidence and user feedback show are missing, then rerun every paired evaluation fairly.

**Files:**
- Modify as justified: `skills/sheltie-use/SKILL.md`
- Modify as justified: `skills/sheltie-use/references/*.md`
- Modify as justified: `skills/sheltie-use/evals/evals.json`
- Create (ignored): `skills/sheltie-use-workspace/iteration-N/...` for each later iteration.
- Create (ignored): `skills/sheltie-use-workspace/iteration-N/feedback.json`

**Interfaces:**
- Consumes: iteration 1 review feedback, grading results, benchmark, and analyst notes.
- Produces: revised Skill source, reproducible paired iteration(s), and documented rationale for retaining or removing instructions.

- [ ] **Step 1: Ingest feedback and close the previous reviewer.**

  After the user submits reviews, copy the downloaded `feedback.json` into `skills/sheltie-use-workspace/iteration-1/feedback.json`, read all non-empty comments, and associate each comment with its output and formal grade. Stop the viewer:

  ```bash
  kill $VIEWER_PID 2>/dev/null
  ```

  Expected: user-specific issues, grader evidence, and analyst observations are available together; no running viewer process remains.

- [ ] **Step 2: Revise for general behavior rather than fixture-specific wording.**

  Change the Skill only where feedback or trace evidence identifies a causal gap. Examples of acceptable generalizations are: make the overview-first reason clearer if agents skip cross-site evidence; explain snapshot replacement if they reuse stale refs; clarify typed-action preference if they jump to evaluate; move a large detail into a reference if the main body caused unnecessary work. Do not add brittle strings from fixture labels, hard-code local URLs, or turn every suggestion into an absolute rule.

  Add a short entry to the workspace `revision-notes.md` naming the evidence, source file changed, and expected behavioral effect. Keep this file ignored.

- [ ] **Step 3: Rerun all three paired evaluations as iteration N.**

  Repeat Task 3’s three six-Agent waves, setup isolation, timing capture, verifier, grader, aggregation, and analyst pass. Preserve the `iteration-N/eval-*/{with_skill,without_skill}/run-*/` layout. For a new Skill, baseline always remains `without_skill`; never replace it with a prior iteration. Populate new `eval_metadata.json` files even when prompts have not changed.

  Generate the viewer with the prior workspace included:

  ```bash
  nohup python /Users/ryo.nakae/.agents/skills/skill-creator/eval-viewer/generate_review.py \
    /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use-workspace/iteration-N \
    --skill-name "sheltie-use" \
    --benchmark /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use-workspace/iteration-N/benchmark.json \
    --previous-workspace /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use-workspace/iteration-$((N - 1)) \
    > /dev/null 2>&1 &
  VIEWER_PID=$!
  ```

  Expected: the reviewer exposes current output, previous output, prior user feedback, and the new benchmark. Continue only while feedback identifies a meaningful issue or a revision improves a discriminating metric; stop when the user is satisfied, feedback is empty, or another revision makes no meaningful progress.

- [ ] **Step 4: Commit accepted source-only revisions.**

  Do not add workspace files. When an iteration produces an accepted source change, run:

  ```bash
  git add skills/sheltie-use/SKILL.md skills/sheltie-use/references skills/sheltie-use/evals/evals.json
  git commit -m "refactor(skill): improve sheltie MCP guidance"
  ```

### Task 5: Optimize and validate the Skill trigger description with 20 reviewed queries

**Objective:** Make the `description` field invoke `sheltie-use` for substantive Sheltie-MCP requests without stealing adjacent tasks such as general browsing or Sheltie implementation.

**Files:**
- Create: `skills/sheltie-use/evals/trigger-evals.json`
- Modify: `skills/sheltie-use/SKILL.md` — frontmatter description only if optimization selects a better held-out result.
- Create (ignored): `skills/sheltie-use-workspace/trigger-description/` — HTML review copy, optimization log, and reports.

**Interfaces:**
- Consumes: finalized Skill body and user-reviewed trigger cases.
- Produces: 20-query test set, selected held-out-test description, and before/after scores.

- [ ] **Step 1: Create a balanced 20-query trigger set.**

  Write 8–10 should-trigger and 8–10 should-not-trigger queries in `trigger-evals.json`. Each query must be realistic, concrete, and multi-step. Cover direct phrases such as “compare the pages open on my Sheltie board,” indirect requests such as “turn these three product pages into linked notes,” authenticated-in-app research, cached screenshot comparison, form completion in a named WebPage, canvas fallback, and “show me the notes you added.” Use near-miss negatives: building the MCP server, changing a React Flow board UI, controlling Chrome with Playwright, general web research with no Sheltie board, writing a design-tool Skill, and merely opening a `.sheltie` file. Include informal Japanese and English wording, typos, different lengths, and contexts that mention MCP but should select another tool.

- [ ] **Step 2: Present the set for user review using the supplied template.**

  Read `/Users/ryo.nakae/.agents/skills/skill-creator/assets/eval_review.html`, replace `__EVAL_DATA_PLACEHOLDER__`, `__SKILL_NAME_PLACEHOLDER__`, and `__SKILL_DESCRIPTION_PLACEHOLDER__`, then write and open the review file:

  ```bash
  open /tmp/eval_review_sheltie-use.html
  ```

  Expected: the user can edit queries, toggle expected triggering, add/remove cases, and export their reviewed set. Copy the most recently exported `~/Downloads/eval_set*.json` into `skills/sheltie-use/evals/trigger-evals.json` before starting the optimization. Preserve exactly 20 reviewed queries.

- [ ] **Step 3: Run the exact Skill Creator optimization loop in the background.**

  Set `MODEL_ID` to the exact model identifier powering the active session; do not substitute a convenient model. Then run:

  ```bash
  cd /Users/ryo.nakae/.agents/skills/skill-creator
  python -m scripts.run_loop \
    --eval-set /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use/evals/trigger-evals.json \
    --skill-path /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use \
    --model "$MODEL_ID" \
    --max-iterations 5 \
    --verbose
  ```

  Start it in the background and periodically inspect its output. Expected: it uses a 60% train / 40% held-out split, evaluates each query three times, reports per-iteration scores, and chooses `best_description` by held-out performance rather than training score.

- [ ] **Step 4: Apply only a held-out winner and commit it.**

  Record the before/after descriptions and train/test scores in the ignored workspace. Update the frontmatter only if `best_description` improves the held-out score or resolves user-approved false positives/negatives without a held-out regression. Then run the full test set once more with the selected description and commit source changes:

  ```bash
  git add skills/sheltie-use/SKILL.md skills/sheltie-use/evals/trigger-evals.json
  git commit -m "refactor(skill): tune sheltie skill trigger description"
  ```

### Task 6: Package the accepted Skill and run repository validation

**Objective:** Produce an installable archive containing only runtime Skill material, preserve all evaluation evidence outside Git, and verify the repository remains healthy.

**Files:**
- Generate (ignored): `skills/sheltie-use-workspace/release/sheltie-use.skill`
- Verify: `skills/sheltie-use/SKILL.md`, `skills/sheltie-use/references/*`, `skills/sheltie-use/evals/*`, `.gitignore`

**Interfaces:**
- Consumes: accepted Skill source and final evaluation evidence.
- Produces: validated `.skill` archive and a concise release handoff with benchmark/review summary.

- [ ] **Step 1: Perform source and package validation.**

  Run:

  ```bash
  cd /Users/ryo.nakae/.agents/skills/skill-creator
  python -m scripts.package_skill \
    /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use \
    /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use-workspace/release
  unzip -t /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use-workspace/release/sheltie-use.skill
  unzip -l /Users/ryo.nakae/Dev/private/sheltie/skills/sheltie-use-workspace/release/sheltie-use.skill | grep 'sheltie-use/evals/' && exit 1 || true
  ```

  Expected: packaging validation succeeds, archive integrity is valid, and the final command produces no `evals/` entries. The archive remains available for installation at the ignored release path; the repository-tracked `skills/sheltie-use/` directory is the source of truth.

- [ ] **Step 2: Run project and harness checks.**

  Run:

  ```bash
  npm run lint
  npm run format
  npm run typecheck
  npm run test
  git status --short
  ```

  Expected: lint, format, typecheck, and all tests pass. `git status --short` contains only intended committed source changes or no output; it must not list `skills/sheltie-use-workspace/`.

- [ ] **Step 3: Complete a release checkpoint.**

  Confirm all of the following before handing off:

  - the packaged Skill loads with its references and no evaluation fixtures;
  - the latest paired benchmark and analyst notes show the actual with-Skill/baseline outcome, including timing and token tradeoff;
  - the user reviewed at least iteration 1 through `generate_review.py`, and later revisions include their feedback;
  - final body guidance contains every global workflow constraint, especially explicit IDs, cached overview, fresh refs, semantic-first actions, atomic board batches, no save, and explicit-only focus;
  - `skills/sheltie-use-workspace/` remains ignored and contains the reproducibility record plus the `.skill` archive.

  If a final source-only packaging adjustment was required, commit it:

  ```bash
  git add .gitignore skills/sheltie-use
  git commit -m "chore(skill): package sheltie MCP skill release"
  ```

  Do not stage the generated `.skill` archive or any workspace artifact.

## Validation

- `npm run test -- skills/sheltie-use/evals/fixtures/verify-eval.test.ts` — validates trace assertions including stale refs, atomic batches, no-save, and focus gating.
- `node skills/sheltie-use/evals/fixtures/serve-local-sites.mjs` — serves only deterministic loopback sites for a real MCP session.
- Paired Agent runs — every eval has simultaneous `with_skill` and `without_skill` output, persisted verbose Agent result, locally derived redacted trace, read-only `get_board` final state, verifier output, metrics, and immediate `timing.json`.
- `python -m scripts.aggregate_benchmark ... --skill-name sheltie-use` — produces valid benchmark JSON/Markdown from grading results.
- `eval-viewer/generate_review.py` — presents outputs and benchmark to the user before a revision.
- `python -m scripts.run_loop ... --max-iterations 5 --verbose` — chooses description changes using a reviewed 20-query set and held-out score.
- `python -m scripts.package_skill ...` plus `unzip -t` — validates the distributable archive and its exclusion of root evals.
- `npm run lint && npm run format && npm run typecheck && npm run test` — confirms repository-wide validation after the new fixture test and Skill source.

## Risks, Tradeoffs, and Open Questions

- The fixture server validates instructions, not a public web site's changing behavior. It intentionally favors determinism so a baseline comparison measures the Skill rather than network variance.
- Cached and missing screenshots are part of the product contract. The Skill must report their limitation rather than silently attempting unreliable captures of hidden WKWebViews.
- `browser_evaluate` is intentionally available to trusted clients but is a poor default because it can bypass semantic safety and access page JavaScript state. The evaluation suite should detect unjustified use, not prohibit it when a final-schema limitation makes it necessary.
- User feedback is a required quality signal for subjective usefulness. Objective trace assertions prevent the viewer from treating polished prose as proof of correct MCP operation.
- The exact active-session model identifier is not stored in this repository. Capture it at the start of trigger optimization so the Skill Creator loop measures the model users actually invoke.
