# Sheltie Release Hardening Implementation Plan

> **For implementers:** Execute the child plans in order. Update this progress list when each child plan is completed and verified.

**Goal:** リリース前に、破損・悪意ある `.sheltie` によるデータ消失経路を閉じ、ページ由来入力の信頼境界を明示し、既知のバグ・デッドコード・ドキュメント不一致を清算する。

**Approach:** 5 観点のコードレビュー（Rust/Tauri セキュリティ、MCP 境界、フロントエンド、Rust/TS リファクタ）と Codex による 2 系統の外部レビューで挙がった指摘を、`dig` で 21 項目の決定事項に落とした結果を実装する。フェーズ 1 はリリースブロッカー（データ保全）で単独完結させ、フェーズ 2 で信頼境界、フェーズ 3 で構造・ドキュメントを整える。

## Shared Decisions

これらは全フェーズが継承する。フェーズ内で判断を再検討しない。

### スコープ方針

- **欠陥は直す。機能は見送る。** 未実装機能（JS ダイアログ、カメラ/マイク対応、MCP 認証、スクリーンショットの明示的消去）はリリース後に回す。
- **未リリース（git tag 0 件）なので後方互換の負債はない。** 検証は今のうちに厳格化する。
- **Wry の fork はしない。** isolated content world・メディア権限の origin 判定・native JS ダイアログはいずれも Wry patch/vendor が前提になるため、維持コストに見合わないと判断した。代わりに制約をドキュメントで固定する。

### `.sheltie` ドキュメント契約

- 読み込みに失敗したファイルは **fail-closed**。エラーダイアログのみ表示し、`filePath` を編集対象に結び付けず、ウインドウを閉じる。読み取り専用モードや回復用 Save As は作らない。
- 検証は **クラッシュ防止に必要な範囲**に限る（配列添字の範囲・enum・数値の有限性）。node/edge 件数、文字列長、Tiptap JSON 深さの上限は設けない。
- ファイルサイズ上限は **64 MiB**（パース前に metadata で判定）。
- URL は `http` / `https` / 空文字のみ許可。違反は「開けないファイル」として扱う。
- 保存は temp file → `sync_all` → atomic rename。上書き時は元ファイルの permissions を引き継ぐ（xattr / Finder タグは対象外）。

### 信頼境界

- **ページ由来の URL 文字列は一切信頼しない。** `document.title` の `\x01` 通知と `on_navigation` は「URL を再取得する契機」として扱い、表示・保存する URL は常に native の webview から取得する。
- **MCP に認証は入れない。** Figma のデスクトップ MCP と同じ「URL だけの設定」で使えることを維持する。接続できた local client を信頼するという既存設計を変えない。ただし `docs/agents/mcp.md` の露出範囲の記述は正確化する（loopback は UID 分離がなく、別ログインユーザーからも到達可能）。
- **MCP に body / session / 並列数の上限は入れない。** 信頼すると決めた相手に対する上限はセキュリティ上の利得がなく、境界の線引きを曖昧にする。
- **page automation ブリッジはページと realm を共有する。** `Object.defineProperty` による硬化は行うが、これはセキュリティ境界ではないとドキュメントに明記する。password/OTP ガードは事故防止のガードレールとして扱う。

### 検証コマンド

`docs/agents/workflow.md` の規定どおり、各タスクの完了時に実行する。

```bash
npm run lint
npm run format
npm run typecheck
npm run test
# Rust を触ったタスクのみ
(cd src-tauri && cargo test --lib)
```

## Progress

- [ ] [Phase 1 — データ保全とドキュメント検証](2026-07-31-release-hardening/phase-1-data-integrity.md)
- [ ] [Phase 2 — 信頼境界の明示](2026-07-31-release-hardening/phase-2-trust-boundaries.md)
- [ ] [Phase 3 — リファクタ・テスト・ドキュメント](2026-07-31-release-hardening/phase-3-refactor-and-docs.md)

## Release Gate

Phase 1 は単独でリリースブロッカーを解消する。Phase 3 が不安定化した場合は Phase 3 のみを後ろに倒し、Phase 1 + 2 でリリースする判断ができるよう、各フェーズを独立して検証・コミットできる形に保つ。

## Completion

3 つの子 plan がすべて validation を通過したら、この親ファイルと同名の子ディレクトリを、同じ親子構造を保ったまま `docs/plans/archived/` へ移す。
