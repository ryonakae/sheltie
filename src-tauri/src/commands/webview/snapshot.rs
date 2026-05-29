use tauri::AppHandle;

#[cfg(target_os = "macos")]
use tauri::Manager;

#[cfg(target_os = "macos")]
pub async fn capture_webview_png_bytes(
    app: &AppHandle,
    label: &str,
) -> Result<Vec<u8>, String> {
    capture_webview_png_bytes_with_options(app, label, false).await
}

#[cfg(target_os = "macos")]
pub async fn capture_webview_png_bytes_with_options(
    app: &AppHandle,
    label: &str,
    hide_after_snapshot_request: bool,
) -> Result<Vec<u8>, String> {
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{label}' not found"))?;

    let (tx, rx) = oneshot::channel::<Result<Vec<u8>, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));

    webview
        .with_webview(move |platform_wv| {
            let raw_ptr = platform_wv.inner() as *mut objc2::runtime::AnyObject;
            take_wkwebview_snapshot(raw_ptr, tx);
        })
        .map_err(|e| format!("with_webview error: {e}"))?;

    if hide_after_snapshot_request {
        if let Err(error) = webview.hide() {
            log::warn!(
                "failed to hide Webview right after snapshot request: page_id={}, error={}",
                label,
                error
            );
        }
    }

    rx.await
        .map_err(|_| "screenshot channel closed".to_string())?
}

#[cfg(not(target_os = "macos"))]
pub async fn capture_webview_png_bytes(
    _app: &AppHandle,
    _label: &str,
) -> Result<Vec<u8>, String> {
    Err("this OS is not supported".to_string())
}

#[cfg(not(target_os = "macos"))]
pub async fn capture_webview_png_bytes_with_options(
    _app: &AppHandle,
    _label: &str,
    _hide_after_snapshot_request: bool,
) -> Result<Vec<u8>, String> {
    Err("this OS is not supported".to_string())
}

pub async fn capture_webview_base64(
    app: &AppHandle,
    label: &str,
) -> Result<String, String> {
    use base64::Engine as _;

    let bytes = capture_webview_png_bytes(app, label).await?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{encoded}"))
}

#[cfg(target_os = "macos")]
fn take_wkwebview_snapshot(
    raw_ptr: *mut objc2::runtime::AnyObject,
    tx: std::sync::Arc<
        std::sync::Mutex<
            Option<tokio::sync::oneshot::Sender<Result<Vec<u8>, String>>>,
        >,
    >,
) {
    use block2::RcBlock;
    use objc2::runtime::AnyObject;

    let block = RcBlock::new(move |image: *mut AnyObject, _error: *mut AnyObject| {
        let result = if image.is_null() {
            Err("NSImage is null (Webview may be hidden)".to_string())
        } else {
            nsimage_to_png_bytes(image)
        };
        if let Ok(mut guard) = tx.lock() {
            if let Some(sender) = guard.take() {
                let _ = sender.send(result);
            }
        }
    });

    unsafe {
        let nil: *mut AnyObject = std::ptr::null_mut();
        let _: () = objc2::msg_send![
            raw_ptr,
            takeSnapshotWithConfiguration: nil,
            completionHandler: &*block
        ];
    }
}

#[cfg(target_os = "macos")]
fn nsimage_to_png_bytes(image: *mut objc2::runtime::AnyObject) -> Result<Vec<u8>, String> {
    use objc2::runtime::{AnyClass, AnyObject};

    unsafe {
        let tiff: *mut AnyObject = objc2::msg_send![image, TIFFRepresentation];
        if tiff.is_null() {
            return Err("TIFFRepresentation is null".to_string());
        }

        let cls = AnyClass::get(c"NSBitmapImageRep")
            .ok_or("NSBitmapImageRep class not found")?;
        let bitmap: *mut AnyObject = objc2::msg_send![cls, imageRepWithData: tiff];
        if bitmap.is_null() {
            return Err("failed to create NSBitmapImageRep".to_string());
        }

        let nil_dict: *mut AnyObject = std::ptr::null_mut();
        let png_data: *mut AnyObject = objc2::msg_send![
            bitmap,
            representationUsingType: 4usize,
            properties: nil_dict
        ];
        if png_data.is_null() {
            return Err("failed to produce PNG data".to_string());
        }

        let bytes: *const u8 = objc2::msg_send![png_data, bytes];
        let length: usize = objc2::msg_send![png_data, length];
        Ok(std::slice::from_raw_parts(bytes, length).to_vec())
    }
}
