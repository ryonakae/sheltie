use std::path::{Component, Path, PathBuf};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Window};

use super::labels::resolve_page_webview;
use super::snapshot;

const SIDECAR_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedScreenshot {
    pub file_path: String,
    pub captured_at: String,
    pub captured_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingScreenshot {
    pub page_id: String,
    pub file_path: String,
    pub captured_at: String,
    pub captured_url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenshotSidecar {
    schema_version: u8,
    captured_at: String,
    captured_url: Option<String>,
}

fn validate_storage_id(id: &str, field: &str) -> Result<(), String> {
    let mut components = Path::new(id).components();
    if id.is_empty()
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
    {
        return Err(format!("invalid {field}"));
    }
    Ok(())
}

fn artifact_paths(screenshots_dir: &Path, page_id: &str) -> Result<(PathBuf, PathBuf), String> {
    validate_storage_id(page_id, "page_id")?;
    Ok((
        screenshots_dir.join(format!("{page_id}.png")),
        screenshots_dir.join(format!("{page_id}.json")),
    ))
}

fn write_screenshot_artifacts(
    screenshots_dir: &Path,
    page_id: &str,
    png_bytes: &[u8],
    captured_url: Option<String>,
    captured_at: String,
) -> Result<SavedScreenshot, String> {
    let (png_path, sidecar_path) = artifact_paths(screenshots_dir, page_id)?;
    std::fs::create_dir_all(screenshots_dir)
        .map_err(|error| format!("failed to create screenshot directory: {error}"))?;
    std::fs::write(&png_path, png_bytes)
        .map_err(|error| format!("failed to save screenshot: {error}"))?;

    let sidecar = ScreenshotSidecar {
        schema_version: SIDECAR_SCHEMA_VERSION,
        captured_at: captured_at.clone(),
        captured_url: captured_url.clone(),
    };
    let metadata = serde_json::to_vec(&sidecar)
        .map_err(|error| format!("failed to serialize screenshot metadata: {error}"))?;
    std::fs::write(&sidecar_path, metadata)
        .map_err(|error| format!("failed to save screenshot metadata: {error}"))?;

    Ok(SavedScreenshot {
        file_path: png_path.to_string_lossy().to_string(),
        captured_at,
        captured_url,
    })
}

fn legacy_captured_at(png_path: &Path) -> Result<String, String> {
    let modified = std::fs::metadata(png_path)
        .and_then(|metadata| metadata.modified())
        .map_err(|error| format!("failed to read screenshot modified time: {error}"))?;
    Ok(DateTime::<Utc>::from(modified).to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn read_existing_screenshot(
    screenshots_dir: &Path,
    page_id: &str,
) -> Result<Option<SavedScreenshot>, String> {
    let (png_path, sidecar_path) = artifact_paths(screenshots_dir, page_id)?;
    if !png_path.is_file() {
        return Ok(None);
    }

    let sidecar = std::fs::read(&sidecar_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ScreenshotSidecar>(&bytes).ok())
        .filter(|metadata| {
            metadata.schema_version == SIDECAR_SCHEMA_VERSION
                && DateTime::parse_from_rfc3339(&metadata.captured_at).is_ok()
        });
    let (captured_at, captured_url) = match sidecar {
        Some(metadata) => (metadata.captured_at, metadata.captured_url),
        None => (legacy_captured_at(&png_path)?, None),
    };

    Ok(Some(SavedScreenshot {
        file_path: png_path.to_string_lossy().to_string(),
        captured_at,
        captured_url,
    }))
}

fn delete_screenshot_artifacts(screenshots_dir: &Path, page_id: &str) -> Result<(), String> {
    let (png_path, sidecar_path) = artifact_paths(screenshots_dir, page_id)?;
    let mut first_error = None;
    for path in [png_path, sidecar_path] {
        if let Err(error) = std::fs::remove_file(&path) {
            if error.kind() != std::io::ErrorKind::NotFound && first_error.is_none() {
                first_error = Some(format!("failed to delete {}: {error}", path.display()));
            }
        }
    }
    first_error.map_or(Ok(()), Err)
}

fn screenshots_dir(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    validate_storage_id(project_id, "project_id")?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to obtain app_data_dir: {error}"))?;
    Ok(data_dir.join("screenshots").join(project_id))
}

/// WKWebView のスクリーンショットをキャプチャし、base64 PNG Data URL として返す。
///
/// 現在はmacOSのみサポート。WKWebViewが表示中（nativeモード）の時に呼び出すこと。
/// hide中は空白画像になる可能性がある。
#[tauri::command]
pub async fn capture_webview_screenshot(window: Window, label: String) -> Result<String, String> {
    resolve_page_webview(&window.app_handle(), window.label(), &label)?;
    snapshot::capture_webview_base64(&window.app_handle(), &label).await
}

/// WKWebViewのスクリーンショットと撮影時メタデータを保存する。
#[tauri::command]
pub async fn save_webview_screenshot(
    window: Window,
    label: String,
    page_id: String,
    project_id: String,
    captured_url: Option<String>,
    hide_after_snapshot_request: Option<bool>,
) -> Result<SavedScreenshot, String> {
    save_screenshot_impl(
        window,
        label,
        page_id,
        project_id,
        captured_url,
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
    captured_url: Option<String>,
    hide_after_snapshot_request: bool,
) -> Result<SavedScreenshot, String> {
    resolve_page_webview(&window.app_handle(), window.label(), &label)?;
    let png_bytes = snapshot::capture_webview_png_bytes_with_options(
        &window.app_handle(),
        &label,
        hide_after_snapshot_request,
    )
    .await?;
    let dir = screenshots_dir(&window.app_handle(), &project_id)?;
    let captured_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    write_screenshot_artifacts(&dir, &page_id, &png_bytes, captured_url, captured_at)
}

#[cfg(not(target_os = "macos"))]
async fn save_screenshot_impl(
    _window: Window,
    _label: String,
    _page_id: String,
    _project_id: String,
    _captured_url: Option<String>,
    _hide_after_snapshot_request: bool,
) -> Result<SavedScreenshot, String> {
    Err("this OS is not supported".to_string())
}

/// 複数ページの既存スクリーンショットと撮影時メタデータを一括取得する。
#[tauri::command]
pub async fn get_existing_screenshot_paths(
    app: AppHandle,
    project_id: String,
    page_ids: Vec<String>,
) -> Result<Vec<ExistingScreenshot>, String> {
    let dir = screenshots_dir(&app, &project_id)?;
    let mut results = Vec::new();
    for page_id in page_ids {
        if let Some(saved) = read_existing_screenshot(&dir, &page_id)? {
            results.push(ExistingScreenshot {
                page_id,
                file_path: saved.file_path,
                captured_at: saved.captured_at,
                captured_url: saved.captured_url,
            });
        }
    }
    Ok(results)
}

/// ページのPNGとsidecarを削除する。
#[tauri::command]
pub async fn delete_screenshot(
    app: AppHandle,
    page_id: String,
    project_id: String,
) -> Result<(), String> {
    let dir = screenshots_dir(&app, &project_id)?;
    delete_screenshot_artifacts(&dir, &page_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("sheltie-screenshot-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn sidecar_round_trips_exact_schema() {
        let dir = temp_dir();
        let saved = write_screenshot_artifacts(
            &dir,
            "page-1",
            b"png",
            Some("https://example.com/path".to_string()),
            "2026-07-17T12:34:56Z".to_string(),
        )
        .unwrap();

        let sidecar: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("page-1.json")).unwrap()).unwrap();
        assert_eq!(
            sidecar,
            serde_json::json!({
                "schemaVersion": 1,
                "capturedAt": "2026-07-17T12:34:56Z",
                "capturedUrl": "https://example.com/path"
            })
        );
        assert_eq!(
            saved.captured_url.as_deref(),
            Some("https://example.com/path")
        );
        assert_eq!(
            read_existing_screenshot(&dir, "page-1").unwrap(),
            Some(saved)
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn legacy_png_without_sidecar_uses_mtime_and_null_url() {
        let dir = temp_dir();
        std::fs::write(dir.join("legacy.png"), b"png").unwrap();

        let restored = read_existing_screenshot(&dir, "legacy").unwrap().unwrap();

        assert!(DateTime::parse_from_rfc3339(&restored.captured_at).is_ok());
        assert_eq!(restored.captured_url, None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn malformed_sidecar_falls_back_to_legacy_metadata() {
        let dir = temp_dir();
        std::fs::write(dir.join("broken.png"), b"png").unwrap();
        std::fs::write(dir.join("broken.json"), b"not-json").unwrap();

        let restored = read_existing_screenshot(&dir, "broken").unwrap().unwrap();

        assert!(DateTime::parse_from_rfc3339(&restored.captured_at).is_ok());
        assert_eq!(restored.captured_url, None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn delete_removes_png_and_sidecar() {
        let dir = temp_dir();
        std::fs::write(dir.join("page-1.png"), b"png").unwrap();
        std::fs::write(dir.join("page-1.json"), b"{}").unwrap();

        delete_screenshot_artifacts(&dir, "page-1").unwrap();

        assert!(!dir.join("page-1.png").exists());
        assert!(!dir.join("page-1.json").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
