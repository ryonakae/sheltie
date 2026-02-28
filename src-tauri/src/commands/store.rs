use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

const STORE_PATH: &str = "siteboard.json";
const PROJECT_STATE_KEY: &str = "projectState";
const DEFAULT_PROJECT_STATE: &str =
    r#"{"projects":[],"openIds":[],"activeId":"__home__"}"#;

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
