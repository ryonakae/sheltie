use tauri::menu::{Menu, MenuItemBuilder, SubmenuBuilder};

use super::helpers::{find_submenu_by_title, remove_submenu_item_by_id};
use super::{
    emit_window_command, EVENT_FILE_COMMAND, MENU_ID_FILE_NEW_TAB, MENU_ID_FILE_NEW_WINDOW,
    MENU_ID_FILE_OPEN, MENU_ID_FILE_SAVE, MENU_ID_FILE_SAVE_AS,
};
use crate::commands::store::create_untitled_document_window;

pub fn configure_file_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    menu: &Menu<R>,
) -> tauri::Result<()> {
    let file_submenu = if let Some(existing) = find_submenu_by_title(menu, "file")? {
        existing
    } else {
        log::warn!("default File menu not found; creating a new one");
        let fallback = SubmenuBuilder::with_id(app, "file", "File").build()?;
        menu.append(&fallback)?;
        fallback
    };

    remove_submenu_item_by_id(&file_submenu, MENU_ID_FILE_NEW_TAB)?;
    remove_submenu_item_by_id(&file_submenu, MENU_ID_FILE_NEW_WINDOW)?;
    remove_submenu_item_by_id(&file_submenu, "file.new")?;
    remove_submenu_item_by_id(&file_submenu, MENU_ID_FILE_OPEN)?;
    remove_submenu_item_by_id(&file_submenu, MENU_ID_FILE_SAVE)?;
    remove_submenu_item_by_id(&file_submenu, MENU_ID_FILE_SAVE_AS)?;

    let open_item = MenuItemBuilder::with_id(MENU_ID_FILE_OPEN, "Open")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let save_item = MenuItemBuilder::with_id(MENU_ID_FILE_SAVE, "Save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_as_item = MenuItemBuilder::with_id(MENU_ID_FILE_SAVE_AS, "Save As")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;

    if cfg!(target_os = "macos") {
        let new_tab_item = MenuItemBuilder::with_id(MENU_ID_FILE_NEW_TAB, "New Tab")
            .accelerator("CmdOrCtrl+T")
            .build(app)?;
        let new_window_item = MenuItemBuilder::with_id(MENU_ID_FILE_NEW_WINDOW, "New Window")
            .accelerator("CmdOrCtrl+N")
            .build(app)?;

        file_submenu.insert(&new_tab_item, 0)?;
        file_submenu.insert(&new_window_item, 1)?;
        file_submenu.insert(&open_item, 2)?;
        file_submenu.insert(&save_item, 3)?;
        file_submenu.insert(&save_as_item, 4)?;
    } else {
        let new_item = MenuItemBuilder::with_id(MENU_ID_FILE_NEW_WINDOW, "New")
            .accelerator("CmdOrCtrl+N")
            .build(app)?;

        file_submenu.insert(&new_item, 0)?;
        file_submenu.insert(&open_item, 1)?;
        file_submenu.insert(&save_item, 2)?;
        file_submenu.insert(&save_as_item, 3)?;
    }

    Ok(())
}

pub fn emit_file_command<R: tauri::Runtime>(app: &tauri::AppHandle<R>, command: &str) {
    if emit_window_command(app, EVENT_FILE_COMMAND, command) {
        return;
    }

    match command {
        "new-window" => {
            if let Err(error) = create_untitled_document_window(app) {
                log::warn!("failed to create new window: {error}");
            }
        }
        "new-tab" => {
            log::warn!(
                "failed to dispatch new tab to current document window: no current document window resolved"
            );
        }
        _ => {}
    }
}
