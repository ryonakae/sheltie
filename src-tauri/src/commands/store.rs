use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;
use std::path::{Path, PathBuf};

const STORE_PATH: &str = "siteboard.json";
const PROJECT_STATE_KEY: &str = "projectStateV2";
const DEFAULT_PROJECT_STATE: &str =
    r#"{"projects":[],"openIds":[],"activeId":"__home__"}"#;

fn normalize_project_file_path(path: &str) -> PathBuf {
    let mut normalized = PathBuf::from(path);
    normalized.set_extension("siteboard");
    normalized
}

#[tauri::command]
pub async fn load_project_state(app: AppHandle) -> Result<serde_json::Value, String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|e| format!("ストアを開けません: {e}"))?;

    let value = store
        .get(PROJECT_STATE_KEY)
        .unwrap_or_else(|| serde_json::from_str(DEFAULT_PROJECT_STATE).unwrap());

    Ok(value)
}

#[tauri::command]
pub async fn save_project_state(
    app: AppHandle,
    state: serde_json::Value,
) -> Result<(), String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|e| format!("ストアを開けません: {e}"))?;

    store.set(PROJECT_STATE_KEY, state);
    store.save().map_err(|e| format!("保存に失敗しました: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn close_ready(
    app: AppHandle,
    state: serde_json::Value,
) -> Result<(), String> {
    // 最終状態を保存してからウィンドウを破棄
    save_project_state(app.clone(), state).await?;

    if let Some(window) = app.get_webview_window("main") {
        window
            .destroy()
            .map_err(|e| format!("ウィンドウ破棄に失敗しました: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn load_project_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(Path::new(&path))
        .map_err(|e| format!("ファイル読み込みに失敗しました: {e}"))
}

#[tauri::command]
pub async fn save_project_file(path: String, contents: String) -> Result<String, String> {
    let normalized_path = normalize_project_file_path(&path);

    if let Some(parent) = normalized_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("保存先ディレクトリの作成に失敗しました: {e}"))?;
        }
    }

    std::fs::write(&normalized_path, contents)
        .map_err(|e| format!("ファイル保存に失敗しました: {e}"))?;

    Ok(normalized_path.to_string_lossy().to_string())
}
