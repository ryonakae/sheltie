use tauri::{AppHandle, Runtime};

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
#[cfg(target_os = "macos")]
use objc2_foundation::NSString;

#[cfg(target_os = "macos")]
use super::store::macos_tabs::run_on_app_main_thread_async;

/// Sheltie board payload 用のカスタム pasteboard type。
/// plain text と併記することで、外部アプリには人間向けテキストだけが見える。
#[cfg(target_os = "macos")]
const BOARD_PASTEBOARD_TYPE: &str = "com.sheltie.board-nodes";

#[tauri::command]
pub async fn write_board_clipboard<R: Runtime>(
    app: AppHandle<R>,
    payload_json: String,
    plain_text: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        run_on_app_main_thread_async(&app, move |_| {
            let pasteboard = NSPasteboard::generalPasteboard();
            let board_type = NSString::from_str(BOARD_PASTEBOARD_TYPE);
            pasteboard.clearContents();
            if !pasteboard.setString_forType(&NSString::from_str(&payload_json), &board_type) {
                return Err("failed to write the board payload to the pasteboard".to_string());
            }
            let plain_text_type = unsafe { NSPasteboardTypeString };
            if !pasteboard.setString_forType(&NSString::from_str(&plain_text), plain_text_type) {
                return Err("failed to write plain text to the pasteboard".to_string());
            }
            Ok(())
        })
        .await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, payload_json, plain_text);
        Err("board clipboard is only supported on macOS".to_string())
    }
}

#[tauri::command]
pub async fn read_board_clipboard<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        run_on_app_main_thread_async(&app, |_| {
            let pasteboard = NSPasteboard::generalPasteboard();
            let board_type = NSString::from_str(BOARD_PASTEBOARD_TYPE);
            let value = pasteboard.stringForType(&board_type);
            Ok(value.map(|string| string.to_string()))
        })
        .await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("board clipboard is only supported on macOS".to_string())
    }
}
