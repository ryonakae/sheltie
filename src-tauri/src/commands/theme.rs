use tauri::{AppHandle, Manager, Theme};
use tauri_plugin_store::StoreExt;

const STORE_PATH: &str = "siteboard.json";
const THEME_KEY: &str = "theme";

#[tauri::command]
pub async fn load_theme(app: AppHandle) -> Result<String, String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|e| format!("ストアを開けません: {e}"))?;

    let mode = store
        .get(THEME_KEY)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "system".to_string());

    Ok(mode)
}

#[tauri::command]
pub async fn set_theme(
    app: AppHandle,
    mode: String,
) -> Result<bool, String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|e| format!("ストアを開けません: {e}"))?;

    store.set(THEME_KEY, serde_json::Value::String(mode.clone()));
    store.save().map_err(|e| format!("保存に失敗しました: {e}"))?;

    // ウィンドウにテーマを適用してシステムのダークモード状態を返す
    let window = app
        .get_webview_window("main")
        .ok_or("main ウィンドウが見つかりません")?;

    let is_dark = match mode.as_str() {
        "dark" => {
            window
                .set_theme(Some(Theme::Dark))
                .map_err(|e| format!("テーマ設定に失敗しました: {e}"))?;
            true
        }
        "light" => {
            window
                .set_theme(Some(Theme::Light))
                .map_err(|e| format!("テーマ設定に失敗しました: {e}"))?;
            false
        }
        // "system" またはその他: OS の設定に従う
        _ => {
            window
                .set_theme(None)
                .map_err(|e| format!("テーマ設定に失敗しました: {e}"))?;
            // macOS/Windows の OS テーマを参照（最善の推測）
            cfg!(target_os = "macos") && is_system_dark()
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

/// OS のダークモード状態を取得する（macOS 専用）
#[cfg(target_os = "macos")]
fn is_system_dark() -> bool {
    // macOS では環境変数やシステム API で判定できるが、
    // ここでは簡易的に false を返す（Tauri の theme:changed イベントで後から更新される）
    false
}

#[cfg(not(target_os = "macos"))]
fn is_system_dark() -> bool {
    false
}
