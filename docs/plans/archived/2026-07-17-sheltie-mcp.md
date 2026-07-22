# Sheltie MCP Implementation Plan

> **For implementers:** Execute the child plans in order. Update this progress list when each child plan is completed and verified.

**Goal:** Let trusted AI clients inspect and atomically edit every open Sheltie board, operate its embedded WKWebViews, compare multiple websites visually, and use a tested distributable Skill.

**Approach:** Add an opt-in local Streamable HTTP MCP server to the macOS app, keep document/board state in the existing renderer and Zustand boundaries, and add page-scoped WKWebView automation actors in Rust. Deliver the work in four independently reviewable phases; later phases consume the exact contracts established by earlier phases.

## Shared Decisions

- macOS/WKWebView only for the initial release.
- MCP binds to loopback, has no authentication, and is disabled by default through a persisted menu setting.
- Every write uses explicit `documentId`; every page operation also uses explicit `pageNodeId`.
- Connected clients are trusted and may operate authenticated pages without per-action confirmation.
- Board writes use declarative, atomic `batch_edit_board` calls that create one Undo entry.
- MCP never saves documents. The user remains responsible for Save/Save As.
- Hidden/offscreen WebPages are never shown to refresh screenshots. Multi-site and board overview use cached images and report missing/stale evidence.
- Semantic DOM/ARIA actions come before screenshot-coordinate fallback; `browser_evaluate` is the final fallback.
- Selection and viewport are read-only unless the user explicitly requests `focus_nodes`.
- The distributable Skill is created and evaluated with the Skill Creator workflow after MCP contracts are stable.

## Progress

- [x] [Phase 1 — MCP foundation, board tools, and multi-site overview](2026-07-17-sheltie-mcp/phase-1-foundation-and-board.md)
- [x] [Phase 2 — Semantic WKWebView automation](2026-07-17-sheltie-mcp/phase-2-semantic-web-automation.md)
- [x] [Phase 3 — Visual fallback and extended Web operations](2026-07-17-sheltie-mcp/phase-3-extended-web-automation.md)
- [x] [Phase 4 — Distributable Sheltie Skill and evaluation](2026-07-17-sheltie-mcp/phase-4-skill.md)

## Completion

After all four child plans pass their validation, move this parent file and its matching child directory to `docs/plans/archived/` while preserving the same parent/child structure.
