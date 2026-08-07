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
            .message(format!(
                "Could not download and install the update.\n\n{error}"
            ))
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

    if let Err(error) = app
        .state::<AppExitCoordinatorState>()
        .request_restart_on_exit()
    {
        log::error!("failed to request restart after update: {error}");
        return;
    }
    // 未保存変更の保護は既存の app-exit フローに任せる
    let app_for_exit = app.clone();
    if let Err(error) = app.run_on_main_thread(move || emit_app_exit_requested(&app_for_exit)) {
        log::error!("failed to schedule restart after update: {error}");
    }
}

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
