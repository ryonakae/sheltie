use std::{
    collections::{HashMap, HashSet},
    ffi::OsStr,
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::{
    AppHandle, LogicalPosition, Manager, State, TitleBarStyle, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

const DEFAULT_WINDOW_WIDTH: f64 = 1200.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 800.0;
const DOCUMENT_WINDOW_LABEL_PREFIX: &str = "document-";
const DOCUMENT_WINDOW_TABBING_IDENTIFIER: &str = "siteboard-document";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowContext {
    pub file_path: Option<String>,
    pub untitled_index: usize,
}

#[derive(Default)]
pub struct DocumentManagerState {
    inner: Mutex<DocumentManager>,
}

#[derive(Default)]
struct DocumentManager {
    next_window_index: usize,
    next_untitled_index: usize,
    windows: HashMap<String, WindowRecord>,
    file_windows: HashMap<PathBuf, String>,
}

#[derive(Clone)]
struct WindowRecord {
    file_path: Option<PathBuf>,
    untitled_index: usize,
}

impl WindowRecord {
    fn to_context(&self) -> WindowContext {
        WindowContext {
            file_path: self
                .file_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            untitled_index: self.untitled_index,
        }
    }
}

impl DocumentManagerState {
    fn reserve_window(&self, file_path: Option<PathBuf>) -> Result<(String, WindowRecord), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "document state のロック取得に失敗しました".to_string())?;

        if let Some(existing) = file_path
            .as_ref()
            .and_then(|path| inner.file_windows.get(path).cloned())
        {
            return Err(format!(
                "このファイルは既に別ウィンドウで開かれています: {existing}"
            ));
        }

        inner.next_window_index += 1;
        let label = format!("{DOCUMENT_WINDOW_LABEL_PREFIX}{}", inner.next_window_index);
        let untitled_index = if file_path.is_some() {
            inner.next_untitled_index.max(1)
        } else {
            inner.next_untitled_index += 1;
            inner.next_untitled_index
        };

        let record = WindowRecord {
            file_path: file_path.clone(),
            untitled_index,
        };

        if let Some(path) = file_path {
            inner.file_windows.insert(path, label.clone());
        }
        inner.windows.insert(label.clone(), record.clone());

        Ok((label, record))
    }

    fn rollback_window(&self, label: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(record) = inner.windows.remove(label) {
                if let Some(path) = record.file_path {
                    inner.file_windows.remove(&path);
                }
            }
        }
    }

    fn window_context(&self, label: &str) -> Result<WindowContext, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "document state のロック取得に失敗しました".to_string())?;

        inner
            .windows
            .get(label)
            .map(WindowRecord::to_context)
            .ok_or_else(|| format!("ウィンドウ '{label}' の状態が見つかりません"))
    }

    fn existing_window_label_for_path(&self, path: &Path) -> Option<String> {
        self.inner
            .lock()
            .ok()
            .and_then(|inner| inner.file_windows.get(path).cloned())
    }

    fn update_window_file_path(&self, label: &str, next_path: PathBuf) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "document state のロック取得に失敗しました".to_string())?;

        if let Some(existing_label) = inner.file_windows.get(&next_path) {
            if existing_label != label {
                return Err("そのファイルは既に別ウィンドウで開かれています".to_string());
            }
        }

        let previous_path = inner
            .windows
            .get(label)
            .ok_or_else(|| format!("ウィンドウ '{label}' の状態が見つかりません"))?
            .file_path
            .clone();

        if let Some(path) = previous_path {
            inner.file_windows.remove(&path);
        }

        let record = inner
            .windows
            .get_mut(label)
            .ok_or_else(|| format!("ウィンドウ '{label}' の状態が見つかりません"))?;
        record.file_path = Some(next_path.clone());
        inner.file_windows.insert(next_path, label.to_string());

        Ok(())
    }

    fn ensure_window_can_use_file_path(&self, label: &str, next_path: &Path) -> Result<(), String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "document state のロック取得に失敗しました".to_string())?;

        if let Some(existing_label) = inner.file_windows.get(next_path) {
            if existing_label != label {
                return Err("そのファイルは既に別ウィンドウで開かれています".to_string());
            }
        }

        Ok(())
    }

    fn unregister_window(&self, label: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(record) = inner.windows.remove(label) {
                if let Some(path) = record.file_path {
                    inner.file_windows.remove(&path);
                }
            }
        }
    }
}

fn normalize_project_file_path(path: &str, cwd: Option<&Path>) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::from(path);
    if normalized.as_os_str().is_empty() {
        return Err("空のパスは扱えません".to_string());
    }

    if normalized.is_relative() {
        let base_dir = match cwd {
            Some(path) => path.to_path_buf(),
            None => std::env::current_dir()
                .map_err(|error| format!("current_dir の取得に失敗しました: {error}"))?,
        };
        normalized = base_dir.join(normalized);
    }

    normalized.set_extension("siteboard");

    if let Some(parent) = normalized.parent() {
        if let Some(file_name) = normalized.file_name().map(|name| name.to_os_string()) {
            let resolved_parent = parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf());
            normalized = resolved_parent.join(file_name);
        }
    }

    Ok(normalized)
}

fn normalize_existing_project_file_path(path: &str, cwd: Option<&Path>) -> Result<PathBuf, String> {
    let normalized = normalize_project_file_path(path, cwd)?;
    normalized
        .canonicalize()
        .map_err(|error| format!("ファイルパスの正規化に失敗しました: {error}"))
}

fn get_window_title(record: &WindowRecord) -> String {
    if let Some(path) = &record.file_path {
        return path
            .file_stem()
            .or_else(|| path.file_name())
            .and_then(OsStr::to_str)
            .filter(|name| !name.is_empty())
            .unwrap_or("名称未設定")
            .to_string();
    }

    get_untitled_display_name(record.untitled_index)
}

fn get_untitled_display_name(index: usize) -> String {
    if index <= 1 {
        "名称未設定".to_string()
    } else {
        format!("名称未設定{index}")
    }
}

fn build_document_window<R: tauri::Runtime>(
    app: &AppHandle<R>,
    label: &str,
    title: &str,
) -> Result<WebviewWindow<R>, String> {
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title(title)
        .inner_size(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(LogicalPosition::new(8.0, 20.0))
        .tabbing_identifier(DOCUMENT_WINDOW_TABBING_IDENTIFIER);

    #[cfg(not(target_os = "macos"))]
    let builder = builder;

    builder
        .build()
        .map_err(|error| format!("document window の生成に失敗しました: {error}"))
}

fn create_document_window_internal<R: tauri::Runtime>(
    app: &AppHandle<R>,
    file_path: Option<PathBuf>,
) -> Result<String, String> {
    let manager = app.state::<DocumentManagerState>();
    let (label, record) = manager.reserve_window(file_path)?;
    let title = get_window_title(&record);

    match build_document_window(app, &label, &title) {
        Ok(window) => {
            let _ = window.set_focus();
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
        .get_webview_window(label)
        .ok_or_else(|| format!("ウィンドウ '{label}' が見つかりません"))?;

    let _ = window.unminimize();
    let _ = window.show();
    window
        .set_focus()
        .map_err(|error| format!("ウィンドウの前面化に失敗しました: {error}"))
}

fn open_or_focus_document_window_internal<R: tauri::Runtime>(
    app: &AppHandle<R>,
    path: PathBuf,
) -> Result<(), String> {
    let manager = app.state::<DocumentManagerState>();
    if let Some(label) = manager.existing_window_label_for_path(&path) {
        return focus_document_window_internal(app, &label);
    }

    create_document_window_internal(app, Some(path)).map(|_| ())
}

fn launch_paths_from_args(args: &[String], cwd: Option<&str>) -> Vec<PathBuf> {
    let cwd = cwd
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok());
    let mut seen = HashSet::new();
    let mut paths = Vec::new();

    for arg in args {
        let candidate = PathBuf::from(arg);
        let is_siteboard = candidate
            .extension()
            .and_then(OsStr::to_str)
            .map(|ext| ext.eq_ignore_ascii_case("siteboard"))
            .unwrap_or(false);
        if !is_siteboard {
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

pub fn focused_document_window_label<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<String> {
    let mut labels: Vec<String> = app
        .webview_windows()
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

    if let Some(label) = labels.pop() {
        return Some(label);
    }

    app.webview_windows()
        .into_iter()
        .find_map(|(label, _)| label.starts_with(DOCUMENT_WINDOW_LABEL_PREFIX).then_some(label))
}

pub fn create_untitled_document_window<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    create_document_window_internal(app, None).map(|_| ())
}

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
pub async fn close_ready(
    window: WebviewWindow,
    state: State<'_, DocumentManagerState>,
) -> Result<(), String> {
    state.unregister_window(window.label());
    window
        .destroy()
        .map_err(|error| format!("ウィンドウ破棄に失敗しました: {error}"))
}

#[tauri::command]
pub async fn load_project_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(Path::new(&path))
        .map_err(|error| format!("ファイル読み込みに失敗しました: {error}"))
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
            std::fs::create_dir_all(parent).map_err(|error| {
                format!("保存先ディレクトリの作成に失敗しました: {error}")
            })?;
        }
    }

    std::fs::write(&normalized_path, contents)
        .map_err(|error| format!("ファイル保存に失敗しました: {error}"))?;

    let canonical_path = normalized_path
        .canonicalize()
        .unwrap_or_else(|_| normalized_path.clone());
    state.update_window_file_path(window.label(), canonical_path.clone())?;

    Ok(canonical_path.to_string_lossy().to_string())
}
