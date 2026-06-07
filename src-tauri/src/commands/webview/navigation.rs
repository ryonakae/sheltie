use tauri::{AppHandle, Manager, Window};

use super::labels::resolve_page_webview;

#[derive(serde::Serialize)]
pub struct NavigationState {
    pub can_go_back: bool,
    pub can_go_forward: bool,
}

/// ページ Webview のブラウザ履歴を1つ戻る。
#[tauri::command]
pub async fn go_back_page_webview(window: Window, label: String) -> Result<(), String> {
    let webview = resolve_page_webview(&window.app_handle(), window.label(), &label)?;
    webview
        .eval("history.back()")
        .map_err(|e| format!("failed to run history.back(): {e}"))
}

/// ページ Webview のブラウザ履歴を1つ進める。
#[tauri::command]
pub async fn go_forward_page_webview(window: Window, label: String) -> Result<(), String> {
    let webview = resolve_page_webview(&window.app_handle(), window.label(), &label)?;
    webview
        .eval("history.forward()")
        .map_err(|e| format!("failed to run history.forward(): {e}"))
}

/// ページ Webview の戻る/進み可否状態を取得する（macOS のみ正確）。
#[tauri::command]
pub async fn get_navigation_state_page_webview(
    window: Window,
    label: String,
) -> Result<NavigationState, String> {
    get_navigation_state_impl(
        window.app_handle().clone(),
        window.label().to_string(),
        label,
    )
    .await
}

#[cfg(target_os = "macos")]
async fn get_navigation_state_impl(
    app: AppHandle,
    window_label: String,
    label: String,
) -> Result<NavigationState, String> {
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;

    let webview = resolve_page_webview(&app, &window_label, &label)?;

    let (tx, rx) = oneshot::channel::<Result<NavigationState, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));

    webview
        .with_webview(move |platform_wv| {
            let raw_ptr = platform_wv.inner() as *mut objc2::runtime::AnyObject;
            unsafe {
                let can_go_back: bool = objc2::msg_send![raw_ptr, canGoBack];
                let can_go_forward: bool = objc2::msg_send![raw_ptr, canGoForward];
                if let Ok(mut guard) = tx.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(Ok(NavigationState {
                            can_go_back,
                            can_go_forward,
                        }));
                    }
                }
            }
        })
        .map_err(|e| format!("with_webview error: {e}"))?;

    rx.await
        .map_err(|_| "navigation state channel closed".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn get_navigation_state_impl(
    _app: AppHandle,
    _window_label: String,
    _label: String,
) -> Result<NavigationState, String> {
    Ok(NavigationState {
        can_go_back: false,
        can_go_forward: false,
    })
}

/// ページの Webview を指定 URL にナビゲートする（追加時 URL へのリセットに使用）。
#[tauri::command]
pub async fn reload_page_webview(
    window: Window,
    label: String,
    url: String,
) -> Result<(), String> {
    let webview = resolve_page_webview(&window.app_handle(), window.label(), &label)?;
    let parsed_url = url
        .parse::<tauri::Url>()
        .map_err(|e| format!("failed to parse URL: {e}"))?;
    webview
        .navigate(parsed_url)
        .map_err(|e| format!("navigation failed: {e}"))
}
