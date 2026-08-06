# macOS "Check for Updates…" Menu Implementation Plan

> **For implementers:** Execute this plan task-by-task. Complete each checkbox step, run the listed validation, and commit after each task.

**Goal:** macOS の App メニュー（About Sheltie の直下）に「Check for Updates…」を追加し、クリックで GitHub Releases 上の `latest.json` を確認、更新があればダウンロード・インストールして再起動できるようにする。

**Architecture:** `tauri-plugin-updater` を Rust 側だけで使う（JS 側の permission 追加は不要）。チェックは手動のみ。更新確認 → 「Install Update / Not Now」→ ダウンロード & インストール → 「Restart / Later」の 2 段階ネイティブダイアログ（`tauri-plugin-dialog`、英語文言）。再起動は既存の app-exit 協調機構（`AppExitCoordinatorState`）に restart フラグを追加して経由させ、未保存変更の保護フローを再利用する。`latest.json` は既存の手組み `release.yml` に生成・アップロードステップを追加する。

**Tech Stack:** Rust (Tauri v2 / tauri-plugin-updater v2 / tauri-plugin-dialog v2)、GitHub Actions（bash + jq）、テストは `cargo test --lib`。

## Global Constraints

- ユーザー決定事項: **手動チェックのみ**（起動時の自動チェックはしない）、**2 段階ダイアログ**（更新確認 → DL → 再起動確認）、**ダイアログ文言は英語**。
- ダイアログ文言は本プランに書いた exact string を使う（Tasks 内に記載）。
- メニュー項目のラベルは `Check for Updates…`（三点リーダーは `…` 1 文字）。位置は About Sheltie の直下（App submenu index 1）。
- コミットメッセージは英語・conventional commits。Rust コード内コメントは既存に合わせて日本語。
- Rust テストコマンド: `cd src-tauri && cargo test --lib`（CI と同一）。
- updater の署名鍵（minisign）の生成と GitHub Secrets 登録は**ユーザーの手作業**（Task 1）。`.key`（秘密鍵）は絶対にコミットしない。コミットするのは `.pub` の内容だけ。
- エンドポイントは `https://github.com/ryonakae/sheltie/releases/latest/download/latest.json`（published release のみ解決される。draft はゲートとして機能し続ける）。
- `latest.json` 内の URL は `/latest/` ではなく **バージョン固定の download URL**（`releases/download/v<version>/...`）にする。signature と実体の不一致を防ぐため。
- universal ビルドのため、`latest.json` の platforms は `darwin-aarch64` と `darwin-x86_64` の両キーに同じ universal tarball を指定する（Rust 側の custom target 設定は不要）。

## Current Context

確認済みの既存コード:

- `src-tauri/src/menus/app.rs`: `configure_app_menu` が App submenu を加工。`replace_default_about_and_hide` 後、`insert_settings_submenu` が「[0] About, [1] separator」を前提に **index 2, 3** へ Settings submenu + separator を挿入している。Check for Updates… を index 1 に挿すとこの前提が **3, 4** にずれる（Task 4 で修正）。
- `src-tauri/src/menus/mod.rs`: `MENU_ID_*` 定数の置き場。
- `src-tauri/src/setup.rs`: plugin 登録（`tauri_plugin_dialog` 登録済み、L171）と `on_menu_event` ディスパッチ（L234）。`RunEvent::ExitRequested` は `consume_allow_exit()` が true のときだけ exit を許す（L336-354）。
- `src-tauri/src/app_exit.rs`: `AppExitCoordinatorState`（`pending_quit` / `allow_exit_once`）と `emit_app_exit_requested`。フロントエンドが unsaved changes を処理して `complete_app_exit` / `abort_app_exit` を呼ぶ。document window が無ければ `allow_next_exit()` → `app.exit(0)` で即終了する。
- `src-tauri/src/commands/store/document_window.rs:370` `complete_app_exit`: `allow_next_exit()` → 全 window destroy → `app.exit(0)`。
- `src-tauri/Cargo.toml`: `tauri-plugin-updater` は未導入。`tauri-plugin-dialog = "2"` あり。
- `src-tauri/tauri.conf.json`: `plugins` セクションなし。`bundle.createUpdaterArtifacts` 未設定。
- `.github/workflows/release.yml`: `npm run build -- --bundles dmg --target universal-apple-darwin` でビルド → DMG を notarize → draft release に DMG + sha256 をアップロード。`VERSION`（`v` なし）は L86 で `$GITHUB_ENV` に入る。Apple 系 secrets は `release` environment。
- `docs/agents/release.md`: リリース手順・artifact contract・secrets の正本（英語）。
- Homebrew cask（`ryonakae/homebrew-tap`）は published release の DMG を参照。updater とは独立に動き続ける（変更不要）。

updater プラグイン仕様（Tauri 公式 docs で確認済み）:

- Rust API: `app.updater()?.check().await` → `Ok(Some(update))` / `Ok(None)`。`update.version` / `update.download_and_install(on_chunk, on_finish).await` / `app.restart()`（`-> !`、`RunEvent::ExitRequested` を経由する）。
- `bundle.createUpdaterArtifacts: true` + `--bundles app` で `bundle/macos/Sheltie.app.tar.gz` と `.sig` が生成される。生成には `TAURI_SIGNING_PRIVATE_KEY`（+ `_PASSWORD`）環境変数が必須。
- `latest.json` 必須キー: `version`, `platforms.<target>.url`, `platforms.<target>.signature`（signature は `.sig` ファイルの**内容**）。

計画上の前提:

- `--bundles app,dmg` で `.app` バンドル（と updater tarball）+ DMG の両方が生成される。tarball の存在は workflow 内で明示的に検証する（Task 5）。
- updater で置き換えられた `.app` には quarantine 属性が付かないため、Gatekeeper の再評価は走らない（stapler 済みでなくてよい）。
- `blocking_show()` は main thread では呼べないが、`tauri::async_runtime::spawn` のワーカースレッド上なので問題ない。

## File Structure

- Create: `src-tauri/src/updater.rs` — 手動アップデートチェックの対話フロー（check → ダイアログ → install → restart 依頼）と純関数のダイアログ文言ヘルパー
- Modify: `src-tauri/src/lib.rs` — `mod updater;` 追加
- Modify: `src-tauri/src/app_exit.rs` — restart フラグ（`restart_after_exit`）と `exit_or_restart` ヘルパー、ユニットテスト
- Modify: `src-tauri/src/commands/store/document_window.rs` — `complete_app_exit` の終了を `exit_or_restart` 経由に変更
- Modify: `src-tauri/src/menus/mod.rs` — `MENU_ID_APP_CHECK_UPDATES` 追加
- Modify: `src-tauri/src/menus/app.rs` — メニュー項目挿入 + Settings 挿入 index 修正
- Modify: `src-tauri/src/setup.rs` — plugin 登録 + menu event ディスパッチ
- Modify: `src-tauri/Cargo.toml` — `tauri-plugin-updater = "2"` 追加
- Modify: `src-tauri/tauri.conf.json` — `createUpdaterArtifacts` + `plugins.updater`（pubkey / endpoints）
- Modify: `.github/workflows/release.yml` — 署名鍵 env、`--bundles app,dmg`、tarball リネーム、`latest.json` 生成、アセット追加
- Modify: `docs/agents/release.md` — artifact contract・secrets・updater 運用の追記
- Modify: `docs/agents/architecture.md` — `updater.rs` の責務 1 行追記
- Test: `src-tauri/src/app_exit.rs`（`#[cfg(test)]`）、`src-tauri/src/updater.rs`（`#[cfg(test)]`）

## Tasks

### Task 1: updater 署名鍵の生成と Secrets 登録（ユーザー手作業）

**Objective:** minisign 鍵ペアを作り、秘密鍵を `release` environment の secrets に、公開鍵をローカルに用意する。

**Files:** なし（リポジトリ外の作業）

**Interfaces:**
- Produces: `~/.tauri/sheltie-updater.key.pub`（Task 3 で `tauri.conf.json` に貼る）、secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（Task 5 の workflow が参照）

- [ ] **Step 1: 鍵ペアを生成する（ユーザー実行）**

```bash
npx tauri signer generate -w ~/.tauri/sheltie-updater.key
```

パスワードを聞かれたら設定する（パスワードマネージャーに保管）。`~/.tauri/sheltie-updater.key`（秘密鍵）と `~/.tauri/sheltie-updater.key.pub`（公開鍵）が生成される。秘密鍵は Apple 証明書と同様に暗号化オフラインバックアップを取る。

- [ ] **Step 2: Secrets を登録する（ユーザー実行）**

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY --env release < ~/.tauri/sheltie-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --env release
```

2 つ目はプロンプトにパスワードを入力する。

- [ ] **Step 3: 登録を確認する**

Run: `gh secret list --env release`
Expected: `TAURI_SIGNING_PRIVATE_KEY` と `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` が一覧に出る（`APPLE_*` 3 件と合わせて計 5 件）

### Task 2: app-exit 協調機構に restart フラグを追加（TDD）

**Objective:** 「アップデート後の再起動」を既存の未保存変更保護フロー（`app-exit-requested` → `complete_app_exit`）に載せるため、`AppExitCoordinatorState` に restart フラグを追加する。

**Files:**
- Modify: `src-tauri/src/app_exit.rs`
- Modify: `src-tauri/src/commands/store/document_window.rs:392`（`app.exit(0)` の置き換え）
- Test: `src-tauri/src/app_exit.rs` に `#[cfg(test)] mod tests` を新設

**Interfaces:**
- Produces: `AppExitCoordinatorState::request_restart_on_exit() -> Result<(), String>`、`AppExitCoordinatorState::consume_restart_after_exit() -> Result<bool, String>`、`pub fn exit_or_restart<R: tauri::Runtime>(app: &tauri::AppHandle<R>, exit_state: &AppExitCoordinatorState)`（Task 3 が `request_restart_on_exit` を使う）

- [ ] **Step 1: Write the failing tests**

`src-tauri/src/app_exit.rs` の末尾に追加:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restart_flag_is_off_by_default() {
        let state = AppExitCoordinatorState::default();
        assert_eq!(state.consume_restart_after_exit(), Ok(false));
    }

    #[test]
    fn restart_request_is_consumed_once() {
        let state = AppExitCoordinatorState::default();
        state.request_restart_on_exit().unwrap();
        assert_eq!(state.consume_restart_after_exit(), Ok(true));
        assert_eq!(state.consume_restart_after_exit(), Ok(false));
    }

    #[test]
    fn aborting_pending_quit_clears_restart_request() {
        let state = AppExitCoordinatorState::default();
        state.begin_pending_quit().unwrap();
        state.request_restart_on_exit().unwrap();
        state.abort_pending_quit().unwrap();
        assert_eq!(state.consume_restart_after_exit(), Ok(false));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib app_exit`
Expected: `request_restart_on_exit` / `consume_restart_after_exit` が存在せずコンパイルエラー

- [ ] **Step 3: Write minimal implementation**

`AppExitCoordinatorFlags` にフィールドを追加し、メソッドを実装する:

```rust
#[derive(Default)]
struct AppExitCoordinatorFlags {
    pending_quit: bool,
    allow_exit_once: bool,
    restart_after_exit: bool,
}
```

`impl AppExitCoordinatorState` に追加:

```rust
    pub fn request_restart_on_exit(&self) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire app exit state lock".to_string())?;
        inner.restart_after_exit = true;
        Ok(())
    }

    pub fn consume_restart_after_exit(&self) -> Result<bool, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire app exit state lock".to_string())?;
        let restart = inner.restart_after_exit;
        inner.restart_after_exit = false;
        Ok(restart)
    }
```

`abort_pending_quit` の中で `inner.restart_after_exit = false;` も設定する（ユーザーが終了をキャンセルしたら、後の通常 Quit で勝手に再起動しないため）。

module レベルにヘルパーを追加:

```rust
/// allow_next_exit() 済みの終了点で呼ぶ。restart 予約があれば exit の代わりに再起動する。
/// app.restart() は非 main thread では ExitRequested を発火して consume_allow_exit の
/// ゲートを通る（allow_next_exit 済みなので通過する）。main thread から呼ばれた場合
/// （emit_app_exit_requested の document window なし分岐）はイベントをスキップして
/// 直接再起動するが、window が無く保護対象もないため許容する。
pub fn exit_or_restart<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    exit_state: &AppExitCoordinatorState,
) {
    match exit_state.consume_restart_after_exit() {
        Ok(true) => app.restart(),
        Ok(false) => {}
        Err(error) => log::error!("failed to read restart flag: {error}"),
    }
    app.exit(0);
}
```

呼び出し側を差し替える:

1. `app_exit.rs` の `emit_app_exit_requested` 末尾（document window が無い場合の即時終了、現 L107）: `app.exit(0);` → `exit_or_restart(app, &exit_state);`
2. `document_window.rs` の `complete_app_exit`（現 L392）: `app.exit(0);` → `crate::app_exit::exit_or_restart(&app, &exit_state);`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib`
Expected: 新規 3 テストを含め全テスト成功

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/app_exit.rs src-tauri/src/commands/store/document_window.rs
git commit -m "feat(macos): route app termination through a restart-aware exit helper"
```

### Task 3: updater プラグイン導入と対話フロー実装（TDD）

**Objective:** `tauri-plugin-updater` を導入し、チェック → 確認ダイアログ → DL & インストール → 再起動確認、の一連のフローを `updater.rs` に実装する。

**Files:**
- Create: `src-tauri/src/updater.rs`
- Modify: `src-tauri/src/lib.rs`（`mod updater;`）
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/setup.rs`（plugin 登録のみ。メニュー配線は Task 4）
- Test: `src-tauri/src/updater.rs` の `#[cfg(test)]`

**Interfaces:**
- Consumes: Task 2 の `request_restart_on_exit`、Task 1 の `~/.tauri/sheltie-updater.key.pub`
- Produces: `pub fn check_for_updates_interactively(app: tauri::AppHandle)`（Task 4 の menu event が呼ぶ）

- [ ] **Step 1: Write the failing tests（文言ヘルパー）**

`src-tauri/src/updater.rs` を新規作成し、まずテストだけ書く（`lib.rs` に `mod updater;` も追加）:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_available_message_mentions_both_versions() {
        assert_eq!(
            update_available_message("1.1.0", "1.2.0"),
            "Sheltie 1.2.0 is available — you have 1.1.0.\n\nWould you like to download and install it now?"
        );
    }

    #[test]
    fn up_to_date_message_mentions_current_version() {
        assert_eq!(
            up_to_date_message("1.1.0"),
            "Sheltie 1.1.0 is currently the newest version available."
        );
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib updater`
Expected: `update_available_message` / `up_to_date_message` が未定義でコンパイルエラー

- [ ] **Step 3: 依存と設定を追加する**

`src-tauri/Cargo.toml` の `[dependencies]` に追加（`tauri-plugin-store` の下）:

```toml
tauri-plugin-updater = "2"
```

`src-tauri/tauri.conf.json` を変更:

1. `bundle` に `"createUpdaterArtifacts": true` を追加。
2. トップレベルに `plugins` セクションを追加（`PUBKEY` は `~/.tauri/sheltie-updater.key.pub` の内容 1 行をそのまま貼る）:

```json
"plugins": {
  "updater": {
    "pubkey": "<content of ~/.tauri/sheltie-updater.key.pub>",
    "endpoints": [
      "https://github.com/ryonakae/sheltie/releases/latest/download/latest.json"
    ]
  }
}
```

`src-tauri/src/setup.rs` の plugin 登録チェーン（`.plugin(tauri_plugin_store::...)` の後）に追加:

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
```

- [ ] **Step 4: Write minimal implementation（updater.rs 本体）**

```rust
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

use crate::app_exit::{emit_app_exit_requested, AppExitCoordinatorState};

const DIALOG_TITLE_CHECK: &str = "Check for Updates";
const DIALOG_TITLE_AVAILABLE: &str = "Update Available";
const DIALOG_TITLE_INSTALLED: &str = "Update Installed";

// メニュー連打で並行チェックが走らないようにする
static CHECK_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

fn update_available_message(current_version: &str, new_version: &str) -> String {
    format!(
        "Sheltie {new_version} is available — you have {current_version}.\n\nWould you like to download and install it now?"
    )
}

fn up_to_date_message(current_version: &str) -> String {
    format!("Sheltie {current_version} is currently the newest version available.")
}

pub fn check_for_updates_interactively(app: tauri::AppHandle) {
    if CHECK_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    tauri::async_runtime::spawn(async move {
        run_interactive_check(&app).await;
        CHECK_IN_FLIGHT.store(false, Ordering::SeqCst);
    });
}

async fn run_interactive_check(app: &tauri::AppHandle) {
    let check_result = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };
    let current_version = app.package_info().version.to_string();

    let update = match check_result {
        Err(error) => {
            log::warn!("update check failed: {error}");
            app.dialog()
                .message(format!("Could not check for updates.\n\n{error}"))
                .title(DIALOG_TITLE_CHECK)
                .kind(MessageDialogKind::Error)
                .blocking_show();
            return;
        }
        Ok(None) => {
            app.dialog()
                .message(up_to_date_message(&current_version))
                .title(DIALOG_TITLE_CHECK)
                .kind(MessageDialogKind::Info)
                .blocking_show();
            return;
        }
        Ok(Some(update)) => update,
    };

    let confirmed = app
        .dialog()
        .message(update_available_message(&current_version, &update.version))
        .title(DIALOG_TITLE_AVAILABLE)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Install Update".to_string(),
            "Not Now".to_string(),
        ))
        .blocking_show();
    if !confirmed {
        return;
    }

    log::info!("downloading update {}", update.version);
    if let Err(error) = update.download_and_install(|_, _| {}, || {}).await {
        log::error!("update installation failed: {error}");
        app.dialog()
            .message(format!("Could not download and install the update.\n\n{error}"))
            .title(DIALOG_TITLE_CHECK)
            .kind(MessageDialogKind::Error)
            .blocking_show();
        return;
    }
    log::info!("update {} installed", update.version);

    let restart = app
        .dialog()
        .message("The update has been installed. Restart Sheltie to start using the new version.")
        .title(DIALOG_TITLE_INSTALLED)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Restart".to_string(),
            "Later".to_string(),
        ))
        .blocking_show();
    if !restart {
        return;
    }

    if let Err(error) = app.state::<AppExitCoordinatorState>().request_restart_on_exit() {
        log::error!("failed to request restart after update: {error}");
        return;
    }
    // 未保存変更の保護は既存の app-exit フローに任せる
    let app_for_exit = app.clone();
    if let Err(error) = app.run_on_main_thread(move || emit_app_exit_requested(&app_for_exit)) {
        log::error!("failed to schedule restart after update: {error}");
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib`
Expected: 新規 2 テストを含め全テスト成功。`cargo test` はコンパイルを兼ねるため、plugin 登録・API 使用の型エラーもここで検出される

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json \
  src-tauri/src/updater.rs src-tauri/src/lib.rs src-tauri/src/setup.rs
git commit -m "feat(updater): add interactive update check and install flow"
```

### Task 4: 「Check for Updates…」メニュー項目の追加と配線

**Objective:** App メニューの About 直下に項目を挿し、クリックで Task 3 のフローを起動する。

**Files:**
- Modify: `src-tauri/src/menus/mod.rs`
- Modify: `src-tauri/src/menus/app.rs`
- Modify: `src-tauri/src/setup.rs`

**Interfaces:**
- Consumes: `crate::updater::check_for_updates_interactively`
- Produces: `MENU_ID_APP_CHECK_UPDATES`

- [ ] **Step 1: MENU_ID を追加**

`src-tauri/src/menus/mod.rs` の定数群（`MENU_ID_APP_QUIT` の下）に追加:

```rust
pub const MENU_ID_APP_CHECK_UPDATES: &str = "app.check-for-updates";
```

- [ ] **Step 2: メニュー項目を挿入**

`src-tauri/src/menus/app.rs` の `configure_app_menu` で、`replace_default_about_and_hide` 呼び出し（L24）の直後に追加（import に `MENU_ID_APP_CHECK_UPDATES` を足す）:

```rust
    // macOS 標準の Sparkle 系アプリと同じく About 直下に置く
    let check_updates_item =
        MenuItemBuilder::with_id(MENU_ID_APP_CHECK_UPDATES, "Check for Updates…").build(app)?;
    app_submenu.insert(&check_updates_item, 1)?;
```

`insert_settings_submenu`（L100-104）の挿入 index を 2, 3 → 3, 4 に変更し、コメントも更新する:

```rust
    // App メニュー構成 [0] About, [1] Check for Updates…, [2] separator, [3] Services, ...
    // の Check for Updates… と Services の間に Settings サブメニュー + separator を差し込む
    let separator = PredefinedMenuItem::separator(app)?;
    app_submenu.insert(&settings_submenu, 3)?;
    app_submenu.insert(&separator, 4)?;
```

- [ ] **Step 3: menu event を配線**

`src-tauri/src/setup.rs` の `on_menu_event`（L234）の `MENU_ID_APP_QUIT` アームの下に追加（import に `MENU_ID_APP_CHECK_UPDATES` を足す）:

```rust
MENU_ID_APP_CHECK_UPDATES => crate::updater::check_for_updates_interactively(app.clone()),
```

- [ ] **Step 4: 動作確認**

Run: `cd src-tauri && cargo test --lib && npm run dev`（リポジトリルートで）
Expected:
- App メニューが About Sheltie / Check for Updates… / separator / Settings / … の順に並ぶ
- Check for Updates… クリックでエラーダイアログ「Could not check for updates.」が出る（`latest.json` を含む published release がまだ無いため 404。この時点では**これが期待動作**）

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/menus/mod.rs src-tauri/src/menus/app.rs src-tauri/src/setup.rs
git commit -m "feat(macos): add Check for Updates menu item to the app menu"
```

### Task 5: release.yml に updater アーティファクトと latest.json を追加

**Objective:** リリースごとに署名済み `.app.tar.gz` / `.sig` / `latest.json` を生成し、draft release にアップロードする。

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（Task 1）、`VERSION` env（既存 L86）
- Produces: release assets `Sheltie_<version>_universal.app.tar.gz`(.sig) と `latest.json`

- [ ] **Step 1: ビルドステップに署名鍵とバンドル追加**

「Build signed universal DMG」ステップ（L158-159）を変更:

```yaml
      - name: Build signed universal DMG and updater artifacts
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: npm run build -- --bundles app,dmg --target universal-apple-darwin
```

- [ ] **Step 2: latest.json 生成ステップを追加**

「Notarize and verify DMG」の直後に追加:

```yaml
      - name: Prepare updater artifacts
        run: |
          set -euo pipefail

          BUNDLE_DIR="$GITHUB_WORKSPACE/src-tauri/target/universal-apple-darwin/release/bundle/macos"
          TARBALL_SRC="$BUNDLE_DIR/Sheltie.app.tar.gz"
          for file in "$TARBALL_SRC" "$TARBALL_SRC.sig"; do
            if [[ ! -f "$file" ]]; then
              echo "Expected updater artifact was not created: $file" >&2
              exit 1
            fi
          done

          TARBALL_PATH="$BUNDLE_DIR/Sheltie_${VERSION}_universal.app.tar.gz"
          mv "$TARBALL_SRC" "$TARBALL_PATH"
          mv "$TARBALL_SRC.sig" "$TARBALL_PATH.sig"

          SIGNATURE="$(cat "$TARBALL_PATH.sig")"
          if [[ -z "$SIGNATURE" ]]; then
            echo "Updater signature file is empty" >&2
            exit 1
          fi

          LATEST_JSON_PATH="$BUNDLE_DIR/latest.json"
          # universal バイナリなので両アーキテクチャのキーが同じ tarball を指す
          jq -n \
            --arg version "$VERSION" \
            --arg pub_date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            --arg signature "$SIGNATURE" \
            --arg url "https://github.com/${GITHUB_REPOSITORY}/releases/download/v${VERSION}/Sheltie_${VERSION}_universal.app.tar.gz" \
            '{
              version: $version,
              pub_date: $pub_date,
              platforms: {
                "darwin-aarch64": { signature: $signature, url: $url },
                "darwin-x86_64": { signature: $signature, url: $url }
              }
            }' > "$LATEST_JSON_PATH"

          echo "TARBALL_PATH=$TARBALL_PATH" >> "$GITHUB_ENV"
          echo "LATEST_JSON_PATH=$LATEST_JSON_PATH" >> "$GITHUB_ENV"
```

- [ ] **Step 3: アップロード対象に追加**

「Create draft GitHub Release」ステップの `gh release upload` と `gh release create` の両方に、`"$CHECKSUM_PATH"` の後ろへ 3 行追加:

```yaml
              "$TARBALL_PATH" \
              "$TARBALL_PATH.sig" \
              "$LATEST_JSON_PATH" \
```

- [ ] **Step 4: 検証**

Run: `npm run format`（prettier が yml を検査する）
Expected: エラーなし

Run: `actionlint .github/workflows/release.yml`（未インストールなら先に `brew install actionlint`）
Expected: エラーなし。CI の `verify` ジョブが `.github/workflows/*.yml` に対して actionlint を必ず実行するため、ローカルでの実行は必須（push 後に気づくのを防ぐ）。

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(release): publish signed updater artifacts and latest.json"
```

### Task 6: docs/agents の更新

**Objective:** リリース運用の正本 `release.md` と `architecture.md` を実装に追従させる。

**Files:**
- Modify: `docs/agents/release.md`
- Modify: `docs/agents/architecture.md`

- [ ] **Step 1: release.md を更新（英語）**

以下を反映する:

1. **Artifact contract** のアセット一覧に追加: `Sheltie_<version>_universal.app.tar.gz`（updater 用、minisign 署名付き）、同 `.sig`、`latest.json`（in-app updater が `releases/latest/download/latest.json` から取得する。URL はバージョン固定 download URL を指す）。
2. **Environment secrets** の表に `TAURI_SIGNING_PRIVATE_KEY`（updater の minisign 秘密鍵）と `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` を追加し、Task 1 と同じ `gh secret set` コマンド例と鍵生成コマンド（`npx tauri signer generate -w ~/.tauri/sheltie-updater.key`）を記載する。
3. 新セクション **In-app updater** を追加:
   - 更新チェックは手動のみ（App menu → Check for Updates…）。
   - endpoint は published release にしか解決されないため、draft のままなら既存ユーザーに配信されない（publish が引き続きゲート）。
   - updater 経由で置き換えられた app には quarantine が付かないため Gatekeeper 再評価は走らない。
   - Homebrew cask との併存: in-app 更新すると brew が把握する version と実体がずれるが、cask は `--no-quarantine` 不要の通常運用のままでよい。
   - ローカルで `npm run build` を実行するには `TAURI_SIGNING_PRIVATE_KEY`（と `_PASSWORD`）の export が必要になった旨（`createUpdaterArtifacts` のため）。
4. **Draft release acceptance** に確認項目を 1 つ追加: 「`latest.json` の `version` がリリースバージョンと一致し、`url` が同じ release の tarball を指していること」。

- [ ] **Step 2: architecture.md を更新**

Rust モジュール一覧（`menus/...` の行の近く）に 1 行追加:

```markdown
- `updater.rs`: Check for Updates… の対話フロー（tauri-plugin-updater / 再起動は app_exit 経由）
```

- [ ] **Step 3: Commit**

```bash
git add docs/agents/release.md docs/agents/architecture.md
git commit -m "docs(agents): document the in-app updater release contract"
```

## Validation

- `npm run lint && npm run format && npm run typecheck && npm run test` — すべてエラーなし（フロントエンド変更は無いが完了時規約として実行）
- `cd src-tauri && cargo test --lib` — 全テスト成功（app_exit の restart フラグ 3 件、updater の文言 2 件を含む）
- `npm run dev` で手動確認:
  1. App メニューの並びが About Sheltie / Check for Updates… / separator / Settings / separator / Services / … になっている
  2. Check for Updates… → 「Could not check for updates.」エラーダイアログ（latest.json 付き release が publish されるまでの期待動作）
  3. Cmd+Q・未保存変更ダイアログなど既存の終了フローが変わっていない
- （任意・フル E2E）ローカルで更新フローを通しで確認する場合:
  1. `tauri.conf.json` の endpoint を一時的に `http://localhost:8000/latest.json` に変え、`plugins.updater.dangerousInsecureTransportProtocol: true` を追加（**コミットしない**）
  2. version を 9.9.9 に上げて `TAURI_SIGNING_PRIVATE_KEY` を export し `npm run build -- --bundles app`、生成された tarball と .sig から latest.json を手作りして `python3 -m http.server` で配信
  3. version を戻してビルドした旧アプリから Check for Updates… → Install Update → Restart で 9.9.9 に置き換わることを確認
- 本番の初回検証: 本実装を含むリリース（例 v1.2.0）を publish した時点では旧バージョンに updater が無いため何も起きない。**その次のリリース**（例 v1.2.1）を publish し、v1.2.0 から Check for Updates… で更新できることを確認するのが最初の実地検証になる。v1.2.0 の draft acceptance では assets（tarball / .sig / latest.json）の存在と latest.json の内容確認まで行う。

## Risks, Tradeoffs, and Open Questions

- **ローカル `npm run build` が鍵必須になる**: `createUpdaterArtifacts: true` のため、`TAURI_SIGNING_PRIVATE_KEY` 未設定だとバンドルが失敗する。ローカルでフルビルドが必要な場面（file association の手動確認など）では鍵を export する。release.md に記載（Task 6）。
- **`--bundles app,dmg` での tarball 生成位置**: `bundle/macos/Sheltie.app.tar.gz` を前提にしている。万一パスが違う場合も Task 5 の存在チェックが workflow を確実に失敗させるので、サイレントに壊れることはない。
- **再起動時の未保存変更**: `app.restart()` を直接呼ばず app-exit フローを経由させるので、未保存変更があれば既存の保存確認ダイアログが出る。ユーザーがキャンセルした場合は再起動されず（フラグは `abort_pending_quit` でクリア)、更新は次回起動時に反映される。
- **main thread からの `app.restart()`**: Tauri docs によると main thread から呼ぶと `ExitRequested` / `Exit` イベントをスキップして直接再起動する。この経路に入るのは「document window が 1 枚も無い状態で Check for Updates… → Restart」のときだけで、保護すべき未保存変更が存在しないため許容する（`exit_or_restart` のコメントにも明記）。`request_restart()` への置き換えは `-> ()` のため直後の `app.exit(0)` と競合する。行わないこと。
- **チェック失敗ダイアログの初期挙動**: `latest.json` を含む release が publish されるまで、Check for Updates… は常にエラーダイアログになる。最初のリリースまでの一時的な状態として許容する。
- **Homebrew cask とのバージョンずれ**: in-app 更新したユーザーの実体と brew の記録がずれるが、実害はない（次の `brew upgrade` で上書きされるだけ）。
- **minisign 鍵の紛失**: 秘密鍵を失うと既存インストールへ更新を配信できなくなる（pubkey を変えた新バージョンを検証できない）。Apple 証明書と同様にオフラインバックアップ必須（Task 1 / release.md に記載）。
