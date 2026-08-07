use std::sync::Mutex;

use tauri::{Emitter, Manager};

use crate::commands::store::focused_document_window_label;

pub const EVENT_APP_EXIT_REQUESTED: &str = "app-exit-requested";

#[derive(Default)]
pub struct AppExitCoordinatorState {
    inner: Mutex<AppExitCoordinatorFlags>,
}

#[derive(Default)]
struct AppExitCoordinatorFlags {
    pending_quit: bool,
    allow_exit_once: bool,
    restart_after_exit: bool,
}

impl AppExitCoordinatorState {
    pub fn begin_pending_quit(&self) -> Result<bool, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire app exit state lock".to_string())?;

        if inner.pending_quit {
            return Ok(false);
        }

        inner.pending_quit = true;
        Ok(true)
    }

    pub fn consume_allow_exit(&self) -> Result<bool, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire app exit state lock".to_string())?;

        if !inner.allow_exit_once {
            return Ok(false);
        }

        inner.allow_exit_once = false;
        Ok(true)
    }

    pub fn has_pending_quit(&self) -> Result<bool, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire app exit state lock".to_string())?;
        Ok(inner.pending_quit)
    }

    pub fn allow_next_exit(&self) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire app exit state lock".to_string())?;
        inner.pending_quit = false;
        inner.allow_exit_once = true;
        Ok(())
    }

    pub fn abort_pending_quit(&self) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire app exit state lock".to_string())?;
        inner.pending_quit = false;
        inner.allow_exit_once = false;
        // 終了をキャンセルしたら、後の通常 Quit で意図せず再起動しないようにする
        inner.restart_after_exit = false;
        Ok(())
    }

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
}

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

pub fn emit_app_exit_requested<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let exit_state = app.state::<AppExitCoordinatorState>();
    match exit_state.begin_pending_quit() {
        Ok(true) => {}
        Ok(false) => return,
        Err(error) => {
            log::error!("failed to update app exit state: {error}");
            return;
        }
    }

    if let Some(label) = focused_document_window_label(app) {
        if let Err(error) = app.emit_to(&label, EVENT_APP_EXIT_REQUESTED, ()) {
            log::warn!("failed to emit app exit request: label={label}, error={error}");
            if let Err(reset_error) = exit_state.abort_pending_quit() {
                log::error!("failed to reset app exit state: {reset_error}");
            }
        }
        return;
    }

    if let Err(error) = exit_state.allow_next_exit() {
        log::error!("failed to update app exit state: {error}");
        if let Err(reset_error) = exit_state.abort_pending_quit() {
            log::error!("failed to reset app exit state: {reset_error}");
        }
        return;
    }

    exit_or_restart(app, &exit_state);
}

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
