use std::{
    collections::HashSet,
    ffi::OsStr,
    path::{Path, PathBuf},
};

use tauri::{
    AppHandle, Manager, PhysicalPosition, State, TitleBarStyle, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window,
};

use crate::app_exit::AppExitCoordinatorState;

use super::document_manager::{
    DocumentManagerState, DocumentWindowDisposition, WindowContext, WindowRecord,
    DOCUMENT_WINDOW_LABEL_PREFIX,
};
use super::file_io::normalize_existing_project_file_path;
use super::macos_tabs::configure_macos_document_window;

const DEFAULT_WINDOW_WIDTH: f64 = 1200.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 800.0;
/// macOS 標準の cascade と同程度のずらし幅（logical pt）
const WINDOW_CASCADE_OFFSET: f64 = 24.0;

pub(super) fn get_window_title(record: &WindowRecord) -> String {
    if let Some(path) = &record.file_path {
        return get_file_display_name(path);
    }

    get_untitled_display_name(record.untitled_index)
}

pub(super) fn get_file_display_name(path: &Path) -> String {
    path.file_stem()
        .or_else(|| path.file_name())
        .and_then(OsStr::to_str)
        .filter(|name| !name.is_empty())
        .unwrap_or("Untitled")
        .to_string()
}

fn get_untitled_display_name(index: usize) -> String {
    if index <= 1 {
        "Untitled".to_string()
    } else {
        format!("Untitled {index}")
    }
}

pub(super) fn build_document_window<R: tauri::Runtime>(
    app: &AppHandle<R>,
    label: &str,
    title: &str,
    tabbing_identifier: &str,
) -> Result<WebviewWindow<R>, String> {
    // 描画前のちらつきを避けるため常に visible(false) で作成し、
    // renderer 側が ready になったタイミングで present_document_window から表示する
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title(title)
        .inner_size(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
        .visible(false);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(TitleBarStyle::Visible)
        .tabbing_identifier(tabbing_identifier);

    #[cfg(not(target_os = "macos"))]
    let builder = {
        let _ = tabbing_identifier;
        builder
    };

    builder
        .build()
        .map_err(|error| format!("failed to create document window: {error}"))
}

/// 新しい document window の初期位置を決める。位置指定なしで生成すると
/// すべての window が同じ既定位置に重なってしまうため、表示前に必ず配置する。
/// 失敗しても OS 既定の位置で表示できるので、エラーは無視して続行する
fn place_document_window<R: tauri::Runtime>(
    app: &AppHandle<R>,
    label: &str,
    inherit_frame_from: Option<&str>,
) {
    let Some(window) = app.get_window(label) else {
        return;
    };

    let reference_label = inherit_frame_from.map(str::to_string).or_else(|| {
        app.state::<DocumentManagerState>()
            .latest_document_window_label(label)
    });
    let Some(reference) = reference_label.and_then(|label| app.get_window(&label)) else {
        return;
    };
    let Ok(position) = reference.outer_position() else {
        return;
    };

    // 置き換えでは対象と同じ frame を継承し、その window が document に
    // 変わったように見せる
    if inherit_frame_from.is_some() {
        if let Ok(size) = reference.inner_size() {
            let _ = window.set_size(size);
        }
        let _ = window.set_position(position);
        return;
    }

    // 残る window とは完全に重ならないよう、macOS 標準の cascade に倣ってずらす
    let offset = (WINDOW_CASCADE_OFFSET * reference.scale_factor().unwrap_or(1.0)).round() as i32;
    let _ = window.set_position(PhysicalPosition::new(
        position.x + offset,
        position.y + offset,
    ));
}

fn create_document_window_internal<R: tauri::Runtime>(
    app: &AppHandle<R>,
    file_path: Option<PathBuf>,
    transient: bool,
    inherit_frame_from: Option<&str>,
) -> Result<String, String> {
    let manager = app.state::<DocumentManagerState>();
    let disposition = DocumentWindowDisposition::Standalone;
    let (label, record) = manager.reserve_window(file_path, &disposition, transient)?;
    let title = get_window_title(&record);

    match build_document_window(app, &label, &title, &record.tabbing_identifier) {
        Ok(window) => {
            if let Err(error) = configure_macos_document_window(app, &label) {
                let _ = window.destroy();
                manager.rollback_window(&label);
                return Err(error);
            }

            place_document_window(app, &label, inherit_frame_from);
            Ok(label)
        }
        Err(error) => {
            manager.rollback_window(&label);
            Err(error)
        }
    }
}

fn focus_document_window_internal<R: tauri::Runtime>(
    app: &AppHandle<R>,
    label: &str,
) -> Result<(), String> {
    let window = app
        .get_window(label)
        .ok_or_else(|| format!("window '{label}' not found"))?;

    let _ = window.unminimize();
    let _ = window.show();
    window
        .set_focus()
        .map_err(|error| format!("failed to bring the window to front: {error}"))
}

fn open_or_focus_document_window_internal<R: tauri::Runtime>(
    app: &AppHandle<R>,
    path: PathBuf,
) -> Result<(), String> {
    let manager = app.state::<DocumentManagerState>();
    if let Some(label) = manager.existing_window_label_for_path(&path) {
        return focus_document_window_internal(app, &label);
    }

    // 置き換え対象は window 生成前に確定させる。生成後に判定すると
    // 新しい window 自身が枚数に含まれてしまう
    let replace_target = manager.transient_window_to_replace();
    let label = create_document_window_internal(app, Some(path), false, replace_target.as_deref())?;
    if let Some(target) = replace_target {
        if let Err(error) = manager.set_pending_replacement(&label, &target) {
            log::warn!("failed to reserve transient window replacement: {error}");
        }
    }

    Ok(())
}

fn launch_paths_from_args(args: &[String], cwd: Option<&str>) -> Vec<PathBuf> {
    let cwd = cwd
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok());
    let mut seen = HashSet::new();
    let mut paths = Vec::new();

    for arg in args {
        let candidate = PathBuf::from(arg);
        let is_sheltie = candidate
            .extension()
            .and_then(OsStr::to_str)
            .map(|ext| ext.eq_ignore_ascii_case("sheltie"))
            .unwrap_or(false);
        if !is_sheltie {
            continue;
        }

        let normalized = normalize_existing_project_file_path(arg, cwd.as_deref());
        let Ok(path) = normalized else {
            continue;
        };

        if seen.insert(path.clone()) {
            paths.push(path);
        }
    }

    paths
}

/// Finder のダブルクリック等で届く RunEvent::Opened の URL 群から
/// 開くべき .sheltie パスを抽出する。関連付け外のファイルや
/// 非 file スキームは無視する
fn sheltie_paths_from_urls(urls: &[tauri::Url]) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut paths = Vec::new();

    for url in urls {
        let Ok(candidate) = url.to_file_path() else {
            continue;
        };

        let is_sheltie = candidate
            .extension()
            .and_then(OsStr::to_str)
            .map(|ext| ext.eq_ignore_ascii_case("sheltie"))
            .unwrap_or(false);
        if !is_sheltie {
            continue;
        }

        if seen.insert(candidate.clone()) {
            paths.push(candidate);
        }
    }

    paths
}

/// macOS では Finder のダブルクリックが argv ではなく Apple Event で届くため、
/// この経路が唯一の入口になる
pub fn handle_opened_urls<R: tauri::Runtime>(app: &AppHandle<R>, urls: &[tauri::Url]) {
    for path in sheltie_paths_from_urls(urls) {
        if let Err(error) = open_or_focus_document_window(app, &path.to_string_lossy()) {
            log::error!("failed to open document from Finder: {error}");
        }
    }
}

pub fn strictly_focused_document_window_label<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Option<String> {
    // webview_windows() ではなく windows() を使う。
    // add_child() で子 Webview を追加すると webview_windows() が
    // document window を返さなくなるため。
    let mut labels: Vec<String> = app
        .windows()
        .into_iter()
        .filter_map(|(label, window)| {
            if !label.starts_with(DOCUMENT_WINDOW_LABEL_PREFIX) {
                return None;
            }

            if window.is_focused().unwrap_or(false) {
                Some(label)
            } else {
                None
            }
        })
        .collect();

    labels.pop()
}

pub fn focused_document_window_label<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<String> {
    if let Some(label) = strictly_focused_document_window_label(app) {
        return Some(label);
    }

    app.windows().into_iter().find_map(|(label, _)| {
        label
            .starts_with(DOCUMENT_WINDOW_LABEL_PREFIX)
            .then_some(label)
    })
}

pub fn create_untitled_document_window<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    create_document_window_internal(app, None, false, None).map(|_| ())
}

/// 引数なし起動・Dock reopen で自動生成される untitled 用。
/// AppKit の transient document と同様、プロジェクトを開くと置き換え対象になる
pub fn create_transient_untitled_document_window<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    create_document_window_internal(app, None, true, None).map(|_| ())
}

/// DevTools メニュー（debug ビルド限定）からのみ使う
#[cfg(debug_assertions)]
pub fn focus_document_window<R: tauri::Runtime>(
    app: &AppHandle<R>,
    label: &str,
) -> Result<(), String> {
    focus_document_window_internal(app, label)
}

pub fn open_or_focus_document_window<R: tauri::Runtime>(
    app: &AppHandle<R>,
    path: &str,
) -> Result<(), String> {
    let normalized = normalize_existing_project_file_path(path, None)?;
    open_or_focus_document_window_internal(app, normalized)
}

pub fn handle_launch_args<R: tauri::Runtime>(
    app: &AppHandle<R>,
    args: &[String],
    cwd: Option<&str>,
) -> Result<(), String> {
    let paths = launch_paths_from_args(args, cwd);
    if paths.is_empty() {
        return create_transient_untitled_document_window(app);
    }

    for path in paths {
        open_or_focus_document_window_internal(app, path)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn load_window_context(
    window: WebviewWindow,
    state: State<'_, DocumentManagerState>,
) -> Result<WindowContext, String> {
    state.window_context(window.label())
}

#[tauri::command]
pub async fn new_document_window(app: AppHandle) -> Result<(), String> {
    create_untitled_document_window(&app)
}

#[tauri::command]
pub async fn open_document_window(app: AppHandle, path: String) -> Result<(), String> {
    open_or_focus_document_window(&app, &path)
}

#[tauri::command]
pub async fn complete_app_exit(
    app: AppHandle,
    state: State<'_, DocumentManagerState>,
    exit_state: State<'_, AppExitCoordinatorState>,
    window_labels: Vec<String>,
) -> Result<(), String> {
    exit_state.allow_next_exit()?;

    let mut labels = HashSet::new();
    for label in window_labels {
        if !labels.insert(label.clone()) {
            continue;
        }

        state.unregister_window(&label);
        if let Some(window) = app.get_window(&label) {
            window
                .destroy()
                .map_err(|error| format!("failed to destroy window: {label}, {error}"))?;
        }
    }

    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn abort_app_exit(exit_state: State<'_, AppExitCoordinatorState>) -> Result<(), String> {
    exit_state.abort_pending_quit()
}

#[tauri::command]
pub async fn close_ready(
    // WebviewWindow ではなく Window を使う。
    // add_child() で子 Webview を追加すると get_webview_window() が
    // document window を返さなくなり、WebviewWindow の解決が失敗するため。
    window: Window,
    state: State<'_, DocumentManagerState>,
) -> Result<(), String> {
    state.unregister_window(window.label());
    window
        .destroy()
        .map_err(|error| format!("failed to destroy window: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Url;

    fn urls(inputs: &[&str]) -> Vec<Url> {
        inputs.iter().map(|s| Url::parse(s).unwrap()).collect()
    }

    #[test]
    fn sheltie_paths_from_urls_accepts_file_urls_with_sheltie_extension() {
        let paths = sheltie_paths_from_urls(&urls(&["file:///tmp/board.sheltie"]));
        assert_eq!(paths, vec![PathBuf::from("/tmp/board.sheltie")]);
    }

    #[test]
    fn sheltie_paths_from_urls_is_case_insensitive_for_extension() {
        let paths = sheltie_paths_from_urls(&urls(&["file:///tmp/BOARD.SHELTIE"]));
        assert_eq!(paths, vec![PathBuf::from("/tmp/BOARD.SHELTIE")]);
    }

    #[test]
    fn sheltie_paths_from_urls_rejects_non_file_schemes_and_other_extensions() {
        let paths = sheltie_paths_from_urls(&urls(&[
            "https://example.com/board.sheltie",
            "file:///tmp/notes.txt",
            "file:///tmp/no-extension",
        ]));
        assert!(paths.is_empty());
    }

    #[test]
    fn sheltie_paths_from_urls_deduplicates() {
        let paths = sheltie_paths_from_urls(&urls(&[
            "file:///tmp/board.sheltie",
            "file:///tmp/board.sheltie",
        ]));
        assert_eq!(paths.len(), 1);
    }
}
