use tauri::{
    menu::{CheckMenuItem, MenuItem, MenuItemKind},
    Emitter,
};

use super::{EVENT_MCP_LIFECYCLE_CHANGED, MENU_ID_MCP_CONNECTIONS, MENU_ID_MCP_ENABLED};

pub fn update_mcp_check_state(app: &tauri::AppHandle, enabled: bool) {
    let Some(menu) = app.menu() else { return };
    let Some(item) = find_check_in_items(&menu.items().unwrap_or_default(), MENU_ID_MCP_ENABLED)
    else {
        return;
    };
    if let Err(error) = item.set_checked(enabled) {
        log::warn!("failed to update MCP menu check state: {error}");
    }
}

pub fn mcp_menu_is_checked(app: &tauri::AppHandle) -> bool {
    let Some(menu) = app.menu() else {
        return false;
    };
    find_check_in_items(&menu.items().unwrap_or_default(), MENU_ID_MCP_ENABLED)
        .and_then(|item| item.is_checked().ok())
        .unwrap_or(false)
}

pub fn emit_mcp_lifecycle_changed<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    window_label: &str,
    enabled: bool,
) {
    let status = lifecycle_notification_status(enabled);
    if let Err(error) = app.emit_to(window_label, EVENT_MCP_LIFECYCLE_CHANGED, status) {
        log::warn!(
            "failed to emit MCP lifecycle change: label={window_label}, status={status}, error={error}"
        );
    }
}

fn lifecycle_notification_status(enabled: bool) -> &'static str {
    if enabled {
        "started"
    } else {
        "stopped"
    }
}

pub fn update_mcp_connection_count(app: &tauri::AppHandle, count: usize) {
    let Some(menu) = app.menu() else { return };
    let Some(item) =
        find_menu_item_in_items(&menu.items().unwrap_or_default(), MENU_ID_MCP_CONNECTIONS)
    else {
        return;
    };
    if let Err(error) = item.set_text(format!("MCP Connections: {count}")) {
        log::warn!("failed to update MCP connection count: {error}");
    }
}

fn find_check_in_items<R: tauri::Runtime>(
    items: &[MenuItemKind<R>],
    id: &str,
) -> Option<CheckMenuItem<R>> {
    for item in items {
        if let Some(check) = item.as_check_menuitem() {
            if check.id() == id {
                return Some(check.clone());
            }
        }
        if let Some(submenu) = item.as_submenu() {
            if let Ok(children) = submenu.items() {
                if let Some(found) = find_check_in_items(&children, id) {
                    return Some(found);
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_notification_status_matches_enabled_state() {
        assert_eq!(lifecycle_notification_status(true), "started");
        assert_eq!(lifecycle_notification_status(false), "stopped");
    }
}

fn find_menu_item_in_items<R: tauri::Runtime>(
    items: &[MenuItemKind<R>],
    id: &str,
) -> Option<MenuItem<R>> {
    for item in items {
        if let Some(menu_item) = item.as_menuitem() {
            if menu_item.id() == id {
                return Some(menu_item.clone());
            }
        }
        if let Some(submenu) = item.as_submenu() {
            if let Ok(children) = submenu.items() {
                if let Some(found) = find_menu_item_in_items(&children, id) {
                    return Some(found);
                }
            }
        }
    }
    None
}
