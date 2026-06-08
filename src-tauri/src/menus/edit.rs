use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

use super::helpers::{find_edit_submenu, remove_default_undo_redo, remove_submenu_item_by_id};
use super::{
    emit_window_command, EVENT_EDIT_COMMAND, MENU_ID_EDIT_DELETE, MENU_ID_EDIT_REDO,
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

    // 既定の Undo/Redo（Predefined）を除去し、アプリ内履歴コマンドに差し替える
    remove_default_undo_redo(&edit_submenu)?;

    let undo_item = MenuItemBuilder::with_id(MENU_ID_EDIT_UNDO, "Undo")
        .accelerator("CmdOrCtrl+Z")
        .build(app)?;
    let redo_item = MenuItemBuilder::with_id(MENU_ID_EDIT_REDO, "Redo")
        .accelerator("CmdOrCtrl+Shift+Z")
        .build(app)?;
    let delete_item = MenuItemBuilder::with_id(MENU_ID_EDIT_DELETE, "Delete")
        .accelerator("Delete")
        .build(app)?;

    edit_submenu.insert(&undo_item, 0)?;
    edit_submenu.insert(&redo_item, 1)?;
    edit_submenu.insert(&delete_item, 2)?;

    if edit_submenu.items()?.len() == 3 {
        let separator = PredefinedMenuItem::separator(app)?;
        edit_submenu.append(&separator)?;
        let cut = PredefinedMenuItem::cut(app, None)?;
        let copy = PredefinedMenuItem::copy(app, None)?;
        let paste = PredefinedMenuItem::paste(app, None)?;
        let select_all = PredefinedMenuItem::select_all(app, None)?;
        edit_submenu.append(&cut)?;
        edit_submenu.append(&copy)?;
        edit_submenu.append(&paste)?;
        edit_submenu.append(&select_all)?;
    }

    Ok(())
}

pub fn emit_edit_command<R: tauri::Runtime>(app: &tauri::AppHandle<R>, command: &str) {
    let _ = emit_window_command(app, EVENT_EDIT_COMMAND, command);
}
