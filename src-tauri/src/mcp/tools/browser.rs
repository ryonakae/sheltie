use std::{future::Future, pin::Pin};

use base64::Engine as _;
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    tool, tool_router, Json,
};
use tauri::Manager;

#[cfg(not(target_os = "macos"))]
use crate::mcp::page_automation::protocol::unsupported_platform;

#[cfg(target_os = "macos")]
use crate::commands::webview::{
    labels::scoped_page_label,
    page_automation::{
        capture_page_element_screenshot, capture_page_full_screenshot,
        capture_page_viewport_screenshot, execute_raw_page_automation, prepare_page_navigation,
        snapshot_after_page_navigation,
    },
};

use crate::{
    commands::webview::page_automation::execute_page_automation,
    mcp::{
        broker::McpRequestBrokerState,
        page_automation::protocol::{
            invalid_argument, page_not_found, webview_not_ready, CachedPageScreenshot,
            CompactSnapshot, DialogAction, PageAutomationActionResult, PageAutomationOperation,
            PageAutomationSuccessResult, PageDisplayMode, PageKey, PageScreenshotRequest,
            PageScreenshotSource, ScreenshotMode, UploadFilePayload,
            PAGE_AUTOMATION_MAX_FILL_CHARS, PAGE_AUTOMATION_MAX_WAIT_TIMEOUT_MS,
        },
        service::{image_result, structured_error, SheltieMcpService},
        types::{RendererCommand, ToolError},
    },
};

use crate::mcp::page_automation::images::{decode_png, encode_capped_png, EncodedPng};
#[cfg(target_os = "macos")]
use crate::mcp::page_automation::uploads::read_upload_files;

mod types;

use types::*;

pub(crate) type BrowserFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, ToolError>> + Send + 'a>>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum BrowserNavigation {
    Navigate(String),
    Back,
    Forward,
    Reload,
}

pub(crate) trait BrowserBackend: Send + Sync {
    fn verify_page(&self, key: PageKey) -> BrowserFuture<'_, ()>;
    fn screenshot_source(&self, key: PageKey) -> BrowserFuture<'_, PageScreenshotSource>;
    fn capture_viewport(&self, key: PageKey) -> BrowserFuture<'_, EncodedPng>;
    fn capture_element(
        &self,
        key: PageKey,
        snapshot_id: String,
        element_ref: String,
        annotate: bool,
    ) -> BrowserFuture<'_, EncodedPng>;
    fn capture_full_page(&self, key: PageKey, annotate: bool) -> BrowserFuture<'_, EncodedPng>;
    fn execute(
        &self,
        key: PageKey,
        operation: PageAutomationOperation,
    ) -> BrowserFuture<'_, PageAutomationSuccessResult>;
    fn execute_raw(
        &self,
        key: PageKey,
        operation: PageAutomationOperation,
    ) -> BrowserFuture<'_, PageAutomationActionResult>;
    fn read_uploads(&self, paths: Vec<String>) -> BrowserFuture<'_, Vec<UploadFilePayload>>;
    fn navigate(
        &self,
        key: PageKey,
        navigation: BrowserNavigation,
    ) -> BrowserFuture<'_, CompactSnapshot>;
}

#[cfg(test)]
pub(crate) struct UnavailableBrowserBackend;

#[cfg(test)]
impl BrowserBackend for UnavailableBrowserBackend {
    fn verify_page(&self, _key: PageKey) -> BrowserFuture<'_, ()> {
        Box::pin(async { Err(webview_not_ready()) })
    }

    fn screenshot_source(&self, _key: PageKey) -> BrowserFuture<'_, PageScreenshotSource> {
        Box::pin(async { Err(webview_not_ready()) })
    }

    fn capture_viewport(&self, _key: PageKey) -> BrowserFuture<'_, EncodedPng> {
        Box::pin(async { Err(webview_not_ready()) })
    }

    fn capture_element(
        &self,
        _key: PageKey,
        _snapshot_id: String,
        _element_ref: String,
        _annotate: bool,
    ) -> BrowserFuture<'_, EncodedPng> {
        Box::pin(async { Err(webview_not_ready()) })
    }

    fn capture_full_page(&self, _key: PageKey, _annotate: bool) -> BrowserFuture<'_, EncodedPng> {
        Box::pin(async { Err(webview_not_ready()) })
    }

    fn execute(
        &self,
        _key: PageKey,
        _operation: PageAutomationOperation,
    ) -> BrowserFuture<'_, PageAutomationSuccessResult> {
        Box::pin(async { Err(webview_not_ready()) })
    }

    fn execute_raw(
        &self,
        _key: PageKey,
        _operation: PageAutomationOperation,
    ) -> BrowserFuture<'_, PageAutomationActionResult> {
        Box::pin(async { Err(webview_not_ready()) })
    }

    fn read_uploads(&self, _paths: Vec<String>) -> BrowserFuture<'_, Vec<UploadFilePayload>> {
        Box::pin(async { Err(webview_not_ready()) })
    }

    fn navigate(
        &self,
        _key: PageKey,
        _navigation: BrowserNavigation,
    ) -> BrowserFuture<'_, CompactSnapshot> {
        Box::pin(async { Err(webview_not_ready()) })
    }
}

pub(crate) struct AppBrowserBackend {
    app: tauri::AppHandle,
}

impl AppBrowserBackend {
    pub(crate) fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl BrowserBackend for AppBrowserBackend {
    fn verify_page(&self, key: PageKey) -> BrowserFuture<'_, ()> {
        let app = self.app.clone();
        Box::pin(async move {
            let value = app
                .state::<McpRequestBrokerState>()
                .request(
                    &app,
                    &key.document_id,
                    RendererCommand::GetBoard,
                    serde_json::json!({
                        "nodeIds": [key.page_node_id],
                        "includeEdges": false
                    }),
                )
                .await
                .map_err(|error| map_page_verification_error(&key.page_node_id, error))?;
            let is_webpage = value
                .get("nodes")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|nodes| {
                    nodes.len() == 1
                        && nodes[0].get("id").and_then(serde_json::Value::as_str)
                            == Some(key.page_node_id.as_str())
                        && nodes[0].get("type").and_then(serde_json::Value::as_str)
                            == Some("webpage")
                });
            if is_webpage {
                Ok(())
            } else {
                Err(page_not_found(&key.page_node_id))
            }
        })
    }

    fn screenshot_source(&self, key: PageKey) -> BrowserFuture<'_, PageScreenshotSource> {
        let app = self.app.clone();
        Box::pin(async move {
            let value = app
                .state::<McpRequestBrokerState>()
                .request(
                    &app,
                    &key.document_id,
                    RendererCommand::GetPageScreenshotSource,
                    serde_json::json!({ "pageNodeId": key.page_node_id }),
                )
                .await?;
            serde_json::from_value(value).map_err(|_| {
                ToolError::new(
                    "renderer_unavailable",
                    "Renderer returned an invalid page screenshot source.",
                )
            })
        })
    }

    fn capture_viewport(&self, key: PageKey) -> BrowserFuture<'_, EncodedPng> {
        let app = self.app.clone();
        Box::pin(async move { capture_page_viewport_screenshot(&app, key).await })
    }

    fn capture_element(
        &self,
        key: PageKey,
        snapshot_id: String,
        element_ref: String,
        annotate: bool,
    ) -> BrowserFuture<'_, EncodedPng> {
        let app = self.app.clone();
        Box::pin(async move {
            capture_page_element_screenshot(&app, key, snapshot_id, element_ref, annotate).await
        })
    }

    fn capture_full_page(&self, key: PageKey, annotate: bool) -> BrowserFuture<'_, EncodedPng> {
        let app = self.app.clone();
        Box::pin(async move { capture_page_full_screenshot(&app, key, annotate).await })
    }

    fn execute(
        &self,
        key: PageKey,
        operation: PageAutomationOperation,
    ) -> BrowserFuture<'_, PageAutomationSuccessResult> {
        let app = self.app.clone();
        Box::pin(async move { execute_page_automation(&app, key, operation).await })
    }

    fn execute_raw(
        &self,
        key: PageKey,
        operation: PageAutomationOperation,
    ) -> BrowserFuture<'_, PageAutomationActionResult> {
        let app = self.app.clone();
        Box::pin(async move { execute_raw_page_automation(&app, key, operation).await })
    }

    fn read_uploads(&self, paths: Vec<String>) -> BrowserFuture<'_, Vec<UploadFilePayload>> {
        #[cfg(target_os = "macos")]
        {
            Box::pin(async move {
                tokio::task::spawn_blocking(move || read_upload_files(&paths))
                    .await
                    .map_err(|_| {
                        ToolError::new("upload_file_invalid", "Upload file could not be read.")
                    })?
            })
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = paths;
            Box::pin(async { Err(unsupported_platform()) })
        }
    }

    fn navigate(
        &self,
        key: PageKey,
        navigation: BrowserNavigation,
    ) -> BrowserFuture<'_, CompactSnapshot> {
        let app = self.app.clone();
        Box::pin(async move {
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app, key, navigation);
                return Err(unsupported_platform());
            }
            #[cfg(target_os = "macos")]
            {
                let marker = prepare_page_navigation(&app, key.clone()).await?;
                let label = scoped_page_label(&key.document_id, &key.page_node_id);
                let webview = app.get_webview(&label).ok_or_else(webview_not_ready)?;
                if webview.window().label() != key.document_id {
                    return Err(webview_not_ready());
                }
                let navigation_result = match navigation {
                    BrowserNavigation::Navigate(url) => {
                        let url = tauri::Url::parse(&url).map_err(|_| {
                            invalid_argument("url must be an absolute HTTP or HTTPS URL")
                        })?;
                        webview.navigate(url)
                    }
                    BrowserNavigation::Back => webview.eval("history.back()"),
                    BrowserNavigation::Forward => webview.eval("history.forward()"),
                    BrowserNavigation::Reload => webview.reload(),
                };
                navigation_result.map_err(|_| webview_not_ready())?;
                snapshot_after_page_navigation(&app, marker, &key).await
            }
        })
    }
}

fn encode_cached_screenshot(cached: CachedPageScreenshot) -> Result<EncodedPng, ToolError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(cached.base64)
        .map_err(|_| crate::mcp::page_automation::protocol::screenshot_failed())?;
    encode_capped_png(&decode_png(&bytes)?)
}

#[cfg(target_os = "macos")]
fn validate_page_key(document_id: String, page_node_id: String) -> Result<PageKey, ToolError> {
    if document_id.is_empty() {
        return Err(invalid_argument("documentId must not be empty"));
    }
    if page_node_id.is_empty() {
        return Err(invalid_argument("pageNodeId must not be empty"));
    }
    Ok(PageKey {
        document_id,
        page_node_id,
    })
}

#[cfg(not(target_os = "macos"))]
fn validate_page_key(_document_id: String, _page_node_id: String) -> Result<PageKey, ToolError> {
    Err(unsupported_platform())
}

fn map_page_verification_error(page_node_id: &str, error: ToolError) -> ToolError {
    if error.code == "validation_failed" && error.message.starts_with("Unknown node IDs:") {
        page_not_found(page_node_id)
    } else {
        error
    }
}

fn validate_navigation_url(url: &str) -> Result<String, ToolError> {
    let parsed = tauri::Url::parse(url)
        .map_err(|_| invalid_argument("url must be an absolute HTTP or HTTPS URL"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(invalid_argument(
            "url must be an absolute HTTP or HTTPS URL",
        ));
    }
    Ok(parsed.to_string())
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

impl SheltieMcpService {
    async fn verify_browser_page(&self, key: &PageKey) -> Result<(), rmcp::model::CallToolResult> {
        self.browser_backend
            .verify_page(key.clone())
            .await
            .map_err(structured_error)
    }

    async fn browser_screenshot_with(
        &self,
        key: PageKey,
        request: PageScreenshotRequest,
    ) -> Result<rmcp::model::CallToolResult, rmcp::model::CallToolResult> {
        request.validate().map_err(structured_error)?;
        self.verify_browser_page(&key).await?;
        let source = self
            .browser_backend
            .screenshot_source(key.clone())
            .await
            .map_err(structured_error)?;
        source
            .ensure_available(request.mode)
            .map_err(structured_error)?;
        let css_viewport_width = source.css_viewport_width;
        let css_viewport_height = source.css_viewport_height;

        let (image, image_source, annotated, warning) = match (source.display_mode, request.mode) {
            (PageDisplayMode::Native, ScreenshotMode::Viewport) => {
                match self.browser_backend.capture_viewport(key.clone()).await {
                    Ok(image) => (
                        image,
                        ScreenshotSource::Native,
                        false,
                        request.annotate.then(|| {
                            "Viewport screenshots have no element target to annotate.".into()
                        }),
                    ),
                    Err(_) => {
                        let cached = source.cached.ok_or_else(|| {
                            structured_error(
                                crate::mcp::page_automation::protocol::screenshot_failed(),
                            )
                        })?;
                        (
                            encode_cached_screenshot(cached).map_err(structured_error)?,
                            ScreenshotSource::Cached,
                            false,
                            Some(
                                if request.annotate {
                                    "Native screenshot failed; returned the existing cached image. Cached screenshot cannot be annotated without revealing the WebView."
                                } else {
                                    "Native screenshot failed; returned the existing cached image."
                                }
                                .into(),
                            ),
                        )
                    }
                }
            }
            (PageDisplayMode::Native, ScreenshotMode::Element) => {
                let image = self
                    .browser_backend
                    .capture_element(
                        key.clone(),
                        request.snapshot_id.expect("validated snapshotId"),
                        request.element_ref.expect("validated elementRef"),
                        request.annotate,
                    )
                    .await
                    .map_err(structured_error)?;
                (image, ScreenshotSource::Native, request.annotate, None)
            }
            (PageDisplayMode::Native, ScreenshotMode::FullPage) => {
                let image = self
                    .browser_backend
                    .capture_full_page(key.clone(), false)
                    .await
                    .map_err(structured_error)?;
                (
                    image,
                    ScreenshotSource::Native,
                    false,
                    request.annotate.then(|| {
                        "Full-page screenshots have no element target to annotate.".into()
                    }),
                )
            }
            (_, ScreenshotMode::Viewport) => {
                let cached = source
                    .cached
                    .expect("availability requires cached screenshot");
                let warning = request.annotate.then(|| {
                    "Cached screenshot cannot be annotated without revealing the WebView.".into()
                });
                (
                    encode_cached_screenshot(cached).map_err(structured_error)?,
                    ScreenshotSource::Cached,
                    false,
                    warning,
                )
            }
            _ => unreachable!("availability rejects non-native element and full-page captures"),
        };
        let metadata = BrowserScreenshotResult {
            document_id: key.document_id,
            page_node_id: key.page_node_id,
            mime_type: "image/png".into(),
            width: image.width,
            height: image.height,
            css_viewport_width,
            css_viewport_height,
            scale_applied: image.scale_applied,
            source: image_source,
            mode: request.mode,
            annotated,
            warning,
        };
        Ok(image_result(
            &metadata,
            [(
                base64::engine::general_purpose::STANDARD.encode(image.bytes),
                "image/png".into(),
            )],
        ))
    }

    async fn browser_execute(
        &self,
        key: PageKey,
        operation: PageAutomationOperation,
    ) -> Result<Json<BrowserPageResult>, rmcp::model::CallToolResult> {
        self.browser_backend
            .verify_page(key.clone())
            .await
            .map_err(structured_error)?;
        let result = self
            .browser_backend
            .execute(key.clone(), operation)
            .await
            .map_err(structured_error)?;
        Ok(Json(BrowserPageResult {
            document_id: key.document_id,
            page_node_id: key.page_node_id,
            action: result.action.map(|action| BrowserActionResult {
                kind: action.kind.into(),
                url: None,
                dialogs: action.dialogs,
            }),
            snapshot: result.snapshot,
        }))
    }

    async fn browser_navigate_with(
        &self,
        key: PageKey,
        navigation: BrowserNavigation,
    ) -> Result<Json<BrowserPageResult>, rmcp::model::CallToolResult> {
        self.browser_backend
            .verify_page(key.clone())
            .await
            .map_err(structured_error)?;
        let snapshot = self
            .browser_backend
            .navigate(key.clone(), navigation)
            .await
            .map_err(structured_error)?;
        let final_url = snapshot.url.clone();
        Ok(Json(BrowserPageResult {
            document_id: key.document_id,
            page_node_id: key.page_node_id,
            action: Some(BrowserActionResult {
                kind: BrowserActionKind::Navigate,
                url: Some(final_url),
                dialogs: None,
            }),
            snapshot,
        }))
    }
}

#[tool_router(router = browser_tool_router)]
impl SheltieMcpService {
    #[tool(
        name = "browser_snapshot",
        description = "Read a compact semantic snapshot from one Sheltie WebPage",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            open_world_hint = true
        )
    )]
    async fn browser_snapshot(
        &self,
        Parameters(params): Parameters<PageParams>,
    ) -> Result<Json<BrowserPageResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        self.browser_execute(key, PageAutomationOperation::Snapshot)
            .await
    }

    #[tool(
        name = "browser_navigate",
        description = "Navigate one Sheltie WebPage to an absolute HTTP or HTTPS URL",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_navigate(
        &self,
        Parameters(params): Parameters<NavigateParams>,
    ) -> Result<Json<BrowserPageResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        let url = validate_navigation_url(&params.url).map_err(structured_error)?;
        self.browser_navigate_with(key, BrowserNavigation::Navigate(url))
            .await
    }

    #[tool(
        name = "browser_go_back",
        description = "Navigate one Sheltie WebPage backward in its history",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_go_back(
        &self,
        Parameters(params): Parameters<PageParams>,
    ) -> Result<Json<BrowserPageResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        self.browser_navigate_with(key, BrowserNavigation::Back)
            .await
    }

    #[tool(
        name = "browser_go_forward",
        description = "Navigate one Sheltie WebPage forward in its history",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_go_forward(
        &self,
        Parameters(params): Parameters<PageParams>,
    ) -> Result<Json<BrowserPageResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        self.browser_navigate_with(key, BrowserNavigation::Forward)
            .await
    }

    #[tool(
        name = "browser_reload",
        description = "Reload one Sheltie WebPage and return its committed snapshot",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_reload(
        &self,
        Parameters(params): Parameters<PageParams>,
    ) -> Result<Json<BrowserPageResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        self.browser_navigate_with(key, BrowserNavigation::Reload)
            .await
    }

    #[tool(
        name = "browser_click",
        description = "Click a semantic element in one Sheltie WebPage",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_click(
        &self,
        Parameters(params): Parameters<ElementParams>,
    ) -> Result<Json<BrowserPageResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        self.browser_execute(
            key,
            PageAutomationOperation::Click {
                snapshot_id: params.snapshot_id,
                element_ref: params.element_ref,
            },
        )
        .await
    }

    #[tool(
        name = "browser_hover",
        description = "Hover a semantic element in one Sheltie WebPage",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_hover(
        &self,
        Parameters(params): Parameters<ElementParams>,
    ) -> Result<Json<BrowserPageResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        self.browser_execute(
            key,
            PageAutomationOperation::Hover {
                snapshot_id: params.snapshot_id,
                element_ref: params.element_ref,
            },
        )
        .await
    }

    #[tool(
        name = "browser_fill",
        description = "Replace text in one semantic field in a Sheltie WebPage",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_fill(
        &self,
        Parameters(params): Parameters<FillParams>,
    ) -> Result<Json<BrowserPageResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        let operation =
            PageAutomationOperation::fill(params.snapshot_id, params.element_ref, params.text)
                .map_err(structured_error)?;
        self.browser_execute(key, operation).await
    }

    #[tool(
        name = "browser_fill_form",
        description = "Atomically validate and fill semantic fields in one Sheltie WebPage",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_fill_form(
        &self,
        Parameters(params): Parameters<FillFormParams>,
    ) -> Result<Json<BrowserPageResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        if params.fields.is_empty() {
            return Err(structured_error(invalid_argument(
                "fields must not be empty",
            )));
        }
        let mut refs = std::collections::HashSet::new();
        for field in &params.fields {
            if !refs.insert(field.element_ref.as_str()) {
                return Err(structured_error(invalid_argument(
                    "fields must not contain duplicate elementRef values",
                )));
            }
            if utf16_len(&field.text) > PAGE_AUTOMATION_MAX_FILL_CHARS {
                return Err(structured_error(invalid_argument(format!(
                    "Fill text must not exceed {PAGE_AUTOMATION_MAX_FILL_CHARS} characters."
                ))));
            }
        }
        let operation = PageAutomationOperation::fill_form(params.snapshot_id, params.fields)
            .map_err(structured_error)?;
        self.browser_execute(key, operation).await
    }

    #[tool(
        name = "browser_select_option",
        description = "Select native option values in one Sheltie WebPage",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_select_option(
        &self,
        Parameters(params): Parameters<SelectOptionParams>,
    ) -> Result<Json<BrowserPageResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        if params.values.is_empty()
            || params.values.len() > 50
            || params.values.iter().any(String::is_empty)
        {
            return Err(structured_error(invalid_argument(
                "values must contain 1 to 50 non-empty strings",
            )));
        }
        self.browser_execute(
            key,
            PageAutomationOperation::SelectOption {
                snapshot_id: params.snapshot_id,
                element_ref: params.element_ref,
                values: params.values,
            },
        )
        .await
    }

    #[tool(
        name = "browser_press_key",
        description = "Press a key in one Sheltie WebPage",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_press_key(
        &self,
        Parameters(params): Parameters<PressKeyParams>,
    ) -> Result<Json<BrowserPageResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        if params.key.is_empty() || utf16_len(&params.key) > 64 {
            return Err(structured_error(invalid_argument(
                "key must contain 1 to 64 characters",
            )));
        }
        self.browser_execute(key, PageAutomationOperation::PressKey { key: params.key })
            .await
    }

    #[tool(
        name = "browser_scroll",
        description = "Scroll one Sheltie WebPage by signed CSS-pixel deltas",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_scroll(
        &self,
        Parameters(params): Parameters<ScrollParams>,
    ) -> Result<Json<BrowserPageResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        if !(-10_000..=10_000).contains(&params.delta_x)
            || !(-10_000..=10_000).contains(&params.delta_y)
        {
            return Err(structured_error(invalid_argument(
                "deltaX and deltaY must be integers from -10000 to 10000",
            )));
        }
        self.browser_execute(
            key,
            PageAutomationOperation::Scroll {
                delta_x: params.delta_x,
                delta_y: params.delta_y,
            },
        )
        .await
    }

    #[tool(
        name = "browser_wait",
        description = "Wait for a bounded semantic condition in one Sheltie WebPage",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_wait(
        &self,
        Parameters(params): Parameters<WaitParams>,
    ) -> Result<Json<BrowserPageResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        let timeout_ms = params.timeout_ms.unwrap_or(5_000);
        if timeout_ms > PAGE_AUTOMATION_MAX_WAIT_TIMEOUT_MS {
            return Err(structured_error(invalid_argument(format!(
                "Wait timeout must not exceed {PAGE_AUTOMATION_MAX_WAIT_TIMEOUT_MS} ms."
            ))));
        }
        let operation = PageAutomationOperation::wait(params.condition, timeout_ms)
            .map_err(structured_error)?;
        self.browser_execute(key, operation).await
    }

    #[tool(
        name = "browser_screenshot",
        description = "Capture one Sheltie WebPage viewport, element, or full page without revealing hidden WebViews",
        output_schema = rmcp::handler::server::common::schema_for_output::<BrowserScreenshotResult>().expect("valid browser screenshot output schema"),
        annotations(read_only_hint = true, destructive_hint = false, open_world_hint = true)
    )]
    async fn browser_screenshot(
        &self,
        Parameters(params): Parameters<ScreenshotParams>,
    ) -> Result<rmcp::model::CallToolResult, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        self.browser_screenshot_with(
            key,
            PageScreenshotRequest {
                mode: params.mode,
                snapshot_id: params.snapshot_id,
                element_ref: params.element_ref,
                annotate: params.annotate,
            },
        )
        .await
    }

    #[tool(
        name = "browser_click_coordinates",
        description = "Send untrusted synthetic pointer and mouse events at CSS viewport coordinates when no semantic element is available",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_click_coordinates(
        &self,
        Parameters(params): Parameters<ClickCoordinatesParams>,
    ) -> Result<Json<CoordinateResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        let operation = PageAutomationOperation::click_coordinates(
            params.snapshot_id,
            params.x,
            params.y,
            params.button,
            params.click_count,
            params.highlight,
        )
        .map_err(structured_error)?;
        self.verify_browser_page(&key).await?;
        let result = self
            .browser_backend
            .execute(key.clone(), operation)
            .await
            .map_err(structured_error)?;
        let action = result.action.ok_or_else(|| {
            structured_error(crate::mcp::page_automation::protocol::bridge_rejected())
        })?;
        Ok(Json(CoordinateResult {
            document_id: key.document_id,
            page_node_id: key.page_node_id,
            input_trusted: action.input_trusted.unwrap_or(false),
            dialogs: action.dialogs,
            snapshot: result.snapshot,
        }))
    }

    #[tool(
        name = "browser_evaluate",
        description = "Run arbitrary page-origin JavaScript in one trusted Sheltie WebPage and return only its JSON-safe value",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_evaluate(
        &self,
        Parameters(params): Parameters<EvaluateParams>,
    ) -> Result<Json<EvaluateResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        let operation = PageAutomationOperation::Evaluate {
            script: params.script,
        };
        operation.validate().map_err(structured_error)?;
        self.verify_browser_page(&key).await?;
        let result = self
            .browser_backend
            .execute(key.clone(), operation)
            .await
            .map_err(structured_error)?;
        let action = result.action.ok_or_else(|| {
            structured_error(crate::mcp::page_automation::protocol::bridge_rejected())
        })?;
        Ok(Json(EvaluateResult {
            document_id: key.document_id,
            page_node_id: key.page_node_id,
            value: action.value,
            dialogs: action.dialogs,
            snapshot: result.snapshot,
        }))
    }

    #[tool(
        name = "browser_upload_file",
        description = "Assign trusted-client readable absolute files to a semantic file input with synthetic untrusted events",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_upload_file(
        &self,
        Parameters(params): Parameters<UploadParams>,
    ) -> Result<Json<UploadResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        if params.paths.is_empty()
            || params
                .paths
                .iter()
                .any(|path| !std::path::Path::new(path).is_absolute())
        {
            return Err(structured_error(invalid_argument(
                "paths must contain at least one absolute path",
            )));
        }
        self.verify_browser_page(&key).await?;
        let files = self
            .browser_backend
            .read_uploads(params.paths)
            .await
            .map_err(structured_error)?;
        let operation = PageAutomationOperation::UploadFiles {
            snapshot_id: params.snapshot_id,
            element_ref: params.element_ref,
            files,
        };
        operation.validate().map_err(structured_error)?;
        let result = self
            .browser_backend
            .execute(key.clone(), operation)
            .await
            .map_err(structured_error)?;
        let action = result.action.ok_or_else(|| {
            structured_error(crate::mcp::page_automation::protocol::bridge_rejected())
        })?;
        let files = action
            .files
            .ok_or_else(|| {
                structured_error(crate::mcp::page_automation::protocol::bridge_rejected())
            })?
            .into_iter()
            .map(|file| UploadedFileResult {
                name: file.name,
                size: file.size,
            })
            .collect();
        Ok(Json(UploadResult {
            document_id: key.document_id,
            page_node_id: key.page_node_id,
            files,
            input_trusted: action.input_trusted.unwrap_or(false),
            dialogs: action.dialogs,
            snapshot: result.snapshot,
        }))
    }

    #[tool(
        name = "browser_handle_dialog",
        description = "Configure the next page dialog shim response before retrying an action",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = true
        )
    )]
    async fn browser_handle_dialog(
        &self,
        Parameters(params): Parameters<DialogParams>,
    ) -> Result<Json<DialogResult>, rmcp::model::CallToolResult> {
        let key =
            validate_page_key(params.document_id, params.page_node_id).map_err(structured_error)?;
        if params.action == DialogAction::Dismiss && params.prompt_text.is_some() {
            return Err(structured_error(invalid_argument(
                "promptText is supported only when action is accept",
            )));
        }
        self.verify_browser_page(&key).await?;
        let result = self
            .browser_backend
            .execute_raw(
                key.clone(),
                PageAutomationOperation::SetDialogHandler {
                    action: params.action,
                    prompt_text: params.prompt_text,
                },
            )
            .await
            .map_err(structured_error)?;
        Ok(Json(DialogResult {
            document_id: key.document_id,
            page_node_id: key.page_node_id,
            configured: result.configured.unwrap_or(false),
        }))
    }
}

pub(crate) fn tool_router() -> ToolRouter<SheltieMcpService> {
    SheltieMcpService::browser_tool_router()
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::mcp::{
        page_automation::protocol::{
            FillField, MouseButton, PageAutomationActionResult, PageAutomationSuccessResult,
            SnapshotFrame,
        },
        service::{McpBackendFuture, McpServiceBackend},
        types::DocumentSummary,
    };

    struct DummyMcpBackend;

    impl McpServiceBackend for DummyMcpBackend {
        fn list_documents(&self) -> Result<Vec<DocumentSummary>, ToolError> {
            Ok(Vec::new())
        }

        fn request(
            &self,
            _document_id: &str,
            _command: RendererCommand,
            _params: serde_json::Value,
        ) -> McpBackendFuture<'_> {
            Box::pin(async { Ok(serde_json::json!({})) })
        }
    }

    #[derive(Clone)]
    struct FakeBrowserBackend {
        operations: Arc<Mutex<Vec<(PageKey, PageAutomationOperation)>>>,
        navigations: Arc<Mutex<Vec<(PageKey, BrowserNavigation)>>>,
        verification_error: Arc<Mutex<Option<ToolError>>>,
        screenshot_source: Arc<Mutex<PageScreenshotSource>>,
        native_capture_calls: Arc<std::sync::atomic::AtomicUsize>,
        native_capture_fails: Arc<std::sync::atomic::AtomicBool>,
        element_capture_args: Arc<Mutex<Vec<(String, String, bool)>>>,
        upload_paths: Arc<Mutex<Vec<Vec<String>>>>,
    }

    impl Default for FakeBrowserBackend {
        fn default() -> Self {
            Self {
                operations: Arc::new(Mutex::new(Vec::new())),
                navigations: Arc::new(Mutex::new(Vec::new())),
                verification_error: Arc::new(Mutex::new(None)),
                screenshot_source: Arc::new(Mutex::new(PageScreenshotSource {
                    display_mode: PageDisplayMode::Native,
                    css_viewport_width: 720,
                    css_viewport_height: 500,
                    cached: None,
                })),
                native_capture_calls: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
                native_capture_fails: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                element_capture_args: Arc::new(Mutex::new(Vec::new())),
                upload_paths: Arc::new(Mutex::new(Vec::new())),
            }
        }
    }

    fn fake_image() -> EncodedPng {
        EncodedPng {
            bytes: b"fake-png".to_vec(),
            width: 1,
            height: 1,
            scale_applied: 1.0,
        }
    }

    fn cached_source(mode: PageDisplayMode) -> PageScreenshotSource {
        let image = image::RgbaImage::from_pixel(1, 1, image::Rgba([1, 2, 3, 255]));
        let encoded = encode_capped_png(&image).unwrap();
        PageScreenshotSource {
            display_mode: mode,
            css_viewport_width: 720,
            css_viewport_height: 500,
            cached: Some(CachedPageScreenshot {
                base64: base64::engine::general_purpose::STANDARD.encode(encoded.bytes),
                width: 1,
                height: 1,
                captured_at: "2026-07-17T00:00:00Z".into(),
                captured_url: None,
            }),
        }
    }

    fn snapshot(epoch: u64, url: &str) -> CompactSnapshot {
        CompactSnapshot {
            snapshot_id: format!("s{epoch}-1"),
            document_token: "0123456789abcdef0123456789abcdef".into(),
            navigation_epoch: epoch,
            url: url.into(),
            title: "Fixture".into(),
            compact_text: String::new(),
            elements: Vec::new(),
            frames: Vec::<SnapshotFrame>::new(),
            truncated: false,
        }
    }

    impl BrowserBackend for FakeBrowserBackend {
        fn verify_page(&self, _key: PageKey) -> BrowserFuture<'_, ()> {
            let error = self.verification_error.lock().unwrap().clone();
            Box::pin(async move { error.map_or(Ok(()), Err) })
        }

        fn screenshot_source(&self, _key: PageKey) -> BrowserFuture<'_, PageScreenshotSource> {
            let source = self.screenshot_source.lock().unwrap().clone();
            Box::pin(async move { Ok(source) })
        }

        fn capture_viewport(&self, _key: PageKey) -> BrowserFuture<'_, EncodedPng> {
            let calls = self.native_capture_calls.clone();
            let fails = self.native_capture_fails.clone();
            Box::pin(async move {
                calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if fails.load(std::sync::atomic::Ordering::SeqCst) {
                    Err(webview_not_ready())
                } else {
                    Ok(fake_image())
                }
            })
        }

        fn capture_element(
            &self,
            _key: PageKey,
            snapshot_id: String,
            element_ref: String,
            annotate: bool,
        ) -> BrowserFuture<'_, EncodedPng> {
            self.element_capture_args
                .lock()
                .unwrap()
                .push((snapshot_id, element_ref, annotate));
            Box::pin(async { Ok(fake_image()) })
        }

        fn capture_full_page(
            &self,
            _key: PageKey,
            _annotate: bool,
        ) -> BrowserFuture<'_, EncodedPng> {
            Box::pin(async { Ok(fake_image()) })
        }

        fn execute_raw(
            &self,
            _key: PageKey,
            operation: PageAutomationOperation,
        ) -> BrowserFuture<'_, PageAutomationActionResult> {
            Box::pin(async move {
                Ok(PageAutomationActionResult {
                    kind: operation.raw_action_kind().unwrap(),
                    input_trusted: None,
                    value: serde_json::Value::Null,
                    files: None,
                    dialogs: None,
                    configured: Some(true),
                    geometry: None,
                })
            })
        }

        fn read_uploads(&self, paths: Vec<String>) -> BrowserFuture<'_, Vec<UploadFilePayload>> {
            self.upload_paths.lock().unwrap().push(paths);
            Box::pin(async {
                Ok(vec![UploadFilePayload {
                    name: "fixture.txt".into(),
                    mime_type: "text/plain".into(),
                    size: 7,
                    bytes_base64: "Zml4dHVyZQ==".into(),
                }])
            })
        }

        fn execute(
            &self,
            key: PageKey,
            operation: PageAutomationOperation,
        ) -> BrowserFuture<'_, PageAutomationSuccessResult> {
            self.operations
                .lock()
                .unwrap()
                .push((key, operation.clone()));
            Box::pin(async move {
                let action = operation.action_kind().map(|kind| {
                    let (input_trusted, value, files) = match &operation {
                        PageAutomationOperation::ClickCoordinates { .. } => {
                            (Some(false), serde_json::Value::Null, None)
                        }
                        PageAutomationOperation::Evaluate { script } => (
                            None,
                            if script == "null" {
                                serde_json::Value::Null
                            } else {
                                serde_json::json!({"ok": true})
                            },
                            None,
                        ),
                        PageAutomationOperation::UploadFiles { files, .. } => (
                            Some(false),
                            serde_json::Value::Null,
                            Some(
                                files
                                    .iter()
                                    .map(|file| crate::mcp::page_automation::protocol::UploadedFileMetadata {
                                        name: file.name.clone(),
                                        size: file.size,
                                    })
                                    .collect(),
                            ),
                        ),
                        _ => (None, serde_json::Value::Null, None),
                    };
                    PageAutomationActionResult {
                        kind,
                        input_trusted,
                        value,
                        files,
                        dialogs: None,
                        configured: None,
                        geometry: None,
                    }
                });
                Ok(PageAutomationSuccessResult {
                    action,
                    snapshot: snapshot(2, "https://example.test/after"),
                })
            })
        }

        fn navigate(
            &self,
            key: PageKey,
            navigation: BrowserNavigation,
        ) -> BrowserFuture<'_, CompactSnapshot> {
            self.navigations.lock().unwrap().push((key, navigation));
            Box::pin(async { Ok(snapshot(3, "https://example.test/target")) })
        }
    }

    fn service(browser: FakeBrowserBackend) -> SheltieMcpService {
        SheltieMcpService::with_backends(DummyMcpBackend, browser)
    }

    fn error_code(result: rmcp::model::CallToolResult) -> String {
        let value: serde_json::Value =
            serde_json::from_str(&result.content[0].as_text().unwrap().text).unwrap();
        value["code"].as_str().unwrap().to_string()
    }

    #[test]
    fn maps_only_unknown_node_verification_to_page_not_found() {
        let mapped = map_page_verification_error(
            "page-9",
            ToolError::new("validation_failed", "Unknown node IDs: page-9"),
        );
        assert_eq!(mapped.code, "page_not_found");
        let renderer = map_page_verification_error(
            "page-9",
            ToolError::new("renderer_unavailable", "Renderer closed"),
        );
        assert_eq!(renderer.code, "renderer_unavailable");
    }

    #[test]
    fn rejects_non_http_navigation_urls() {
        for url in [
            "relative",
            "javascript:alert(1)",
            "file:///tmp/a",
            "data:text/plain,a",
        ] {
            assert_eq!(
                validate_navigation_url(url).unwrap_err().code,
                "invalid_argument"
            );
        }
        assert_eq!(
            validate_navigation_url("https://example.test").unwrap(),
            "https://example.test/"
        );
    }

    #[test]
    fn browser_router_exposes_phase_three_metadata() {
        let router = tool_router();
        let tools = router.list_all();
        let names = tools
            .iter()
            .map(|tool| tool.name.as_ref())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                "browser_click",
                "browser_click_coordinates",
                "browser_evaluate",
                "browser_fill",
                "browser_fill_form",
                "browser_go_back",
                "browser_go_forward",
                "browser_handle_dialog",
                "browser_hover",
                "browser_navigate",
                "browser_press_key",
                "browser_reload",
                "browser_screenshot",
                "browser_scroll",
                "browser_select_option",
                "browser_snapshot",
                "browser_upload_file",
                "browser_wait",
            ]
        );
        let evaluate = tools
            .iter()
            .find(|tool| tool.name.as_ref() == "browser_evaluate")
            .unwrap();
        let evaluate_schema =
            serde_json::to_value(evaluate.output_schema.as_ref().unwrap()).unwrap();
        assert_eq!(
            evaluate_schema.pointer("/properties/value"),
            Some(&serde_json::json!({}))
        );

        for tool in tools {
            let annotations = tool.annotations.as_ref().unwrap();
            if matches!(
                tool.name.as_ref(),
                "browser_snapshot" | "browser_screenshot"
            ) {
                assert_eq!(annotations.read_only_hint, Some(true));
                assert_eq!(annotations.destructive_hint, Some(false));
            } else {
                assert_eq!(annotations.read_only_hint, Some(false));
                assert_eq!(annotations.destructive_hint, Some(true));
            }
            let schema = serde_json::to_value(&tool.input_schema).unwrap();
            assert!(schema["required"]
                .as_array()
                .unwrap()
                .iter()
                .any(|field| field == "documentId"));
            assert!(schema["required"]
                .as_array()
                .unwrap()
                .iter()
                .any(|field| field == "pageNodeId"));
        }
    }

    #[tokio::test]
    async fn click_preserves_refs_and_returns_the_actor_snapshot() {
        let backend = FakeBrowserBackend::default();
        let service = service(backend.clone());
        let result = service
            .browser_click(Parameters(ElementParams {
                document_id: "document-1".into(),
                page_node_id: "page-1".into(),
                snapshot_id: "s1-7".into(),
                element_ref: "f2:e9".into(),
            }))
            .await
            .unwrap()
            .0;
        let operations = backend.operations.lock().unwrap();
        assert_eq!(operations.len(), 1);
        assert!(matches!(
            &operations[0].1,
            PageAutomationOperation::Click { snapshot_id, element_ref }
                if snapshot_id == "s1-7" && element_ref == "f2:e9"
        ));
        assert_eq!(result.snapshot.navigation_epoch, 2);
        assert!(matches!(
            result.action.unwrap().kind,
            BrowserActionKind::Click
        ));
    }

    #[tokio::test]
    async fn validation_and_page_verification_fail_before_dispatch() {
        let backend = FakeBrowserBackend::default();
        let service = service(backend.clone());
        let empty_page = service
            .browser_snapshot(Parameters(PageParams {
                document_id: "document-1".into(),
                page_node_id: String::new(),
            }))
            .await
            .err()
            .unwrap();
        assert_eq!(error_code(empty_page), "invalid_argument");

        *backend.verification_error.lock().unwrap() = Some(page_not_found("note-1"));
        let sticky = service
            .browser_snapshot(Parameters(PageParams {
                document_id: "document-1".into(),
                page_node_id: "note-1".into(),
            }))
            .await
            .err()
            .unwrap();
        assert_eq!(error_code(sticky), "page_not_found");
        assert!(backend.operations.lock().unwrap().is_empty());

        *backend.verification_error.lock().unwrap() = None;
        let duplicate = service
            .browser_fill_form(Parameters(FillFormParams {
                document_id: "document-1".into(),
                page_node_id: "page-1".into(),
                snapshot_id: "s1-1".into(),
                fields: vec![
                    FillField {
                        element_ref: "e1".into(),
                        text: "a".into(),
                    },
                    FillField {
                        element_ref: "e1".into(),
                        text: "b".into(),
                    },
                ],
            }))
            .await
            .err()
            .unwrap();
        assert_eq!(error_code(duplicate), "invalid_argument");
        assert!(backend.operations.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn navigation_is_normalized_and_dispatched_once() {
        let backend = FakeBrowserBackend::default();
        let service = service(backend.clone());
        let result = service
            .browser_navigate(Parameters(NavigateParams {
                document_id: "document-1".into(),
                page_node_id: "page-1".into(),
                url: "https://example.test".into(),
            }))
            .await
            .unwrap()
            .0;
        assert_eq!(result.snapshot.navigation_epoch, 3);
        let action = result.action.unwrap();
        assert!(matches!(action.kind, BrowserActionKind::Navigate));
        assert_eq!(action.url.as_deref(), Some("https://example.test/target"));
        assert_eq!(
            backend.navigations.lock().unwrap().as_slice(),
            [(
                PageKey {
                    document_id: "document-1".into(),
                    page_node_id: "page-1".into(),
                },
                BrowserNavigation::Navigate("https://example.test/".into()),
            )]
        );
    }

    #[tokio::test]
    async fn cached_screenshot_never_captures_or_reveals_a_hidden_page() {
        let backend = FakeBrowserBackend::default();
        *backend.screenshot_source.lock().unwrap() = cached_source(PageDisplayMode::Hidden);
        let service = service(backend.clone());
        let result = service
            .browser_screenshot(Parameters(ScreenshotParams {
                document_id: "document-1".into(),
                page_node_id: "page-1".into(),
                mode: ScreenshotMode::Viewport,
                snapshot_id: None,
                element_ref: None,
                annotate: true,
            }))
            .await
            .unwrap();
        assert_eq!(
            backend
                .native_capture_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            0
        );
        assert_eq!(result.content.len(), 2);
        assert!(result.content[1].as_image().is_some());
        let metadata = result.structured_content.unwrap();
        assert_eq!(metadata["source"], "cached");
        assert_eq!(metadata["cssViewportWidth"], 720);
        assert_eq!(metadata["cssViewportHeight"], 500);
        assert_eq!(metadata["annotated"], false);
        assert_eq!(
            metadata["warning"],
            "Cached screenshot cannot be annotated without revealing the WebView."
        );
        assert!(metadata.get("base64").is_none());

        let hidden_element = service
            .browser_screenshot(Parameters(ScreenshotParams {
                document_id: "document-1".into(),
                page_node_id: "page-1".into(),
                mode: ScreenshotMode::Element,
                snapshot_id: Some("s2-1".into()),
                element_ref: Some("e1".into()),
                annotate: false,
            }))
            .await
            .unwrap_err();
        assert_eq!(error_code(hidden_element), "live_webview_required");
        assert_eq!(
            backend
                .native_capture_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            0
        );
    }

    #[tokio::test]
    async fn native_viewport_captures_once_then_uses_cache_only_after_failure() {
        let backend = FakeBrowserBackend::default();
        *backend.screenshot_source.lock().unwrap() = cached_source(PageDisplayMode::Native);
        backend
            .native_capture_fails
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let service = service(backend.clone());
        let result = service
            .browser_screenshot(Parameters(ScreenshotParams {
                document_id: "document-1".into(),
                page_node_id: "page-1".into(),
                mode: ScreenshotMode::Viewport,
                snapshot_id: None,
                element_ref: None,
                annotate: true,
            }))
            .await
            .unwrap();
        assert_eq!(
            backend
                .native_capture_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            1
        );
        let metadata = result.structured_content.unwrap();
        assert_eq!(metadata["source"], "cached");
        assert_eq!(
            metadata["warning"],
            "Native screenshot failed; returned the existing cached image. Cached screenshot cannot be annotated without revealing the WebView."
        );
        assert_eq!(metadata["annotated"], false);
    }

    #[tokio::test]
    async fn native_element_capture_preserves_the_caller_snapshot_ref_pair() {
        let backend = FakeBrowserBackend::default();
        let service = service(backend.clone());

        let result = service
            .browser_screenshot(Parameters(ScreenshotParams {
                document_id: "document-1".into(),
                page_node_id: "page-1".into(),
                mode: ScreenshotMode::Element,
                snapshot_id: Some("s7-3".into()),
                element_ref: Some("e9".into()),
                annotate: true,
            }))
            .await
            .unwrap();

        assert_eq!(
            backend.element_capture_args.lock().unwrap().as_slice(),
            [("s7-3".into(), "e9".into(), true)]
        );
        assert_eq!(result.structured_content.unwrap()["annotated"], true);
        assert!(backend.operations.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn extended_actions_validate_and_return_typed_post_action_results() {
        let backend = FakeBrowserBackend::default();
        let service = service(backend.clone());
        let coordinate = service
            .browser_click_coordinates(Parameters(ClickCoordinatesParams {
                document_id: "document-1".into(),
                page_node_id: "page-1".into(),
                snapshot_id: "s1-1".into(),
                x: 10.0,
                y: 20.0,
                button: MouseButton::Left,
                click_count: 1,
                highlight: None,
            }))
            .await
            .unwrap()
            .0;
        assert!(!coordinate.input_trusted);
        assert_eq!(coordinate.snapshot.snapshot_id, "s2-1");

        let evaluated = service
            .browser_evaluate(Parameters(EvaluateParams {
                document_id: "document-1".into(),
                page_node_id: "page-1".into(),
                script: "null".into(),
            }))
            .await
            .unwrap()
            .0;
        assert_eq!(evaluated.value, serde_json::Value::Null);

        let upload = service
            .browser_upload_file(Parameters(UploadParams {
                document_id: "document-1".into(),
                page_node_id: "page-1".into(),
                snapshot_id: "s1-1".into(),
                element_ref: "e1".into(),
                paths: vec!["/tmp/fixture.txt".into()],
            }))
            .await
            .unwrap()
            .0;
        assert_eq!(upload.files[0].name, "fixture.txt");
        assert!(!upload.input_trusted);
        assert_eq!(
            backend.upload_paths.lock().unwrap().as_slice(),
            &[vec!["/tmp/fixture.txt".to_string()]]
        );

        let empty = service
            .browser_evaluate(Parameters(EvaluateParams {
                document_id: "document-1".into(),
                page_node_id: "page-1".into(),
                script: String::new(),
            }))
            .await
            .err()
            .expect("empty script should be rejected");
        assert_eq!(error_code(empty), "invalid_argument");
        let dialog = service
            .browser_handle_dialog(Parameters(DialogParams {
                document_id: "document-1".into(),
                page_node_id: "page-1".into(),
                action: DialogAction::Accept,
                prompt_text: Some("ok".into()),
            }))
            .await
            .unwrap()
            .0;
        assert!(dialog.configured);
    }

    #[tokio::test]
    async fn upload_and_dialog_boundary_validation_prevent_dispatch() {
        let backend = FakeBrowserBackend::default();
        let service = service(backend.clone());
        let upload = service
            .browser_upload_file(Parameters(UploadParams {
                document_id: "document-1".into(),
                page_node_id: "page-1".into(),
                snapshot_id: "s1-1".into(),
                element_ref: "e1".into(),
                paths: vec!["relative.txt".into()],
            }))
            .await
            .err()
            .expect("relative upload path should be rejected");
        assert_eq!(error_code(upload), "invalid_argument");
        assert!(backend.upload_paths.lock().unwrap().is_empty());
        let dialog = service
            .browser_handle_dialog(Parameters(DialogParams {
                document_id: "document-1".into(),
                page_node_id: "page-1".into(),
                action: DialogAction::Dismiss,
                prompt_text: Some("not allowed".into()),
            }))
            .await
            .err()
            .expect("dismiss prompt text should be rejected");
        assert_eq!(error_code(dialog), "invalid_argument");
    }
}
