use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

use super::helpers::{find_submenu_by_title, remove_submenu_item_by_id};
use super::{
    emit_window_command, EVENT_VIEW_COMMAND, MENU_ID_VIEW_FIT, MENU_ID_VIEW_RESET_ZOOM,
    MENU_ID_VIEW_ZOOM_IN, MENU_ID_VIEW_ZOOM_OUT,
};

pub fn configure_view_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    menu: &Menu<R>,
) -> tauri::Result<()> {
    let view_submenu = if let Some(existing) = find_submenu_by_title(menu, "view")? {
        existing
    } else {
        let fallback = SubmenuBuilder::with_id(app, "view", "View").build()?;
        menu.append(&fallback)?;
        fallback
    };

    // 再初期化・将来の再適用でも重複しないよう既存の custom item を先に削除
    remove_submenu_item_by_id(&view_submenu, MENU_ID_VIEW_FIT)?;
    remove_submenu_item_by_id(&view_submenu, MENU_ID_VIEW_RESET_ZOOM)?;
    remove_submenu_item_by_id(&view_submenu, MENU_ID_VIEW_ZOOM_IN)?;
    remove_submenu_item_by_id(&view_submenu, MENU_ID_VIEW_ZOOM_OUT)?;

    let fit_item = MenuItemBuilder::with_id(MENU_ID_VIEW_FIT, "Zoom to Fit")
        .accelerator("Shift+1")
        .build(app)?;
    let reset_zoom_item = MenuItemBuilder::with_id(MENU_ID_VIEW_RESET_ZOOM, "Zoom to 100%")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;
    let zoom_in_item = MenuItemBuilder::with_id(MENU_ID_VIEW_ZOOM_IN, "Zoom In")
        .accelerator("CmdOrCtrl+Shift+=")
        .build(app)?;
    let zoom_out_item = MenuItemBuilder::with_id(MENU_ID_VIEW_ZOOM_OUT, "Zoom Out")
        .accelerator("CmdOrCtrl+Minus")
        .build(app)?;

    view_submenu.append(&fit_item)?;
    view_submenu.append(&reset_zoom_item)?;
    view_submenu.append(&PredefinedMenuItem::separator(app)?)?;
    view_submenu.append(&zoom_in_item)?;
    view_submenu.append(&zoom_out_item)?;

    Ok(())
}

pub fn emit_view_command<R: tauri::Runtime>(app: &tauri::AppHandle<R>, command: &str) {
    let _ = emit_window_command(app, EVENT_VIEW_COMMAND, command);
}
