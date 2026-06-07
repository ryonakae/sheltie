use std::path::{Path, PathBuf};

use tauri::{State, WebviewWindow};

use super::document_manager::DocumentManagerState;
use super::document_window::get_file_display_name;

pub(super) fn normalize_project_file_path(
    path: &str,
    cwd: Option<&Path>,
) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::from(path);
    if normalized.as_os_str().is_empty() {
        return Err("empty paths are not supported".to_string());
    }

    if normalized.is_relative() {
        let base_dir = match cwd {
            Some(path) => path.to_path_buf(),
            None => std::env::current_dir()
                .map_err(|error| format!("failed to obtain current_dir: {error}"))?,
        };
        normalized = base_dir.join(normalized);
    }

    normalized.set_extension("siteboard");

    if let Some(parent) = normalized.parent() {
        if let Some(file_name) = normalized.file_name().map(|name| name.to_os_string()) {
            let resolved_parent = parent
                .canonicalize()
                .unwrap_or_else(|_| parent.to_path_buf());
            normalized = resolved_parent.join(file_name);
        }
    }

    Ok(normalized)
}

pub(super) fn normalize_existing_project_file_path(
    path: &str,
    cwd: Option<&Path>,
) -> Result<PathBuf, String> {
    let normalized = normalize_project_file_path(path, cwd)?;
    normalized
        .canonicalize()
        .map_err(|error| format!("failed to normalize file path: {error}"))
}

#[tauri::command]
pub async fn load_project_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(Path::new(&path))
        .map_err(|error| format!("failed to read file: {error}"))
}

#[tauri::command]
pub async fn save_project_file(
    window: WebviewWindow,
    state: State<'_, DocumentManagerState>,
    path: String,
    contents: String,
) -> Result<String, String> {
    let normalized_path = normalize_project_file_path(&path, None)?;
    state.ensure_window_can_use_file_path(window.label(), &normalized_path)?;

    if let Some(parent) = normalized_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create destination directory: {error}"))?;
        }
    }

    std::fs::write(&normalized_path, contents)
        .map_err(|error| format!("failed to save file: {error}"))?;

    let canonical_path = normalized_path
        .canonicalize()
        .unwrap_or_else(|_| normalized_path.clone());
    state.update_window_file_path(window.label(), canonical_path.clone())?;
    window
        .set_title(&get_file_display_name(&canonical_path))
        .map_err(|error| format!("failed to update window title: {error}"))?;

    Ok(canonical_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_base() -> PathBuf {
        // macOS の /tmp は /private/tmp に正規化されるため、canonicalize 済みの値で固定する
        std::env::temp_dir()
            .canonicalize()
            .expect("temp_dir should canonicalize")
    }

    #[test]
    fn empty_path_returns_error() {
        assert!(normalize_project_file_path("", None).is_err());
    }

    #[test]
    fn appends_siteboard_extension_when_missing() {
        let base = temp_base();
        let result = normalize_project_file_path("my-project", Some(&base)).unwrap();
        assert_eq!(result, base.join("my-project.siteboard"));
    }

    #[test]
    fn replaces_non_siteboard_extension() {
        let base = temp_base();
        let result = normalize_project_file_path("my-project.txt", Some(&base)).unwrap();
        assert_eq!(result, base.join("my-project.siteboard"));
    }

    #[test]
    fn keeps_existing_siteboard_extension() {
        let base = temp_base();
        let result = normalize_project_file_path("my-project.siteboard", Some(&base)).unwrap();
        assert_eq!(result, base.join("my-project.siteboard"));
    }

    #[test]
    fn absolute_path_ignores_cwd() {
        let base = temp_base();
        let abs = base.join("foo");
        let result = normalize_project_file_path(abs.to_str().unwrap(), None).unwrap();
        assert_eq!(result, base.join("foo.siteboard"));
    }

    #[test]
    fn relative_path_joins_with_cwd() {
        let base = temp_base();
        // parent "sub" は存在しないので canonicalize は fallback して base/sub のまま
        let result = normalize_project_file_path("sub/project", Some(&base)).unwrap();
        assert_eq!(result, base.join("sub").join("project.siteboard"));
    }
}
