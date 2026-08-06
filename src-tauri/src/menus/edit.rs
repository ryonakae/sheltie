use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

use super::helpers::{
    find_edit_submenu, remove_default_edit_predefined_items, remove_submenu_item_by_id,
};
use super::{
    emit_window_command, EVENT_EDIT_COMMAND, MENU_ID_EDIT_COPY, MENU_ID_EDIT_CUT,
    MENU_ID_EDIT_DELETE, MENU_ID_EDIT_DUPLICATE, MENU_ID_EDIT_PASTE, MENU_ID_EDIT_REDO,
    MENU_ID_EDIT_UNDO,
};

pub fn configure_edit_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    menu: &Menu<R>,
) -> tauri::Result<()> {
    let edit_submenu = if let Some(existing) = find_edit_submenu(menu)? {
        existing
    } else {
        log::warn!("default Edit menu not found; creating a new one");
        let fallback = SubmenuBuilder::with_id(app, "edit", "Edit").build()?;
        menu.append(&fallback)?;
        fallback
    };

    // 再初期化・将来の再適用でも重複しないよう既存の custom item を先に削除
    remove_submenu_item_by_id(&edit_submenu, MENU_ID_EDIT_UNDO)?;
    remove_submenu_item_by_id(&edit_submenu, MENU_ID_EDIT_REDO)?;
    remove_submenu_item_by_id(&edit_submenu, MENU_ID_EDIT_DELETE)?;
    remove_submenu_item_by_id(&edit_submenu, MENU_ID_EDIT_CUT)?;
    remove_submenu_item_by_id(&edit_submenu, MENU_ID_EDIT_COPY)?;
    remove_submenu_item_by_id(&edit_submenu, MENU_ID_EDIT_PASTE)?;
    remove_submenu_item_by_id(&edit_submenu, MENU_ID_EDIT_DUPLICATE)?;

    // 既定の Undo/Redo/Cut/Copy/Paste（Predefined）を除去し、アプリ内コマンドに差し替える。
    // Select All は predefined を再追加するため、この掃除でまとめて外す。
    remove_default_edit_predefined_items(&edit_submenu)?;

    let undo_item = MenuItemBuilder::with_id(MENU_ID_EDIT_UNDO, "Undo")
        .accelerator("CmdOrCtrl+Z")
        .build(app)?;
    let redo_item = MenuItemBuilder::with_id(MENU_ID_EDIT_REDO, "Redo")
        .accelerator("CmdOrCtrl+Shift+Z")
        .build(app)?;
    let delete_item = MenuItemBuilder::with_id(MENU_ID_EDIT_DELETE, "Delete")
        .accelerator("Delete")
        .build(app)?;
    let cut_item = MenuItemBuilder::with_id(MENU_ID_EDIT_CUT, "Cut")
        .accelerator("CmdOrCtrl+X")
        .build(app)?;
    let copy_item = MenuItemBuilder::with_id(MENU_ID_EDIT_COPY, "Copy")
        .accelerator("CmdOrCtrl+C")
        .build(app)?;
    let paste_item = MenuItemBuilder::with_id(MENU_ID_EDIT_PASTE, "Paste")
        .accelerator("CmdOrCtrl+V")
        .build(app)?;
    let duplicate_item = MenuItemBuilder::with_id(MENU_ID_EDIT_DUPLICATE, "Duplicate")
        .accelerator("CmdOrCtrl+D")
        .build(app)?;

    edit_submenu.append(&undo_item)?;
    edit_submenu.append(&redo_item)?;
    edit_submenu.append(&delete_item)?;
    edit_submenu.append(&PredefinedMenuItem::separator(app)?)?;
    edit_submenu.append(&cut_item)?;
    edit_submenu.append(&copy_item)?;
    edit_submenu.append(&paste_item)?;
    edit_submenu.append(&duplicate_item)?;
    edit_submenu.append(&PredefinedMenuItem::separator(app)?)?;
    edit_submenu.append(&PredefinedMenuItem::select_all(app, None)?)?;

    Ok(())
}

pub fn emit_edit_command<R: tauri::Runtime>(app: &tauri::AppHandle<R>, command: &str) {
    let _ = emit_window_command(app, EVENT_EDIT_COMMAND, command);
}
