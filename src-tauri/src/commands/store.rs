use std::{
    collections::{HashMap, HashSet},
    ffi::OsStr,
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::{
    AppHandle, Manager, Runtime, State, TitleBarStyle, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window,
};

#[cfg(target_os = "macos")]
use objc2::runtime::{AnyClass, AnyObject};

const DEFAULT_WINDOW_WIDTH: f64 = 1200.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 800.0;
const DOCUMENT_WINDOW_LABEL_PREFIX: &str = "document-";
const DOCUMENT_WINDOW_TABBING_IDENTIFIER: &str = "siteboard-document";

#[cfg(target_os = "macos")]
const NS_WINDOW_TITLE_VISIBILITY_VISIBLE: isize = 0;
#[cfg(target_os = "macos")]
const NS_WINDOW_ORDER_ABOVE: isize = 1;

#[derive(Clone)]
enum DocumentWindowDisposition {
    Standalone,
    TabInGroup { host_label: String },
}

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
    tabbing_identifier: String,
    pending_tab_host_label: Option<String>,
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
    fn reserve_window(
        &self,
        file_path: Option<PathBuf>,
        disposition: &DocumentWindowDisposition,
    ) -> Result<(String, WindowRecord), String> {
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
        let tabbing_identifier = match disposition {
            DocumentWindowDisposition::Standalone => {
                format!("{DOCUMENT_WINDOW_TABBING_IDENTIFIER}-{label}")
            }
            DocumentWindowDisposition::TabInGroup { host_label } => inner
                .windows
                .get(host_label)
                .map(|record| record.tabbing_identifier.clone())
                .ok_or_else(|| format!("ホストウィンドウ '{host_label}' の状態が見つかりません"))?,
        };
        let untitled_index = if file_path.is_some() {
            inner.next_untitled_index.max(1)
        } else {
            inner.next_untitled_index += 1;
            inner.next_untitled_index
        };

        let record = WindowRecord {
            file_path: file_path.clone(),
            untitled_index,
            tabbing_identifier,
            pending_tab_host_label: match disposition {
                DocumentWindowDisposition::Standalone => None,
                DocumentWindowDisposition::TabInGroup { host_label } => Some(host_label.clone()),
            },
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

    fn take_pending_tab_attachment(&self, label: &str) -> Result<Option<(String, String)>, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "document state のロック取得に失敗しました".to_string())?;

        let record = inner
            .windows
            .get_mut(label)
            .ok_or_else(|| format!("ウィンドウ '{label}' の状態が見つかりません"))?;
        let tabbing_identifier = record.tabbing_identifier.clone();
        let host_label = record.pending_tab_host_label.take();

        Ok(host_label.map(|host_label| (host_label, tabbing_identifier)))
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
            let resolved_parent = parent
                .canonicalize()
                .unwrap_or_else(|_| parent.to_path_buf());
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
        return get_file_display_name(path);
    }

    get_untitled_display_name(record.untitled_index)
}

fn get_file_display_name(path: &Path) -> String {
    path.file_stem()
        .or_else(|| path.file_name())
        .and_then(OsStr::to_str)
        .filter(|name| !name.is_empty())
        .unwrap_or("名称未設定")
        .to_string()
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
    tabbing_identifier: &str,
    disposition: &DocumentWindowDisposition,
) -> Result<WebviewWindow<R>, String> {
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title(title)
        .inner_size(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT);

    #[cfg(target_os = "macos")]
    let builder = {
        let builder = if matches!(disposition, DocumentWindowDisposition::TabInGroup { .. }) {
            builder.visible(false)
        } else {
            builder
        };

        builder
            .title_bar_style(TitleBarStyle::Visible)
            .tabbing_identifier(tabbing_identifier)
    };

    #[cfg(not(target_os = "macos"))]
    let builder = builder;

    builder
        .build()
        .map_err(|error| format!("document window の生成に失敗しました: {error}"))
}

#[cfg(target_os = "macos")]
fn run_on_app_main_thread<R, T, F>(app: &AppHandle<R>, operation: F) -> Result<T, String>
where
    R: Runtime,
    T: Send + 'static,
    F: FnOnce(AppHandle<R>) -> Result<T, String> + Send + 'static,
{
    let app_handle = app.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = operation(app_handle);
        let _ = sender.send(result);
    })
    .map_err(|error| format!("main thread への切り替えに失敗しました: {error}"))?;

    receiver
        .recv()
        .map_err(|_| "main thread の結果受信に失敗しました".to_string())?
}

#[cfg(target_os = "macos")]
fn ns_window_class() -> Result<&'static AnyClass, String> {
    AnyClass::get(c"NSWindow").ok_or("NSWindow クラスが見つかりません".to_string())
}

#[cfg(target_os = "macos")]
fn get_ns_window_object<R: Runtime>(window: &WebviewWindow<R>) -> Result<*mut AnyObject, String> {
    let raw = window
        .ns_window()
        .map_err(|error| format!("NSWindow の取得に失敗しました: {error}"))?;
    let ns_window = raw.cast::<AnyObject>();
    if ns_window.is_null() {
        return Err("NSWindow が null です".to_string());
    }
    Ok(ns_window)
}

#[cfg(target_os = "macos")]
fn configure_ns_document_window(ns_window: *mut AnyObject) {
    unsafe {
        let _: () = objc2::msg_send![
            ns_window,
            setTitleVisibility: NS_WINDOW_TITLE_VISIBILITY_VISIBLE
        ];
    }
}

#[cfg(target_os = "macos")]
fn focus_ns_window(ns_window: *mut AnyObject) {
    unsafe {
        let nil_sender: *mut AnyObject = std::ptr::null_mut();
        let _: () = objc2::msg_send![ns_window, makeKeyAndOrderFront: nil_sender];
    }
}

#[cfg(target_os = "macos")]
pub fn configure_macos_window_tabbing_policy<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    run_on_app_main_thread(app, |_| {
        let ns_window_class = ns_window_class()?;
        unsafe {
            let _: () = objc2::msg_send![ns_window_class, setAllowsAutomaticWindowTabbing: false];
        }
        Ok(())
    })
}

#[cfg(not(target_os = "macos"))]
pub fn configure_macos_window_tabbing_policy<R: Runtime>(_: &AppHandle<R>) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn configure_macos_document_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
) -> Result<(), String> {
    let label = label.to_string();

    run_on_app_main_thread(app, move |app| {
        let window = app
            .get_webview_window(&label)
            .ok_or_else(|| format!("ウィンドウ '{label}' が見つかりません"))?;
        let ns_window = get_ns_window_object(&window)?;
        configure_ns_document_window(ns_window);
        Ok(())
    })
}

#[cfg(not(target_os = "macos"))]
fn configure_macos_document_window<R: Runtime>(
    _: &AppHandle<R>,
    _: &str,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn present_document_window_after_creation<R: Runtime>(
    window: &WebviewWindow<R>,
    disposition: &DocumentWindowDisposition,
) {
    if matches!(disposition, DocumentWindowDisposition::Standalone) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(not(target_os = "macos"))]
fn present_document_window_after_creation<R: Runtime>(
    window: &WebviewWindow<R>,
    _: &DocumentWindowDisposition,
) {
    let _ = window.show();
    let _ = window.set_focus();
}

fn create_document_window_internal<R: tauri::Runtime>(
    app: &AppHandle<R>,
    file_path: Option<PathBuf>,
) -> Result<String, String> {
    let manager = app.state::<DocumentManagerState>();
    let disposition = DocumentWindowDisposition::Standalone;
    let (label, record) = manager.reserve_window(file_path, &disposition)?;
    let title = get_window_title(&record);

    match build_document_window(
        app,
        &label,
        &title,
        &record.tabbing_identifier,
        &disposition,
    ) {
        Ok(window) => {
            if let Err(error) = configure_macos_document_window(app, &label) {
                let _ = window.destroy();
                manager.rollback_window(&label);
                return Err(error);
            }

            present_document_window_after_creation(&window, &disposition);
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

    app.webview_windows().into_iter().find_map(|(label, _)| {
        label
            .starts_with(DOCUMENT_WINDOW_LABEL_PREFIX)
            .then_some(label)
    })
}

pub fn create_untitled_document_window<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    create_document_window_internal(app, None).map(|_| ())
}

#[cfg(target_os = "macos")]
fn create_document_tab_internal<R: Runtime>(
    app: &AppHandle<R>,
    host_label: &str,
) -> Result<String, String> {
    let disposition = DocumentWindowDisposition::TabInGroup {
        host_label: host_label.to_string(),
    };
    let manager = app.state::<DocumentManagerState>();
    let (label, record) = manager.reserve_window(None, &disposition)?;
    let title = get_window_title(&record);
    let host_label = host_label.to_string();
    let child_label = label.clone();
    let tabbing_identifier = record.tabbing_identifier.clone();

    log::info!(
        "[new-tab] reserve_window: host_label={host_label}, child_label={child_label}, tabbing_identifier={tabbing_identifier}, title={title}"
    );

    log::info!(
        "[new-tab] build child before: host_label={host_label}, child_label={child_label}, tabbing_identifier={tabbing_identifier}"
    );

    match build_document_window(
        app,
        &label,
        &title,
        &record.tabbing_identifier,
        &disposition,
    ) {
        Ok(window) => {
            log::info!(
                "[new-tab] build child after: host_label={host_label}, child_label={child_label}, tabbing_identifier={tabbing_identifier}"
            );

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

pub fn create_untitled_document_tab<R: tauri::Runtime>(
    app: &AppHandle<R>,
    host_label: &str,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        log::info!("[new-tab] create_untitled_document_tab start: host_label={host_label}");
        create_document_tab_internal(app, host_label)
        .map(|_| ())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, host_label);
        Err("New Tab は macOS document window でのみサポートしています".to_string())
    }
}

#[tauri::command]
pub async fn attach_pending_document_tab(
    window: Window,
    state: State<'_, DocumentManagerState>,
) -> Result<(), String> {
    let child_label = window.label().to_string();
    let Some((host_label, tabbing_identifier)) = state.take_pending_tab_attachment(&child_label)? else {
        return Ok(());
    };

    log::info!(
        "[new-tab] attach command start: host_label={host_label}, child_label={child_label}, tabbing_identifier={tabbing_identifier}"
    );

    let app = window.app_handle();
    let attach_host_label = host_label.clone();
    let attach_child_label = child_label.clone();
    let attach_tabbing_identifier = tabbing_identifier.clone();

    let result = run_on_app_main_thread(&app, move |app| {
        log::info!(
            "[new-tab] main-thread entered: host_label={attach_host_label}, child_label={attach_child_label}, tabbing_identifier={attach_tabbing_identifier}"
        );

        let host_window = app.get_webview_window(&attach_host_label).ok_or_else(|| {
            format!("ホストウィンドウ '{attach_host_label}' が見つかりません")
        })?;
        let child_window = app
            .get_webview_window(&attach_child_label)
            .ok_or_else(|| format!("child ウィンドウ '{attach_child_label}' が見つかりません"))?;
        let host_ns_window = get_ns_window_object(&host_window)?;
        let child_ns_window = get_ns_window_object(&child_window)?;

        configure_ns_document_window(host_ns_window);
        configure_ns_document_window(child_ns_window);

        log::info!(
            "[new-tab] addTabbedWindow before: host_label={attach_host_label}, child_label={attach_child_label}, tabbing_identifier={attach_tabbing_identifier}"
        );
        unsafe {
            let _: () = objc2::msg_send![
                host_ns_window,
                addTabbedWindow: child_ns_window,
                ordered: NS_WINDOW_ORDER_ABOVE
            ];
        }
        log::info!(
            "[new-tab] addTabbedWindow after: host_label={attach_host_label}, child_label={attach_child_label}, tabbing_identifier={attach_tabbing_identifier}"
        );

        log::info!(
            "[new-tab] makeKeyAndOrderFront before: host_label={attach_host_label}, child_label={attach_child_label}, tabbing_identifier={attach_tabbing_identifier}"
        );
        focus_ns_window(child_ns_window);
        log::info!(
            "[new-tab] makeKeyAndOrderFront after: host_label={attach_host_label}, child_label={attach_child_label}, tabbing_identifier={attach_tabbing_identifier}"
        );
        log::info!(
            "[new-tab] main-thread exit: host_label={attach_host_label}, child_label={attach_child_label}, tabbing_identifier={attach_tabbing_identifier}"
        );
        Ok(())
    });

    match result {
        Ok(()) => {
            log::info!(
                "[new-tab] attach command complete: host_label={host_label}, child_label={child_label}, tabbing_identifier={tabbing_identifier}"
            );
            Ok(())
        }
        Err(error) => {
            if let Some(child_window) = app.get_webview_window(&child_label) {
                let _ = child_window.destroy();
            }
            state.rollback_window(&child_label);
            Err(error)
        }
    }
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
pub async fn new_document_tab(window: Window) -> Result<(), String> {
    log::info!("[new-tab] command start: host_label={}", window.label());
    let result = create_untitled_document_tab(&window.app_handle(), window.label());
    if let Err(error) = &result {
        log::error!("[new-tab] command error: host_label={}, error={error}", window.label());
    } else {
        log::info!("[new-tab] command complete: host_label={}", window.label());
    }
    result
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
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("保存先ディレクトリの作成に失敗しました: {error}"))?;
        }
    }

    std::fs::write(&normalized_path, contents)
        .map_err(|error| format!("ファイル保存に失敗しました: {error}"))?;

    let canonical_path = normalized_path
        .canonicalize()
        .unwrap_or_else(|_| normalized_path.clone());
    state.update_window_file_path(window.label(), canonical_path.clone())?;
    window
        .set_title(&get_file_display_name(&canonical_path))
        .map_err(|error| format!("window title の更新に失敗しました: {error}"))?;

    Ok(canonical_path.to_string_lossy().to_string())
}
