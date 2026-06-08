use tauri::menu::{PredefinedMenuItem, Submenu};

use super::helpers::normalize_menu_text;

pub fn replace_default_about_and_hide<R: tauri::Runtime>(
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
        let about_item =
            PredefinedMenuItem::about(app, Some(&format!("About {product_name}")), None)?;
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

/// macOS 14+ の NSMenuItem.sectionHeaderWithTitle: を使い、Settings サブメニュー先頭に
/// 「Theme」セクションタイトルを挿入する。setup 後（NSApp.mainMenu が利用可能な状態）に呼ぶ。
pub fn apply_settings_theme_section_header() -> Result<(), String> {
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
