use super::helpers::find_check_menu_item;
use super::{emit_window_command, EVENT_THEME_COMMAND};
use crate::commands::theme::{MENU_ID_THEME_DARK, MENU_ID_THEME_LIGHT, MENU_ID_THEME_SYSTEM};

pub fn update_theme_check_state<R: tauri::Runtime>(app: &tauri::AppHandle<R>, selected_mode: &str) {
    let Some(menu) = app.menu() else { return };
    for (id, mode) in [
        (MENU_ID_THEME_LIGHT, "light"),
        (MENU_ID_THEME_DARK, "dark"),
        (MENU_ID_THEME_SYSTEM, "system"),
    ] {
        if let Some(check) = find_check_menu_item(&menu, id) {
            if let Err(error) = check.set_checked(mode == selected_mode) {
                log::warn!("failed to update Theme menu check state: id={id}, error={error}");
            }
        }
    }
}

pub fn emit_theme_command<R: tauri::Runtime>(app: &tauri::AppHandle<R>, mode: &str) {
    let _ = emit_window_command(app, EVENT_THEME_COMMAND, mode);
}
