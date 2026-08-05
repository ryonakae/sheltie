use tauri::{AppHandle, Manager, Runtime, State, Window};

#[cfg(target_os = "macos")]
use objc2::{
    runtime::{AnyClass, AnyObject},
    MainThreadMarker,
};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSColor, NSView, NSWindow};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSSize, NSString};

use super::document_manager::DocumentManagerState;

#[cfg(target_os = "macos")]
const NS_WINDOW_TITLE_VISIBILITY_VISIBLE: isize = 0;
#[cfg(target_os = "macos")]
const NS_WINDOW_ORDER_ABOVE: isize = 1;
#[cfg(target_os = "macos")]
const EDITED_INDICATOR_DIAMETER: f64 = 4.0;
#[cfg(target_os = "macos")]
const EDITED_INDICATOR_SIZE: f64 = 20.0;

#[cfg(target_os = "macos")]
pub(super) fn run_on_app_main_thread<R, T, F>(app: &AppHandle<R>, operation: F) -> Result<T, String>
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
    .map_err(|error| format!("failed to switch to the main thread: {error}"))?;

    receiver
        .recv()
        .map_err(|_| "failed to receive result from the main thread".to_string())?
}

/// 非同期コマンドから main thread の処理結果を待つ版。
/// 同期版は setup など await できない経路のために残す。同期版を async command から
/// 呼ぶと、ユーザー操作が終わるまで tokio worker を 1 本占有してしまう。
#[cfg(target_os = "macos")]
pub(super) async fn run_on_app_main_thread_async<R, T, F>(
    app: &AppHandle<R>,
    operation: F,
) -> Result<T, String>
where
    R: Runtime,
    T: Send + 'static,
    F: FnOnce(AppHandle<R>) -> Result<T, String> + Send + 'static,
{
    let app_handle = app.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(operation(app_handle));
    })
    .map_err(|error| format!("failed to switch to the main thread: {error}"))?;

    receiver
        .await
        .map_err(|_| "failed to receive result from the main thread".to_string())?
}

#[cfg(target_os = "macos")]
fn ns_window_class() -> Result<&'static AnyClass, String> {
    AnyClass::get(c"NSWindow").ok_or("NSWindow class not found".to_string())
}

#[cfg(target_os = "macos")]
fn get_ns_window_object<R: Runtime>(window: &Window<R>) -> Result<*mut AnyObject, String> {
    let raw = window
        .ns_window()
        .map_err(|error| format!("failed to obtain NSWindow: {error}"))?;
    let ns_window = raw.cast::<AnyObject>();
    if ns_window.is_null() {
        return Err("NSWindow is null".to_string());
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
fn create_ns_edited_indicator() -> Result<objc2::rc::Retained<NSView>, String> {
    let mtm = MainThreadMarker::new().ok_or("edited indicator must be created on main thread")?;
    let accessibility_description = NSString::from_str("Document has unsaved changes");
    let indicator = NSView::new(mtm);
    let dot = NSView::new(mtm);

    indicator.setFrameSize(NSSize::new(EDITED_INDICATOR_SIZE, EDITED_INDICATOR_SIZE));
    indicator.setToolTip(Some(&accessibility_description));
    dot.setFrameSize(NSSize::new(
        EDITED_INDICATOR_DIAMETER,
        EDITED_INDICATOR_DIAMETER,
    ));
    dot.setWantsLayer(true);
    indicator.addSubview(&dot);

    unsafe {
        let dot_layer: *mut AnyObject = objc2::msg_send![&*dot, layer];
        if dot_layer.is_null() {
            return Err("failed to create edited indicator layer".to_string());
        }
        let color = NSColor::tertiaryLabelColor();
        let cg_color: *const std::ffi::c_void = objc2::msg_send![&*color, CGColor];
        let _: () = objc2::msg_send![dot_layer, setBackgroundColor: cg_color];
        let _: () = objc2::msg_send![
            dot_layer,
            setCornerRadius: EDITED_INDICATOR_DIAMETER / 2.0
        ];

        let _: () = objc2::msg_send![&*dot, setTranslatesAutoresizingMaskIntoConstraints: false];
        let indicator_width_anchor: *mut AnyObject = objc2::msg_send![&*indicator, widthAnchor];
        let indicator_width_constraint: *mut AnyObject = objc2::msg_send![
            indicator_width_anchor,
            constraintEqualToConstant: EDITED_INDICATOR_SIZE
        ];
        let _: () = objc2::msg_send![indicator_width_constraint, setActive: true];

        let dot_width_anchor: *mut AnyObject = objc2::msg_send![&*dot, widthAnchor];
        let dot_width_constraint: *mut AnyObject = objc2::msg_send![
            dot_width_anchor,
            constraintEqualToConstant: EDITED_INDICATOR_DIAMETER
        ];
        let _: () = objc2::msg_send![dot_width_constraint, setActive: true];

        let dot_height_anchor: *mut AnyObject = objc2::msg_send![&*dot, heightAnchor];
        let dot_height_constraint: *mut AnyObject = objc2::msg_send![
            dot_height_anchor,
            constraintEqualToConstant: EDITED_INDICATOR_DIAMETER
        ];
        let _: () = objc2::msg_send![dot_height_constraint, setActive: true];

        let dot_center_x_anchor: *mut AnyObject = objc2::msg_send![&*dot, centerXAnchor];
        let indicator_center_x_anchor: *mut AnyObject =
            objc2::msg_send![&*indicator, centerXAnchor];
        let center_x_constraint: *mut AnyObject = objc2::msg_send![
            dot_center_x_anchor,
            constraintEqualToAnchor: indicator_center_x_anchor
        ];
        let _: () = objc2::msg_send![center_x_constraint, setActive: true];

        let dot_center_y_anchor: *mut AnyObject = objc2::msg_send![&*dot, centerYAnchor];
        let indicator_center_y_anchor: *mut AnyObject =
            objc2::msg_send![&*indicator, centerYAnchor];
        let center_y_constraint: *mut AnyObject = objc2::msg_send![
            dot_center_y_anchor,
            constraintEqualToAnchor: indicator_center_y_anchor
        ];
        let _: () = objc2::msg_send![center_y_constraint, setActive: true];
    }

    Ok(indicator)
}

#[cfg(target_os = "macos")]
fn set_ns_document_edited(ns_window: *mut AnyObject, edited: bool) -> Result<(), String> {
    let ns_window = unsafe { &*ns_window.cast::<NSWindow>() };
    ns_window.setDocumentEdited(edited);

    let tab = ns_window.tab();
    if edited {
        let indicator = create_ns_edited_indicator()?;
        tab.setAccessoryView(Some(&indicator));
    } else {
        tab.setAccessoryView(None);
    }

    Ok(())
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
pub(super) fn configure_macos_document_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
) -> Result<(), String> {
    let label = label.to_string();

    run_on_app_main_thread(app, move |app| {
        let window = app
            .get_window(&label)
            .ok_or_else(|| format!("window '{label}' not found"))?;
        let ns_window = get_ns_window_object(&window)?;
        configure_ns_document_window(ns_window);
        Ok(())
    })
}

#[cfg(not(target_os = "macos"))]
pub(super) fn configure_macos_document_window<R: Runtime>(
    _: &AppHandle<R>,
    _: &str,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn set_document_edited(window: Window, edited: bool) -> Result<(), String> {
    // transient 置き換え判定に使うため、表示更新の前に状態を記録する。
    // window が既にクローズ済みなら表示更新も不要なので警告だけ残す
    if let Err(error) = window
        .app_handle()
        .state::<DocumentManagerState>()
        .set_window_edited(window.label(), edited)
    {
        log::warn!("failed to record edited state: {error}");
    }

    #[cfg(target_os = "macos")]
    {
        let label = window.label().to_string();
        let app = window.app_handle();

        run_on_app_main_thread_async(app, move |app| {
            let window = app
                .get_window(&label)
                .ok_or_else(|| format!("window '{label}' not found"))?;
            let ns_window = get_ns_window_object(&window)?;
            set_ns_document_edited(ns_window, edited)
        })
        .await
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, edited);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn create_document_tab_internal<R: Runtime>(
    app: &AppHandle<R>,
    host_label: &str,
) -> Result<String, String> {
    use super::document_manager::DocumentWindowDisposition;
    use super::document_window::{build_document_window, get_window_title};

    let disposition = DocumentWindowDisposition::TabInGroup {
        host_label: host_label.to_string(),
    };
    let manager = app.state::<DocumentManagerState>();
    let (label, record) = manager.reserve_window(None, &disposition, false)?;
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

    match build_document_window(app, &label, &title, &record.tabbing_identifier) {
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
        create_document_tab_internal(app, host_label).map(|_| ())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, host_label);
        Err("New Tab is only supported on macOS document windows".to_string())
    }
}

#[tauri::command]
pub async fn new_document_tab(window: Window) -> Result<(), String> {
    log::info!("[new-tab] command start: host_label={}", window.label());
    let result = create_untitled_document_tab(window.app_handle(), window.label());
    if let Err(error) = &result {
        log::error!(
            "[new-tab] command error: host_label={}, error={error}",
            window.label()
        );
    } else {
        log::info!("[new-tab] command complete: host_label={}", window.label());
    }
    result
}

/// renderer の初期化完了後に呼ばれ、document window をユーザーに見せる。
/// pending な tab attachment があれば NSWindow の `addTabbedWindow` でタブに合流させ、
/// 無ければ単独 window として show + setFocus する。いずれも window 生成時点の
/// `visible(false)` を解除する役割を持ち、React 描画前のちらつきを防ぐ。
#[tauri::command]
pub async fn present_document_window(
    window: Window,
    state: State<'_, DocumentManagerState>,
) -> Result<(), String> {
    let child_label = window.label().to_string();
    let Some((host_label, tabbing_identifier)) = state.take_pending_tab_attachment(&child_label)?
    else {
        window
            .show()
            .map_err(|error| format!("failed to show window '{child_label}': {error}"))?;
        window
            .set_focus()
            .map_err(|error| format!("failed to focus window '{child_label}': {error}"))?;
        // 置き換え対象の untitled は、新しい window を見せた後に閉じて
        // window が 1 枚も無い瞬間を作らない
        if let Some(target_label) = state.take_pending_replacement(&child_label)? {
            state.unregister_window(&target_label);
            if let Some(target_window) = window.app_handle().get_window(&target_label) {
                if let Err(error) = target_window.destroy() {
                    log::warn!(
                        "failed to close replaced transient window '{target_label}': {error}"
                    );
                }
            }
        }
        return Ok(());
    };

    log::info!(
        "[new-tab] attach command start: host_label={host_label}, child_label={child_label}, tabbing_identifier={tabbing_identifier}"
    );

    let app = window.app_handle();

    #[cfg(target_os = "macos")]
    {
        let attach_host_label = host_label.clone();
        let attach_child_label = child_label.clone();
        let attach_tabbing_identifier = tabbing_identifier.clone();

        let result = run_on_app_main_thread_async(app, move |app| {
            log::info!(
                "[new-tab] main-thread entered: host_label={attach_host_label}, child_label={attach_child_label}, tabbing_identifier={attach_tabbing_identifier}"
            );

            let host_window = app
                .get_window(&attach_host_label)
                .ok_or_else(|| format!("host window '{attach_host_label}' not found"))?;
            let child_window = app
                .get_window(&attach_child_label)
                .ok_or_else(|| format!("child window '{attach_child_label}' not found"))?;
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
        })
        .await;

        match result {
            Ok(()) => {
                log::info!(
                    "[new-tab] attach command complete: host_label={host_label}, child_label={child_label}, tabbing_identifier={tabbing_identifier}"
                );
                Ok(())
            }
            Err(error) => {
                if let Some(child_window) = app.get_window(&child_label) {
                    let _ = child_window.destroy();
                }
                state.rollback_window(&child_label);
                Err(error)
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = tabbing_identifier;
        let _ = app;
        state.rollback_window(&child_label);
        Err("New Tab is only supported on macOS document windows".to_string())
    }
}
