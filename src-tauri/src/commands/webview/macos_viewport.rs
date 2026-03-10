#[cfg(target_os = "macos")]
fn sanitize_zoom(zoom: f64) -> f64 {
    if zoom.is_finite() && zoom > 0.0 {
        zoom
    } else {
        1.0
    }
}

#[cfg(target_os = "macos")]
fn run_objc_void_guarded<F>(context: &str, f: F)
where
    F: FnOnce(),
{
    if let Err(exception) = objc2::exception::catch(std::panic::AssertUnwindSafe(f)) {
        let detail = exception
            .as_ref()
            .map(|e| format!("{e:?}"))
            .unwrap_or_else(|| "nil exception".to_string());
        log::warn!(
            "Objective-C 呼び出し `{context}` で例外が発生したため補正をスキップしました: {detail}"
        );
    }
}

#[cfg(target_os = "macos")]
fn run_objc_bool_guarded<F>(context: &str, f: F) -> bool
where
    F: FnOnce() -> bool,
{
    match objc2::exception::catch(std::panic::AssertUnwindSafe(f)) {
        Ok(value) => value,
        Err(exception) => {
            let detail = exception
                .as_ref()
                .map(|e| format!("{e:?}"))
                .unwrap_or_else(|| "nil exception".to_string());
            log::warn!(
                "Objective-C 呼び出し `{context}` で例外が発生したため `false` を返します: {detail}"
            );
            false
        }
    }
}

#[cfg(target_os = "macos")]
fn compute_css_viewport_size_for_units(width: f64, height: f64, zoom: f64) -> (f64, f64) {
    let safe_zoom = sanitize_zoom(zoom);
    (width / safe_zoom, height / safe_zoom)
}

#[cfg(target_os = "macos")]
unsafe fn set_css_viewport_unit_sizes(
    raw: *mut objc2::runtime::AnyObject,
    physical_width: f64,
    physical_height: f64,
    logical_width: f64,
    logical_height: f64,
) {
    use objc2_foundation::NSEdgeInsets;

    let inset_right = physical_width - logical_width;
    let inset_bottom = physical_height - logical_height;
    let inset = NSEdgeInsets {
        top: 0.0,
        left: 0.0,
        bottom: inset_bottom,
        right: inset_right,
    };

    let recalc_sel = objc2::sel!(
        _recalculateViewportSizesWithMinimumViewportInset:maximumViewportInset:throwOnInvalidInput:
    );
    let supports_recalc = run_objc_bool_guarded(
        "respondsToSelector(_recalculateViewportSizes...)",
        || unsafe { objc2::msg_send![raw, respondsToSelector: recalc_sel] },
    );
    if supports_recalc {
        run_objc_void_guarded(
            "_recalculateViewportSizesWithMinimumViewportInset:maximumViewportInset:throwOnInvalidInput:",
            || unsafe {
                let _: () = objc2::msg_send![
                    raw,
                    _recalculateViewportSizesWithMinimumViewportInset: inset,
                    maximumViewportInset: inset,
                    throwOnInvalidInput: false
                ];
            },
        );
        return;
    }

    if inset_right >= 0.0 && inset_bottom >= 0.0 {
        let supports_inset = run_objc_bool_guarded(
            "respondsToSelector(setMinimumViewportInset:maximumViewportInset:)",
            || unsafe {
                objc2::msg_send![
                    raw,
                    respondsToSelector: objc2::sel!(setMinimumViewportInset:maximumViewportInset:)
                ]
            },
        );
        if supports_inset {
            run_objc_void_guarded(
                "setMinimumViewportInset:maximumViewportInset:",
                || unsafe {
                    let _: () = objc2::msg_send![
                        raw,
                        setMinimumViewportInset: inset,
                        maximumViewportInset: inset
                    ];
                },
            );
        }
    }
}

#[cfg(target_os = "macos")]
pub fn configure_new_webview_viewport(
    raw: *mut objc2::runtime::AnyObject,
    width: f64,
    height: f64,
    zoom: f64,
) {
    let safe_zoom = sanitize_zoom(zoom);
    let (css_viewport_width, css_viewport_height) =
        compute_css_viewport_size_for_units(width, height, safe_zoom);

    run_objc_void_guarded("_setLayoutMode + _setViewScale + viewport insets", || unsafe {
        let _: () = objc2::msg_send![raw, _setLayoutMode: 2i64];
        let _: () = objc2::msg_send![raw, _setViewScale: safe_zoom];
        set_css_viewport_unit_sizes(
            raw,
            width,
            height,
            css_viewport_width,
            css_viewport_height,
        );
    });
}

#[cfg(target_os = "macos")]
pub fn update_existing_webview_viewport(
    raw: *mut objc2::runtime::AnyObject,
    width: f64,
    height: f64,
    zoom: f64,
) {
    let safe_zoom = sanitize_zoom(zoom);
    let (css_viewport_width, css_viewport_height) =
        compute_css_viewport_size_for_units(width, height, safe_zoom);

    run_objc_void_guarded("_setViewScale + viewport insets", || unsafe {
        let _: () = objc2::msg_send![raw, _setViewScale: safe_zoom];
        set_css_viewport_unit_sizes(
            raw,
            width,
            height,
            css_viewport_width,
            css_viewport_height,
        );
    });
}

#[cfg(target_os = "macos")]
pub fn set_webview_alpha(
    raw: *mut objc2::runtime::AnyObject,
    opacity: f64,
) {
    run_objc_void_guarded("setAlphaValue:", || unsafe {
        let _: () = objc2::msg_send![raw, setAlphaValue: opacity];
    });
}
