//! browser tool の入出力データ契約。
//! browser.rs は tool 登録とハンドラ本体に専念させ、params / result 型はここに置く。

use rmcp::schemars;
use rmcp::schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::mcp::page_automation::protocol::{
    CompactSnapshot, CssRect, DialogAction, FillField, MouseButton, PageDialog, ScreenshotMode,
    WaitCondition,
};

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct PageParams {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct NavigateParams {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) url: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct ElementParams {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) snapshot_id: String,
    pub(super) element_ref: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct FillParams {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) snapshot_id: String,
    pub(super) element_ref: String,
    pub(super) text: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct FillFormParams {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) snapshot_id: String,
    pub(super) fields: Vec<FillField>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct SelectOptionParams {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) snapshot_id: String,
    pub(super) element_ref: String,
    pub(super) values: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct PressKeyParams {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) key: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct ScrollParams {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) delta_x: i64,
    pub(super) delta_y: i64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct WaitParams {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) condition: WaitCondition,
    #[serde(default)]
    pub(super) timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct ScreenshotParams {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) mode: ScreenshotMode,
    #[serde(default)]
    pub(super) snapshot_id: Option<String>,
    #[serde(default)]
    pub(super) element_ref: Option<String>,
    #[serde(default)]
    pub(super) annotate: bool,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct ClickCoordinatesParams {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) snapshot_id: String,
    pub(super) x: f64,
    pub(super) y: f64,
    #[serde(default = "default_mouse_button")]
    pub(super) button: MouseButton,
    #[serde(default = "default_click_count")]
    pub(super) click_count: u8,
    #[serde(default)]
    pub(super) highlight: Option<CssRect>,
}

pub(super) fn default_mouse_button() -> MouseButton {
    MouseButton::Left
}

pub(super) fn default_click_count() -> u8 {
    1
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct EvaluateParams {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) script: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct UploadParams {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) snapshot_id: String,
    pub(super) element_ref: String,
    pub(super) paths: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct DialogParams {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) action: DialogAction,
    #[serde(default)]
    pub(super) prompt_text: Option<String>,
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
    ScreenshotElement,
    ScreenshotFullPage,
    ScreenshotScroll,
    ScreenshotRestore,
    ClickCoordinates,
    Evaluate,
    UploadFiles,
    SetDialogHandler,
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
            crate::mcp::page_automation::protocol::PageAutomationActionKind::ScreenshotElement => {
                Self::ScreenshotElement
            }
            crate::mcp::page_automation::protocol::PageAutomationActionKind::ScreenshotFullPage => {
                Self::ScreenshotFullPage
            }
            crate::mcp::page_automation::protocol::PageAutomationActionKind::ScreenshotScroll => {
                Self::ScreenshotScroll
            }
            crate::mcp::page_automation::protocol::PageAutomationActionKind::ScreenshotRestore => {
                Self::ScreenshotRestore
            }
            crate::mcp::page_automation::protocol::PageAutomationActionKind::ClickCoordinates => {
                Self::ClickCoordinates
            }
            crate::mcp::page_automation::protocol::PageAutomationActionKind::Evaluate => {
                Self::Evaluate
            }
            crate::mcp::page_automation::protocol::PageAutomationActionKind::UploadFiles => {
                Self::UploadFiles
            }
            crate::mcp::page_automation::protocol::PageAutomationActionKind::SetDialogHandler => {
                Self::SetDialogHandler
            }
        }
    }
}

#[derive(Clone, Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserActionResult {
    pub kind: BrowserActionKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dialogs: Option<Vec<PageDialog>>,
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

#[derive(Clone, Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BrowserScreenshotResult {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) mime_type: String,
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) css_viewport_width: u32,
    pub(super) css_viewport_height: u32,
    pub(super) scale_applied: f64,
    pub(super) source: ScreenshotSource,
    pub(super) mode: ScreenshotMode,
    pub(super) annotated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) warning: Option<String>,
}

#[derive(Clone, Copy, Debug, JsonSchema, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum ScreenshotSource {
    Native,
    Cached,
}

#[derive(Clone, Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CoordinateResult {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) input_trusted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) dialogs: Option<Vec<PageDialog>>,
    pub(super) snapshot: CompactSnapshot,
}

pub(super) fn json_value_output_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    serde_json::Map::new().into()
}

#[derive(Clone, Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EvaluateResult {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    #[schemars(schema_with = "json_value_output_schema")]
    pub(super) value: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) dialogs: Option<Vec<PageDialog>>,
    pub(super) snapshot: CompactSnapshot,
}

#[derive(Clone, Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UploadedFileResult {
    pub(super) name: String,
    pub(super) size: u64,
}

#[derive(Clone, Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UploadResult {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) files: Vec<UploadedFileResult>,
    pub(super) input_trusted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) dialogs: Option<Vec<PageDialog>>,
    pub(super) snapshot: CompactSnapshot,
}

#[derive(Clone, Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DialogResult {
    pub(super) document_id: String,
    pub(super) page_node_id: String,
    pub(super) configured: bool,
}
