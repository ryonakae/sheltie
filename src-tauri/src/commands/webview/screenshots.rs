use tauri::{AppHandle, Manager, Window};

use super::labels::resolve_page_webview;
use super::snapshot;

/// WKWebView のスクリーンショットをキャプチャし、base64 PNG Data URL として返す。
///
/// 現在は macOS のみサポート。WKWebView が表示中（native モード）の時に呼び出すこと。
/// hide 中は空白画像になる可能性がある。
#[tauri::command]
pub async fn capture_webview_screenshot(window: Window, label: String) -> Result<String, String> {
    resolve_page_webview(&window.app_handle(), window.label(), &label)?;
    snapshot::capture_webview_base64(&window.app_handle(), &label).await
}

/// WKWebView のスクリーンショットを PNG ファイルに保存し、ファイルパスを返す。
///
/// 保存先: app_data_dir/screenshots/{project_id}/{page_id}.png（既存ファイルは上書き）
/// macOS のみサポート。WKWebView が表示中（native モード）の時に呼び出すこと。
#[tauri::command]
pub async fn save_webview_screenshot(
    window: Window,
    label: String,
    page_id: String,
    project_id: String,
    hide_after_snapshot_request: Option<bool>,
) -> Result<String, String> {
    save_screenshot_impl(
        window,
        label,
        page_id,
        project_id,
        hide_after_snapshot_request.unwrap_or(false),
    )
    .await
}

#[cfg(target_os = "macos")]
async fn save_screenshot_impl(
    window: Window,
    label: String,
    page_id: String,
    project_id: String,
    hide_after_snapshot_request: bool,
) -> Result<String, String> {
    resolve_page_webview(&window.app_handle(), window.label(), &label)?;
    let png_bytes = snapshot::capture_webview_png_bytes_with_options(
        &window.app_handle(),
        &label,
        hide_after_snapshot_request,
    )
    .await?;

    let data_dir = window
        .app_handle()
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to obtain app_data_dir: {e}"))?;
    let screenshots_dir = data_dir.join("screenshots").join(&project_id);
    std::fs::create_dir_all(&screenshots_dir)
        .map_err(|e| format!("failed to create directory: {e}"))?;
    let file_path = screenshots_dir.join(format!("{page_id}.png"));
    std::fs::write(&file_path, &png_bytes).map_err(|e| format!("failed to save file: {e}"))?;

    Ok(file_path.to_string_lossy().to_string())
}

#[cfg(not(target_os = "macos"))]
async fn save_screenshot_impl(
    _window: Window,
    _label: String,
    _page_id: String,
    _project_id: String,
    _hide_after_snapshot_request: bool,
) -> Result<String, String> {
    Err("this OS is not supported".to_string())
}

/// 複数ページの既存スクリーンショットパスを一括取得する（起動時の復元用）。
///
/// 存在するファイルのみ `(page_id, absolute_path)` のペアで返す。
#[tauri::command]
pub async fn get_existing_screenshot_paths(
    app: AppHandle,
    project_id: String,
    page_ids: Vec<String>,
) -> Result<Vec<(String, String)>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to obtain app_data_dir: {e}"))?;
    let screenshots_dir = data_dir.join("screenshots").join(&project_id);
    let mut results = Vec::new();
    for page_id in page_ids {
        let path = screenshots_dir.join(format!("{page_id}.png"));
        if path.exists() {
            results.push((page_id, path.to_string_lossy().to_string()));
        }
    }
    Ok(results)
}

/// ページのスクリーンショットファイルを削除する（ページ削除時のクリーンアップ用）。
#[tauri::command]
pub async fn delete_screenshot(
    app: AppHandle,
    page_id: String,
    project_id: String,
) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to obtain app_data_dir: {e}"))?;
    let file_path = data_dir
        .join("screenshots")
        .join(&project_id)
        .join(format!("{page_id}.png"));
    if file_path.exists() {
        std::fs::remove_file(&file_path).map_err(|e| format!("failed to delete file: {e}"))?;
    }
    Ok(())
}
