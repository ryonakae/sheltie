use tauri::menu::Menu;

#[cfg(target_os = "macos")]
pub fn configure_app_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    menu: &Menu<R>,
) -> tauri::Result<()> {
    use tauri::menu::MenuItemBuilder;

    use super::helpers::{find_app_submenu, remove_default_quit, remove_submenu_item_by_id};
    use super::{MENU_ID_APP_CHECK_UPDATES, MENU_ID_APP_QUIT, MENU_ID_SETTINGS};

    let Some(app_submenu) = find_app_submenu(menu)? else {
        log::warn!("default App menu not found; skipping Quit replacement");
        return Ok(());
    };

    let app_name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| app.package_info().name.clone());

    super::macos::replace_default_about_and_hide(app, &app_submenu, &app_name)?;

    // macOS 標準の Sparkle 系アプリと同じく About 直下に置く
    let check_updates_item =
        MenuItemBuilder::with_id(MENU_ID_APP_CHECK_UPDATES, "Check for Updates…").build(app)?;
    app_submenu.insert(&check_updates_item, 1)?;

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

#[cfg(not(target_os = "macos"))]
pub fn configure_app_menu<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    _menu: &Menu<R>,
) -> tauri::Result<()> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn insert_settings_submenu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    app_submenu: &tauri::menu::Submenu<R>,
) -> tauri::Result<()> {
    use tauri::menu::{CheckMenuItem, PredefinedMenuItem, SubmenuBuilder};

    use super::mcp::{mcp_action_title, mcp_connections_title};
    use super::{MENU_ID_MCP_CONNECTIONS, MENU_ID_MCP_ENABLED, MENU_ID_SETTINGS};
    use crate::commands::theme::{MENU_ID_THEME_DARK, MENU_ID_THEME_LIGHT, MENU_ID_THEME_SYSTEM};

    // メニュー構築時点ではまだ tauri_plugin_store の State が manage されていないため、
    // Themeの初期チェックは全てoff、MCP actionはdisabled時の文言で作り、setupで復元する。
    // セクションタイトルは muda 経由では section header スタイルが使えないため、
    // setup 後に `apply_settings_section_headers` で NSMenuItem.sectionHeaderWithTitle: を挿入する
    let system_item = CheckMenuItem::with_id(
        app,
        MENU_ID_THEME_SYSTEM,
        "System",
        true,
        false,
        None::<&str>,
    )?;
    let light_item =
        CheckMenuItem::with_id(app, MENU_ID_THEME_LIGHT, "Light", true, false, None::<&str>)?;
    let dark_item =
        CheckMenuItem::with_id(app, MENU_ID_THEME_DARK, "Dark", true, false, None::<&str>)?;
    let section_separator = PredefinedMenuItem::separator(app)?;
    let mcp_enabled_item = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_MCP_ENABLED,
        mcp_action_title(false),
        cfg!(target_os = "macos"),
        None::<&str>,
    )?;
    let mcp_connections_item = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_MCP_CONNECTIONS,
        mcp_connections_title(0),
        false,
        None::<&str>,
    )?;

    let settings_submenu = SubmenuBuilder::with_id(app, MENU_ID_SETTINGS, "Settings")
        .item(&system_item)
        .item(&light_item)
        .item(&dark_item)
        .item(&section_separator)
        .item(&mcp_enabled_item)
        .item(&mcp_connections_item)
        .build()?;

    // App メニュー構成 [0] About, [1] Check for Updates…, [2] separator, [3] Services, ...
    // の Check for Updates… と Services の間に Settings サブメニュー + separator を差し込む
    let separator = PredefinedMenuItem::separator(app)?;
    app_submenu.insert(&settings_submenu, 3)?;
    app_submenu.insert(&separator, 4)?;

    Ok(())
}
