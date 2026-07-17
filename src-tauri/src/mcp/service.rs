use std::{
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, Implementation, ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router, Json, ServerHandler,
};
use serde::{de::DeserializeOwned, Serialize};
use tauri::Manager;

use super::{
    broker::McpRequestBrokerState,
    types::{
        BatchEditBoardParams, BatchEditBoardResult, BoardResult, BoardScreenshotResult,
        DocumentSummary, EditorStateResult, FocusNodesParams, FocusNodesResult, GetBoardParams,
        GetBoardScreenshotParams, GetWebpageScreenshotsParams, ListDocumentsParams,
        ListDocumentsResult, RendererBoardScreenshotResult, RendererCommand,
        RendererWebpageScreenshotResult, ScreenshotFreshness, ToolError, WebpageScreenshotMetadata,
        WebpageScreenshotsResult,
    },
    MCP_ENDPOINT,
};
use crate::{
    commands::store::{focused_document_window_label, DocumentManagerState},
    menus::mcp::update_mcp_connection_count,
};

pub(crate) type McpBackendFuture<'a> =
    Pin<Box<dyn Future<Output = Result<serde_json::Value, ToolError>> + Send + 'a>>;

pub(crate) trait McpServiceBackend: Send + Sync {
    fn list_documents(&self) -> Result<Vec<DocumentSummary>, ToolError>;

    fn request(
        &self,
        document_id: &str,
        command: RendererCommand,
        params: serde_json::Value,
    ) -> McpBackendFuture<'_>;
}

struct AppMcpServiceBackend {
    app: tauri::AppHandle,
}

impl McpServiceBackend for AppMcpServiceBackend {
    fn list_documents(&self) -> Result<Vec<DocumentSummary>, ToolError> {
        self.app
            .state::<DocumentManagerState>()
            .document_summaries(focused_document_window_label(&self.app).as_deref())
            .map_err(|error| ToolError::new("renderer_unavailable", error))
    }

    fn request(
        &self,
        document_id: &str,
        command: RendererCommand,
        params: serde_json::Value,
    ) -> McpBackendFuture<'_> {
        let app = self.app.clone();
        let document_id = document_id.to_string();
        Box::pin(async move {
            app.state::<McpRequestBrokerState>()
                .request(&app, &document_id, command, params)
                .await
        })
    }
}

#[derive(Default)]
pub(crate) struct McpConnectionCounter {
    count: AtomicUsize,
}

impl McpConnectionCounter {
    pub(crate) fn lease(self: &Arc<Self>, app: tauri::AppHandle) -> McpConnectionLease {
        let count = self.count.fetch_add(1, Ordering::AcqRel) + 1;
        update_connection_menu(&app, count);
        McpConnectionLease {
            _inner: Arc::new(McpConnectionLeaseInner {
                counter: self.clone(),
                app,
            }),
        }
    }
}

struct McpConnectionLeaseInner {
    counter: Arc<McpConnectionCounter>,
    app: tauri::AppHandle,
}

impl Drop for McpConnectionLeaseInner {
    fn drop(&mut self) {
        let count = self.counter.count.fetch_sub(1, Ordering::AcqRel) - 1;
        update_connection_menu(&self.app, count);
    }
}

#[derive(Clone)]
pub(crate) struct McpConnectionLease {
    _inner: Arc<McpConnectionLeaseInner>,
}

fn update_connection_menu(app: &tauri::AppHandle, count: usize) {
    let app_for_menu = app.clone();
    let _ = app.run_on_main_thread(move || update_mcp_connection_count(&app_for_menu, count));
}

#[derive(Clone)]
pub struct SheltieMcpService {
    backend: Arc<dyn McpServiceBackend>,
    _connection_lease: Option<McpConnectionLease>,
    tool_router: ToolRouter<Self>,
}

impl SheltieMcpService {
    pub(crate) fn from_app(app: tauri::AppHandle, connections: Arc<McpConnectionCounter>) -> Self {
        Self::with_backend_and_lease(
            AppMcpServiceBackend { app: app.clone() },
            connections.lease(app),
        )
    }

    #[cfg(test)]
    fn with_backend(backend: impl McpServiceBackend + 'static) -> Self {
        Self {
            backend: Arc::new(backend),
            _connection_lease: None,
            tool_router: Self::tool_router(),
        }
    }

    fn with_backend_and_lease(
        backend: impl McpServiceBackend + 'static,
        connection_lease: McpConnectionLease,
    ) -> Self {
        Self {
            backend: Arc::new(backend),
            _connection_lease: Some(connection_lease),
            tool_router: Self::tool_router(),
        }
    }

    async fn request(
        &self,
        document_id: &str,
        command: RendererCommand,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, CallToolResult> {
        validate_document_id(document_id)?;
        self.backend
            .request(document_id, command, params)
            .await
            .map_err(structured_error)
    }
}

fn validate_document_id(document_id: &str) -> Result<(), CallToolResult> {
    if document_id.is_empty() {
        return Err(structured_error(ToolError::new(
            "validation_failed",
            "documentId must not be empty",
        )));
    }
    Ok(())
}

fn structured_error(error: ToolError) -> CallToolResult {
    let value = serde_json::to_value(error).unwrap_or_else(|_| {
        serde_json::json!({
            "code": "renderer_unavailable",
            "message": "Failed to encode tool error"
        })
    });
    CallToolResult::structured_error(value)
}

fn decode_renderer_result<T: DeserializeOwned>(
    value: serde_json::Value,
) -> Result<T, CallToolResult> {
    serde_json::from_value(value).map_err(|_| {
        structured_error(ToolError::new(
            "renderer_unavailable",
            "Renderer returned data that does not match the MCP contract",
        ))
    })
}

fn decode_document_result<T: DeserializeOwned>(
    document_id: &str,
    mut value: serde_json::Value,
) -> Result<T, CallToolResult> {
    let Some(object) = value.as_object_mut() else {
        return Err(structured_error(ToolError::new(
            "renderer_unavailable",
            "Renderer returned a non-object document result",
        )));
    };
    object.insert(
        "documentId".to_string(),
        serde_json::Value::String(document_id.to_string()),
    );
    decode_renderer_result(value)
}

fn image_result<T: Serialize>(
    metadata: &T,
    images: impl IntoIterator<Item = (String, String)>,
) -> CallToolResult {
    let value = match serde_json::to_value(metadata) {
        Ok(value) => value,
        Err(_) => {
            return structured_error(ToolError::new(
                "renderer_unavailable",
                "Failed to encode MCP image metadata",
            ));
        }
    };
    let mut result = CallToolResult::structured(value);
    result.content.extend(
        images
            .into_iter()
            .map(|(base64, mime_type)| rmcp::model::ContentBlock::image(base64, mime_type)),
    );
    result
}

#[tool_router(router = tool_router)]
impl SheltieMcpService {
    #[tool(
        name = "list_documents",
        description = "List every open Sheltie document and identify the focused document",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            open_world_hint = false
        )
    )]
    async fn list_documents(
        &self,
        _params: Parameters<ListDocumentsParams>,
    ) -> Result<Json<ListDocumentsResult>, CallToolResult> {
        self.backend
            .list_documents()
            .map(|documents| Json(ListDocumentsResult { documents }))
            .map_err(structured_error)
    }

    #[tool(
        name = "get_editor_state",
        description = "Read selection and viewport from one open Sheltie document without changing them",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            open_world_hint = false
        )
    )]
    async fn get_editor_state(
        &self,
        Parameters(params): Parameters<super::types::DocumentParams>,
    ) -> Result<Json<EditorStateResult>, CallToolResult> {
        let value = self
            .request(
                &params.document_id,
                RendererCommand::GetEditorState,
                serde_json::json!({}),
            )
            .await?;
        decode_document_result(&params.document_id, value).map(Json)
    }

    #[tool(
        name = "get_board",
        description = "Read nodes and edges from one open Sheltie document without changing selection or viewport",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            open_world_hint = false
        )
    )]
    async fn get_board(
        &self,
        Parameters(params): Parameters<GetBoardParams>,
    ) -> Result<Json<BoardResult>, CallToolResult> {
        let mut renderer_params = serde_json::Map::new();
        if let Some(node_ids) = params.node_ids {
            renderer_params.insert("nodeIds".into(), serde_json::json!(node_ids));
        }
        if let Some(node_types) = params.node_types {
            renderer_params.insert("nodeTypes".into(), serde_json::json!(node_types));
        }
        if let Some(include_edges) = params.include_edges {
            renderer_params.insert("includeEdges".into(), serde_json::json!(include_edges));
        }
        let value = self
            .request(
                &params.document_id,
                RendererCommand::GetBoard,
                serde_json::Value::Object(renderer_params),
            )
            .await?;
        decode_document_result(&params.document_id, value).map(Json)
    }

    #[tool(
        name = "batch_edit_board",
        description = "Atomically apply validated board operations to one open Sheltie document",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            open_world_hint = false
        )
    )]
    async fn batch_edit_board(
        &self,
        Parameters(params): Parameters<BatchEditBoardParams>,
    ) -> Result<Json<BatchEditBoardResult>, CallToolResult> {
        let value = self
            .request(
                &params.document_id,
                RendererCommand::BatchEditBoard,
                serde_json::json!({"operations": params.operations}),
            )
            .await?;
        decode_document_result(&params.document_id, value).map(Json)
    }

    #[tool(
        name = "focus_nodes",
        description = "Select and fit explicit nodes in one open Sheltie document without changing board contents",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn focus_nodes(
        &self,
        Parameters(params): Parameters<FocusNodesParams>,
    ) -> Result<Json<FocusNodesResult>, CallToolResult> {
        let value = self
            .request(
                &params.document_id,
                RendererCommand::FocusNodes,
                serde_json::json!({"nodeIds": params.node_ids}),
            )
            .await?;
        decode_document_result(&params.document_id, value).map(Json)
    }

    #[tool(
        name = "get_webpage_screenshots",
        description = "Return cached WebPage screenshots in board order without changing the viewport",
        output_schema = rmcp::handler::server::common::schema_for_output::<WebpageScreenshotsResult>().expect("valid webpage screenshot output schema"),
        annotations(read_only_hint = true, destructive_hint = false, open_world_hint = false)
    )]
    async fn get_webpage_screenshots(
        &self,
        Parameters(params): Parameters<GetWebpageScreenshotsParams>,
    ) -> Result<CallToolResult, CallToolResult> {
        let mut renderer_params = serde_json::Map::new();
        if let Some(page_node_ids) = params.page_node_ids {
            renderer_params.insert("pageNodeIds".into(), serde_json::json!(page_node_ids));
        }
        let value = self
            .request(
                &params.document_id,
                RendererCommand::GetWebpageScreenshots,
                serde_json::Value::Object(renderer_params),
            )
            .await?;
        let screenshots: Vec<RendererWebpageScreenshotResult> = decode_renderer_result(value)?;
        let mut metadata_screenshots = Vec::with_capacity(screenshots.len());
        let mut images = Vec::new();
        for screenshot in screenshots {
            if matches!(screenshot.freshness, ScreenshotFreshness::Cached) {
                let (Some(base64), Some(mime_type)) =
                    (screenshot.base64.as_ref(), screenshot.mime_type.as_ref())
                else {
                    return Err(structured_error(ToolError::new(
                        "renderer_unavailable",
                        "Cached screenshot is missing image data",
                    )));
                };
                images.push((base64.clone(), mime_type.clone()));
            }
            metadata_screenshots.push(WebpageScreenshotMetadata {
                page_node_id: screenshot.page_node_id,
                freshness: screenshot.freshness,
                mime_type: screenshot.mime_type,
                width: screenshot.width,
                height: screenshot.height,
                captured_at: screenshot.captured_at,
                captured_url: screenshot.captured_url,
            });
        }
        let metadata = WebpageScreenshotsResult {
            document_id: params.document_id,
            screenshots: metadata_screenshots,
        };
        Ok(image_result(&metadata, images))
    }

    #[tool(
        name = "get_board_screenshot",
        description = "Return a full-board PNG from cached WebPage images without changing the viewport",
        output_schema = rmcp::handler::server::common::schema_for_output::<BoardScreenshotResult>().expect("valid board screenshot output schema"),
        annotations(read_only_hint = true, destructive_hint = false, open_world_hint = false)
    )]
    async fn get_board_screenshot(
        &self,
        Parameters(params): Parameters<GetBoardScreenshotParams>,
    ) -> Result<CallToolResult, CallToolResult> {
        let mut renderer_params = serde_json::Map::new();
        if let Some(node_ids) = params.node_ids {
            renderer_params.insert("nodeIds".into(), serde_json::json!(node_ids));
        }
        let value = self
            .request(
                &params.document_id,
                RendererCommand::GetBoardScreenshot,
                serde_json::Value::Object(renderer_params),
            )
            .await?;
        let screenshot: RendererBoardScreenshotResult = decode_renderer_result(value)?;
        let metadata = BoardScreenshotResult {
            document_id: params.document_id,
            mime_type: screenshot.mime_type.clone(),
            width: screenshot.width,
            height: screenshot.height,
            world_bounds: screenshot.world_bounds,
            included_node_ids: screenshot.included_node_ids,
            missing_screenshot_node_ids: screenshot.missing_screenshot_node_ids,
        };
        Ok(image_result(
            &metadata,
            [(screenshot.base64, screenshot.mime_type)],
        ))
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for SheltieMcpService {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("sheltie", env!("CARGO_PKG_VERSION")))
            .with_instructions(format!(
                "Operate open Sheltie documents through {MCP_ENDPOINT}. Enablement is controlled by the Sheltie Settings menu."
            ))
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::VecDeque, sync::Mutex};

    use rmcp::{
        handler::server::wrapper::Parameters,
        model::{CallToolResult, ContentBlock},
    };

    use super::*;
    use crate::mcp::types::{
        BatchEditBoardParams, GetBoardParams, GetBoardScreenshotParams,
        GetWebpageScreenshotsParams, RendererCommand, ToolError,
    };

    #[derive(Default)]
    struct FakeBackend {
        responses: Mutex<VecDeque<Result<serde_json::Value, ToolError>>>,
    }

    impl FakeBackend {
        fn with_responses(
            responses: impl IntoIterator<Item = Result<serde_json::Value, ToolError>>,
        ) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().collect()),
            }
        }
    }

    impl McpServiceBackend for FakeBackend {
        fn list_documents(&self) -> Result<Vec<DocumentSummary>, ToolError> {
            Ok(vec![DocumentSummary {
                document_id: "document-1".into(),
                file_path: None,
                untitled_index: 1,
                focused: true,
            }])
        }

        fn request(
            &self,
            _document_id: &str,
            _command: RendererCommand,
            _params: serde_json::Value,
        ) -> McpBackendFuture<'_> {
            let response = self
                .responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Ok(serde_json::json!({})));
            Box::pin(async move { response })
        }
    }

    fn service_with_responses(
        responses: impl IntoIterator<Item = Result<serde_json::Value, ToolError>>,
    ) -> SheltieMcpService {
        SheltieMcpService::with_backend(FakeBackend::with_responses(responses))
    }

    fn error_value(result: CallToolResult) -> serde_json::Value {
        assert_eq!(result.is_error, Some(true));
        result.structured_content.expect("structured error")
    }

    #[test]
    fn lists_exactly_seven_tools_with_document_schemas_and_annotations() {
        let service = service_with_responses([]);
        let tools = service.tool_router.list_all();
        assert_eq!(
            tools
                .iter()
                .map(|tool| tool.name.as_ref())
                .collect::<Vec<_>>(),
            vec![
                "batch_edit_board",
                "focus_nodes",
                "get_board",
                "get_board_screenshot",
                "get_editor_state",
                "get_webpage_screenshots",
                "list_documents",
            ]
        );

        for tool in tools.iter().filter(|tool| tool.name != "list_documents") {
            let schema = serde_json::to_value(&tool.input_schema).unwrap();
            assert!(
                schema["properties"].get("documentId").is_some(),
                "{}",
                tool.name
            );
            assert!(schema["required"]
                .as_array()
                .unwrap()
                .iter()
                .any(|field| field == "documentId"));
            assert!(tool.output_schema.is_some(), "{}", tool.name);
        }

        for name in [
            "list_documents",
            "get_editor_state",
            "get_board",
            "get_webpage_screenshots",
            "get_board_screenshot",
        ] {
            let annotations = service
                .tool_router
                .get(name)
                .unwrap()
                .annotations
                .as_ref()
                .unwrap();
            assert_eq!(annotations.read_only_hint, Some(true), "{name}");
            assert_eq!(annotations.destructive_hint, Some(false), "{name}");
            assert_eq!(annotations.open_world_hint, Some(false), "{name}");
        }
        let batch = service
            .tool_router
            .get("batch_edit_board")
            .unwrap()
            .annotations
            .as_ref()
            .unwrap();
        assert_eq!(batch.destructive_hint, Some(true));
        let focus = service
            .tool_router
            .get("focus_nodes")
            .unwrap()
            .annotations
            .as_ref()
            .unwrap();
        assert_eq!(focus.idempotent_hint, Some(true));
        assert_eq!(focus.destructive_hint, Some(false));
    }

    #[tokio::test]
    async fn preserves_document_and_renderer_errors_as_structured_errors() {
        let document_error =
            ToolError::new("document_not_found", "Document document-9 is not open")
                .with_retry("Call list_documents and use a returned documentId");
        let timeout = ToolError::new(
            "renderer_timeout",
            "Renderer did not respond within 10000 ms",
        );
        let service = service_with_responses([Err(document_error.clone()), Err(timeout.clone())]);

        let document_result = service
            .get_board(Parameters(GetBoardParams {
                document_id: "document-9".into(),
                node_ids: None,
                node_types: None,
                include_edges: None,
            }))
            .await
            .err()
            .expect("document request should fail");
        assert_eq!(
            error_value(document_result),
            serde_json::to_value(document_error).unwrap()
        );

        let timeout_result = service
            .get_board(Parameters(GetBoardParams {
                document_id: "document-1".into(),
                node_ids: None,
                node_types: None,
                include_edges: None,
            }))
            .await
            .err()
            .expect("renderer request should time out");
        assert_eq!(
            error_value(timeout_result),
            serde_json::to_value(timeout).unwrap()
        );
    }

    #[tokio::test]
    async fn preserves_atomic_batch_validation_errors() {
        let error = ToolError::new(
            "validation_failed",
            "Operation 1 references missing node missing-node",
        );
        let service = service_with_responses([Err(error.clone())]);
        let result = service
            .batch_edit_board(Parameters(BatchEditBoardParams {
                document_id: "document-1".into(),
                operations: vec![
                    serde_json::json!({"op": "delete_node", "nodeId": "missing-node"}),
                ],
            }))
            .await
            .err()
            .expect("invalid batch should fail");
        assert_eq!(error_value(result), serde_json::to_value(error).unwrap());
    }

    #[tokio::test]
    async fn returns_webpage_images_in_board_order_after_metadata() {
        let service = service_with_responses([Ok(serde_json::json!([
            {"pageNodeId": "page-a", "freshness": "cached", "mimeType": "image/png", "base64": "aGVsbG8=", "width": 1, "height": 1, "capturedAt": "2026-07-17T00:00:00Z", "capturedUrl": "https://a.example"},
            {"pageNodeId": "page-b", "freshness": "missing"},
            {"pageNodeId": "page-c", "freshness": "cached", "mimeType": "image/png", "base64": "d29ybGQ=", "width": 1, "height": 1, "capturedAt": "2026-07-17T00:00:01Z", "capturedUrl": null}
        ]))]);
        let result = service
            .get_webpage_screenshots(Parameters(GetWebpageScreenshotsParams {
                document_id: "document-1".into(),
                page_node_ids: None,
            }))
            .await
            .unwrap();

        assert_eq!(result.is_error, Some(false));
        assert_eq!(result.content.len(), 3);
        assert!(matches!(result.content[0], ContentBlock::Text(_)));
        assert_eq!(result.content[1].as_image().unwrap().data, "aGVsbG8=");
        assert_eq!(result.content[2].as_image().unwrap().data, "d29ybGQ=");
        let structured = result.structured_content.unwrap();
        assert_eq!(
            structured["screenshots"]
                .as_array()
                .unwrap()
                .iter()
                .map(|screenshot| screenshot["pageNodeId"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["page-a", "page-b", "page-c"]
        );
        assert!(structured["screenshots"][0].get("base64").is_none());
    }

    #[tokio::test]
    async fn returns_board_metadata_without_base64_then_one_image() {
        let service = service_with_responses([Ok(serde_json::json!({
            "mimeType": "image/png",
            "base64": "Ym9hcmQ=",
            "width": 1200,
            "height": 800,
            "worldBounds": {"x": -64.0, "y": -64.0, "width": 1200.0, "height": 800.0},
            "includedNodeIds": ["node-a"],
            "missingScreenshotNodeIds": []
        }))]);

        let result = service
            .get_board_screenshot(Parameters(GetBoardScreenshotParams {
                document_id: "document-1".into(),
                node_ids: None,
            }))
            .await
            .unwrap();

        assert_eq!(result.content.len(), 2);
        assert!(matches!(result.content[0], ContentBlock::Text(_)));
        assert_eq!(result.content[1].as_image().unwrap().data, "Ym9hcmQ=");
        let structured = result.structured_content.unwrap();
        assert_eq!(structured["documentId"], "document-1");
        assert!(structured.get("base64").is_none());
    }
}
