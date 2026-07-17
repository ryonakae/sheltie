use rmcp::schemars;
use rmcp::schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry: Option<String>,
}

impl ToolError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retry: None,
        }
    }

    pub fn with_retry(mut self, retry: impl Into<String>) -> Self {
        self.retry = Some(retry.into());
        self
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RendererCommand {
    GetEditorState,
    GetBoard,
    BatchEditBoard,
    FocusNodes,
    GetWebpageScreenshots,
    GetBoardScreenshot,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererRequest {
    pub request_id: String,
    pub command: RendererCommand,
    pub params: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererResponse {
    pub request_id: String,
    pub result: RendererResult,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererResult {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ToolError>,
}

impl RendererResult {
    #[cfg(test)]
    pub fn success(data: serde_json::Value) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn into_result(self) -> Result<serde_json::Value, ToolError> {
        match (self.ok, self.data, self.error) {
            (true, Some(data), None) => Ok(data),
            (false, None, Some(error)) => Err(error),
            _ => Err(ToolError::new(
                "renderer_unavailable",
                "Renderer returned an invalid response envelope",
            )),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, JsonSchema, Serialize)]
pub struct ListDocumentsParams {}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentParams {
    pub document_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BoardNodeType {
    Webpage,
    Stickynote,
    Text,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetBoardParams {
    pub document_id: String,
    #[serde(default)]
    pub node_ids: Option<Vec<String>>,
    #[serde(default)]
    pub node_types: Option<Vec<BoardNodeType>>,
    #[serde(default)]
    pub include_edges: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchEditBoardParams {
    pub document_id: String,
    pub operations: Vec<serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusNodesParams {
    pub document_id: String,
    pub node_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetWebpageScreenshotsParams {
    pub document_id: String,
    #[serde(default)]
    pub page_node_ids: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetBoardScreenshotParams {
    pub document_id: String,
    #[serde(default)]
    pub node_ids: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub document_id: String,
    pub file_path: Option<String>,
    pub untitled_index: usize,
    pub focused: bool,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDocumentsResult {
    pub documents: Vec<DocumentSummary>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorStateResult {
    pub document_id: String,
    pub selected_node_ids: Vec<String>,
    pub selected_edge_ids: Vec<String>,
    pub viewport: ViewportResult,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportResult {
    pub zoom: f64,
    pub pan_x: f64,
    pub pan_y: f64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardResult {
    pub document_id: String,
    pub nodes: Vec<serde_json::Value>,
    pub edges: Vec<serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchEditBoardResult {
    pub document_id: String,
    pub changed: bool,
    pub created_node_ids: Vec<String>,
    pub updated_node_ids: Vec<String>,
    pub deleted_node_ids: Vec<String>,
    pub created_edge_ids: Vec<String>,
    pub updated_edge_ids: Vec<String>,
    pub deleted_edge_ids: Vec<String>,
    pub temp_id_map: std::collections::BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusNodesResult {
    pub document_id: String,
    pub focused_node_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScreenshotFreshness {
    Cached,
    Missing,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererWebpageScreenshotResult {
    pub page_node_id: String,
    pub freshness: ScreenshotFreshness,
    pub mime_type: Option<String>,
    pub base64: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub captured_at: Option<String>,
    pub captured_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebpageScreenshotMetadata {
    pub page_node_id: String,
    pub freshness: ScreenshotFreshness,
    pub mime_type: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub captured_at: Option<String>,
    pub captured_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebpageScreenshotsResult {
    pub document_id: String,
    pub screenshots: Vec<WebpageScreenshotMetadata>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldBoundsResult {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererBoardScreenshotResult {
    pub mime_type: String,
    pub base64: String,
    pub width: u32,
    pub height: u32,
    pub world_bounds: WorldBoundsResult,
    pub included_node_ids: Vec<String>,
    pub missing_screenshot_node_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardScreenshotResult {
    pub document_id: String,
    pub mime_type: String,
    pub width: u32,
    pub height: u32,
    pub world_bounds: WorldBoundsResult,
    pub included_node_ids: Vec<String>,
    pub missing_screenshot_node_ids: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_request_uses_camel_case_contract() {
        let request = RendererRequest {
            request_id: "request-1".into(),
            command: RendererCommand::GetBoard,
            params: serde_json::json!({"includeEdges": true}),
        };
        assert_eq!(
            serde_json::to_value(request).unwrap(),
            serde_json::json!({
                "requestId": "request-1",
                "command": "getBoard",
                "params": {"includeEdges": true}
            })
        );
    }

    #[test]
    fn tool_error_is_stable_and_actionable() {
        let error = ToolError::new("document_not_found", "Document document-9 is not open")
            .with_retry("Call list_documents and use a returned documentId");
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({
                "code": "document_not_found",
                "message": "Document document-9 is not open",
                "retry": "Call list_documents and use a returned documentId"
            })
        );
    }

    #[test]
    fn renderer_result_rejects_inconsistent_envelopes() {
        let result = RendererResult {
            ok: true,
            data: None,
            error: None,
        };
        assert_eq!(
            result.into_result().unwrap_err().code,
            "renderer_unavailable"
        );
    }
}
