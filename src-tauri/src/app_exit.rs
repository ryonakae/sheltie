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
        Ok(())
    }
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

    app.exit(0);
}
