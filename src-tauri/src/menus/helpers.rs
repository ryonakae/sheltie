use tauri::menu::{CheckMenuItem, Menu, MenuItemKind, Submenu};

pub fn normalize_menu_text(text: &str) -> String {
    text.replace('&', "").trim().to_ascii_lowercase()
}

pub fn find_app_submenu<R: tauri::Runtime>(menu: &Menu<R>) -> tauri::Result<Option<Submenu<R>>> {
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

pub fn find_edit_submenu<R: tauri::Runtime>(menu: &Menu<R>) -> tauri::Result<Option<Submenu<R>>> {
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

pub fn find_submenu_by_title<R: tauri::Runtime>(
    menu: &Menu<R>,
    title: &str,
) -> tauri::Result<Option<Submenu<R>>> {
    Ok(menu
        .items()?
        .into_iter()
        .filter_map(|item| item.as_submenu().cloned())
        .find(|submenu| normalize_menu_text(&submenu.text().unwrap_or_default()) == title))
}

pub fn remove_submenu_item_by_id<R: tauri::Runtime>(
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

/// Edit submenu の predefined item（Undo/Redo/Cut/Copy/Paste/Select All/separator）をすべて除去する。
/// custom item への置き換え前に呼び、再初期化でも重複しないようにする。
pub fn remove_default_edit_predefined_items<R: tauri::Runtime>(
    submenu: &Submenu<R>,
) -> tauri::Result<()> {
    for item in submenu.items()? {
        if let Some(predefined) = item.as_predefined_menuitem() {
            submenu.remove(predefined)?;
        }
    }
    Ok(())
}

pub fn remove_default_quit<R: tauri::Runtime>(submenu: &Submenu<R>) -> tauri::Result<()> {
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

pub fn find_check_menu_item<R: tauri::Runtime>(
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

#[cfg(test)]
mod tests {
    use super::normalize_menu_text;

    #[test]
    fn normalizes_menu_text() {
        assert_eq!(normalize_menu_text("Edit"), "edit");
        assert_eq!(normalize_menu_text("&Edit"), "edit");
        assert_eq!(normalize_menu_text("  Quit Sheltie  "), "quit sheltie");
        assert_eq!(normalize_menu_text("&Save &As..."), "save as...");
        assert_eq!(normalize_menu_text(""), "");
    }
}
