use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::{State, Window};

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

    normalized.set_extension("sheltie");

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

/// `.sheltie` は nodes / edges の JSON のみでスクリーンショットを含まないため、
/// 1000 ノード規模でも数 MB に収まる。正当なファイルを弾かない寛容な上限を置く。
const MAX_PROJECT_FILE_BYTES: u64 = 64 * 1024 * 1024;

fn ensure_project_file_size(path: &Path, limit: u64) -> Result<(), String> {
    let metadata =
        std::fs::metadata(path).map_err(|error| format!("failed to read file: {error}"))?;
    if metadata.len() > limit {
        return Err("the file is too large to open".to_string());
    }
    Ok(())
}

/// 保存中の異常終了で元ファイルを壊さないため、同一ディレクトリの一時ファイルへ書いて
/// fsync 後に atomic rename する。rename は元ファイルのメタデータを引き継がないため、
/// 上書き時だけ permissions を明示的にコピーする（xattr / Finder タグは対象外）。
fn write_atomically(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "destination has no parent directory".to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "destination has no file name".to_string())?;
    let temp_path = parent.join(format!(".{}.tmp", file_name.to_string_lossy()));

    let existing_permissions = std::fs::metadata(path).ok().map(|meta| meta.permissions());

    {
        let mut file = std::fs::File::create(&temp_path)
            .map_err(|error| format!("failed to create a temporary file: {error}"))?;
        file.write_all(contents.as_bytes())
            .map_err(|error| format!("failed to write a temporary file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("failed to flush a temporary file: {error}"))?;
    }

    if let Some(permissions) = existing_permissions {
        std::fs::set_permissions(&temp_path, permissions)
            .map_err(|error| format!("failed to carry over file permissions: {error}"))?;
    }

    std::fs::rename(&temp_path, path).map_err(|error| {
        let _ = std::fs::remove_file(&temp_path);
        format!("failed to replace the destination file: {error}")
    })
}

#[tauri::command]
pub async fn load_project_file(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    ensure_project_file_size(path, MAX_PROJECT_FILE_BYTES)?;
    std::fs::read_to_string(path).map_err(|error| format!("failed to read file: {error}"))
}

#[tauri::command]
pub async fn save_project_file(
    window: Window,
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

    write_atomically(&normalized_path, &contents)?;

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
    fn appends_sheltie_extension_when_missing() {
        let base = temp_base();
        let result = normalize_project_file_path("my-project", Some(&base)).unwrap();
        assert_eq!(result, base.join("my-project.sheltie"));
    }

    #[test]
    fn replaces_non_sheltie_extension() {
        let base = temp_base();
        let result = normalize_project_file_path("my-project.txt", Some(&base)).unwrap();
        assert_eq!(result, base.join("my-project.sheltie"));
    }

    #[test]
    fn keeps_existing_sheltie_extension() {
        let base = temp_base();
        let result = normalize_project_file_path("my-project.sheltie", Some(&base)).unwrap();
        assert_eq!(result, base.join("my-project.sheltie"));
    }

    #[test]
    fn absolute_path_ignores_cwd() {
        let base = temp_base();
        let abs = base.join("foo");
        let result = normalize_project_file_path(abs.to_str().unwrap(), None).unwrap();
        assert_eq!(result, base.join("foo.sheltie"));
    }

    #[test]
    fn relative_path_joins_with_cwd() {
        let base = temp_base();
        // parent "sub" は存在しないので canonicalize は fallback して base/sub のまま
        let result = normalize_project_file_path("sub/project", Some(&base)).unwrap();
        assert_eq!(result, base.join("sub").join("project.sheltie"));
    }
}

#[cfg(test)]
mod atomic_write_tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sheltie-atomic-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_a_new_file_and_leaves_no_temporary_file() {
        let dir = temp_dir("new-file");
        let path = dir.join("board.sheltie");

        write_atomically(&path, "{\"schemaVersion\":2}").unwrap();

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "{\"schemaVersion\":2}"
        );
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .filter(|name| name != "board.sheltie")
            .collect();
        assert!(leftovers.is_empty(), "unexpected leftovers: {leftovers:?}");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn overwriting_preserves_the_existing_file_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = temp_dir("permissions");
        let path = dir.join("board.sheltie");
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();

        write_atomically(&path, "new").unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "permissions must survive the atomic replace");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_a_file_larger_than_the_limit() {
        let dir = temp_dir("size-limit");
        let path = dir.join("huge.sheltie");
        std::fs::write(&path, "x").unwrap();

        assert!(ensure_project_file_size(&path, 0).is_err());
        assert!(ensure_project_file_size(&path, MAX_PROJECT_FILE_BYTES).is_ok());

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
