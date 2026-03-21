mod commands;

use commands::{
    store::{
        close_ready, configure_macos_window_tabbing_policy, create_untitled_document_window,
        focus_document_window, focused_document_window_label, handle_launch_args,
        load_project_file, load_window_context, new_document_tab, new_document_window,
        open_document_window, save_project_file, DocumentManagerState,
    },
    theme::{get_platform_info, load_theme, set_theme},
    webview::{
        batch_update_page_webview_bounds, batch_update_webview_positions,
        capture_webview_screenshot, create_page_webview, delete_screenshot,
        get_existing_screenshot_paths, get_navigation_state_page_webview, go_back_page_webview,
        go_forward_page_webview, reload_page_webview, save_webview_screenshot,
        set_page_webview_opacity, update_page_webview_bounds,
    },
};

use tauri::{
    menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder},
    Emitter, Manager,
};

const EVENT_EDIT_COMMAND: &str = "edit-command";
const EVENT_FILE_COMMAND: &str = "file-command";
const MENU_ID_FILE_NEW_TAB: &str = "file.new-tab";
const MENU_ID_FILE_NEW_WINDOW: &str = "file.new-window";
const MENU_ID_FILE_OPEN: &str = "file.open";
const MENU_ID_FILE_SAVE: &str = "file.save";
const MENU_ID_FILE_SAVE_AS: &str = "file.save-as";
const MENU_ID_EDIT_UNDO: &str = "edit.undo";
const MENU_ID_EDIT_REDO: &str = "edit.redo";
const MENU_ID_EDIT_DELETE: &str = "edit.delete";
const MENU_ID_OPEN_DEVTOOLS: &str = "develop.open-devtools";

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
            "window command の送信に失敗しました: label={label}, event={event_name}, command={command}, error={error}"
        );
        return false;
    }

    true
}

fn emit_edit_command<R: tauri::Runtime>(app: &tauri::AppHandle<R>, command: &str) {
    let _ = emit_window_command(app, EVENT_EDIT_COMMAND, command);
}

fn emit_file_command<R: tauri::Runtime>(app: &tauri::AppHandle<R>, command: &str) {
    if emit_window_command(app, EVENT_FILE_COMMAND, command) {
        return;
    }

    if command == "new-tab" || command == "new-window" {
        if let Err(error) = create_untitled_document_window(app) {
            log::warn!("new window の生成に失敗しました: {error}");
        }
    }
}

fn normalize_menu_text(text: &str) -> String {
    text.replace('&', "").trim().to_ascii_lowercase()
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
        log::warn!("既定の File メニューが見つからなかったため新規作成します");
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
        log::warn!("既定の Edit メニューが見つからなかったため新規作成します");
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_prevent_default::Flags;

    let builder = tauri::Builder::default()
        .manage(DocumentManagerState::default())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Err(error) = handle_launch_args(app, &argv, Some(cwd.as_str())) {
                log::error!("single-instance 起動要求の処理に失敗しました: {error}");
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
            configure_file_menu(app, &menu)?;
            configure_edit_menu(app, &menu)?;

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

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            if let Err(error) = configure_macos_window_tabbing_policy(&app.handle()) {
                log::error!("macOS native tab の初期化に失敗しました: {error}");
            }
            let launch_args: Vec<String> = std::env::args().collect();
            if let Err(error) = handle_launch_args(&app.handle(), &launch_args, None) {
                log::error!("初期 window の作成に失敗しました: {error}");
            }
            app.on_menu_event(|app, event| match event.id().as_ref() {
                MENU_ID_FILE_NEW_TAB => emit_file_command(app, "new-tab"),
                MENU_ID_FILE_NEW_WINDOW => emit_file_command(app, "new-window"),
                MENU_ID_FILE_OPEN => emit_file_command(app, "open"),
                MENU_ID_FILE_SAVE => emit_file_command(app, "save"),
                MENU_ID_FILE_SAVE_AS => emit_file_command(app, "save-as"),
                MENU_ID_EDIT_UNDO => emit_edit_command(app, "undo"),
                MENU_ID_EDIT_REDO => emit_edit_command(app, "redo"),
                MENU_ID_EDIT_DELETE => emit_edit_command(app, "delete"),
                MENU_ID_OPEN_DEVTOOLS =>
                {
                    #[cfg(debug_assertions)]
                    if let Some(label) = focused_document_window_label(app) {
                        if let Some(window) = app.get_webview_window(&label) {
                            let _ = focus_document_window(app, &label);
                            window.open_devtools();
                        }
                    } else if let Some(window) =
                        app.webview_windows()
                            .into_iter()
                            .find_map(|(label, window)| {
                                label.starts_with("document-").then_some(window)
                            })
                    {
                        window.open_devtools();
                    }
                }
                _ => {}
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_window_context,
            new_document_tab,
            new_document_window,
            open_document_window,
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
        ])
        .run(tauri::generate_context!())
        .expect("Tauri アプリの起動中にエラーが発生しました");
}
