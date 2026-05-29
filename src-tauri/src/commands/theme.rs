use tauri::{AppHandle, Theme, Window};
use tauri_plugin_store::StoreExt;

pub const STORE_PATH: &str = "siteboard.json";
pub const THEME_KEY: &str = "theme";

pub const MENU_ID_THEME_LIGHT: &str = "theme.light";
pub const MENU_ID_THEME_DARK: &str = "theme.dark";
pub const MENU_ID_THEME_SYSTEM: &str = "theme.system";

pub fn load_persisted_theme<R: tauri::Runtime>(app: &AppHandle<R>) -> String {
    let Ok(store) = app.store(STORE_PATH) else {
        return "system".to_string();
    };
    store
        .get(THEME_KEY)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "system".to_string())
}

#[tauri::command]
pub async fn load_theme(app: AppHandle) -> Result<String, String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|e| format!("failed to open store: {e}"))?;

    let mode = store
        .get(THEME_KEY)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "system".to_string());

    Ok(mode)
}

#[tauri::command]
pub async fn set_theme(app: AppHandle, window: Window, mode: String) -> Result<bool, String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|e| format!("failed to open store: {e}"))?;

    store.set(THEME_KEY, serde_json::Value::String(mode.clone()));
    store.save().map_err(|e| format!("failed to save store: {e}"))?;

    let is_dark = match mode.as_str() {
        "dark" => {
            window
                .set_theme(Some(Theme::Dark))
                .map_err(|e| format!("failed to set theme: {e}"))?;
            true
        }
        "light" => {
            window
                .set_theme(Some(Theme::Light))
                .map_err(|e| format!("failed to set theme: {e}"))?;
            false
        }
        // "system" またはその他: OS の設定に従う
        _ => {
            window
                .set_theme(None)
                .map_err(|e| format!("failed to set theme: {e}"))?;
            // Tauri API で現在の実効テーマを取得
            let current_theme = window
                .theme()
                .map_err(|e| format!("failed to read theme: {e}"))?;
            current_theme == Theme::Dark
        }
    };

    Ok(is_dark)
}

#[tauri::command]
pub async fn get_platform_info() -> (String, f64) {
    let platform = if cfg!(target_os = "macos") {
        "macos".to_string()
    } else if cfg!(target_os = "windows") {
        "windows".to_string()
    } else {
        "linux".to_string()
    };

    // macOS トラフィックライト幅: ボタン直径 12px × 3 + 間隔 8px × 2 + 右マージン 6px
    let traffic_light_width = if cfg!(target_os = "macos") {
        12.0 + 12.0 * 3.0 + 8.0 * 2.0 + 6.0
    } else {
        0.0
    };

    (platform, traffic_light_width)
}
