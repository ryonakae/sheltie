//! `ToolError` のファクトリ群。protocol.rs は型契約とバリデーションを担当し、
//! エラー生成はここに集約する。

use super::{ToolError, PAGE_AUTOMATION_MAX_EVALUATE_RESPONSE_BYTES};

#[allow(dead_code)]
pub fn ensure_supported_platform(supported: bool) -> Result<(), ToolError> {
    if supported {
        Ok(())
    } else {
        Err(unsupported_platform())
    }
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn unsupported_platform() -> ToolError {
    ToolError::new(
        "unsupported_platform",
        "Browser automation is available only on macOS.",
    )
}

pub fn document_not_found(_document_id: &str) -> ToolError {
    ToolError::new("document_not_found", "The requested document is not open.")
        .with_retry("Call list_documents and use a returned documentId")
}

pub fn page_not_found(_page_node_id: &str) -> ToolError {
    ToolError::new("page_not_found", "The requested page node does not exist.")
        .with_retry("Call get_board and use a returned pageNodeId")
}

pub fn webview_not_ready() -> ToolError {
    ToolError::new("webview_not_ready", "The page Webview is not ready.")
        .with_retry("Wait, then call browser_snapshot")
}

pub fn request_timeout() -> ToolError {
    ToolError::new(
        "request_timeout",
        "The page did not complete the automation request in time.",
    )
    .with_retry("Call browser_snapshot; do not replay a side-effecting operation automatically")
}

pub fn bridge_rejected() -> ToolError {
    ToolError::new(
        "bridge_rejected",
        "The page returned a completion that did not match the pending request.",
    )
    .with_retry("Treat the operation as failed and inspect the current page")
}

#[allow(dead_code)]
pub fn stale_element(_snapshot_id: &str, _element_ref: &str) -> ToolError {
    ToolError::new(
        "stale_element",
        "The page changed after this element was observed.",
    )
    .with_retry("Call browser_snapshot and use a returned elementRef")
}

#[allow(dead_code)]
pub fn element_not_found(_element_ref: &str) -> ToolError {
    ToolError::new(
        "element_not_found",
        "The referenced element no longer exists.",
    )
    .with_retry("Call browser_snapshot")
}

#[allow(dead_code)]
pub fn element_not_interactable(_element_ref: &str) -> ToolError {
    ToolError::new(
        "element_not_interactable",
        "The referenced element cannot be interacted with.",
    )
    .with_retry("Inspect a new snapshot")
}

pub fn invalid_argument(message: impl Into<String>) -> ToolError {
    ToolError::new("invalid_argument", message)
}

#[allow(dead_code)]
pub fn wait_timeout() -> ToolError {
    ToolError::new(
        "wait_timeout",
        "The wait condition was not met before the timeout.",
    )
    .with_retry("Call browser_snapshot and choose a new condition")
}

pub fn snapshot_too_large() -> ToolError {
    ToolError::new(
        "snapshot_too_large",
        "The semantic snapshot exceeds the fixed protocol limits.",
    )
    .with_retry("Use the returned truncated snapshot and narrower page state")
}

pub fn live_webview_required() -> ToolError {
    ToolError::new(
        "live_webview_required",
        "Element and full-page screenshots require a currently native WebPage.",
    )
    .with_retry("Bring the WebPage into the visible native area, then retry browser_screenshot.")
}

pub fn screenshot_failed() -> ToolError {
    ToolError::new(
        "screenshot_failed",
        "The page screenshot could not be captured.",
    )
    .with_retry("Open the WebPage until a native screenshot is captured, then retry.")
}

pub fn screenshot_target_not_visible() -> ToolError {
    ToolError::new(
        "screenshot_target_not_visible",
        "The requested screenshot target is not fully visible in the native WebPage.",
    )
    .with_retry("Scroll the target fully into view, then retry browser_screenshot")
}

pub fn page_changed_during_capture() -> ToolError {
    ToolError::new(
        "page_changed_during_capture",
        "The page navigated while the screenshot was being captured.",
    )
    .with_retry("Call browser_snapshot, then retry the screenshot")
}

pub fn screenshot_too_large() -> ToolError {
    ToolError::new(
        "screenshot_too_large",
        "The screenshot exceeds the fixed image limits.",
    )
}

pub fn evaluate_not_json() -> ToolError {
    ToolError::new(
        "evaluate_not_json",
        "The evaluated value is not JSON serializable.",
    )
}

#[allow(dead_code)]
pub fn evaluate_timeout() -> ToolError {
    ToolError::new(
        "evaluate_timeout",
        "Page evaluation did not finish before the timeout.",
    )
    .with_retry("Inspect the page before evaluating again")
}

pub fn evaluate_result_too_large() -> ToolError {
    ToolError::new(
        "evaluate_result_too_large",
        "The evaluated JSON value exceeds the fixed response limit.",
    )
}

pub fn validate_evaluate_result(value: &serde_json::Value) -> Result<(), ToolError> {
    let bytes = serde_json::to_vec(value).map_err(|_| evaluate_not_json())?;
    if bytes.len() > PAGE_AUTOMATION_MAX_EVALUATE_RESPONSE_BYTES {
        return Err(evaluate_result_too_large());
    }
    Ok(())
}

pub fn upload_file_invalid() -> ToolError {
    ToolError::new(
        "upload_file_invalid",
        "An upload path is not a readable regular file or exceeds the upload limits.",
    )
    .with_retry("Use readable absolute paths within the documented upload limits")
}

#[allow(dead_code)]
pub fn upload_target_not_file_input() -> ToolError {
    ToolError::new(
        "upload_target_not_file_input",
        "The referenced element is not a current file input.",
    )
    .with_retry("Call browser_snapshot and use an input[type=file] elementRef")
}
