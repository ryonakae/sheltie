# Phase 2 — 信頼境界の明示 Implementation Plan

> **For implementers:** Execute this plan task-by-task. Complete each checkbox step, run the listed validation, and commit after each task.

**Goal:** ネイティブ Webview へ渡る URL の scheme を Rust 側で強制し、ページが申告する URL を信頼しない構造にする。あわせて page automation のなりすまし経路、スクリーンショットキャッシュの orphan 化、緩和層（CSP・capability）を整える。

**Architecture:** URL 検証の正本を Rust の `normalize_navigation_url` に集約し、webview 生成・reload・popup・SPA 通知のすべてがそこを通るようにする。フロントエンドは Phase 1 で追加した `isAllowedPageUrl` を文書パーサーと MCP board operations で使い、二層で防ぐ。表示・保存する URL は native の webview から取得した値だけを正本にする。

**Tech Stack:** Rust / Tauri v2 / cargo test、TypeScript / Vitest、JavaScript（initialization script）

## Global Constraints

- Phase 1 の完了が前提。`isAllowedPageUrl`（`src/lib/url-utils.ts`）が存在すること。
- 許可 scheme は `http` / `https` のみ。空文字は TS 層でのみ許可（Rust には空文字が渡らない）。
- **MCP に認証・body / session / 並列数の上限は追加しない。** 接続できた local client を信頼する既存設計を維持する。
- **Wry の fork はしない。** isolated content world への移行は行わず、`Object.defineProperty` による硬化とドキュメント記載で対応する。
- page automation の request ID は `uuid` crate（`src-tauri/Cargo.toml:38`、`features = ["serde", "v4"]`）を使う。broker（`src-tauri/src/mcp/broker.rs:104`）と同じ `Uuid::new_v4()` に揃える。
- スクリーンショットキャッシュの TTL は exact value で **30 日**。
- `.sheltie` に追加する `projectId` は **optional フィールド**。存在しないファイルを開いたときに dirty 判定が壊れないこと（Task 7 のテストで担保する）。

## Current Context

確認済みの既存実装:

- `src-tauri/src/commands/webview/page_automation.rs:37-41` — `normalize_navigation_url` は `tauri::Url::parse` のみ。scheme allowlist なし。`on_page_load` と automation の committed navigation が消費している。
- `src-tauri/src/commands/webview/bounds.rs:175-177` — `create_page_webview` は `url.parse::<tauri::Url>()` の結果をそのまま `WebviewUrl::External` に渡す。
- `src-tauri/src/commands/webview/bounds.rs:197-218` — `on_new_window` は popup を `Deny` し、`tauri::Url::parse` が通れば同じ webview で `navigate` する（scheme 検証なし）。
- `src-tauri/src/commands/webview/bounds.rs:222-236` — `on_navigation` は **policy 判定の時点で** `page-navigated-{pid}` に `nav_url` を載せて emit し、常に `true` を返す。
- `src-tauri/src/commands/webview/bounds.rs:237-253` — `on_page_load` は `Finished` のときだけ automation state に committed navigation を記録する。イベント emit はしていない。
- `src-tauri/src/commands/webview/bounds.rs:255-292` — `on_document_title_changed` が title 先頭 `\x01` を URL 変更、`\x02` をスクロール完了として扱う。`\x01` の場合はページが与えた文字列を `page-navigated-{pid}` に載せる。
- `src-tauri/src/commands/webview/navigation.rs:92-101` — `reload_page_webview` も `parse` のみ。
- `src/lib/tauri-bridge/webview.ts:272-279` — フロントは `page-navigated-${pageId}`（payload `{ url: string }`）と `page-scroll-ended-${pageId}` を listen する。消費側は `src/hooks/sheltie/useWebPageWebviewLifecycle.ts:212`。
- `src-tauri/src/commands/webview/page_automation_script.js:1187-1192` — ブリッジを通常代入で `window.__SHELTIE_MCP_PAGE_AUTOMATION__` に公開している。
- `src-tauri/src/mcp/page_automation/actor.rs:846-850` — `allocate_request_id` は `pa-{連番}`。
- `src-tauri/src/mcp/page_automation/actor.rs:178-196` — `complete` は identity 照合の**前**に `pending.remove` してしまう。不一致時は正規の待ち手へ `bridge_rejected` を送る。
- `src-tauri/src/mcp/page_automation/actor.rs:1327` 付近 — 現在の（不一致で pending を消費する）挙動を固定しているテストがある。
- `src-tauri/src/commands/webview/snapshot.rs:48-50` — `rx.await` にタイムアウトがない。`hide_after_snapshot_request` が true の場合は hide 済みのまま無期限待機する。
- `src/store/tab-store.ts:149` — `createProject` が毎回 `crypto.randomUUID()` で `Project.id` を作る。`SheltieDocumentV2`（`src/types/index.ts`）に `id` 相当のフィールドはない。
- `src-tauri/src/commands/webview/screenshots.rs:134-141` — `screenshots_dir` は `app_data_dir/screenshots/{project_id}`。GC は存在しない。
- `src-tauri/tauri.conf.json:12-21` — `withGlobalTauri: true`、`csp: null`、`assetProtocol.scope: ["$APPDATA/screenshots/**"]`。
- `index.html` — head に inline `<style>`（初回 paint の白防止）と inline `<script>`（`light` / `dark` クラス付与）がある。どちらも実行順が本質的。
- `src-tauri/capabilities/default.json` — `windows: ["document-*", "page-*"]`、`store:*` 5 件を含む。

## File Structure

- Create: `public/theme-init.js` — 初回 paint 前のテーマクラス付与（CSP `script-src 'self'` 対応）
- Create: `public/initial-background.css` — 初回 paint の背景色
- Modify: `index.html` — inline script / style を外部参照へ置換
- Modify: `src-tauri/tauri.conf.json` — CSP を設定
- Modify: `src-tauri/capabilities/default.json` — 未使用権限の削除、`windows` → `webviews`
- Modify: `src-tauri/src/commands/webview/page_automation.rs` — scheme allowlist
- Modify: `src-tauri/src/commands/webview/bounds.rs` — create / popup / navigation / title の URL 取り扱い
- Modify: `src-tauri/src/commands/webview/navigation.rs` — reload の scheme 検証
- Modify: `src-tauri/src/commands/webview/page_automation_script.js` — ブリッジ公開の硬化
- Modify: `src-tauri/src/mcp/page_automation/actor.rs` — request ID の UUID 化、identity 不一致時に pending を消費しない
- Modify: `src-tauri/src/commands/webview/snapshot.rs` — タイムアウトと復帰
- Modify: `src-tauri/src/commands/webview/screenshots.rs` — TTL GC コマンド
- Modify: `src/lib/mcp/board-operations.ts` — URL scheme 検証
- Modify: `src/lib/mcp/board-operations.test.ts` — 不正 scheme の拒否ケース
- Modify: `src/types/index.ts` — `SheltieDocumentV2.projectId`
- Modify: `src/lib/project-document.ts` — `projectId` の parse / serialize
- Modify: `src/lib/project-document.test.ts` — `projectId` の round trip と dirty 判定
- Modify: `src/store/tab-store.ts` — 文書の `projectId` を採用

## Tasks

### Task 1: Rust に URL scheme allowlist を置く

**Objective:** ネイティブ Webview に到達しうるすべての URL 経路で `http` / `https` を強制する。

**Files:**
- Modify: `src-tauri/src/commands/webview/page_automation.rs:37-41`
- Modify: `src-tauri/src/commands/webview/bounds.rs:175-177, 197-218`
- Modify: `src-tauri/src/commands/webview/navigation.rs:92-101`

**Interfaces:**
- Produces: `normalize_navigation_url(url: &str) -> Result<String, String>`（scheme 検証込み。既存シグネチャを維持）

- [x] **Step 1: Write the failing test**

`src-tauri/src/commands/webview/page_automation.rs` の `#[cfg(test)] mod tests` に追加する（存在しなければ末尾に作る）。

```rust
    #[test]
    fn normalize_navigation_url_allows_only_http_and_https() {
        assert!(normalize_navigation_url("https://example.com/").is_ok());
        assert!(normalize_navigation_url("http://127.0.0.1:8080/x").is_ok());

        for rejected in [
            "file:///Users/victim/.ssh/id_rsa",
            "javascript:alert(1)",
            "data:text/html,<script>1</script>",
            "tauri://localhost",
            "asset://localhost/x.png",
        ] {
            assert!(
                normalize_navigation_url(rejected).is_err(),
                "must reject {rejected}"
            );
        }
    }
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib normalize_navigation_url_allows_only_http_and_https`
Expected: `must reject file:///Users/victim/.ssh/id_rsa` で assertion 失敗

- [x] **Step 3: Write minimal implementation**

`src-tauri/src/commands/webview/page_automation.rs:37-41` を差し替える。

```rust
/// ページ Webview へ渡る URL は http / https だけを許可する。
/// file: や custom scheme はボード上の Webview が読み込むべき対象ではない。
pub fn normalize_navigation_url(url: &str) -> Result<String, String> {
    let parsed =
        tauri::Url::parse(url).map_err(|error| format!("invalid page navigation URL: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed.to_string()),
        scheme => Err(format!("unsupported page navigation URL scheme: {scheme}")),
    }
}
```

`src-tauri/src/commands/webview/bounds.rs:175-177` を差し替える。

```rust
    let parsed_url = normalize_navigation_url(&url)?
        .parse::<tauri::Url>()
        .map_err(|e| format!("failed to parse URL: {e}"))?;
```

`bounds.rs` の `use` に `normalize_navigation_url` が無ければ追加する（同 crate 内の `super::page_automation::normalize_navigation_url` 相当。既存の import 形式に合わせる）。

`src-tauri/src/commands/webview/bounds.rs:204-206` の popup 内 parse を差し替える。

```rust
                        let Ok(normalized) = normalize_navigation_url(&new_url) else {
                            return;
                        };
                        let Ok(url) = tauri::Url::parse(&normalized) else {
                            return;
                        };
```

`src-tauri/src/commands/webview/navigation.rs:94-96` を差し替える。

```rust
    let parsed_url = normalize_navigation_url(&url)?
        .parse::<tauri::Url>()
        .map_err(|e| format!("failed to parse URL: {e}"))?;
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib && cargo clippy --all-targets 2>&1 | tail -5`
Expected: 全テスト green。clippy は既知の `items_after_test_module` 1 件のみ（Phase 3 で解消）

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/commands/webview/page_automation.rs src-tauri/src/commands/webview/bounds.rs src-tauri/src/commands/webview/navigation.rs
git commit -m "fix(webview): allow only http and https page URLs"
```

---

### Task 2: MCP board operations に URL 検証を追加する

**Objective:** MCP 経由で不正 scheme の URL がボードへ入り、そのまま保存されるのを防ぐ。

**Files:**
- Modify: `src/lib/mcp/board-operations.ts:122, 313`
- Modify: `src/lib/mcp/board-operations.test.ts`

**Interfaces:**
- Consumes: `isAllowedPageUrl`（Phase 1 Task 3）

- [x] **Step 1: Write the failing test**

`src/lib/mcp/board-operations.test.ts` に追加する。この関数は `applyBoardOperations(snapshot, operations, createId)`（`board-operations.ts:527`）で、既存ヘルパー `webpage(id, x)` を使う。失敗結果の判定方法は既存テストが `BatchEditBoardResult` をどう検査しているかに合わせる（`ok` フラグと `error` の形）。

```ts
  it('create_node の url が http/https 以外なら失敗する', () => {
    const result = applyBoardOperations(
      { nodes: [], edges: [] },
      [
        {
          op: 'create_node',
          tempId: 'page',
          node: { type: 'webpage', url: 'file:///etc/passwd' },
        },
      ],
      () => 'page-id',
    );

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toMatch(/url/);
  });

  it('update_node の url が http/https 以外なら失敗する', () => {
    const result = applyBoardOperations(
      { nodes: [webpage('a')], edges: [] },
      [
        {
          op: 'update_node',
          nodeId: 'a',
          patch: { type: 'webpage', url: 'javascript:alert(1)' },
        },
      ],
      () => 'unused',
    );

    expect(result.ok).toBe(false);
  });

  it('空文字の url は URL 未入力ノードとして許可する', () => {
    const result = applyBoardOperations(
      { nodes: [], edges: [] },
      [{ op: 'create_node', tempId: 'page', node: { type: 'webpage', url: '' } }],
      () => 'page-id',
    );

    expect(result.ok).toBe(true);
  });
```

> 既存テストのテスト名は日本語・英語が混在している。このファイルの近傍の記法に合わせる。`update_node` の operation 形状（`nodeId` / `patch` のキー名）は `BoardOperation` 型定義で確認する。

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/mcp/board-operations.test.ts`
Expected: `expected true to be false` — 現在は任意の文字列が受理される

- [x] **Step 3: Write minimal implementation**

`src/lib/mcp/board-operations.ts` の import に追加する。

```ts
import { isAllowedPageUrl } from '@/lib/url-utils';
```

`requireString` の直後に helper を追加する。

```ts
function requirePageUrl(value: unknown, name: string, operationIndex: number): string {
  const url = requireString(value, name, operationIndex);
  if (!isAllowedPageUrl(url)) {
    fail(operationIndex, `${name} must be an http or https URL`);
  }
  return url;
}
```

`createNode` の webpage 分岐（122 行）を差し替える。

```ts
    const url =
      input.url === undefined ? '' : requirePageUrl(input.url, 'node.url', operationIndex);
```

`updateNode` の webpage 分岐（313 行）を差し替える。

```ts
      const url = requirePageUrl(patch.url, 'patch.url', operationIndex);
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/mcp/board-operations.test.ts`
Expected: 全ケース green

- [x] **Step 5: Commit**

```bash
git add src/lib/mcp/board-operations.ts src/lib/mcp/board-operations.test.ts
git commit -m "fix(mcp): reject non-http page URLs in board operations"
```

---

### Task 3: 表示・保存する URL を native の実 URL に統一する

**Objective:** ページが `document.title` 経由で申告した URL を信頼せず、また未 commit のナビゲーションを保存しないようにする。

**Files:**
- Modify: `src-tauri/src/commands/webview/bounds.rs:222-292`

**Interfaces:**
- Produces: `page-navigated-{pid}` の payload 形状（`{ "url": string }`）は変更しない。emit のタイミングと URL の出所だけが変わる

- [x] **Step 1: `on_navigation` から URL emit を外す**

`src-tauri/src/commands/webview/bounds.rs:222-236` を差し替える。

```rust
            .on_navigation({
                // policy 判定の時点では commit されていないため、ここで URL を保存すると
                // DNS/TLS エラーやキャンセルでも保存 URL だけが進んでしまう。
                // URL の確定は on_page_load(Finished) と SPA 通知に任せる。
                move |_nav_url| true
            })
```

- [x] **Step 2: `on_page_load` で commit 済み URL を emit する**

`bounds.rs:237-253` を差し替える。

```rust
            .on_page_load({
                let ah = app_handle.clone();
                let automation_key = automation_key.clone();
                let pid = pid.clone();
                let event_window_label = event_window_label.clone();
                move |_webview, payload| {
                    if payload.event() != PageLoadEvent::Finished {
                        return;
                    }
                    let Ok(url) = normalize_navigation_url(payload.url().as_str()) else {
                        return;
                    };
                    if let Err(error) = ah
                        .state::<PageAutomationState>()
                        .note_committed_navigation(&automation_key, url.clone())
                    {
                        log::warn!("failed to record committed page navigation: {error}");
                    }
                    ah.emit_to(
                        &event_window_label,
                        &format!("page-navigated-{pid}"),
                        serde_json::json!({ "url": url }),
                    )
                    .ok();
                }
            })
```

- [x] **Step 3: `\x01` 通知では native の URL を読み直す**

`bounds.rs` の `on_document_title_changed` に `label` の clone を追加し、`\x01` 分岐を差し替える。クロージャ先頭の clone 群に次を加える。

```rust
                let label = label.clone();
```

`\x01` 分岐（255-277 行相当）を差し替える。

```rust
                move |_webview, title| {
                    // \x01: initialization_script からの SPA URL 変更通知
                    // \x02: initialization_script からのスクロール完了通知
                    // \x01 の値はページが自由に設定できるため URL としては信頼せず、
                    // 「URL を読み直す契機」としてのみ扱う。
                    if title.starts_with('\u{0001}') {
                        let Some(webview) = ah.get_webview(&label) else {
                            return;
                        };
                        let Ok(current_url) = webview.url() else {
                            return;
                        };
                        let Ok(url) = normalize_navigation_url(current_url.as_str()) else {
                            return;
                        };
                        if let Err(error) = ah
                            .state::<PageAutomationState>()
                            .note_spa_navigation(&automation_key, url.clone())
                        {
                            log::warn!("failed to record SPA page navigation: {error}");
                        }
                        ah.emit_to(
                            &event_window_label,
                            &format!("page-navigated-{pid}"),
                            serde_json::json!({ "url": url }),
                        )
                        .ok();
                    } else if title.starts_with('\u{0002}') {
```

`\x02` 以降の分岐は変更しない。

- [x] **Step 4: Run validation**

Run: `cd src-tauri && cargo test --lib && cargo clippy --all-targets 2>&1 | tail -5`
Expected: 全テスト green

- [x] **Step 5: 手動確認（必須）**

`npm run dev` で起動し、次を確認する。

1. 通常のページ遷移（リンククリック）でツールバーの URL が更新される（commit 後に更新されるため、遷移中は前の URL のまま）
2. SPA（例: GitHub 内のページ遷移）で URL が追従する
3. 存在しないホスト（例: `https://nonexistent.invalid`）へ遷移 → 保存 URL が変わらない
4. 偽装の確認: DevTools で `document.title = '\x01https://accounts.google.com/'` を実行 → ツールバーの URL が変わらないこと
5. スクロール停止後のスクリーンショット更新が従来どおり動くこと

- [x] **Step 6: Commit**

```bash
git add src-tauri/src/commands/webview/bounds.rs
git commit -m "fix(webview): trust only native URLs for page navigation events"
```

---

### Task 4: page automation ブリッジの再代入を防ぐ

**Objective:** ページ側の単純な上書きでブリッジを差し替えられない状態にする。

**Files:**
- Modify: `src-tauri/src/commands/webview/page_automation_script.js:1187-1192`
- Modify: `src-tauri/src/commands/webview/scripts.rs`（テスト追加）

- [x] **Step 1: Write the failing test**

`src-tauri/src/commands/webview/scripts.rs` の `mod tests` 内 `page_automation_source_has_the_all_frame_bridge_contract` の直後に追加する。

```rust
    #[test]
    fn page_automation_bridge_is_defined_as_a_non_writable_property() {
        assert!(
            PAGE_AUTOMATION_SCRIPT.contains("Object.defineProperty(window"),
            "the bridge must be installed with defineProperty"
        );
        assert!(
            PAGE_AUTOMATION_SCRIPT.contains("writable: false"),
            "the bridge property must not be writable"
        );
        assert!(
            PAGE_AUTOMATION_SCRIPT.contains("configurable: false"),
            "the bridge property must not be configurable"
        );
    }
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib page_automation_bridge_is_defined_as_a_non_writable_property`
Expected: `the bridge must be installed with defineProperty` で失敗

- [x] **Step 3: Write minimal implementation**

`src-tauri/src/commands/webview/page_automation_script.js:1187-1192` を差し替える。

```js
  // ページと同一 realm で動くため、これはセキュリティ境界ではない。
  // 単純な再代入によるブリッジ差し替えだけを防ぐ。
  Object.defineProperty(window, '__SHELTIE_MCP_PAGE_AUTOMATION__', {
    value: Object.freeze({
      dispatch(request) {
        if (!isTopFrame) throw new Error('Only the top frame accepts native dispatch.');
        return dispatchTopFrame(request);
      },
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib`
Expected: 全テスト green（既存の `__SHELTIE_MCP_PAGE_AUTOMATION__` を含むアサーションも通ること）

- [x] **Step 5: 手動確認**

`npm run dev` で MCP を有効にし、任意のページで `browser_snapshot` と `browser_click` が従来どおり動くことを確認する。

- [x] **Step 6: Commit**

```bash
git add src-tauri/src/commands/webview/page_automation_script.js src-tauri/src/commands/webview/scripts.rs
git commit -m "fix(automation): install the page bridge as a non-writable property"
```

---

### Task 5: request ID を UUID にし、identity 不一致で pending を消費しない

**Objective:** 悪意あるページが連番 ID を推測して他ページの automation を失敗させる経路を閉じる。

**Files:**
- Modify: `src-tauri/src/mcp/page_automation/actor.rs:178-196, 846-850`
- Modify: `src-tauri/src/mcp/page_automation/actor.rs` のテスト（1327 行付近）

- [x] **Step 1: Write the failing test**

既存テスト `mismatched_completion_identity_fails_the_known_request`（`actor.rs:1332` 付近）は「不一致 completion が正規 request を失敗させる」という**この決定と矛盾する挙動を固定している**ため、次の内容に置き換える。既存の test helper（`key(page_node_id)`、`result(request, token, url)`、`#[cfg(test)] fn pending_count()`（`actor.rs:1057`））をそのまま使う。

```rust
    #[tokio::test]
    async fn a_mismatched_completion_leaves_the_legitimate_request_pending() {
        // 悪意あるページが他ページ向けの requestId を推測して送っても、
        // 正規の待ち手を失敗させたり pending entry を消費したりしてはならない。
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        state.register_page(key("page-a")).unwrap();
        let state_for_dispatch = state.clone();

        let outcome = state
            .execute_with(
                key("page-a"),
                "document-1".into(),
                "page-document-1-page-a".into(),
                PageAutomationOperation::Snapshot,
                move |request| {
                    let state = state_for_dispatch.clone();
                    let request = request.clone();
                    std::thread::spawn(move || {
                        // 別 document / 別 webview を騙る completion
                        assert!(state
                            .complete(
                                "document-2",
                                "page-document-2-page-z",
                                result(&request, "t1", "https://example.com/"),
                            )
                            .is_err());
                        // 不一致では pending を消費しない
                        assert_eq!(state.pending_count(), 1);
                        // 正規の completion は成功する
                        assert!(state
                            .complete(
                                "document-1",
                                "page-document-1-page-a",
                                result(&request, "t1", "https://example.com/"),
                            )
                            .is_ok());
                    });
                    Ok(())
                },
            )
            .await;

        assert!(
            outcome.is_ok(),
            "the legitimate request must still succeed: {outcome:?}"
        );
        assert_eq!(state.pending_count(), 0);
    }

    #[test]
    fn request_ids_are_not_guessable() {
        let state = PageAutomationState::with_timeout(Duration::from_secs(1));
        let first = state.allocate_request_id().unwrap();
        let second = state.allocate_request_id().unwrap();

        assert_ne!(first, second);
        assert!(is_page_request_id(&first), "must stay a valid page request ID");
        assert!(!first.ends_with("-1"), "must not be sequential: {first}");
        assert_eq!(first.len(), second.len());
    }
```

> `execute_with` のクロージャ引数の型・`clone` 可否は既存テスト（`mismatched_completion_identity_fails_the_known_request` と `action_result` を使うテスト群）の書き方に合わせる。dispatch クロージャ内で `request` を別スレッドへ渡す形は既存テストと同じ。

- [x] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib page_automation`
Expected: `the legitimate pending entry must survive` と `request IDs must not be guessable` で失敗

- [x] **Step 3: Write minimal implementation**

`actor.rs` の `complete`（178-196 行）を差し替える。

```rust
        let pending = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "failed to acquire page automation state".to_string())?;
            let expected = inner.pending.get(&request_id).ok_or_else(|| {
                "page automation request is unknown or already completed".to_string()
            })?;
            let identity_matches = expected.window_label == window_label
                && expected.webview_label == webview_label
                && result.document_id == expected.key.document_id
                && result.page_node_id == expected.key.page_node_id;
            // 不一致の completion で pending を消費すると、requestId を推測した別ページが
            // 正規 request を失敗させられる。一致した場合だけ取り出す。
            if !identity_matches {
                return Err("page automation completion identity mismatch".to_string());
            }
            inner
                .pending
                .remove(&request_id)
                .expect("pending request exists after lookup")
        };
```

`allocate_request_id`（846-850 行）を差し替える。`&self` を使わなくなるため clippy の `unused_self` が出る場合は関連関数へ変更し、呼び出し側も合わせる。

```rust
    fn allocate_request_id(&self) -> Result<String, ToolError> {
        Ok(format!("pa-{}", uuid::Uuid::new_v4()))
    }
```

`inner.next_request_id` が他で使われていなければ、フィールド定義と初期化も削除する。

**`is_page_request_id`（`actor.rs:1066-1070`）の更新が必須。** 現在は `pa-` の後を全 ASCII 数字に限定しているため、UUID を入れると `complete` が「invalid」で弾かれる。次に差し替える。

```rust
fn is_page_request_id(request_id: &str) -> bool {
    request_id.strip_prefix("pa-").is_some_and(|value| {
        !value.is_empty()
            && value
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
    })
}
```

`is_page_request_id` の既存テスト（数値 ID を有効と見なすもの）があれば、UUID を有効・不正文字を無効とする内容へ更新する。

- [x] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib && cargo clippy --all-targets 2>&1 | tail -5`
Expected: 全テスト green

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/mcp/page_automation/actor.rs
git commit -m "fix(automation): use unguessable request IDs and keep pending entries on mismatch"
```

---

### Task 6: snapshot 待機にタイムアウトと復帰を入れる

**Objective:** WebContent プロセスの hang でスクリーンショットキューが永久に詰まり、Webview が非表示のまま戻らない状態を防ぐ。

**Files:**
- Modify: `src-tauri/src/commands/webview/snapshot.rs:16-50`

- [x] **Step 1: Write the implementation**

`snapshot.rs` の先頭に定数を追加する。

```rust
/// WKWebView の snapshot callback が返らないケース（WebContent プロセスの hang / crash）で
/// capture queue が永久に詰まらないための上限。
#[cfg(target_os = "macos")]
const SNAPSHOT_TIMEOUT_MS: u64 = 5_000;
```

`capture_webview_png_bytes_with_options` の末尾（48-50 行）を差し替える。

```rust
    let outcome = tokio::time::timeout(
        std::time::Duration::from_millis(SNAPSHOT_TIMEOUT_MS),
        rx,
    )
    .await;

    // hide したまま復帰しないと、ボード上でページが消えたように見える。
    // 失敗時は必ず再表示してから error を返す。
    let restore_visibility = |error: String| -> String {
        if hide_after_snapshot_request {
            if let Err(show_error) = webview.show() {
                log::warn!(
                    "failed to show Webview after a failed snapshot: page_id={}, error={}",
                    label,
                    show_error
                );
            }
        }
        error
    };

    match outcome {
        Ok(Ok(result)) => result.map_err(restore_visibility),
        Ok(Err(_)) => Err(restore_visibility("screenshot channel closed".to_string())),
        Err(_) => Err(restore_visibility("screenshot timed out".to_string())),
    }
```

> `webview.hide()` 呼び出し（39-46 行）より後で `webview` を使うため、`hide` 側で move されていないことを確認する。必要なら `let webview = webview;` の位置を調整する。

- [x] **Step 2: Run validation**

Run: `cd src-tauri && cargo test --lib && cargo clippy --all-targets 2>&1 | tail -5`
Expected: コンパイル成功、全テスト green

- [x] **Step 3: 手動確認**

`npm run dev` で起動し、複数の WebPage ノードを配置してスクロール・ズームを繰り返す。スクリーンショットが従来どおり更新され、ページが非表示のまま残らないことを確認する。

- [x] **Step 4: Commit**

```bash
git add src-tauri/src/commands/webview/snapshot.rs
git commit -m "fix(screenshot): time out native snapshot waits and restore visibility"
```

---

### Task 7: `.sheltie` に `projectId` を保存してキャッシュキーを安定させる

**Objective:** ドキュメント化済みの lazy restore（セッションを超えたスクリーンショット復元）を実際に機能させ、開くたびに orphan ディレクトリが増える状態を止める。

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/project-document.ts`
- Modify: `src/lib/project-document.test.ts`
- Modify: `src/store/tab-store.ts:140-158`

- [x] **Step 1: Write the failing test**

`src/lib/project-document.test.ts` に追加する。

```ts
  it('round trips projectId', () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      projectId: 'fixed-project-id',
      nodes: [],
      edges: [],
    });

    expect(parseProjectDocument(raw).projectId).toBe('fixed-project-id');
  });

  it('accepts a document without projectId', () => {
    const raw = JSON.stringify({ schemaVersion: 2, nodes: [], edges: [] });

    expect(parseProjectDocument(raw).projectId).toBeUndefined();
  });

  it('does not mark a project dirty right after opening a file without projectId', () => {
    const document = parseProjectDocument(
      JSON.stringify({ schemaVersion: 2, nodes: [], edges: [] }),
    );
    const project: Project = {
      id: 'generated-id',
      untitledIndex: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      lastSavedDocument: sanitizeProjectDocument(document, { nodes: [], edges: [] }),
    };

    expect(isProjectDirty(project)).toBe(false);
  });
```

> `Project` の必須フィールドは `src/types/index.ts` の定義に合わせる。既存テストの project 生成ヘルパーがあればそれを使う。

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/project-document.test.ts`
Expected: `projectId` が型・実装に存在しないため失敗する

- [x] **Step 3: Write minimal implementation**

`src/types/index.ts` の `SheltieDocumentV2` に optional フィールドを追加する。

```ts
export interface SheltieDocumentV2 {
  schemaVersion: 2;
  /** スクリーンショットキャッシュのディレクトリキー。古いファイルには存在しない */
  projectId?: string;
  nodes: SheltieDocumentNode[];
  edges?: SheltieDocumentEdge[];
}
```

`src/lib/project-document.ts` の `parseProjectDocumentValue`（195-213 行）の v2 分岐で `projectId` を読む。

```ts
  const projectId =
    value.projectId === undefined
      ? undefined
      : parseString(value.projectId, 'projectId');

  return {
    schemaVersion: 2,
    projectId,
    nodes: rawNodes.map((node, index) => parseNode(node, index)),
    edges,
  };
```

`createProjectDocument` を差し替える。

```ts
export function createProjectDocument(
  project: Pick<Project, 'id' | 'nodes' | 'edges'>,
): SheltieDocumentV2 {
  return {
    schemaVersion: 2,
    projectId: project.id,
    nodes: project.nodes.map(boardNodeToDocumentNode),
    edges: project.edges.map(boardEdgeToDocumentEdge),
  };
}
```

`sanitizeProjectDocument` の `fallbackProject` 型も `Pick<Project, 'id' | 'nodes' | 'edges'>` に変える。あわせて、**読み込んだ文書に `projectId` が無い場合は解決済みの id を埋めてから `lastSavedDocument` にする**。`src/store/tab-store.ts:140-158` の `createProject` を差し替える。

```ts
function createProject(params: {
  filePath?: string;
  untitledIndex: number;
  document?: SheltieDocumentV2;
}): Project {
  const nodes = params.document?.nodes.map(documentNodeToBoardNode) ?? [];
  const edges = params.document?.edges?.map(documentEdgeToBoardEdge) ?? [];
  // 文書に保存された ID を再利用することで、スクリーンショットキャッシュが
  // セッションを超えて復元でき、開くたびに orphan ディレクトリが増えなくなる。
  const id = params.document?.projectId ?? crypto.randomUUID();
  const document =
    params.document === undefined ? undefined : { ...params.document, projectId: id };

  return {
    id,
    filePath: params.filePath,
    untitledIndex: params.untitledIndex,
    nodes,
    edges,
    viewport: DEFAULT_VIEWPORT,
    lastSavedDocument: sanitizeProjectDocument(document, { id, nodes, edges }),
  };
}
```

`createProjectDocument` / `sanitizeProjectDocument` の呼び出し箇所（`src/lib/file-commands.ts` の `createProjectDocument(latestProject)` を含む）で `id` が渡るよう型エラーを解消する。

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run && npm run typecheck`
Expected: 全テスト green、型エラーなし

- [x] **Step 5: 手動確認**

1. 新規ボードに WebPage ノードを 2 枚置いて保存する
2. `ls ~/Library/Application\ Support/jp.brdr.app.sheltie/screenshots/` でディレクトリ名を記録する
3. アプリを終了し、同じファイルを開き直す → **同じディレクトリ名が再利用され**、スクリーンショットが復元される（新しい UUID ディレクトリが増えない）

- [x] **Step 6: Commit**

```bash
git add src/types/index.ts src/lib/project-document.ts src/lib/project-document.test.ts src/store/tab-store.ts src/lib/file-commands.ts
git commit -m "fix(document): persist projectId to stabilize the screenshot cache key"
```

---

### Task 8: スクリーンショットキャッシュの TTL GC を追加する

**Objective:** 削除・移動された `.sheltie` に対応する古いキャッシュディレクトリを回収する。

**Files:**
- Modify: `src-tauri/src/commands/webview/screenshots.rs`
- Modify: `src-tauri/src/lib.rs`（コマンド登録）
- Modify: `src/lib/tauri-bridge/webview.ts`（bridge 追加）
- Modify: `src/main.tsx`（起動時に 1 回呼ぶ）

**Interfaces:**
- Produces: `prune_screenshot_cache` コマンド、`api.pruneScreenshotCache()`

- [x] **Step 1: Write the failing test**

`src-tauri/src/commands/webview/screenshots.rs` のテストモジュールに追加する。

```rust
    #[test]
    fn prunes_only_directories_older_than_the_ttl() {
        let root = temp_dir().join("sheltie-prune-test");
        let _ = std::fs::remove_dir_all(&root);
        let fresh = root.join("fresh-project");
        let stale = root.join("stale-project");
        std::fs::create_dir_all(&fresh).unwrap();
        std::fs::create_dir_all(&stale).unwrap();
        std::fs::write(fresh.join("a.png"), b"fresh").unwrap();
        std::fs::write(stale.join("a.png"), b"stale").unwrap();

        // stale 側の mtime を TTL より古くする
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(60 * 60 * 24 * 31);
        filetime::set_file_mtime(stale.join("a.png"), filetime::FileTime::from_system_time(old))
            .unwrap();

        prune_screenshot_cache_dir(&root, std::time::Duration::from_secs(SCREENSHOT_CACHE_TTL_SECS))
            .unwrap();

        assert!(fresh.exists(), "recently used cache must stay");
        assert!(!stale.exists(), "stale cache must be removed");

        std::fs::remove_dir_all(&root).unwrap();
    }
```

> `filetime` crate が依存に無い場合は、テストでは mtime 変更の代わりに「TTL を 0 秒にして全削除される」「TTL を十分長くして何も削除されない」の 2 ケースで検証する形へ置き換える（依存追加はしない）。

- [x] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib prunes_only_directories_older_than_the_ttl`
Expected: `cannot find function \`prune_screenshot_cache_dir\``

- [x] **Step 3: Write minimal implementation**

`screenshots.rs` に追加する。

```rust
/// キャッシュの保持期間。キャッシュは失われても撮り直せるため、
/// ディスクを無制限に消費しないことを優先する。
const SCREENSHOT_CACHE_TTL_SECS: u64 = 60 * 60 * 24 * 30;

/// project ディレクトリ単位で、最終更新から TTL を超えたものを削除する。
/// 開いていない `.sheltie` も正当に存在しうるため、「開いている文書と照合して消す」方式は採らない。
fn prune_screenshot_cache_dir(root: &Path, ttl: std::time::Duration) -> Result<(), String> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("failed to read the screenshot cache: {error}")),
    };

    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let mut newest: Option<std::time::SystemTime> = None;
        if let Ok(files) = std::fs::read_dir(&path) {
            for file in files.flatten() {
                if let Ok(modified) = file.metadata().and_then(|meta| meta.modified()) {
                    if newest.is_none_or(|current| modified > current) {
                        newest = Some(modified);
                    }
                }
            }
        }

        let is_stale = match newest {
            Some(modified) => now
                .duration_since(modified)
                .map(|elapsed| elapsed > ttl)
                .unwrap_or(false),
            None => true,
        };

        if is_stale {
            if let Err(error) = std::fs::remove_dir_all(&path) {
                log::warn!("failed to prune a screenshot cache directory: {error}");
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn prune_screenshot_cache(app: AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to obtain app_data_dir: {error}"))?;
    prune_screenshot_cache_dir(
        &data_dir.join("screenshots"),
        std::time::Duration::from_secs(SCREENSHOT_CACHE_TTL_SECS),
    )
}
```

> `is_none_or` が使えない Rust バージョンの場合は `map_or(true, |current| modified > current)` に置き換える。

`src-tauri/src/lib.rs` の `invoke_handler` に `prune_screenshot_cache` を追加する。

`src/lib/tauri-bridge/webview.ts` に追加する。

```ts
  pruneScreenshotCache: (): Promise<void> => invoke('prune_screenshot_cache'),
```

`src/main.tsx` の起動時登録（既存の listener 登録と同じ 1 回だけ走る箇所）に追加する。

```ts
void api.pruneScreenshotCache().catch(() => {
  // キャッシュ回収の失敗は起動を妨げない
});
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib && npm run typecheck`
Expected: 全テスト green、型エラーなし

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/commands/webview/screenshots.rs src-tauri/src/lib.rs src/lib/tauri-bridge/webview.ts src/main.tsx
git commit -m "feat(screenshot): prune stale screenshot cache directories on launch"
```

---

### Task 9: CSP を設定し inline script / style を外部化する

**Objective:** `script-src 'self'` を成立させ、XSS が入った場合に `window.__TAURI__` 経由の invoke へ発展する経路を狭める。

**Files:**
- Create: `public/theme-init.js`
- Create: `public/initial-background.css`
- Modify: `index.html`
- Modify: `src-tauri/tauri.conf.json`

- [x] **Step 1: inline script を外部化する**

`public/theme-init.js` を新規作成する。

```js
// Tailwind の dark variant が CSS パース時から正しい色を出せるよう、
// OS テーマに応じた light/dark クラスを最初の paint 前に同期付与する。
// Theme メニューでの上書きは React マウント後に theme-store が反映する。
(function () {
  var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.add(isDark ? 'dark' : 'light');
})();
```

- [x] **Step 2: inline style を外部化する**

`public/initial-background.css` を新規作成する。

```css
/* Tailwind/HeroUI の CSS が適用される前の Webview 初回 paint で
   NSWindow のデフォルト白が見えるのを防ぐ。 */
html,
body {
  background-color: #ffffff;
}

@media (prefers-color-scheme: dark) {
  html,
  body {
    background-color: #18181b;
  }
}
```

- [x] **Step 3: `index.html` を差し替える**

`<head>` の inline `<style>` と inline `<script>` を次で置き換える。`<link>` と classic `<script>`（`type="module"` を付けない）はどちらも head でブロッキング実行されるため、実行順は維持される。

```html
    <link rel="stylesheet" href="/initial-background.css" />
    <script src="/theme-init.js"></script>
```

- [x] **Step 4: CSP を設定する**

`src-tauri/tauri.conf.json` の `app.security.csp` を差し替える。

```json
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: http://asset.localhost data: blob:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'self'; frame-src 'none'"
```

`style-src` の `'unsafe-inline'` は Tailwind v4 / HeroUI / React Flow がランタイムで style を注入・inline style 属性を使うため外せない。

- [x] **Step 5: Run validation**

Run: `npm run build`
Expected: ビルド成功

- [x] **Step 6: 手動確認（このタスクの完了判定に必須）**

`npm run build` した成果物（`npm run dev` ではなくリリース相当のビルド）を起動し、次を確認する。CSP 違反はコンソールにのみ出るため、DevTools の Console を必ず開いて確認する。

1. 起動直後に白フラッシュが出ない（light / dark 両方の OS 設定で確認）
2. テーマメニューでの light / dark / system 切り替えが効く
3. スクリーンショット画像が表示される（`asset:` の許可確認）
4. HeroUI のダイアログ・トースト、React Flow のノード描画・ドラッグが崩れない
5. ファイル Open / Save ダイアログが開く
6. MCP を有効にしてボード操作・ページ自動化が動く（`ipc:` の許可確認）
7. Console に `Refused to ...` の CSP 違反が 1 件も出ていない

違反が出た場合は、該当ディレクティブだけを最小限緩める（`'unsafe-inline'` を `script-src` に足す対応は取らない。原因の inline を外部化する）。

- [x] **Step 7: Commit**

```bash
git add public/theme-init.js public/initial-background.css index.html src-tauri/tauri.conf.json
git commit -m "feat(security): enable a content security policy"
```

---

### Task 10: capability を実測ベースで最小化する

**Objective:** XSS 時に到達できるコマンド面を狭め、window 単位で child webview へ権限が広がる粗さを解消する。

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [x] **Step 1: Write the implementation**

実測で使用が確認できたのは `setTitle`（`src/App.tsx:37`）、webview の `show` / `hide` / `close`（`src/lib/tauri-bridge/webview.ts:136,139,146`）、dialog の `message` / `open` / `save`（`src/lib/file-commands.ts`）だけ。`data-tauri-drag-region` は未使用、ウインドウクローズは独自コマンド `close_ready` 経由。

`src-tauri/capabilities/default.json` を次に差し替える。

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability",
  "webviews": ["document-*"],
  "permissions": [
    "allow-local-app-commands",
    "core:default",
    "core:window:allow-set-title",
    "core:webview:allow-webview-close",
    "core:webview:allow-webview-show",
    "core:webview:allow-webview-hide",
    "dialog:allow-message",
    "dialog:allow-open",
    "dialog:allow-save"
  ]
}
```

`core:window:default` / `core:webview:default` を外したうえで必要な個別権限だけを残している。**`core:default` に含まれる権限セットの中身を確認し**、`event:allow-listen` / `event:allow-emit` など既存機能が依存するものが失われていないことを確かめる。失われる場合は個別に足す。

- [x] **Step 2: Run validation**

Run: `npm run build`
Expected: ビルド成功（capability の schema 検証を通ること）

- [x] **Step 3: 手動確認（このタスクの完了判定に必須）**

権限不足は実行時にしか現れないため、ビルドした成果物で次をすべて確認する。失敗時はコンソールに `not allowed` 系のエラーが出る。

1. ウインドウタイトルがファイル名に追従する
2. WebPage ノードの追加・削除でページが表示/非表示/破棄される
3. ボードのスクロール・ズームでページの表示モードが切り替わる
4. File > Open / Save / Save As のダイアログが開く
5. 未保存で閉じたときの確認ダイアログが出て、保存・破棄・キャンセルが動く
6. `Cmd+Q` で全ウインドウの集約確認 → 終了まで通る
7. 新規タブ・新規ウインドウが開ける
8. MCP を有効にしてボード読み取り・`batch_edit_board`・ページ自動化が動く

- [x] **Step 4: Commit**

```bash
git add src-tauri/capabilities/default.json
git commit -m "refactor(security): scope the default capability to what the renderer uses"
```

## Validation

- `npm run lint` / `npm run format` / `npm run typecheck` / `npm run test` — すべて成功
- `cd src-tauri && cargo test --lib` — 全テスト green
- `cd src-tauri && cargo clippy --all-targets` — 既知の `items_after_test_module` 1 件のみ（Phase 3 で解消）
- `npm run build` — 成功
- 手動: Task 3 / 9 / 10 の確認項目をすべて実施
- 手動: `file:///etc/passwd` を URL バーに入れても開けないこと、`file://` URL を含む `.sheltie`（手作り）が Phase 1 の fail-closed で弾かれること
- 手動: 同じファイルを閉じて開き直したときにスクリーンショットが復元され、キャッシュディレクトリが増えないこと

## Risks, Tradeoffs, and Open Questions

- **URL 表示が commit まで遅れる。** Task 3 でナビゲーション中は前の URL を表示するようになる。Safari 等と同じ挙動であり意図した変更だが、体感が変わるため手動確認で違和感がないか見る。
- **`\x01` 通知で `webview.url()` が新 URL を返す保証。** WKWebView は `pushState` / `replaceState` で URL プロパティを更新するため成立する想定だが、Task 3 の手動確認 2 で SPA の URL 追従を必ず検証する。追従しない場合は、通知値を `webview.url()` と同一 origin かどうかで照合する方式へ切り替える。
- **`Object.defineProperty` はセキュリティ境界ではない。** `Function.prototype` の差し替えや DOM prototype 汚染は防げない。この事実は Phase 3 で `docs/agents/mcp.md` に明記する。
- **capability 縮小は実行時にしか検証できない。** Task 10 の手動確認 8 項目は省略できない。`core:default` の中身を確認せずに `core:window:default` を外すと、イベント購読など広範な機能が壊れる可能性がある。
- **CSP は `style-src 'unsafe-inline'` を含む。** XSS に対する防御は `script-src 'self'` の部分に限られる。これは Tailwind v4 / HeroUI / React Flow の実装上避けられない。
- **`projectId` を持たないファイルは初回オープンで新 ID を採用する。** そのまま保存しなければ ID は永続化されず、次回オープンで再度別 ID になる。未リリースのため実質的な影響は開発中のファイルのみ。
- **TTL GC は mtime ベース。** ファイルシステムの mtime が信頼できない状況（時刻巻き戻し等）では削除判定がぶれる。キャッシュのため実害は再撮影のみ。
