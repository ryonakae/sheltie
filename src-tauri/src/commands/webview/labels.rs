use tauri::{AppHandle, Manager};

pub fn scoped_page_label(window_label: &str, page_id: &str) -> String {
    format!("page-{window_label}-{page_id}")
}

pub fn resolve_page_webview<R: tauri::Runtime>(
    app: &AppHandle<R>,
    current_window_label: &str,
    label: &str,
) -> Result<tauri::Webview<R>, String> {
    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("Webview '{label}' not found"))?;

    if webview.window().label() != current_window_label {
        return Err(format!(
            "Webview '{label}' does not belong to the current document window '{current_window_label}'"
        ));
    }

    Ok(webview)
}
