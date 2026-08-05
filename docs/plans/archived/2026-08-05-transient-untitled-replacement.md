# Transient Untitled Window Replacement + Finder Double-Click Open Implementation Plan

> **For implementers:** Execute this plan task-by-task. Complete each checkbox step, run the listed validation, and commit after each task.

**Goal:** AppKit の transient document 規則を再現し、「自動生成された空の untitled ウインドウが 1 枚だけあるとき、プロジェクトを開くとそのウインドウが置き換わって合計 1 枚になる」挙動を実装する。あわせて、未対応だった Finder での `.sheltie` ダブルクリックオープン（`RunEvent::Opened`）を実装する。

**Architecture:** 置き換え判定（transient・未編集・1 枚のみ）は `DocumentManagerState` の純ロジックに集約し、既存の document_manager テスト群と同じ形でユニットテストする。ウインドウの閉鎖は「新ウインドウの `present_document_window` 時に旧ウインドウを destroy」する遅延方式で、ウインドウゼロの瞬間を作らない。フロントエンド（TypeScript）の変更は不要。

**Tech Stack:** Rust (Tauri v2.10 / tauri crate)、テストは `cargo test --lib`（CI と同一）。

## Global Constraints

- 置き換え条件は AppKit 準拠: **document ウインドウがちょうど 1 枚**存在し、それが **transient かつ未編集かつ untitled**（`file_path == None`）のときのみ。
- transient = 自動生成された untitled のみ: 引数なし起動（`setup` の `handle_launch_args` 空引数）、Dock reopen（`RunEvent::Reopen`）、single-instance の引数なし再起動。**Cmd+N（`new_document_window` コマンド / メニューフォールバック）と新規タブ（`new_document_tab`）は非 transient**。
- transient 資格の剥奪は行わない。判定時に現在の `edited` を見る（Undo で完全に元へ戻れば置き換え対象に復活する仕様。dig で合意済み）。
- open から present までの間に置き換え対象が編集された場合はデータ保護のため置き換えを中止する（take 時に再検証）。
- 適用経路: メニュー Open（`open_document_window`）・Finder ダブルクリック（`RunEvent::Opened`）・CLI 引数（`handle_launch_args`）・single-instance。すべて `open_or_focus_document_window_internal` に合流するため、実装箇所は 1 箇所。
- コミットメッセージは英語・conventional commits（既存の git log に準拠）。
- Rust テストコマンド: `cd src-tauri && cargo test --lib`（CI の ci.yml:86 と同一）。

## Current Context

確認済みの既存コード:

- `src-tauri/src/commands/store/document_manager.rs`: `DocumentManagerState`（`Mutex<DocumentManager>`）が `windows: HashMap<String, WindowRecord>` と `file_windows` を管理。`WindowRecord` は `creation_index` / `file_path` / `untitled_index` / `tabbing_identifier` / `pending_tab_host_label` を持つ。充実したユニットテストあり。
- `src-tauri/src/commands/store/document_window.rs`: `create_document_window_internal(app, file_path)` → `reserve_window` → `build_document_window`（`visible(false)` で生成）。`open_or_focus_document_window_internal` が全オープン経路の合流点。`handle_launch_args` は argv から `.sheltie` を抽出し、空なら `create_untitled_document_window`。テストモジュールは未存在（本プランで新設）。
- `src-tauri/src/commands/store/macos_tabs.rs`: `set_document_edited` コマンドは NSWindow の表示更新のみで状態を保持しない（235 行目）。`present_document_window`（342 行目）は renderer ready 後に呼ばれ、tab attach または show + set_focus する。`create_document_tab_internal`（259 行目）も `reserve_window` を呼ぶ。
- `src-tauri/src/setup.rs`: `app.run` のハンドラ（333 行目）は `ExitRequested` と `Reopen` のみ処理。`RunEvent::Opened` は未処理（ダブルクリックが効かない原因）。367 行目の Reopen で `create_untitled_document_window` を呼ぶ。
- `src-tauri/src/menus/file.rs:74`: ウインドウゼロ時の Cmd+N フォールバックが `create_untitled_document_window` を直接呼ぶ（ユーザー明示操作 → 非 transient のまま維持）。
- `tauri 2.10.2` の `RunEvent::Opened { urls: Vec<url::Url> }` は `#[cfg(any(target_os = "macos", target_os = "ios"))]`。`tauri::Url` として re-export されている（新規依存不要）。
- `tauri.conf.json` の `bundle.fileAssociations` に `.sheltie` 登録済み（Info.plist の CFBundleDocumentTypes は生成される）。

計画上の前提:

- macOS のダブルクリックは argv ではなく Apple Event（Tauri では `RunEvent::Opened`）で届く。アプリ起動中はプロセスが増えないため single-instance コールバックも発火しない（前段の調査で確認済み）。
- コールド起動ダブルクリックでは setup が先に transient untitled を作り、直後に `Opened` が届く。置き換えロジックがこのレースをそのまま解決する（untitled が present 前なら一度も表示されずに destroy される）。
- ファイル関連付けは `.app` バンドルの Info.plist 由来のため、ダブルクリックの手動確認は `npm run build` したアプリで行う（`npm run dev` では確認不可）。

## File Structure

- Modify: `src-tauri/src/commands/store/document_manager.rs` — `WindowRecord` に `transient` / `edited` / `pending_replacement_target` を追加。`set_window_edited` / `transient_window_to_replace` / `set_pending_replacement` / `take_pending_replacement` を追加。テスト追加。
- Modify: `src-tauri/src/commands/store/document_window.rs` — `create_document_window_internal` に transient 引数、`create_transient_untitled_document_window` / `handle_opened_urls` / `sheltie_paths_from_urls` を追加。`open_or_focus_document_window_internal` に置き換え予約を組み込み。テストモジュール新設。
- Modify: `src-tauri/src/commands/store/macos_tabs.rs` — `set_document_edited` で状態記録、`present_document_window` で置き換え実行、`create_document_tab_internal` の `reserve_window` 呼び出し更新。
- Modify: `src-tauri/src/commands/store.rs` — `create_transient_untitled_document_window` / `handle_opened_urls` の re-export 追加。
- Modify: `src-tauri/src/setup.rs` — `RunEvent::Opened` ハンドラ追加、Reopen を transient 版へ変更。
- Modify: `docs/agents/tauri-ipc.md` / `docs/agents/architecture.md` — 契約・挙動の記述更新。
- Test: `src-tauri/src/commands/store/document_manager.rs`（既存 `mod tests` へ追加）、`src-tauri/src/commands/store/document_window.rs`（`mod tests` 新設）。

## Tasks

### Task 1: WindowRecord に transient / edited を追加し、reserve_window で受け取る

**Objective:** 置き換え判定に必要な状態を `WindowRecord` に持たせる。

**Files:**
- Modify: `src-tauri/src/commands/store/document_manager.rs`
- Modify: `src-tauri/src/commands/store/document_window.rs:78-102`（`create_document_window_internal`）
- Modify: `src-tauri/src/commands/store/macos_tabs.rs:259-303`（`create_document_tab_internal`）

**Interfaces:**
- Produces: `reserve_window(file_path, disposition, transient: bool)`、`WindowRecord { transient: bool, edited: bool, pending_replacement_target: Option<String>, .. }`、`create_document_window_internal(app, file_path, transient: bool)`

- [ ] **Step 1: Write the failing test**

`document_manager.rs` の `mod tests` に追加:

```rust
#[test]
fn reserve_window_records_transient_flag() {
    let state = DocumentManagerState::default();
    let (_l1, transient_record) = state.reserve_window(None, &standalone(), true).unwrap();
    let (_l2, normal_record) = state.reserve_window(None, &standalone(), false).unwrap();
    assert!(transient_record.transient);
    assert!(!normal_record.transient);
    assert!(!transient_record.edited);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib reserve_window_records_transient_flag`
Expected: コンパイルエラー（`reserve_window` は 2 引数、`WindowRecord` に `transient` フィールドなし）

- [ ] **Step 3: Write minimal implementation**

`document_manager.rs`:

```rust
#[derive(Clone)]
pub(super) struct WindowRecord {
    pub(super) creation_index: usize,
    pub(super) file_path: Option<PathBuf>,
    pub(super) untitled_index: usize,
    pub(super) tabbing_identifier: String,
    pub(super) pending_tab_host_label: Option<String>,
    /// 自動生成された untitled（引数なし起動・Dock reopen）だけ true。
    /// AppKit の transient document に相当し、置き換え対象の資格を表す
    pub(super) transient: bool,
    pub(super) edited: bool,
    /// この window の present 時に閉じるべき置き換え対象 window のラベル
    pub(super) pending_replacement_target: Option<String>,
}
```

`reserve_window` のシグネチャを `pub(super) fn reserve_window(&self, file_path: Option<PathBuf>, disposition: &DocumentWindowDisposition, transient: bool)` に変更し、`WindowRecord` 生成箇所に以下を追加:

```rust
            transient,
            edited: false,
            pending_replacement_target: None,
```

呼び出し元の更新:

- `document_window.rs` の `create_document_window_internal` にパラメータ `transient: bool` を追加し、`manager.reserve_window(file_path, &disposition, transient)?` に変更。同ファイル内の既存呼び出し 2 箇所を更新:
  - `create_untitled_document_window` → `create_document_window_internal(app, None, false)`
  - `open_or_focus_document_window_internal` → `create_document_window_internal(app, Some(path), false)`
- `macos_tabs.rs` の `create_document_tab_internal` → `manager.reserve_window(None, &disposition, false)?`
- `document_manager.rs` の既存テスト中の `reserve_window(...)` 呼び出しはすべて第 3 引数 `false` を追加（機械的な置換。`reserve_window(None, &standalone())` → `reserve_window(None, &standalone(), false)` 等）。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib`
Expected: 全テスト成功（既存テスト含む）

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/store/document_manager.rs src-tauri/src/commands/store/document_window.rs src-tauri/src/commands/store/macos_tabs.rs
git commit -m "feat(window): track transient and edited state on window records"
```

### Task 2: 置き換え判定ロジック transient_window_to_replace と set_window_edited

**Objective:** 「1 枚のみ・transient・未編集・untitled」の置き換え判定と、edited 状態の記録 API を純ロジックとして実装する。

**Files:**
- Modify: `src-tauri/src/commands/store/document_manager.rs`

**Interfaces:**
- Consumes: Task 1 の `transient` / `edited` フィールド
- Produces: `set_window_edited(label, edited) -> Result<(), String>`、`transient_window_to_replace() -> Option<String>`

- [ ] **Step 1: Write the failing tests**

`document_manager.rs` の `mod tests` に追加:

```rust
#[test]
fn transient_window_to_replace_returns_single_pristine_transient_untitled() {
    let state = DocumentManagerState::default();
    let (label, _) = state.reserve_window(None, &standalone(), true).unwrap();
    assert_eq!(state.transient_window_to_replace(), Some(label));
}

#[test]
fn transient_window_to_replace_ignores_non_transient_window() {
    let state = DocumentManagerState::default();
    let _ = state.reserve_window(None, &standalone(), false).unwrap();
    assert_eq!(state.transient_window_to_replace(), None);
}

#[test]
fn transient_window_to_replace_ignores_edited_window_and_recovers_when_unedited() {
    let state = DocumentManagerState::default();
    let (label, _) = state.reserve_window(None, &standalone(), true).unwrap();

    state.set_window_edited(&label, true).unwrap();
    assert_eq!(state.transient_window_to_replace(), None);

    // Undo で完全に元へ戻った場合は置き換え対象に復活する（dig で合意した仕様）
    state.set_window_edited(&label, false).unwrap();
    assert_eq!(state.transient_window_to_replace(), Some(label));
}

#[test]
fn transient_window_to_replace_requires_exactly_one_window() {
    let state = DocumentManagerState::default();
    let _ = state.reserve_window(None, &standalone(), true).unwrap();
    let _ = state.reserve_window(None, &standalone(), false).unwrap();
    assert_eq!(state.transient_window_to_replace(), None);
}

#[test]
fn transient_window_to_replace_ignores_file_backed_window() {
    let state = DocumentManagerState::default();
    let path = PathBuf::from("/tmp/test.sheltie");
    let _ = state.reserve_window(Some(path), &standalone(), true).unwrap();
    assert_eq!(state.transient_window_to_replace(), None);
}

#[test]
fn set_window_edited_fails_for_unknown_window() {
    let state = DocumentManagerState::default();
    assert!(state.set_window_edited("document-999", true).is_err());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib transient_window_to_replace`
Expected: コンパイルエラー（`transient_window_to_replace` / `set_window_edited` 未定義）

- [ ] **Step 3: Write minimal implementation**

`document_manager.rs` の `impl DocumentManagerState` に追加:

```rust
    pub(super) fn set_window_edited(&self, label: &str, edited: bool) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire document state lock".to_string())?;

        let record = inner
            .windows
            .get_mut(label)
            .ok_or_else(|| format!("window '{label}' state not found"))?;
        record.edited = edited;
        Ok(())
    }

    /// AppKit の transient document 置き換え規則:
    /// document window がちょうど 1 枚で、それが自動生成 (transient) の
    /// 未編集 untitled のときだけ、その window が置き換え対象になる
    pub(super) fn transient_window_to_replace(&self) -> Option<String> {
        let inner = self.inner.lock().ok()?;
        if inner.windows.len() != 1 {
            return None;
        }
        inner.windows.iter().find_map(|(label, record)| {
            (record.transient && !record.edited && record.file_path.is_none())
                .then(|| label.clone())
        })
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib`
Expected: 全テスト成功

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/store/document_manager.rs
git commit -m "feat(window): add transient window replacement decision logic"
```

### Task 3: 置き換え予約の保持と再検証付き取り出し

**Objective:** 「開く時に判定した置き換え対象」を新ウインドウの record に予約し、present 時に安全に取り出す API を実装する。open〜present 間にユーザーが編集した場合は置き換えを中止する。

**Files:**
- Modify: `src-tauri/src/commands/store/document_manager.rs`

**Interfaces:**
- Consumes: Task 1 の `pending_replacement_target` フィールド
- Produces: `set_pending_replacement(label, target_label) -> Result<(), String>`、`take_pending_replacement(label) -> Result<Option<String>, String>`

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn take_pending_replacement_returns_target_once() {
    let state = DocumentManagerState::default();
    let (target, _) = state.reserve_window(None, &standalone(), true).unwrap();
    let (opener, _) = state
        .reserve_window(Some(PathBuf::from("/tmp/test.sheltie")), &standalone(), false)
        .unwrap();

    state.set_pending_replacement(&opener, &target).unwrap();

    assert_eq!(state.take_pending_replacement(&opener).unwrap(), Some(target));
    assert_eq!(state.take_pending_replacement(&opener).unwrap(), None);
}

#[test]
fn take_pending_replacement_aborts_when_target_was_edited() {
    let state = DocumentManagerState::default();
    let (target, _) = state.reserve_window(None, &standalone(), true).unwrap();
    let (opener, _) = state
        .reserve_window(Some(PathBuf::from("/tmp/test.sheltie")), &standalone(), false)
        .unwrap();
    state.set_pending_replacement(&opener, &target).unwrap();

    // open から present までの間にユーザーが編集したケース
    state.set_window_edited(&target, true).unwrap();

    assert_eq!(state.take_pending_replacement(&opener).unwrap(), None);
}

#[test]
fn take_pending_replacement_aborts_when_target_already_closed() {
    let state = DocumentManagerState::default();
    let (target, _) = state.reserve_window(None, &standalone(), true).unwrap();
    let (opener, _) = state
        .reserve_window(Some(PathBuf::from("/tmp/test.sheltie")), &standalone(), false)
        .unwrap();
    state.set_pending_replacement(&opener, &target).unwrap();

    state.unregister_window(&target);

    assert_eq!(state.take_pending_replacement(&opener).unwrap(), None);
}

#[test]
fn take_pending_replacement_returns_none_without_reservation() {
    let state = DocumentManagerState::default();
    let (label, _) = state.reserve_window(None, &standalone(), false).unwrap();
    assert_eq!(state.take_pending_replacement(&label).unwrap(), None);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib pending_replacement`
Expected: コンパイルエラー（`set_pending_replacement` / `take_pending_replacement` 未定義）

- [ ] **Step 3: Write minimal implementation**

`document_manager.rs` の `impl DocumentManagerState` に追加:

```rust
    pub(super) fn set_pending_replacement(
        &self,
        label: &str,
        target_label: &str,
    ) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire document state lock".to_string())?;

        if !inner.windows.contains_key(target_label) {
            return Err(format!("window '{target_label}' state not found"));
        }

        let record = inner
            .windows
            .get_mut(label)
            .ok_or_else(|| format!("window '{label}' state not found"))?;
        record.pending_replacement_target = Some(target_label.to_string());
        Ok(())
    }

    /// present 時に置き換え対象を取り出す。open から present までの間に
    /// 対象が編集・保存・クローズされていた場合はデータ保護のため中止する
    pub(super) fn take_pending_replacement(&self, label: &str) -> Result<Option<String>, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire document state lock".to_string())?;

        let record = inner
            .windows
            .get_mut(label)
            .ok_or_else(|| format!("window '{label}' state not found"))?;
        let Some(target) = record.pending_replacement_target.take() else {
            return Ok(None);
        };

        let still_eligible = inner
            .windows
            .get(&target)
            .map(|record| record.transient && !record.edited && record.file_path.is_none())
            .unwrap_or(false);
        Ok(still_eligible.then_some(target))
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib`
Expected: 全テスト成功

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/store/document_manager.rs
git commit -m "feat(window): add pending replacement reservation with revalidation"
```

### Task 4: 全オープン経路への組み込み（置き換えの発動と実行）

**Objective:** transient の付与・edited の記録・置き換え予約・present 時のクローズを実際のウインドウライフサイクルに接続する。

**Files:**
- Modify: `src-tauri/src/commands/store/document_window.rs`
- Modify: `src-tauri/src/commands/store/macos_tabs.rs`
- Modify: `src-tauri/src/commands/store.rs`
- Modify: `src-tauri/src/setup.rs`

**Interfaces:**
- Consumes: Task 2 の `transient_window_to_replace` / `set_window_edited`、Task 3 の `set_pending_replacement` / `take_pending_replacement`
- Produces: `create_transient_untitled_document_window(app) -> Result<(), String>`（`store.rs` から re-export、後続タスクが setup で使用）

このタスクはウインドウ実体（`AppHandle`）が必要な wiring のためユニットテスト対象外。`cargo test --lib`（回帰）とコンパイル、および Validation 章の手動確認で検証する。

- [ ] **Step 1: document_window.rs — transient 生成関数と置き換え予約**

`create_untitled_document_window` の直後に追加:

```rust
/// 引数なし起動・Dock reopen で自動生成される untitled 用。
/// AppKit の transient document と同様、プロジェクトを開くと置き換え対象になる
pub fn create_transient_untitled_document_window<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    create_document_window_internal(app, None, true).map(|_| ())
}
```

`open_or_focus_document_window_internal` を以下に変更:

```rust
fn open_or_focus_document_window_internal<R: tauri::Runtime>(
    app: &AppHandle<R>,
    path: PathBuf,
) -> Result<(), String> {
    let manager = app.state::<DocumentManagerState>();
    if let Some(label) = manager.existing_window_label_for_path(&path) {
        return focus_document_window_internal(app, &label);
    }

    let replace_target = manager.transient_window_to_replace();
    let label = create_document_window_internal(app, Some(path), false)?;
    if let Some(target) = replace_target {
        if let Err(error) = manager.set_pending_replacement(&label, &target) {
            log::warn!("failed to reserve transient window replacement: {error}");
        }
    }
    Ok(())
}
```

`handle_launch_args` の空引数分岐を transient 版に変更:

```rust
    if paths.is_empty() {
        return create_transient_untitled_document_window(app);
    }
```

- [ ] **Step 2: store.rs — re-export 追加**

`store.rs` の `pub use document_window::{...}` に `create_transient_untitled_document_window` を追加する。

- [ ] **Step 3: setup.rs — Dock reopen を transient 化**

import（setup.rs:7）の `create_untitled_document_window` を `create_transient_untitled_document_window` に変更し、`RunEvent::Reopen` ハンドラ内（setup.rs:367）の呼び出しも同名に変更する。エラーログ文言は変更しない。

- [ ] **Step 4: macos_tabs.rs — edited の記録と置き換えの実行**

`set_document_edited`（macos_tabs.rs:235）の冒頭に状態記録を追加。record が見つからないケース（クローズ競合）は致命的でないため warn に留める:

```rust
#[tauri::command]
pub async fn set_document_edited(window: Window, edited: bool) -> Result<(), String> {
    let manager = window.app_handle().state::<DocumentManagerState>();
    if let Err(error) = manager.set_window_edited(window.label(), edited) {
        log::warn!("failed to record edited state: {error}");
    }

    #[cfg(target_os = "macos")]
    {
        // 既存実装のまま
```

`present_document_window`（macos_tabs.rs:342）の standalone 分岐（`take_pending_tab_attachment` が `None` の分岐）で、`set_focus` 成功後・`return Ok(())` の前に置き換えを実行:

```rust
        if let Some(target_label) = state.take_pending_replacement(&child_label)? {
            state.unregister_window(&target_label);
            if let Some(target_window) = window.app_handle().get_window(&target_label) {
                if let Err(error) = target_window.destroy() {
                    log::warn!(
                        "failed to close replaced transient window '{target_label}': {error}"
                    );
                }
            }
        }
        return Ok(());
```

タブ attach 分岐は変更しない（タブは置き換え予約を持ち得ない: 予約はファイルオープンの standalone window にしか付かないため）。

- [ ] **Step 5: Build and run regression tests**

Run: `cd src-tauri && cargo test --lib`
Expected: 全テスト成功、警告なしでコンパイル

- [ ] **Step 6: 手動確認（dev モード）**

`npm run dev` で起動し、以下を確認:

1. 起動直後の untitled 1 枚で Cmd+O → `.sheltie` を開く → untitled が消えて合計 1 枚になる
2. 起動直後の untitled を閉じ、Cmd+N で untitled を作って Cmd+O → 新規ウインドウは残り合計 2 枚
3. untitled 2 枚（起動時 + Cmd+N）で Cmd+O → 2 枚とも残り合計 3 枚
4. 起動直後の untitled にページを追加（編集）してから Cmd+O → untitled は残り合計 2 枚
5. 起動直後の untitled で Cmd+O → 既に別ウインドウで開いているファイルを選択 → 既存ウインドウがフォーカスされ untitled は残る（置き換えなし）

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/store/document_window.rs src-tauri/src/commands/store/macos_tabs.rs src-tauri/src/commands/store.rs src-tauri/src/setup.rs
git commit -m "feat(window): replace pristine transient untitled window when opening a project"
```

### Task 5: RunEvent::Opened で Finder ダブルクリックに対応

**Objective:** macOS の Apple Event 経由のファイルオープン（ダブルクリック・Finder の「このアプリケーションで開く」）を処理する。

**Files:**
- Modify: `src-tauri/src/commands/store/document_window.rs`（`sheltie_paths_from_urls` + `handle_opened_urls` + `mod tests` 新設）
- Modify: `src-tauri/src/commands/store.rs`（re-export）
- Modify: `src-tauri/src/setup.rs`（`RunEvent::Opened` ハンドラ）

**Interfaces:**
- Consumes: Task 4 で置き換え対応済みの `open_or_focus_document_window`
- Produces: `handle_opened_urls(app, urls: &[tauri::Url])`（setup.rs が使用）

- [ ] **Step 1: Write the failing tests**

`document_window.rs` の末尾に `mod tests` を新設:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Url;

    fn urls(inputs: &[&str]) -> Vec<Url> {
        inputs.iter().map(|s| Url::parse(s).unwrap()).collect()
    }

    #[test]
    fn sheltie_paths_from_urls_accepts_file_urls_with_sheltie_extension() {
        let paths = sheltie_paths_from_urls(&urls(&["file:///tmp/board.sheltie"]));
        assert_eq!(paths, vec![PathBuf::from("/tmp/board.sheltie")]);
    }

    #[test]
    fn sheltie_paths_from_urls_is_case_insensitive_for_extension() {
        let paths = sheltie_paths_from_urls(&urls(&["file:///tmp/BOARD.SHELTIE"]));
        assert_eq!(paths, vec![PathBuf::from("/tmp/BOARD.SHELTIE")]);
    }

    #[test]
    fn sheltie_paths_from_urls_rejects_non_file_schemes_and_other_extensions() {
        let paths = sheltie_paths_from_urls(&urls(&[
            "https://example.com/board.sheltie",
            "file:///tmp/notes.txt",
            "file:///tmp/no-extension",
        ]));
        assert!(paths.is_empty());
    }

    #[test]
    fn sheltie_paths_from_urls_deduplicates() {
        let paths = sheltie_paths_from_urls(&urls(&[
            "file:///tmp/board.sheltie",
            "file:///tmp/board.sheltie",
        ]));
        assert_eq!(paths.len(), 1);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib sheltie_paths_from_urls`
Expected: コンパイルエラー（`sheltie_paths_from_urls` 未定義）

- [ ] **Step 3: Write minimal implementation**

`document_window.rs` の `launch_paths_from_args` の直後に追加（`tauri::Url` は `url` crate の re-export なので新規依存は不要）:

```rust
/// Finder のダブルクリック等で届く RunEvent::Opened の URL 群から
/// 開くべき .sheltie パスを抽出する。関連付け外のファイルや
/// 非 file スキームは無視する
fn sheltie_paths_from_urls(urls: &[tauri::Url]) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut paths = Vec::new();

    for url in urls {
        let Ok(candidate) = url.to_file_path() else {
            continue;
        };
        let is_sheltie = candidate
            .extension()
            .and_then(OsStr::to_str)
            .map(|ext| ext.eq_ignore_ascii_case("sheltie"))
            .unwrap_or(false);
        if !is_sheltie {
            continue;
        }
        if seen.insert(candidate.clone()) {
            paths.push(candidate);
        }
    }

    paths
}

pub fn handle_opened_urls<R: tauri::Runtime>(app: &AppHandle<R>, urls: &[tauri::Url]) {
    for path in sheltie_paths_from_urls(urls) {
        if let Err(error) = open_or_focus_document_window(app, &path.to_string_lossy()) {
            log::error!("failed to open document from Finder: {error}");
        }
    }
}
```

`store.rs` の `pub use document_window::{...}` に `handle_opened_urls` を追加。

`setup.rs` の `app.run` ハンドラ（`#[cfg(target_os = "macos")]` の `match event` 内、`RunEvent::Reopen` アームの後）に追加:

```rust
            // Finder ダブルクリック等の Apple Event で届いたファイルを開く。
            // macOS では argv にパスが渡らないため、この経路が唯一の入口
            RunEvent::Opened { urls } => {
                crate::commands::store::handle_opened_urls(app_handle, &urls);
            }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib`
Expected: 全テスト成功

- [ ] **Step 5: 手動確認（ビルド版）**

ファイル関連付けは `.app` の Info.plist 由来のため `npm run build` で生成したアプリで確認する（dev モード不可）:

1. アプリ未起動で `.sheltie` をダブルクリック → アプリが起動し、プロジェクトウインドウ 1 枚だけが開く（untitled は見えない or 一瞬で置き換わる）
2. アプリ起動中（untitled 1 枚）で `.sheltie` をダブルクリック → untitled が消えてプロジェクトが開く
3. アプリ起動中（プロジェクトウインドウあり）で同じ `.sheltie` をダブルクリック → 既存ウインドウがフォーカスされる
4. Dock アイコンクリックで untitled を出し、`.sheltie` をダブルクリック → untitled が置き換わる

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/store/document_window.rs src-tauri/src/commands/store.rs src-tauri/src/setup.rs
git commit -m "feat(macos): open .sheltie files from Finder via RunEvent::Opened"
```

### Task 6: docs/agents の更新と全体検証

**Objective:** 変更した契約・挙動をドキュメントに反映し、リポジトリ全体の検証を通す。

**Files:**
- Modify: `docs/agents/tauri-ipc.md:19-23`
- Modify: `docs/agents/architecture.md:64,72`

- [ ] **Step 1: tauri-ipc.md を更新**

- `present_document_window`（19 行目）: 「standalone 表示時、置き換え予約（transient untitled）があれば対象 window を destroy する」旨を追記
- `set_document_edited`（20 行目）: 「`DocumentManagerState` の `edited` にも記録し、transient 置き換え判定に使う」旨を追記
- `open_document_window`（23 行目）: 「document window がちょうど 1 枚で、それが自動生成（transient）の未編集 untitled なら、新 window の present 時にその untitled を閉じる（AppKit の transient document 準拠）」旨を追記

- [ ] **Step 2: architecture.md を更新**

- 64 行目の document manager の説明に `transient` / `edited` / 置き換え予約の管理を追記
- 72 行目の Reopen 説明に「この untitled は transient（プロジェクトを開くと置き換え対象）」を追記
- Reopen 記述の近くに追加: 「Finder ダブルクリック等は `RunEvent::Opened { urls }` で受け、`.sheltie` の file URL だけを `open_or_focus_document_window` に渡す。macOS では argv にパスが渡らないため、この経路が唯一の入口」

- [ ] **Step 3: Run full validation**

Run: `npm run lint && npm run format && npm run typecheck && npm run test && cd src-tauri && cargo test --lib`
Expected: すべて成功（TypeScript 側は無変更のため既存結果と同一）

- [ ] **Step 4: Commit**

```bash
git add docs/agents/tauri-ipc.md docs/agents/architecture.md
git commit -m "docs(agents): document transient window replacement and Finder open flow"
```

## Validation

- `cd src-tauri && cargo test --lib` — document_manager の新規テスト（transient 判定・pending replacement）と document_window の新規テスト（URL 抽出）を含め全件成功
- `npm run lint && npm run format && npm run typecheck && npm run test` — フロントエンド無変更のため全件成功
- 手動確認（Task 4 Step 6 / Task 5 Step 5 の手順）。ウインドウ挙動は自動テスト対象外のため、この手順を PR 説明に転記する

## Risks, Tradeoffs, and Open Questions

- **open〜present 間の編集レース**: 置き換え予約から present までは renderer 起動分（サブ秒）の間があり、その間に対象 untitled が編集される可能性がある。`take_pending_replacement` の再検証で置き換えを中止する設計にしており、データ喪失は起きない（最悪でもウインドウが 2 枚残るだけ）。
- **コールド起動ダブルクリックの一瞬の untitled 表示**: setup が transient untitled を作った後に `RunEvent::Opened` が届く。untitled の renderer が先に ready になると一瞬表示されてから置き換わる。CotEditor でも同種の遷移は見えるため許容とする。抑制（untitled 生成の遅延）は複雑さに見合わないので実装しない。
- **`RunEvent::Opened` は macOS/iOS 限定**: ハンドラは既存の `#[cfg(target_os = "macos")] match` 内に置くため、他プラットフォームのビルドには影響しない。Windows/Linux のダブルクリックは argv 経由で届き、既存の `handle_launch_args` + single-instance が処理する。
- **`reserve_window` のシグネチャ変更**: 既存テスト全件の機械的更新が必要（Task 1 に含む）。`DocumentWindowDisposition` に transient を持たせる案は「タブ生成に transient の概念がない」ため不採用とし、独立引数にした。
- **`set_document_edited` の非 macOS 挙動変化**: 従来は完全 no-op だったが、状態記録は全プラットフォームで行うようになる。置き換えロジックがプラットフォーム共通で正しく動くための意図的な変更。
