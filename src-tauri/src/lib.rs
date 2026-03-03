mod commands;

use commands::{
    store::{close_ready, load_project_state, save_project_state},
    theme::{get_platform_info, load_theme, set_theme},
    webview::{
        capture_webview_screenshot, create_page_webview, get_navigation_state_page_webview,
        go_back_page_webview, go_forward_page_webview, reload_page_webview,
    },
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_project_state,
            save_project_state,
            close_ready,
            load_theme,
            set_theme,
            get_platform_info,
            create_page_webview,
            capture_webview_screenshot,
            reload_page_webview,
            go_back_page_webview,
            go_forward_page_webview,
            get_navigation_state_page_webview,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri アプリの起動中にエラーが発生しました");
}
