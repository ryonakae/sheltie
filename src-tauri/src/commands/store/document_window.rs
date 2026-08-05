use std::{
    collections::HashSet,
    ffi::OsStr,
    path::{Path, PathBuf},
};

use tauri::{
    AppHandle, Manager, State, TitleBarStyle, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    Window,
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

fn create_document_window_internal<R: tauri::Runtime>(
    app: &AppHandle<R>,
    file_path: Option<PathBuf>,
    transient: bool,
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

    create_document_window_internal(app, Some(path), false).map(|_| ())
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
    create_document_window_internal(app, None, false).map(|_| ())
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
        return create_untitled_document_window(app);
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
