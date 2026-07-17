use tauri::{AppHandle, Manager, Webview, Window};

use super::labels::{resolve_page_webview, scoped_page_label};
#[cfg(not(target_os = "macos"))]
use crate::mcp::page_automation::protocol::unsupported_platform;

use crate::mcp::{
    page_automation::{
        actor::{NavigationMarker, PageAutomationState},
        images::EncodedPng,
        protocol::{
            document_not_found, screenshot_failed, webview_not_ready, CompactSnapshot,
            PageAutomationActionResult, PageAutomationBridgeRequest, PageAutomationBridgeResult,
            PageAutomationOperation, PageAutomationSuccessResult, PageKey,
        },
    },
    types::ToolError,
};

pub const PAGE_AUTOMATION_SCRIPT: &str = include_str!("page_automation_script.js");

pub fn page_automation_initialization_script() -> &'static str {
    PAGE_AUTOMATION_SCRIPT
}

pub fn page_key(document_window_label: &str, page_id: &str) -> PageKey {
    PageKey {
        document_id: document_window_label.to_string(),
        page_node_id: page_id.to_string(),
    }
}

fn expected_capture_label(key: &PageKey) -> String {
    scoped_page_label(&key.document_id, &key.page_node_id)
}

pub fn normalize_navigation_url(url: &str) -> Result<String, String> {
    tauri::Url::parse(url)
        .map(|url| url.to_string())
        .map_err(|error| format!("invalid page navigation URL: {error}"))
}

fn dispatch_expression(request: &PageAutomationBridgeRequest) -> Result<String, ToolError> {
    let request = serde_json::to_string(request).map_err(|_| {
        ToolError::new(
            "bridge_rejected",
            "Failed to serialize the page automation request.",
        )
    })?;
    Ok(format!(
        "window.__SHELTIE_MCP_PAGE_AUTOMATION__.dispatch({request});"
    ))
}

#[cfg(target_os = "macos")]
fn resolve_automation_webview(
    app: &AppHandle,
    key: &PageKey,
) -> Result<(String, tauri::Webview), ToolError> {
    let documents = app.state::<crate::commands::store::DocumentManagerState>();
    if !documents
        .contains_document(&key.document_id)
        .unwrap_or(false)
    {
        return Err(document_not_found(&key.document_id));
    }
    let label = expected_capture_label(key);
    let webview =
        resolve_page_webview(app, &key.document_id, &label).map_err(|_| webview_not_ready())?;
    Ok((label, webview))
}

#[cfg(target_os = "macos")]
fn dispatch_to_webview(
    webview: &tauri::Webview,
    request: PageAutomationBridgeRequest,
) -> Result<(), ToolError> {
    let expression = dispatch_expression(&request)?;
    webview.eval(&expression).map_err(|_| webview_not_ready())
}

#[cfg(target_os = "macos")]
pub async fn execute_page_automation(
    app: &AppHandle,
    key: PageKey,
    operation: PageAutomationOperation,
) -> Result<PageAutomationSuccessResult, ToolError> {
    let (webview_label, webview) = resolve_automation_webview(app, &key)?;

    let state = app.state::<PageAutomationState>();
    state
        .execute_with(
            key.clone(),
            key.document_id.clone(),
            webview_label,
            operation,
            move |request| dispatch_to_webview(&webview, request),
        )
        .await
}

#[cfg(target_os = "macos")]
pub async fn execute_raw_page_automation(
    app: &AppHandle,
    key: PageKey,
    operation: PageAutomationOperation,
) -> Result<PageAutomationActionResult, ToolError> {
    let (webview_label, webview) = resolve_automation_webview(app, &key)?;
    app.state::<PageAutomationState>()
        .execute_raw_with(
            key.clone(),
            key.document_id.clone(),
            webview_label,
            operation,
            move |request| dispatch_to_webview(&webview, request),
        )
        .await
}

#[cfg(target_os = "macos")]
pub async fn capture_page_viewport_screenshot(
    app: &AppHandle,
    key: PageKey,
) -> Result<EncodedPng, ToolError> {
    let (label, _) = resolve_automation_webview(app, &key)?;
    let bytes = super::snapshot::capture_webview_png_bytes(app, &label)
        .await
        .map_err(|_| screenshot_failed())?;
    let image = crate::mcp::page_automation::images::decode_png(&bytes)?;
    crate::mcp::page_automation::images::encode_capped_png(&image)
}

#[cfg(target_os = "macos")]
pub async fn capture_page_element_screenshot(
    app: &AppHandle,
    key: PageKey,
    snapshot_id: String,
    element_ref: String,
    annotate: bool,
) -> Result<EncodedPng, ToolError> {
    let (webview_label, webview) = resolve_automation_webview(app, &key)?;
    let capture_app = app.clone();
    let capture_label = webview_label.clone();
    app.state::<PageAutomationState>()
        .capture_element_with(
            key.clone(),
            key.document_id.clone(),
            webview_label,
            snapshot_id,
            element_ref,
            annotate,
            move |request| dispatch_to_webview(&webview, request),
            move || {
                let app = capture_app.clone();
                let label = capture_label.clone();
                async move {
                    super::snapshot::capture_webview_png_bytes(&app, &label)
                        .await
                        .map_err(|_| screenshot_failed())
                }
            },
        )
        .await
}

#[cfg(target_os = "macos")]
pub async fn capture_page_full_screenshot(
    app: &AppHandle,
    key: PageKey,
    annotate: bool,
) -> Result<EncodedPng, ToolError> {
    let (webview_label, webview) = resolve_automation_webview(app, &key)?;
    let capture_app = app.clone();
    let capture_label = webview_label.clone();
    app.state::<PageAutomationState>()
        .capture_full_page_with(
            key.clone(),
            key.document_id.clone(),
            webview_label,
            annotate,
            move |request| dispatch_to_webview(&webview, request),
            move || {
                let app = capture_app.clone();
                let label = capture_label.clone();
                async move {
                    super::snapshot::capture_webview_png_bytes(&app, &label)
                        .await
                        .map_err(|_| screenshot_failed())
                }
            },
        )
        .await
}

#[cfg(target_os = "macos")]
pub async fn prepare_page_navigation(
    app: &AppHandle,
    key: PageKey,
) -> Result<NavigationMarker, ToolError> {
    let (webview_label, webview) = resolve_automation_webview(app, &key)?;
    app.state::<PageAutomationState>()
        .prepare_navigation_with(
            key.clone(),
            key.document_id.clone(),
            webview_label,
            move |request| dispatch_to_webview(&webview, request),
        )
        .await
}

#[cfg(target_os = "macos")]
pub async fn snapshot_after_page_navigation(
    app: &AppHandle,
    marker: NavigationMarker,
    key: &PageKey,
) -> Result<CompactSnapshot, ToolError> {
    let (webview_label, webview) = resolve_automation_webview(app, key)?;
    app.state::<PageAutomationState>()
        .snapshot_after_navigation_with(
            marker,
            key.document_id.clone(),
            webview_label,
            move |request| dispatch_to_webview(&webview, request),
        )
        .await
}

#[cfg(not(target_os = "macos"))]
pub async fn execute_raw_page_automation(
    _app: &AppHandle,
    _key: PageKey,
    _operation: PageAutomationOperation,
) -> Result<PageAutomationActionResult, ToolError> {
    Err(unsupported_platform())
}

#[cfg(not(target_os = "macos"))]
pub async fn capture_page_viewport_screenshot(
    _app: &AppHandle,
    _key: PageKey,
) -> Result<EncodedPng, ToolError> {
    Err(unsupported_platform())
}

#[cfg(not(target_os = "macos"))]
pub async fn capture_page_element_screenshot(
    _app: &AppHandle,
    _key: PageKey,
    _snapshot_id: String,
    _element_ref: String,
    _annotate: bool,
) -> Result<EncodedPng, ToolError> {
    Err(unsupported_platform())
}

#[cfg(not(target_os = "macos"))]
pub async fn capture_page_full_screenshot(
    _app: &AppHandle,
    _key: PageKey,
    _annotate: bool,
) -> Result<EncodedPng, ToolError> {
    Err(unsupported_platform())
}

#[cfg(not(target_os = "macos"))]
pub async fn execute_page_automation(
    _app: &AppHandle,
    _key: PageKey,
    _operation: PageAutomationOperation,
) -> Result<PageAutomationSuccessResult, ToolError> {
    Err(unsupported_platform())
}

#[tauri::command]
pub async fn complete_page_automation_request(
    webview: Webview,
    state: tauri::State<'_, PageAutomationState>,
    result: PageAutomationBridgeResult,
) -> Result<(), String> {
    state.complete(webview.window().label(), webview.label(), result)
}

#[tauri::command]
pub async fn unregister_page_automation_page(
    window: Window,
    state: tauri::State<'_, PageAutomationState>,
    page_id: String,
) -> Result<(), String> {
    state.remove_page(&PageKey {
        document_id: window.label().to_string(),
        page_node_id: page_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn dispatches_only_the_fixed_bridge_entrypoint_with_serialized_data() {
        let request: PageAutomationBridgeRequest = serde_json::from_value(json!({
            "requestId": "pa-1",
            "documentId": "document-1",
            "pageNodeId": "page-1",
            "navigationEpoch": 3,
            "operation": {
                "kind": "fill",
                "snapshotId": "s3-1",
                "elementRef": "e1",
                "text": "'); globalThis.pwned = true; ('"
            }
        }))
        .unwrap();

        let expression = dispatch_expression(&request).unwrap();
        assert!(expression.starts_with("window.__SHELTIE_MCP_PAGE_AUTOMATION__.dispatch({"));
        assert!(expression.ends_with("});"));
        assert!(!expression.contains("eval("));
        assert!(expression.contains("globalThis.pwned = true"));
        assert_eq!(expression.matches(".dispatch(").count(), 1);
    }

    #[test]
    fn maps_page_identity_and_normalizes_navigation_urls() {
        assert_eq!(
            page_key("document-7", "node-4"),
            PageKey {
                document_id: "document-7".into(),
                page_node_id: "node-4".into(),
            }
        );
        assert_eq!(
            normalize_navigation_url("https://example.test").unwrap(),
            "https://example.test/"
        );
        assert_eq!(
            expected_capture_label(&page_key("document-7", "node-4")),
            "page-document-7-node-4"
        );
    }

    #[test]
    fn initialization_script_is_the_exact_tested_bridge_source() {
        assert_eq!(
            page_automation_initialization_script(),
            include_str!("page_automation_script.js")
        );
    }
}
