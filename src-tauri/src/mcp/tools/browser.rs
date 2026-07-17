use std::{future::Future, pin::Pin};

use rmcp::schemars;
use rmcp::schemars::JsonSchema;
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    tool, tool_router, Json,
};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[cfg(not(target_os = "macos"))]
use crate::mcp::page_automation::protocol::unsupported_platform;

#[cfg(target_os = "macos")]
use crate::commands::webview::{
    labels::scoped_page_label,
    page_automation::{prepare_page_navigation, snapshot_after_page_navigation},
};

use crate::{
    commands::webview::page_automation::execute_page_automation,
    mcp::{
        broker::McpRequestBrokerState,
        page_automation::protocol::{
            invalid_argument, page_not_found, webview_not_ready, CompactSnapshot, FillField,
            PageAutomationOperation, PageKey, WaitCondition, PAGE_AUTOMATION_MAX_FILL_CHARS,
            PAGE_AUTOMATION_MAX_WAIT_TIMEOUT_MS,
        },
        service::{structured_error, SheltieMcpService},
        types::{RendererCommand, ToolError},
    },
};

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
    fn execute(
        &self,
        key: PageKey,
        operation: PageAutomationOperation,
    ) -> BrowserFuture<'_, crate::mcp::page_automation::protocol::PageAutomationSuccessResult>;
    fn navigate(
        &self,
        key: PageKey,
        navigation: BrowserNavigation,
    ) -> BrowserFuture<'_, CompactSnapshot>;
}

pub(crate) struct UnavailableBrowserBackend;

impl BrowserBackend for UnavailableBrowserBackend {
    fn verify_page(&self, _key: PageKey) -> BrowserFuture<'_, ()> {
        Box::pin(async { Err(webview_not_ready()) })
    }

    fn execute(
        &self,
        _key: PageKey,
        _operation: PageAutomationOperation,
    ) -> BrowserFuture<'_, crate::mcp::page_automation::protocol::PageAutomationSuccessResult> {
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

    fn execute(
        &self,
        key: PageKey,
        operation: PageAutomationOperation,
    ) -> BrowserFuture<'_, crate::mcp::page_automation::protocol::PageAutomationSuccessResult> {
        let app = self.app.clone();
        Box::pin(async move { execute_page_automation(&app, key, operation).await })
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

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct PageParams {
    document_id: String,
    page_node_id: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct NavigateParams {
    document_id: String,
    page_node_id: String,
    url: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ElementParams {
    document_id: String,
    page_node_id: String,
    snapshot_id: String,
    element_ref: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FillParams {
    document_id: String,
    page_node_id: String,
    snapshot_id: String,
    element_ref: String,
    text: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FillFormParams {
    document_id: String,
    page_node_id: String,
    snapshot_id: String,
    fields: Vec<FillField>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SelectOptionParams {
    document_id: String,
    page_node_id: String,
    snapshot_id: String,
    element_ref: String,
    values: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct PressKeyParams {
    document_id: String,
    page_node_id: String,
    key: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ScrollParams {
    document_id: String,
    page_node_id: String,
    delta_x: i64,
    delta_y: i64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct WaitParams {
    document_id: String,
    page_node_id: String,
    condition: WaitCondition,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, JsonSchema, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum BrowserActionKind {
    Click,
    Hover,
    Fill,
    FillForm,
    SelectOption,
    PressKey,
    Scroll,
    Wait,
    Navigate,
}

impl From<crate::mcp::page_automation::protocol::PageAutomationActionKind> for BrowserActionKind {
    fn from(kind: crate::mcp::page_automation::protocol::PageAutomationActionKind) -> Self {
        match kind {
            crate::mcp::page_automation::protocol::PageAutomationActionKind::Click => Self::Click,
            crate::mcp::page_automation::protocol::PageAutomationActionKind::Hover => Self::Hover,
            crate::mcp::page_automation::protocol::PageAutomationActionKind::Fill => Self::Fill,
            crate::mcp::page_automation::protocol::PageAutomationActionKind::FillForm => {
                Self::FillForm
            }
            crate::mcp::page_automation::protocol::PageAutomationActionKind::SelectOption => {
                Self::SelectOption
            }
            crate::mcp::page_automation::protocol::PageAutomationActionKind::PressKey => {
                Self::PressKey
            }
            crate::mcp::page_automation::protocol::PageAutomationActionKind::Scroll => Self::Scroll,
            crate::mcp::page_automation::protocol::PageAutomationActionKind::Wait => Self::Wait,
        }
    }
}

#[derive(Clone, Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserActionResult {
    pub kind: BrowserActionKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Clone, Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserPageResult {
    pub document_id: String,
    pub page_node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<BrowserActionResult>,
    pub snapshot: CompactSnapshot,
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
            PageAutomationActionResult, PageAutomationSuccessResult, SnapshotFrame,
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

    #[derive(Clone, Default)]
    struct FakeBrowserBackend {
        operations: Arc<Mutex<Vec<(PageKey, PageAutomationOperation)>>>,
        navigations: Arc<Mutex<Vec<(PageKey, BrowserNavigation)>>>,
        verification_error: Arc<Mutex<Option<ToolError>>>,
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
                Ok(PageAutomationSuccessResult {
                    action: operation
                        .action_kind()
                        .map(|kind| PageAutomationActionResult { kind }),
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
        result.structured_content.unwrap()["code"]
            .as_str()
            .unwrap()
            .to_string()
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
    fn browser_router_exposes_exact_phase_two_metadata() {
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
                "browser_fill",
                "browser_fill_form",
                "browser_go_back",
                "browser_go_forward",
                "browser_hover",
                "browser_navigate",
                "browser_press_key",
                "browser_reload",
                "browser_scroll",
                "browser_select_option",
                "browser_snapshot",
                "browser_wait",
            ]
        );
        for tool in tools {
            let annotations = tool.annotations.as_ref().unwrap();
            if tool.name == "browser_snapshot" {
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
}
