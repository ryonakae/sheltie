use tauri::{
    webview::PageLoadEvent, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl,
    Window,
};

#[cfg(target_os = "macos")]
use objc2_foundation::NSRect;

use super::labels::{resolve_page_webview, scoped_page_label};
use super::page_automation::{
    normalize_navigation_url, page_automation_initialization_script, page_key,
};
use super::scripts::{SCROLL_DETECTION_SCRIPT, SPA_URL_DETECTION_SCRIPT};
use crate::mcp::page_automation::actor::PageAutomationState;

#[cfg(target_os = "macos")]
use super::macos_viewport::{
    configure_new_webview_viewport, set_webview_alpha, update_existing_webview_viewport,
};

#[cfg(target_os = "macos")]
fn format_ns_rect(rect: NSRect) -> String {
    format!(
        "{{x={:.2}, y={:.2}, w={:.2}, h={:.2}}}",
        rect.origin.x, rect.origin.y, rect.size.width, rect.size.height
    )
}

#[cfg(target_os = "macos")]
fn log_host_window_metrics(window: &Window, phase: &str) {
    if !cfg!(debug_assertions) {
        return;
    }

    let Ok(raw_ns_window) = window.ns_window() else {
        log::info!("[webview-layout][rust] {phase}: ns_window unavailable");
        return;
    };
    let Ok(raw_ns_view) = window.ns_view() else {
        log::info!("[webview-layout][rust] {phase}: ns_view unavailable");
        return;
    };

    let raw_ns_window = raw_ns_window as *mut objc2::runtime::AnyObject;
    let raw_ns_view = raw_ns_view as *mut objc2::runtime::AnyObject;

    unsafe {
        let window_frame: NSRect = objc2::msg_send![raw_ns_window, frame];
        let content_layout_rect: NSRect = objc2::msg_send![raw_ns_window, contentLayoutRect];
        let content_view: *mut objc2::runtime::AnyObject =
            objc2::msg_send![raw_ns_window, contentView];
        let content_view_frame: NSRect = objc2::msg_send![content_view, frame];
        let host_view_frame: NSRect = objc2::msg_send![raw_ns_view, frame];
        let host_view_bounds: NSRect = objc2::msg_send![raw_ns_view, bounds];

        log::info!(
            "[webview-layout][rust] {phase}: window_label={}, window_frame={}, content_layout_rect={}, content_view_frame={}, host_view_frame={}, host_view_bounds={}",
            window.label(),
            format_ns_rect(window_frame),
            format_ns_rect(content_layout_rect),
            format_ns_rect(content_view_frame),
            format_ns_rect(host_view_frame),
            format_ns_rect(host_view_bounds),
        );
    }
}

#[cfg(target_os = "macos")]
fn log_child_webview_metrics(
    phase: &str,
    label: &str,
    raw_webview: *mut objc2::runtime::AnyObject,
) {
    if !cfg!(debug_assertions) {
        return;
    }

    unsafe {
        let webview_frame: NSRect = objc2::msg_send![raw_webview, frame];
        let webview_bounds: NSRect = objc2::msg_send![raw_webview, bounds];
        let superview: *mut objc2::runtime::AnyObject = objc2::msg_send![raw_webview, superview];
        let superview_frame: NSRect = objc2::msg_send![superview, frame];
        let superview_bounds: NSRect = objc2::msg_send![superview, bounds];
        let is_flipped: bool = objc2::msg_send![superview, isFlipped];

        log::info!(
            "[webview-layout][rust] {phase}: label={label}, webview_frame={}, webview_bounds={}, superview_frame={}, superview_bounds={}, superview_is_flipped={}",
            format_ns_rect(webview_frame),
            format_ns_rect(webview_bounds),
            format_ns_rect(superview_frame),
            format_ns_rect(superview_bounds),
            is_flipped,
        );
    }
}

#[cfg(target_os = "macos")]
fn child_webview_top_inset(window: &Window) -> Result<f64, String> {
    let raw_ns_window = window
        .ns_window()
        .map_err(|e| format!("failed to obtain ns_window: {e}"))?
        as *mut objc2::runtime::AnyObject;
    let raw_ns_view = window
        .ns_view()
        .map_err(|e| format!("failed to obtain ns_view: {e}"))?
        as *mut objc2::runtime::AnyObject;

    unsafe {
        let content_layout_rect: NSRect = objc2::msg_send![raw_ns_window, contentLayoutRect];
        let host_view_frame: NSRect = objc2::msg_send![raw_ns_view, frame];
        let top_inset = (host_view_frame.size.height
            - (content_layout_rect.origin.y + content_layout_rect.size.height))
            .max(0.0);
        Ok(top_inset)
    }
}

/// 子 Webview を配置する際の上端オフセット。macOS のタイトルバー分だけ下げる。
/// 非 macOS では 0 を返す（プラットフォーム分岐を呼び出し側から隠す）。
fn platform_top_inset(window: &Window) -> Result<f64, String> {
    #[cfg(target_os = "macos")]
    {
        child_webview_top_inset(window)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(0.0)
    }
}

/// ページ用のネイティブ Webview を作成しイベントハンドラーを登録する。
///
/// 作成後の位置・サイズ・表示制御は JS 側の Webview API で行う（IPC 不要）。
/// ナビゲーション/タイトル変更イベントは Rust から JS にイベント送信する。
///
/// zoom は WKWebView の _viewScale として設定する。
/// _WKLayoutModeDynamicSizeComputedFromViewScale（layoutMode=2）と組み合わせることで
/// CSS viewport = frame.size / viewScale となり、frame が縮小されても
/// WKWebView は常に論理サイズを認識し、最小フォントサイズ問題も回避できる。
/// 併せて set_css_viewport_unit_sizes で svh/lvh/dvh/vh の基準サイズを論理サイズに同期し、
/// 物理 frame サイズからの乖離を防ぐ（新旧 API の両方をサポート）。
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_page_webview(
    window: Window,
    page_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    zoom: f64,
) -> Result<String, String> {
    let app = window.app_handle();
    let window_label = window.label().to_string();
    let label = scoped_page_label(&window_label, &page_id);
    let top_inset = platform_top_inset(&window)?;
    let adjusted_y = y + top_inset;

    #[cfg(target_os = "macos")]
    log_host_window_metrics(&window, "create_page_webview:host-before");

    if cfg!(debug_assertions) {
        log::info!(
            "[webview-layout][rust] create_page_webview: window_label={window_label}, page_id={page_id}, label={label}, x={x:.2}, y={y:.2}, adjusted_y={adjusted_y:.2}, width={width:.2}, height={height:.2}, zoom={zoom:.4}{}",
            if cfg!(target_os = "macos") {
                format!(", top_inset={top_inset:.2}")
            } else {
                String::new()
            }
        );
    }

    let parsed_url = url
        .parse::<tauri::Url>()
        .map_err(|e| format!("failed to parse URL: {e}"))?;

    let automation_key = page_key(&window_label, &page_id);
    let automation_state = app.state::<PageAutomationState>();
    automation_state.remove_page(&automation_key)?;

    // 既存の同名 Webview があれば破棄（HMR / 異常系での再作成に対する防御策）
    if let Some(existing) = app.get_webview(&label) {
        let _ = existing.close();
    }
    automation_state.register_page(automation_key.clone())?;

    let app_handle = app.clone();
    let pid = page_id.clone();
    let label_clone = label.clone();
    let event_window_label = window_label.clone();

    let add_result = window.add_child(
        tauri::webview::WebviewBuilder::new(&label_clone, WebviewUrl::External(parsed_url))
            .initialization_script_for_all_frames(page_automation_initialization_script())
            .on_new_window({
                let app = app_handle.clone();
                let label = label.clone();
                move |new_url, _features| {
                    let app = app.clone();
                    let label = label.clone();
                    let new_url = new_url.to_string();
                    tauri::async_runtime::spawn(async move {
                        let Ok(url) = tauri::Url::parse(&new_url) else {
                            return;
                        };
                        let Some(webview) = app.get_webview(&label) else {
                            return;
                        };
                        if let Err(error) = webview.navigate(url) {
                            if cfg!(debug_assertions) {
                                log::debug!("failed to navigate in-place popup Webview: {error}");
                            }
                        }
                    });
                    tauri::webview::NewWindowResponse::Deny
                }
            })
            .initialization_script(SPA_URL_DETECTION_SCRIPT)
            .initialization_script(SCROLL_DETECTION_SCRIPT)
            .on_navigation({
                let ah = app_handle.clone();
                let pid = pid.clone();
                let event_window_label = event_window_label.clone();
                move |nav_url| {
                    ah.emit_to(
                        &event_window_label,
                        &format!("page-navigated-{pid}"),
                        serde_json::json!({ "url": nav_url.to_string() }),
                    )
                    .ok();
                    // ナビゲーションを許可
                    true
                }
            })
            .on_page_load({
                let ah = app_handle.clone();
                let automation_key = automation_key.clone();
                move |_webview, payload| {
                    if payload.event() != PageLoadEvent::Finished {
                        return;
                    }
                    let Ok(url) = normalize_navigation_url(payload.url().as_str()) else {
                        return;
                    };
                    if let Err(error) = ah
                        .state::<PageAutomationState>()
                        .note_committed_navigation(&automation_key, url)
                    {
                        log::warn!("failed to record committed page navigation: {error}");
                    }
                }
            })
            .on_document_title_changed({
                let ah = app_handle.clone();
                let automation_key = automation_key.clone();
                let pid = pid.clone();
                let event_window_label = event_window_label.clone();
                move |_webview, title| {
                    // \x01: initialization_script からの SPA URL 変更通知
                    // \x02: initialization_script からのスクロール完了通知
                    if let Some(url) = title.strip_prefix('\u{0001}') {
                        if let Ok(url) = normalize_navigation_url(url) {
                            if let Err(error) = ah
                                .state::<PageAutomationState>()
                                .note_spa_navigation(&automation_key, url)
                            {
                                log::warn!("failed to record SPA page navigation: {error}");
                            }
                        }
                        ah.emit_to(
                            &event_window_label,
                            &format!("page-navigated-{pid}"),
                            serde_json::json!({ "url": url }),
                        )
                        .ok();
                    } else if title.starts_with('\u{0002}') {
                        ah.emit_to(
                            &event_window_label,
                            &format!("page-scroll-ended-{pid}"),
                            serde_json::json!({}),
                        )
                        .ok();
                    } else {
                        ah.emit_to(
                            &event_window_label,
                            &format!("page-title-changed-{pid}"),
                            serde_json::json!({ "title": title }),
                        )
                        .ok();
                    }
                }
            }),
        LogicalPosition::new(x, adjusted_y),
        LogicalSize::new(width, height),
    );
    if let Err(error) = add_result {
        let _ = automation_state.remove_page(&automation_key);
        return Err(format!("failed to create Webview: {error}"));
    }

    // macOS: _WKLayoutModeDynamicSizeComputedFromViewScale（layoutMode=2）+ _setViewScale: zoom を設定。
    // これにより CSS viewport = frame.size / viewScale となり、frame が物理的に縮小されても
    // WKWebView が認識するレイアウトサイズは論理サイズ（page.width/height）を維持できる。
    // setBoundsSize: と異なり、この方式では CSS レベルではなくコンポジティング段階でスケーリングされるため
    // 最小フォントサイズ制約が発動しない。
    // さらに set_css_viewport_unit_sizes で svh/lvh の基準も CSS viewport に揃える。
    // layoutMode は作成時のみ設定し、update 時は viewScale + viewport insets を更新する。
    #[cfg(target_os = "macos")]
    {
        if let Some(wv) = app.get_webview(&label) {
            let log_label = label.clone();
            wv.with_webview(move |platform_wv| {
                let raw = platform_wv.inner() as *mut objc2::runtime::AnyObject;
                log_child_webview_metrics("create_page_webview:child-after-build", &log_label, raw);
                configure_new_webview_viewport(raw, width, height, zoom);
            })
            .ok();
        }
    }

    Ok(label)
}

/// ページ Webview の位置・サイズ（frame）と viewScale をアトミックに更新する。
///
/// frame は画面上の物理的な表示領域（zoom 済みサイズ）。
/// _setViewScale により CSS viewport = frame.size / zoom となるため、
/// zoom < 1.0 の時もレイアウト崩れなくページを縮小表示できる。
/// 同時に set_css_viewport_unit_sizes で svh/lvh/dvh/vh の基準サイズを論理サイズへ更新し、
/// frame の物理サイズとの乖離を防ぐ（新旧 API の両方をサポート）。
#[tauri::command]
pub async fn update_page_webview_bounds(
    window: Window,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    zoom: f64,
) -> Result<(), String> {
    let top_inset = platform_top_inset(&window)?;
    let adjusted_y = y + top_inset;

    if cfg!(debug_assertions) {
        log::info!(
            "[webview-layout][rust] update_page_webview_bounds: window_label={}, label={}, x={:.2}, y={:.2}, adjusted_y={:.2}, width={:.2}, height={:.2}, zoom={:.4}{}",
            window.label(),
            label,
            x,
            y,
            adjusted_y,
            width,
            height,
            zoom,
            if cfg!(target_os = "macos") {
                format!(", top_inset={top_inset:.2}")
            } else {
                String::new()
            }
        );
    }
    #[cfg(target_os = "macos")]
    log_host_window_metrics(&window, "update_page_webview_bounds:host-before");
    update_bounds_impl(
        window.app_handle(),
        window.label(),
        &label,
        x,
        adjusted_y,
        width,
        height,
        zoom,
    )
    .await
}

#[cfg(target_os = "macos")]
#[allow(clippy::too_many_arguments)]
async fn update_bounds_impl(
    app: &AppHandle,
    window_label: &str,
    label: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    zoom: f64,
) -> Result<(), String> {
    let wv = resolve_page_webview(app, window_label, label)?;
    let label_string = label.to_string();

    if cfg!(debug_assertions) {
        wv.with_webview({
            let label = label_string.clone();
            move |platform_wv| {
                let raw = platform_wv.inner() as *mut objc2::runtime::AnyObject;
                log_child_webview_metrics("update_bounds_impl:child-before", &label, raw);
            }
        })
        .ok();
    }

    wv.set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("setPosition error: {e}"))?;
    wv.set_size(LogicalSize::new(width, height))
        .map_err(|e| format!("setSize error: {e}"))?;

    wv.with_webview(move |platform_wv| {
        let raw = platform_wv.inner() as *mut objc2::runtime::AnyObject;
        log_child_webview_metrics(
            "update_bounds_impl:child-after-set-frame",
            &label_string,
            raw,
        );
        update_existing_webview_viewport(raw, width, height, zoom);
        log_child_webview_metrics(
            "update_bounds_impl:child-after-viewport",
            &label_string,
            raw,
        );
    })
    .map_err(|e| format!("with_webview error: {e}"))?;

    Ok(())
}

#[cfg(not(target_os = "macos"))]
async fn update_bounds_impl(
    app: &AppHandle,
    window_label: &str,
    label: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    _zoom: f64,
) -> Result<(), String> {
    let wv = resolve_page_webview(app, window_label, label)?;
    wv.set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("setPosition error: {e}"))?;
    wv.set_size(LogicalSize::new(width, height))
        .map_err(|e| format!("setSize error: {e}"))?;
    Ok(())
}

/// ページ Webview の不透明度を設定する。
///
/// show/hide は setHidden ベースで表示復帰時の描画揺れが発生しやすいため、
/// macOS では alpha 値を操作して表示状態を維持したままフェード復帰を可能にする。
#[tauri::command]
pub async fn set_page_webview_opacity(
    window: Window,
    label: String,
    opacity: f64,
) -> Result<(), String> {
    set_opacity_impl(
        window.app_handle().clone(),
        window.label().to_string(),
        label,
        opacity.clamp(0.0, 1.0),
    )
    .await
}

#[cfg(target_os = "macos")]
async fn set_opacity_impl(
    app: AppHandle,
    window_label: String,
    label: String,
    opacity: f64,
) -> Result<(), String> {
    let wv = resolve_page_webview(&app, &window_label, &label)?;

    wv.with_webview(move |platform_wv| {
        let raw = platform_wv.inner() as *mut objc2::runtime::AnyObject;
        set_webview_alpha(raw, opacity);
    })
    .map_err(|e| format!("with_webview error: {e}"))?;

    Ok(())
}

#[cfg(not(target_os = "macos"))]
async fn set_opacity_impl(
    _app: AppHandle,
    _window_label: String,
    _label: String,
    _opacity: f64,
) -> Result<(), String> {
    Ok(())
}

/// 複数ページ Webview の frame + viewScale を一括更新する（操作中のリアルタイム同期用）。
#[derive(serde::Deserialize)]
pub struct BoundsEntry {
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub zoom: f64,
}

#[tauri::command]
pub async fn batch_update_page_webview_bounds(
    window: Window,
    entries: Vec<BoundsEntry>,
) -> Result<(), String> {
    let app = window.app_handle();
    let window_label = window.label().to_string();
    let top_inset = platform_top_inset(&window)?;

    // エラーは個別に無視（一括更新中の孤児 Webview 対策）
    for e in entries {
        let _ = update_bounds_impl(
            app,
            &window_label,
            &e.label,
            e.x,
            e.y + top_inset,
            e.width,
            e.height,
            e.zoom,
        )
        .await;
    }
    Ok(())
}

/// パン操作専用: 複数 Webview の位置のみを一括更新する。
///
/// パン中は size や zoom は変化しないため set_size / _setViewScale をスキップし
/// IPC メッセージ数を削減することで追従遅延を軽減する。
#[derive(serde::Deserialize)]
pub struct PositionEntry {
    pub label: String,
    pub x: f64,
    pub y: f64,
}

#[tauri::command]
pub async fn batch_update_webview_positions(
    window: Window,
    entries: Vec<PositionEntry>,
) -> Result<(), String> {
    let app = window.app_handle();
    let window_label = window.label().to_string();
    let top_inset = platform_top_inset(&window)?;

    for e in entries {
        if let Ok(wv) = resolve_page_webview(app, &window_label, &e.label) {
            wv.set_position(LogicalPosition::new(e.x, e.y + top_inset))
                .ok();
        }
    }
    Ok(())
}
