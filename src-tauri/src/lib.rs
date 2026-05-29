mod commands;

use std::sync::Mutex;

use commands::{
    dialog::show_unsaved_changes_dialog,
    store::{
        abort_app_exit, attach_pending_document_tab, close_ready, complete_app_exit,
        configure_macos_window_tabbing_policy, create_untitled_document_window,
        focus_document_window, focused_document_window_label, handle_launch_args,
        load_project_file, load_window_context, new_document_tab, new_document_window,
        open_document_window, save_project_file, DocumentManagerState,
    },
    theme::{
        get_platform_info, load_persisted_theme, load_theme, set_theme, MENU_ID_THEME_DARK,
        MENU_ID_THEME_LIGHT, MENU_ID_THEME_SYSTEM,
    },
    webview::{
        batch_update_page_webview_bounds, batch_update_webview_positions,
        capture_webview_screenshot, create_page_webview, delete_screenshot,
        get_existing_screenshot_paths, get_navigation_state_page_webview, go_back_page_webview,
        go_forward_page_webview, reload_page_webview, save_webview_screenshot,
        set_page_webview_opacity, update_page_webview_bounds,
    },
};

use tauri::{
    menu::{
        CheckMenuItem, Menu, MenuItemBuilder, MenuItemKind, PredefinedMenuItem, Submenu,
        SubmenuBuilder,
    },
    Emitter, Manager, RunEvent,
};

const EVENT_EDIT_COMMAND: &str = "edit-command";
const EVENT_FILE_COMMAND: &str = "file-command";
const EVENT_VIEW_COMMAND: &str = "view-command";
const EVENT_THEME_COMMAND: &str = "theme-command";
const EVENT_APP_EXIT_REQUESTED: &str = "app-exit-requested";
const MENU_ID_APP_QUIT: &str = "app.quit";
const MENU_ID_FILE_NEW_TAB: &str = "file.new-tab";
const MENU_ID_FILE_NEW_WINDOW: &str = "file.new-window";
const MENU_ID_FILE_OPEN: &str = "file.open";
const MENU_ID_FILE_SAVE: &str = "file.save";
const MENU_ID_FILE_SAVE_AS: &str = "file.save-as";
const MENU_ID_EDIT_UNDO: &str = "edit.undo";
const MENU_ID_EDIT_REDO: &str = "edit.redo";
const MENU_ID_EDIT_DELETE: &str = "edit.delete";
const MENU_ID_VIEW_FIT: &str = "view.fit";
const MENU_ID_VIEW_RESET_ZOOM: &str = "view.reset-zoom";
const MENU_ID_VIEW_ZOOM_IN: &str = "view.zoom-in";
const MENU_ID_VIEW_ZOOM_OUT: &str = "view.zoom-out";
const MENU_ID_OPEN_DEVTOOLS: &str = "develop.open-devtools";
const MENU_ID_SETTINGS: &str = "app.settings";

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

fn emit_window_command<R: tauri::Runtime>(
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

fn emit_edit_command<R: tauri::Runtime>(app: &tauri::AppHandle<R>, command: &str) {
    let _ = emit_window_command(app, EVENT_EDIT_COMMAND, command);
}

fn emit_view_command<R: tauri::Runtime>(app: &tauri::AppHandle<R>, command: &str) {
    let _ = emit_window_command(app, EVENT_VIEW_COMMAND, command);
}

fn emit_theme_command<R: tauri::Runtime>(app: &tauri::AppHandle<R>, mode: &str) {
    let _ = emit_window_command(app, EVENT_THEME_COMMAND, mode);
}

fn emit_file_command<R: tauri::Runtime>(app: &tauri::AppHandle<R>, command: &str) {
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

fn normalize_menu_text(text: &str) -> String {
    text.replace('&', "").trim().to_ascii_lowercase()
}

fn find_app_submenu<R: tauri::Runtime>(menu: &Menu<R>) -> tauri::Result<Option<Submenu<R>>> {
    for top_item in menu.items()? {
        let Some(submenu) = top_item.as_submenu() else {
            continue;
        };

        for item in submenu.items()? {
            let Some(predefined) = item.as_predefined_menuitem() else {
                continue;
            };
            let title = normalize_menu_text(&predefined.text()?);
            if title.starts_with("quit") {
                return Ok(Some(submenu.clone()));
            }
        }
    }

    Ok(None)
}

fn find_edit_submenu<R: tauri::Runtime>(menu: &Menu<R>) -> tauri::Result<Option<Submenu<R>>> {
    let top_items = menu.items()?;

    // 1) まずはサブメニュー名が Edit のものを優先する
    for top_item in &top_items {
        let Some(submenu) = top_item.as_submenu() else {
            continue;
        };
        let title = normalize_menu_text(&submenu.text()?);
        if title == "edit" {
            return Ok(Some(submenu.clone()));
        }
    }

    // 2) タイトル一致しない場合は Undo/Redo を含むサブメニューを Edit とみなす
    for top_item in &top_items {
        let Some(submenu) = top_item.as_submenu() else {
            continue;
        };

        let mut has_undo = false;
        let mut has_redo = false;
        for item in submenu.items()? {
            if let Some(predefined) = item.as_predefined_menuitem() {
                let title = normalize_menu_text(&predefined.text()?);
                if title == "undo" {
                    has_undo = true;
                } else if title == "redo" {
                    has_redo = true;
                }
            } else if let Some(normal_item) = item.as_menuitem() {
                let title = normalize_menu_text(&normal_item.text()?);
                if title == "undo" {
                    has_undo = true;
                } else if title == "redo" {
                    has_redo = true;
                }
            }
        }

        if has_undo && has_redo {
            return Ok(Some(submenu.clone()));
        }
    }

    Ok(None)
}

fn remove_submenu_item_by_id<R: tauri::Runtime>(
    submenu: &Submenu<R>,
    id: &str,
) -> tauri::Result<()> {
    let Some(item) = submenu.get(id) else {
        return Ok(());
    };

    if let Some(menu_item) = item.as_menuitem() {
        submenu.remove(menu_item)?;
    } else if let Some(predefined) = item.as_predefined_menuitem() {
        submenu.remove(predefined)?;
    } else if let Some(check) = item.as_check_menuitem() {
        submenu.remove(check)?;
    } else if let Some(icon) = item.as_icon_menuitem() {
        submenu.remove(icon)?;
    } else if let Some(nested_submenu) = item.as_submenu() {
        submenu.remove(nested_submenu)?;
    }

    Ok(())
}

fn remove_default_undo_redo<R: tauri::Runtime>(submenu: &Submenu<R>) -> tauri::Result<()> {
    for item in submenu.items()? {
        let Some(predefined) = item.as_predefined_menuitem() else {
            continue;
        };
        let title = normalize_menu_text(&predefined.text()?);
        if title == "undo" || title == "redo" {
            submenu.remove(predefined)?;
        }
    }

    Ok(())
}

fn remove_default_quit<R: tauri::Runtime>(submenu: &Submenu<R>) -> tauri::Result<()> {
    for item in submenu.items()? {
        let Some(predefined) = item.as_predefined_menuitem() else {
            continue;
        };
        let title = normalize_menu_text(&predefined.text()?);
        if title.starts_with("quit") {
            submenu.remove(predefined)?;
            break;
        }
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn replace_default_about_and_hide<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    submenu: &Submenu<R>,
    product_name: &str,
) -> tauri::Result<()> {
    // PredefinedMenuItem の About / Hide は package_info().name を参照するため、
    // lower-case の crate 名がそのまま「About siteboard」「Hide siteboard」と出てしまう。
    // 既存項目を index 位置で差し替え、productName に揃えたラベルを明示する。
    let items = submenu.items()?;
    let mut about_index = None;
    let mut hide_index = None;
    for (index, item) in items.iter().enumerate() {
        let Some(predefined) = item.as_predefined_menuitem() else {
            continue;
        };
        let title = normalize_menu_text(&predefined.text()?);
        if title.starts_with("about") && about_index.is_none() {
            about_index = Some(index);
        } else if title.starts_with("hide") && !title.contains("others") && hide_index.is_none() {
            hide_index = Some(index);
        }
    }

    if let Some(index) = about_index {
        if let Some(item) = submenu.items()?.get(index) {
            if let Some(predefined) = item.as_predefined_menuitem() {
                submenu.remove(predefined)?;
            }
        }
        let about_item = PredefinedMenuItem::about(app, Some(&format!("About {product_name}")), None)?;
        submenu.insert(&about_item, index)?;
    }

    if let Some(index) = hide_index {
        if let Some(item) = submenu.items()?.get(index) {
            if let Some(predefined) = item.as_predefined_menuitem() {
                submenu.remove(predefined)?;
            }
        }
        let hide_item = PredefinedMenuItem::hide(app, Some(&format!("Hide {product_name}")))?;
        submenu.insert(&hide_item, index)?;
    }

    Ok(())
}

fn configure_app_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    menu: &Menu<R>,
) -> tauri::Result<()> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, menu);
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let Some(app_submenu) = find_app_submenu(menu)? else {
            log::warn!("default App menu not found; skipping Quit replacement");
            return Ok(());
        };

        let app_name = app
            .config()
            .product_name
            .clone()
            .unwrap_or_else(|| app.package_info().name.clone());

        replace_default_about_and_hide(app, &app_submenu, &app_name)?;

        remove_submenu_item_by_id(&app_submenu, MENU_ID_APP_QUIT)?;
        remove_default_quit(&app_submenu)?;
        remove_submenu_item_by_id(&app_submenu, MENU_ID_SETTINGS)?;

        let quit_item = MenuItemBuilder::with_id(MENU_ID_APP_QUIT, format!("Quit {app_name}"))
            .accelerator("CmdOrCtrl+Q")
            .build(app)?;
        app_submenu.append(&quit_item)?;

        insert_settings_submenu(app, &app_submenu)?;

        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn insert_settings_submenu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    app_submenu: &Submenu<R>,
) -> tauri::Result<()> {
    // メニュー構築時点ではまだ tauri_plugin_store の State が manage されていないため、
    // 初期チェックは全て off とし、setup フェーズで `update_theme_check_state` を呼んで反映する。
    // セクションタイトル「Theme」は muda 経由では section header スタイルが使えないため、
    // setup 後に `apply_settings_theme_section_header` で NSMenuItem.sectionHeaderWithTitle: を挿入する
    let system_item =
        CheckMenuItem::with_id(app, MENU_ID_THEME_SYSTEM, "System", true, false, None::<&str>)?;
    let light_item =
        CheckMenuItem::with_id(app, MENU_ID_THEME_LIGHT, "Light", true, false, None::<&str>)?;
    let dark_item =
        CheckMenuItem::with_id(app, MENU_ID_THEME_DARK, "Dark", true, false, None::<&str>)?;

    let settings_submenu = SubmenuBuilder::with_id(app, MENU_ID_SETTINGS, "Settings")
        .item(&system_item)
        .item(&light_item)
        .item(&dark_item)
        .build()?;

    // App メニュー既定構成 [0] About, [1] separator, [2] Services, ...
    // の About と Services の間に Settings サブメニュー + separator を差し込む
    let separator = PredefinedMenuItem::separator(app)?;
    app_submenu.insert(&settings_submenu, 2)?;
    app_submenu.insert(&separator, 3)?;

    Ok(())
}

/// macOS 14+ の NSMenuItem.sectionHeaderWithTitle: を使い、Settings サブメニュー先頭に
/// 「Theme」セクションタイトルを挿入する。setup 後（NSApp.mainMenu が利用可能な状態）に呼ぶ。
#[cfg(target_os = "macos")]
fn apply_settings_theme_section_header() -> Result<(), String> {
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSString;

    unsafe {
        let ns_app_class =
            AnyClass::get(c"NSApplication").ok_or("NSApplication class not found")?;
        let ns_app: *mut AnyObject = objc2::msg_send![ns_app_class, sharedApplication];
        if ns_app.is_null() {
            return Err("NSApplication.sharedApplication is null".to_string());
        }

        let main_menu: *mut AnyObject = objc2::msg_send![ns_app, mainMenu];
        if main_menu.is_null() {
            return Err("NSApplication.mainMenu is null".to_string());
        }

        // mainMenu の index 0 がアプリ submenu（Siteboard）
        let app_item: *mut AnyObject = objc2::msg_send![main_menu, itemAtIndex: 0isize];
        if app_item.is_null() {
            return Err("App submenu item not found".to_string());
        }
        let app_submenu: *mut AnyObject = objc2::msg_send![app_item, submenu];
        if app_submenu.is_null() {
            return Err("App submenu is null".to_string());
        }

        // タイトル一致で Settings 項目を探す
        let settings_title = NSString::from_str("Settings");
        let settings_item: *mut AnyObject =
            objc2::msg_send![app_submenu, itemWithTitle: &*settings_title];
        if settings_item.is_null() {
            return Err("Settings menu item not found".to_string());
        }
        let settings_submenu: *mut AnyObject = objc2::msg_send![settings_item, submenu];
        if settings_submenu.is_null() {
            return Err("Settings submenu is null".to_string());
        }

        // 既に section header を挿入済みなら何もしない（idempotency）
        let first_item: *mut AnyObject = objc2::msg_send![settings_submenu, itemAtIndex: 0isize];
        if !first_item.is_null() {
            let is_section_header: bool = objc2::msg_send![first_item, isSectionHeader];
            if is_section_header {
                return Ok(());
            }
        }

        let ns_menu_item_class =
            AnyClass::get(c"NSMenuItem").ok_or("NSMenuItem class not found")?;
        let theme_title = NSString::from_str("Theme");
        let section_header: *mut AnyObject =
            objc2::msg_send![ns_menu_item_class, sectionHeaderWithTitle: &*theme_title];
        if section_header.is_null() {
            return Err("failed to create section header".to_string());
        }

        let _: () = objc2::msg_send![settings_submenu, insertItem: section_header, atIndex: 0isize];
    }

    Ok(())
}

/// menu hierarchy を再帰的に辿って、指定 id の CheckMenuItem を探す。
fn find_check_menu_item<R: tauri::Runtime>(
    menu: &Menu<R>,
    id: &str,
) -> Option<CheckMenuItem<R>> {
    find_check_in_items(&menu.items().ok()?, id)
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
            if let Ok(sub_items) = submenu.items() {
                if let Some(found) = find_check_in_items(&sub_items, id) {
                    return Some(found);
                }
            }
        }
    }
    None
}

fn update_theme_check_state<R: tauri::Runtime>(app: &tauri::AppHandle<R>, selected_mode: &str) {
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

fn configure_file_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    menu: &Menu<R>,
) -> tauri::Result<()> {
    let file_submenu = if let Some(existing) = menu
        .items()?
        .into_iter()
        .filter_map(|item| item.as_submenu().cloned())
        .find(|submenu| normalize_menu_text(&submenu.text().unwrap_or_default()) == "file")
    {
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

fn configure_edit_menu<R: tauri::Runtime>(
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

fn configure_view_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    menu: &Menu<R>,
) -> tauri::Result<()> {
    let view_submenu = if let Some(existing) = menu
        .items()?
        .into_iter()
        .filter_map(|item| item.as_submenu().cloned())
        .find(|s| normalize_menu_text(&s.text().unwrap_or_default()) == "view")
    {
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

fn emit_app_exit_requested<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_prevent_default::Flags;

    let builder = tauri::Builder::default()
        .manage(DocumentManagerState::default())
        .manage(AppExitCoordinatorState::default())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Err(error) = handle_launch_args(app, &argv, Some(cwd.as_str())) {
                log::error!("failed to handle single-instance launch request: {error}");
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_prevent_default::Builder::new()
                .with_flags(Flags::CONTEXT_MENU)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .menu(|app| {
            let menu = Menu::default(app)?;
            configure_app_menu(app, &menu)?;
            configure_file_menu(app, &menu)?;
            configure_edit_menu(app, &menu)?;
            configure_view_menu(app, &menu)?;

            #[cfg(debug_assertions)]
            {
                let devtools_item =
                    MenuItemBuilder::with_id(MENU_ID_OPEN_DEVTOOLS, "Open DevTools").build(app)?;
                let develop_menu = SubmenuBuilder::with_id(app, "develop", "Develop")
                    .item(&devtools_item)
                    .build()?;
                menu.append(&develop_menu)?;
            }

            Ok(menu)
        });

    let app = builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            if let Err(error) = configure_macos_window_tabbing_policy(&app.handle()) {
                log::error!("failed to initialize macOS native tab: {error}");
            }
            // tauri_plugin_store の State がここで初期化済みなので、
            // 永続化済みテーマで Settings > Theme の初期チェック状態を反映する
            let initial_theme = load_persisted_theme(&app.handle());
            update_theme_check_state(&app.handle(), &initial_theme);

            #[cfg(target_os = "macos")]
            if let Err(error) = apply_settings_theme_section_header() {
                log::warn!("failed to insert Theme section header in Settings: {error}");
            }

            let launch_args: Vec<String> = std::env::args().collect();
            if let Err(error) = handle_launch_args(&app.handle(), &launch_args, None) {
                log::error!("failed to create initial window: {error}");
            }
            app.on_menu_event(|app, event| match event.id().as_ref() {
                MENU_ID_APP_QUIT => emit_app_exit_requested(app),
                MENU_ID_FILE_NEW_TAB => emit_file_command(app, "new-tab"),
                MENU_ID_FILE_NEW_WINDOW => emit_file_command(app, "new-window"),
                MENU_ID_FILE_OPEN => emit_file_command(app, "open"),
                MENU_ID_FILE_SAVE => emit_file_command(app, "save"),
                MENU_ID_FILE_SAVE_AS => emit_file_command(app, "save-as"),
                MENU_ID_EDIT_UNDO => emit_edit_command(app, "undo"),
                MENU_ID_EDIT_REDO => emit_edit_command(app, "redo"),
                MENU_ID_EDIT_DELETE => emit_edit_command(app, "delete"),
                MENU_ID_VIEW_FIT => emit_view_command(app, "fit-view"),
                MENU_ID_VIEW_RESET_ZOOM => emit_view_command(app, "reset-zoom"),
                MENU_ID_VIEW_ZOOM_IN => emit_view_command(app, "zoom-in"),
                MENU_ID_VIEW_ZOOM_OUT => emit_view_command(app, "zoom-out"),
                MENU_ID_THEME_LIGHT => {
                    update_theme_check_state(app, "light");
                    emit_theme_command(app, "light");
                }
                MENU_ID_THEME_DARK => {
                    update_theme_check_state(app, "dark");
                    emit_theme_command(app, "dark");
                }
                MENU_ID_THEME_SYSTEM => {
                    update_theme_check_state(app, "system");
                    emit_theme_command(app, "system");
                }
                MENU_ID_OPEN_DEVTOOLS =>
                {
                    #[cfg(debug_assertions)]
                    if let Some(label) = focused_document_window_label(app) {
                        if let Some(window) = app.get_webview_window(&label) {
                            let _ = focus_document_window(app, &label);
                            window.open_devtools();
                        }
                    } else if let Some(label) =
                        app.windows()
                            .into_iter()
                            .find_map(|(label, _)| label.starts_with("document-").then_some(label))
                    {
                        if let Some(window) = app.get_webview_window(&label) {
                            window.open_devtools();
                        }
                    }
                }
                _ => {}
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_window_context,
            attach_pending_document_tab,
            new_document_tab,
            new_document_window,
            open_document_window,
            complete_app_exit,
            abort_app_exit,
            close_ready,
            load_project_file,
            save_project_file,
            load_theme,
            set_theme,
            get_platform_info,
            create_page_webview,
            capture_webview_screenshot,
            reload_page_webview,
            go_back_page_webview,
            go_forward_page_webview,
            get_navigation_state_page_webview,
            update_page_webview_bounds,
            set_page_webview_opacity,
            batch_update_page_webview_bounds,
            batch_update_webview_positions,
            save_webview_screenshot,
            get_existing_screenshot_paths,
            delete_screenshot,
            show_unsaved_changes_dialog,
        ])
        .build(tauri::generate_context!())
        .expect("an error occurred while running the Tauri app");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::ExitRequested { api, .. } = event {
            let exit_state = app_handle.state::<AppExitCoordinatorState>();
            match exit_state.consume_allow_exit() {
                Ok(true) => {}
                Ok(false) => match exit_state.has_pending_quit() {
                    Ok(true) => api.prevent_exit(),
                    Ok(false) => {}
                    Err(error) => {
                        log::error!("failed to handle ExitRequested: {error}");
                        api.prevent_exit();
                    }
                },
                Err(error) => {
                    log::error!("failed to handle ExitRequested: {error}");
                    api.prevent_exit();
                }
            }
        }
    });
}
