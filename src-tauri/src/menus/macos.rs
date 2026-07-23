use tauri::menu::{PredefinedMenuItem, Submenu};

use super::helpers::normalize_menu_text;

pub fn replace_default_about_and_hide<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    submenu: &Submenu<R>,
    product_name: &str,
) -> tauri::Result<()> {
    // PredefinedMenuItem の About / Hide は package_info().name を参照するため、
    // lower-case の crate 名がそのまま「About sheltie」「Hide sheltie」と出てしまう。
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

fn settings_submenu() -> Result<*mut objc2::runtime::AnyObject, String> {
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

        let app_item: *mut AnyObject = objc2::msg_send![main_menu, itemAtIndex: 0isize];
        if app_item.is_null() {
            return Err("App submenu item not found".to_string());
        }
        let app_submenu: *mut AnyObject = objc2::msg_send![app_item, submenu];
        if app_submenu.is_null() {
            return Err("App submenu is null".to_string());
        }

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

        Ok(settings_submenu)
    }
}

#[derive(Debug, Eq, PartialEq)]
struct McpSectionLayout {
    header_index: isize,
    action_index: isize,
    connections_index: isize,
    insert_header: bool,
}

fn resolve_mcp_section_layout(
    action_index: isize,
    has_header: bool,
) -> Result<McpSectionLayout, String> {
    if action_index < 1 {
        return Err("MCP action menu item has an invalid index".to_string());
    }
    if has_header {
        Ok(McpSectionLayout {
            header_index: action_index - 1,
            action_index,
            connections_index: action_index + 1,
            insert_header: false,
        })
    } else {
        Ok(McpSectionLayout {
            header_index: action_index,
            action_index: action_index + 1,
            connections_index: action_index + 2,
            insert_header: true,
        })
    }
}

fn update_mcp_section(
    settings_submenu: *mut objc2::runtime::AnyObject,
    enabled: bool,
) -> Result<(), String> {
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSString;

    unsafe {
        let enable_title = NSString::from_str(super::mcp::mcp_action_title(false));
        let disable_title = NSString::from_str(super::mcp::mcp_action_title(true));
        let mut action_item: *mut AnyObject =
            objc2::msg_send![settings_submenu, itemWithTitle: &*enable_title];
        if action_item.is_null() {
            action_item = objc2::msg_send![settings_submenu, itemWithTitle: &*disable_title];
        }
        if action_item.is_null() {
            return Err("MCP action menu item not found".to_string());
        }

        let action_index: isize = objc2::msg_send![settings_submenu, indexOfItem: action_item];
        if action_index < 1 {
            return Err("MCP action menu item has an invalid index".to_string());
        }
        let previous_item: *mut AnyObject =
            objc2::msg_send![settings_submenu, itemAtIndex: action_index - 1];
        let has_mcp_header =
            !previous_item.is_null() && objc2::msg_send![previous_item, isSectionHeader];
        let layout = resolve_mcp_section_layout(action_index, has_mcp_header)?;
        let mcp_header = if layout.insert_header {
            let ns_menu_item_class =
                AnyClass::get(c"NSMenuItem").ok_or("NSMenuItem class not found")?;
            let title = NSString::from_str(super::mcp::mcp_section_title(enabled));
            let header: *mut AnyObject =
                objc2::msg_send![ns_menu_item_class, sectionHeaderWithTitle: &*title];
            if header.is_null() {
                return Err("failed to create MCP section header".to_string());
            }
            let _: () = objc2::msg_send![settings_submenu, insertItem: header, atIndex: layout.header_index];
            header
        } else {
            previous_item
        };

        let title = NSString::from_str(super::mcp::mcp_section_title(enabled));
        let _: () = objc2::msg_send![mcp_header, setTitle: &*title];

        let connections_item: *mut AnyObject =
            objc2::msg_send![settings_submenu, itemAtIndex: layout.connections_index];
        if connections_item.is_null() {
            return Err("MCP connections menu item not found".to_string());
        }
        let hidden = !enabled;
        let _: () = objc2::msg_send![connections_item, setHidden: hidden];
    }

    Ok(())
}

/// macOS 14+ の NSMenuItem.sectionHeaderWithTitle: を使い、Settings に
/// Theme と MCP のセクションタイトルを挿入する。
pub fn apply_settings_section_headers(mcp_enabled: bool) -> Result<(), String> {
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSString;

    let settings_submenu = settings_submenu()?;
    unsafe {
        let first_item: *mut AnyObject = objc2::msg_send![settings_submenu, itemAtIndex: 0isize];
        let has_theme_header =
            !first_item.is_null() && objc2::msg_send![first_item, isSectionHeader];
        if !has_theme_header {
            let ns_menu_item_class =
                AnyClass::get(c"NSMenuItem").ok_or("NSMenuItem class not found")?;
            let theme_title = NSString::from_str("Theme");
            let header: *mut AnyObject =
                objc2::msg_send![ns_menu_item_class, sectionHeaderWithTitle: &*theme_title];
            if header.is_null() {
                return Err("failed to create Theme section header".to_string());
            }
            let _: () = objc2::msg_send![settings_submenu, insertItem: header, atIndex: 0isize];
        }
    }

    update_mcp_section(settings_submenu, mcp_enabled)
}

pub fn update_settings_mcp_section(enabled: bool) -> Result<(), String> {
    update_mcp_section(settings_submenu()?, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_section_layout_accounts_for_header_insertion() {
        assert_eq!(
            resolve_mcp_section_layout(5, false),
            Ok(McpSectionLayout {
                header_index: 5,
                action_index: 6,
                connections_index: 7,
                insert_header: true,
            })
        );
        assert_eq!(
            resolve_mcp_section_layout(6, true),
            Ok(McpSectionLayout {
                header_index: 5,
                action_index: 6,
                connections_index: 7,
                insert_header: false,
            })
        );
    }
}
