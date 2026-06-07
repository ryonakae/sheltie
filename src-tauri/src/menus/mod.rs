pub mod app;
pub mod edit;
pub mod file;
pub mod helpers;
pub mod theme;
pub mod view;

#[cfg(target_os = "macos")]
pub mod macos;

use tauri::Emitter;

use crate::commands::store::focused_document_window_label;

pub const EVENT_EDIT_COMMAND: &str = "edit-command";
pub const EVENT_FILE_COMMAND: &str = "file-command";
pub const EVENT_VIEW_COMMAND: &str = "view-command";
pub const EVENT_THEME_COMMAND: &str = "theme-command";

pub const MENU_ID_APP_QUIT: &str = "app.quit";
pub const MENU_ID_FILE_NEW_TAB: &str = "file.new-tab";
pub const MENU_ID_FILE_NEW_WINDOW: &str = "file.new-window";
pub const MENU_ID_FILE_OPEN: &str = "file.open";
pub const MENU_ID_FILE_SAVE: &str = "file.save";
pub const MENU_ID_FILE_SAVE_AS: &str = "file.save-as";
pub const MENU_ID_EDIT_UNDO: &str = "edit.undo";
pub const MENU_ID_EDIT_REDO: &str = "edit.redo";
pub const MENU_ID_EDIT_DELETE: &str = "edit.delete";
pub const MENU_ID_VIEW_FIT: &str = "view.fit";
pub const MENU_ID_VIEW_RESET_ZOOM: &str = "view.reset-zoom";
pub const MENU_ID_VIEW_ZOOM_IN: &str = "view.zoom-in";
pub const MENU_ID_VIEW_ZOOM_OUT: &str = "view.zoom-out";
pub const MENU_ID_OPEN_DEVTOOLS: &str = "develop.open-devtools";
pub const MENU_ID_SETTINGS: &str = "app.settings";

pub fn emit_window_command<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    event_name: &str,
    command: &str,
) -> bool {
    let Some(label) = focused_document_window_label(app) else {
        return false;
    };

    if let Err(error) = app.emit_to(&label, event_name, command) {
        log::warn!(
            "failed to emit window command: label={label}, event={event_name}, command={command}, error={error}"
        );
        return false;
    }

    true
}
