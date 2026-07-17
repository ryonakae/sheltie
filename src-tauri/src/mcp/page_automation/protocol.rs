use rmcp::schemars;
use rmcp::schemars::JsonSchema;

use crate::mcp::types::ToolError;

pub const PAGE_AUTOMATION_REQUEST_TIMEOUT_MS: u64 = 15_000;
pub const PAGE_AUTOMATION_SETTLE_DELAY_MS: u64 = 250;
pub const PAGE_AUTOMATION_SETTLE_POLL_MS: u64 = 50;
pub const PAGE_AUTOMATION_SETTLE_TIMEOUT_MS: u64 = 5_000;
#[allow(dead_code)]
pub const PAGE_AUTOMATION_FRAME_RESPONSE_TIMEOUT_MS: u64 = 750;
pub const PAGE_AUTOMATION_MAX_SNAPSHOT_ELEMENTS: usize = 200;
pub const PAGE_AUTOMATION_MAX_SNAPSHOT_CHARS: usize = 20_000;
pub const PAGE_AUTOMATION_MAX_TEXT_CHARS: usize = 512;
pub const PAGE_AUTOMATION_MAX_FILL_CHARS: usize = 10_000;
pub const PAGE_AUTOMATION_MAX_WAIT_TIMEOUT_MS: u64 = 10_000;
pub const PAGE_AUTOMATION_EVALUATE_TIMEOUT_MS: u64 = 10_000;
pub const PAGE_AUTOMATION_MAX_EVALUATE_RESPONSE_BYTES: usize = 256 * 1024;
pub const PAGE_AUTOMATION_MAX_SCREENSHOT_EDGE_PX: u32 = 4_096;
pub const PAGE_AUTOMATION_MAX_SCREENSHOT_PIXELS: u64 = 16_777_216;
pub const PAGE_AUTOMATION_MAX_SCREENSHOT_PNG_BYTES: usize = 8 * 1024 * 1024;
pub const PAGE_AUTOMATION_MAX_FULL_PAGE_TILES: usize = 64;
pub const PAGE_AUTOMATION_MAX_UPLOAD_FILES: usize = 10;
pub const PAGE_AUTOMATION_MAX_UPLOAD_FILE_BYTES: u64 = 25 * 1024 * 1024;
pub const PAGE_AUTOMATION_MAX_UPLOAD_TOTAL_BYTES: u64 = 100 * 1024 * 1024;
pub const PAGE_AUTOMATION_HIGHLIGHT_FADE_MS: u32 = 180;

#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScreenshotMode {
    Viewport,
    Element,
    FullPage,
}

#[derive(Clone, Debug, JsonSchema, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageScreenshotRequest {
    pub mode: ScreenshotMode,
    pub element_ref: Option<String>,
    pub annotate: bool,
}

impl PageScreenshotRequest {
    pub fn validate(&self) -> Result<(), ToolError> {
        if self.mode == ScreenshotMode::Element
            && self.element_ref.as_deref().is_none_or(str::is_empty)
        {
            return Err(invalid_argument(
                "elementRef is required for an element screenshot.",
            ));
        }
        if self.mode != ScreenshotMode::Element && self.element_ref.is_some() {
            return Err(invalid_argument(
                "elementRef is supported only for an element screenshot.",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PageDisplayMode {
    Native,
    Screenshot,
    Hidden,
}

#[derive(Clone, Debug, JsonSchema, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedPageScreenshot {
    pub base64: String,
    pub width: u32,
    pub height: u32,
    pub captured_at: String,
    pub captured_url: Option<String>,
}

#[derive(Clone, Debug, JsonSchema, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageScreenshotSource {
    pub display_mode: PageDisplayMode,
    pub cached: Option<CachedPageScreenshot>,
}

impl PageScreenshotSource {
    pub fn ensure_available(&self, mode: ScreenshotMode) -> Result<(), ToolError> {
        match (self.display_mode, mode) {
            (PageDisplayMode::Native, _) => Ok(()),
            (_, ScreenshotMode::Viewport) if self.cached.is_some() => Ok(()),
            (_, ScreenshotMode::Viewport) => Err(screenshot_failed()),
            _ => Err(live_webview_required()),
        }
    }
}

#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CssRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl CssRect {
    pub fn validate(&self) -> Result<(), ToolError> {
        if !self.x.is_finite()
            || !self.y.is_finite()
            || !self.width.is_finite()
            || !self.height.is_finite()
            || self.width < 0.0
            || self.height < 0.0
        {
            return Err(invalid_argument(
                "Highlight coordinates and dimensions must be finite and nonnegative.",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MouseButton {
    Left,
    Middle,
    Right,
}

impl MouseButton {
    pub fn parse(value: &str) -> Result<Self, ToolError> {
        match value {
            "left" => Ok(Self::Left),
            "middle" => Ok(Self::Middle),
            "right" => Ok(Self::Right),
            _ => Err(invalid_argument(
                "Mouse button must be left, middle, or right.",
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DialogAction {
    Accept,
    Dismiss,
}

#[derive(Clone, Debug, JsonSchema, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadFilePayload {
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub bytes_base64: String,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct PageKey {
    pub document_id: String,
    pub page_node_id: String,
}

#[derive(Clone, Debug, JsonSchema, serde::Deserialize, serde::Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum PageAutomationOperation {
    Snapshot,
    Click {
        snapshot_id: String,
        element_ref: String,
    },
    Hover {
        snapshot_id: String,
        element_ref: String,
    },
    Fill {
        snapshot_id: String,
        element_ref: String,
        text: String,
    },
    FillForm {
        snapshot_id: String,
        fields: Vec<FillField>,
    },
    SelectOption {
        snapshot_id: String,
        element_ref: String,
        values: Vec<String>,
    },
    PressKey {
        key: String,
    },
    Scroll {
        delta_x: i64,
        delta_y: i64,
    },
    Wait {
        condition: WaitCondition,
        timeout_ms: u64,
    },
    ScreenshotElement {
        snapshot_id: String,
        element_ref: String,
        annotate: bool,
    },
    ScreenshotFullPage {
        annotate: bool,
    },
    ClickCoordinates {
        snapshot_id: String,
        x: f64,
        y: f64,
        button: MouseButton,
        click_count: u8,
        highlight: Option<CssRect>,
    },
    Evaluate {
        script: String,
    },
    UploadFiles {
        snapshot_id: String,
        element_ref: String,
        files: Vec<UploadFilePayload>,
    },
    SetDialogHandler {
        action: DialogAction,
        prompt_text: Option<String>,
    },
}

impl PageAutomationOperation {
    pub fn fill(
        snapshot_id: impl Into<String>,
        element_ref: impl Into<String>,
        text: impl Into<String>,
    ) -> Result<Self, ToolError> {
        let operation = Self::Fill {
            snapshot_id: snapshot_id.into(),
            element_ref: element_ref.into(),
            text: text.into(),
        };
        operation.validate()?;
        Ok(operation)
    }

    pub fn fill_form(
        snapshot_id: impl Into<String>,
        fields: Vec<FillField>,
    ) -> Result<Self, ToolError> {
        let operation = Self::FillForm {
            snapshot_id: snapshot_id.into(),
            fields,
        };
        operation.validate()?;
        Ok(operation)
    }

    pub fn wait(condition: WaitCondition, timeout_ms: u64) -> Result<Self, ToolError> {
        let operation = Self::Wait {
            condition,
            timeout_ms,
        };
        operation.validate()?;
        Ok(operation)
    }

    pub fn click_coordinates(
        snapshot_id: impl Into<String>,
        x: f64,
        y: f64,
        button: MouseButton,
        click_count: u8,
        highlight: Option<CssRect>,
    ) -> Result<Self, ToolError> {
        let operation = Self::ClickCoordinates {
            snapshot_id: snapshot_id.into(),
            x,
            y,
            button,
            click_count,
            highlight,
        };
        operation.validate()?;
        Ok(operation)
    }

    pub fn action_kind(&self) -> Option<PageAutomationActionKind> {
        match self {
            Self::Snapshot => None,
            Self::Click { .. } => Some(PageAutomationActionKind::Click),
            Self::Hover { .. } => Some(PageAutomationActionKind::Hover),
            Self::Fill { .. } => Some(PageAutomationActionKind::Fill),
            Self::FillForm { .. } => Some(PageAutomationActionKind::FillForm),
            Self::SelectOption { .. } => Some(PageAutomationActionKind::SelectOption),
            Self::PressKey { .. } => Some(PageAutomationActionKind::PressKey),
            Self::Scroll { .. } => Some(PageAutomationActionKind::Scroll),
            Self::Wait { .. } => Some(PageAutomationActionKind::Wait),
            Self::ScreenshotElement { .. }
            | Self::ScreenshotFullPage { .. }
            | Self::SetDialogHandler { .. } => None,
            Self::ClickCoordinates { .. } => Some(PageAutomationActionKind::ClickCoordinates),
            Self::Evaluate { .. } => Some(PageAutomationActionKind::Evaluate),
            Self::UploadFiles { .. } => Some(PageAutomationActionKind::UploadFiles),
        }
    }

    pub fn validate(&self) -> Result<(), ToolError> {
        match self {
            Self::Fill { text, .. } => validate_fill_text(text),
            Self::FillForm { fields, .. } => {
                for field in fields {
                    validate_fill_text(&field.text)?;
                }
                Ok(())
            }
            Self::Wait { timeout_ms, .. } if *timeout_ms > PAGE_AUTOMATION_MAX_WAIT_TIMEOUT_MS => {
                Err(invalid_argument(format!(
                    "Wait timeout must not exceed {PAGE_AUTOMATION_MAX_WAIT_TIMEOUT_MS} ms."
                )))
            }
            Self::ClickCoordinates {
                x,
                y,
                click_count,
                highlight,
                ..
            } => {
                if !x.is_finite() || !y.is_finite() {
                    return Err(invalid_argument(
                        "Click coordinates must be finite CSS viewport coordinates.",
                    ));
                }
                if !(1..=2).contains(click_count) {
                    return Err(invalid_argument("clickCount must be 1 or 2."));
                }
                if let Some(highlight) = highlight {
                    highlight.validate()?;
                }
                Ok(())
            }
            Self::Evaluate { script } if script.is_empty() => {
                Err(invalid_argument("Evaluate script must not be empty."))
            }
            Self::UploadFiles { files, .. } if files.is_empty() => {
                Err(invalid_argument("At least one upload file is required."))
            }
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Debug, JsonSchema, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FillField {
    pub element_ref: String,
    pub text: String,
}

#[derive(Clone, Debug, JsonSchema, serde::Deserialize, serde::Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum WaitCondition {
    Time { milliseconds: u64 },
    Url { contains: String },
    Selector { selector: String },
    Text { text: String },
}

#[derive(Clone, Debug, JsonSchema, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticElement {
    #[serde(rename = "ref")]
    pub element_ref: String,
    pub role: String,
    pub name: String,
    pub tag_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expanded: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    pub frame_id: String,
}

#[derive(Clone, Debug, JsonSchema, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactSnapshot {
    pub navigation_epoch: u64,
    pub document_token: String,
    pub snapshot_id: String,
    pub url: String,
    pub title: String,
    pub compact_text: String,
    pub elements: Vec<SemanticElement>,
    pub frames: Vec<SnapshotFrame>,
    pub truncated: bool,
}

impl CompactSnapshot {
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn from_value(value: serde_json::Value) -> Result<Self, ToolError> {
        let snapshot: Self = serde_json::from_value(value)
            .map_err(|_| invalid_argument("The page returned an invalid semantic snapshot."))?;
        snapshot.validate()?;
        Ok(snapshot)
    }

    pub fn validate(&self) -> Result<(), ToolError> {
        let Some(snapshot_epoch) = parse_snapshot_id(&self.snapshot_id) else {
            return Err(invalid_argument(
                "The page returned an invalid snapshot ID.",
            ));
        };
        if snapshot_epoch != self.navigation_epoch {
            return Err(invalid_argument(
                "The page returned a snapshot ID for a different navigation epoch.",
            ));
        }
        if !is_document_token(&self.document_token) {
            return Err(invalid_argument(
                "The page returned an invalid document token.",
            ));
        }
        if self.elements.len() > PAGE_AUTOMATION_MAX_SNAPSHOT_ELEMENTS {
            return Err(snapshot_too_large());
        }
        if utf16_len(&self.compact_text) > PAGE_AUTOMATION_MAX_SNAPSHOT_CHARS {
            return Err(snapshot_too_large());
        }
        for element in &self.elements {
            if utf16_len(&element.name) > PAGE_AUTOMATION_MAX_TEXT_CHARS
                || element
                    .value
                    .as_deref()
                    .is_some_and(|value| utf16_len(value) > PAGE_AUTOMATION_MAX_TEXT_CHARS)
                || element
                    .placeholder
                    .as_deref()
                    .is_some_and(|value| utf16_len(value) > PAGE_AUTOMATION_MAX_TEXT_CHARS)
            {
                return Err(snapshot_too_large());
            }
            if !is_element_ref(&element.element_ref) || !is_frame_id(&element.frame_id) {
                return Err(invalid_argument(
                    "The page returned an invalid semantic element reference.",
                ));
            }
            if !element_ref_matches_frame(&element.element_ref, &element.frame_id) {
                return Err(invalid_argument(
                    "The page returned an element reference for the wrong frame.",
                ));
            }
        }
        for frame in &self.frames {
            if !is_frame_id(&frame.frame_id) {
                return Err(invalid_argument("The page returned an invalid frame ID."));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, JsonSchema, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotFrame {
    pub frame_id: String,
    pub url: String,
    pub status: SnapshotFrameStatus,
}

#[derive(Clone, Debug, JsonSchema, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotFrameStatus {
    Ok,
    Unavailable,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageAutomationBridgeRequest {
    pub request_id: String,
    pub document_id: String,
    pub page_node_id: String,
    pub navigation_epoch: u64,
    pub operation: PageAutomationOperation,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageAutomationBridgeResult {
    pub request_id: String,
    pub document_id: String,
    pub page_node_id: String,
    pub result: serde_json::Value,
}

#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PageAutomationActionKind {
    Click,
    Hover,
    Fill,
    FillForm,
    SelectOption,
    PressKey,
    Scroll,
    Wait,
    ClickCoordinates,
    Evaluate,
    UploadFiles,
}

#[derive(Clone, Debug, JsonSchema, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageAutomationActionResult {
    pub kind: PageAutomationActionKind,
}

#[derive(Clone, Debug, JsonSchema, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageAutomationSuccessResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<PageAutomationActionResult>,
    pub snapshot: CompactSnapshot,
}

impl PageAutomationBridgeResult {
    pub fn success_result(&self) -> Result<PageAutomationSuccessResult, ToolError> {
        if let Some(error) = self.result.get("error") {
            let error = serde_json::from_value::<ToolError>(error.clone()).map_err(|_| {
                invalid_argument("The page returned an invalid automation error envelope.")
            })?;
            if !is_page_automation_error_code(&error.code) {
                return Err(invalid_argument(
                    "The page returned an unknown automation error code.",
                ));
            }
            return Err(error);
        }
        let result: PageAutomationSuccessResult = serde_json::from_value(self.result.clone())
            .map_err(|_| invalid_argument("The page returned an invalid automation result."))?;
        result.snapshot.validate()?;
        Ok(result)
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn compact_snapshot(&self) -> Result<CompactSnapshot, ToolError> {
        self.success_result().map(|result| result.snapshot)
    }
}

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

pub fn upload_target_not_file_input() -> ToolError {
    ToolError::new(
        "upload_target_not_file_input",
        "The referenced element is not a current file input.",
    )
    .with_retry("Call browser_snapshot and use an input[type=file] elementRef")
}

fn is_page_automation_error_code(code: &str) -> bool {
    matches!(
        code,
        "unsupported_platform"
            | "document_not_found"
            | "page_not_found"
            | "webview_not_ready"
            | "request_timeout"
            | "bridge_rejected"
            | "stale_element"
            | "element_not_found"
            | "element_not_interactable"
            | "invalid_argument"
            | "wait_timeout"
            | "snapshot_too_large"
            | "live_webview_required"
            | "screenshot_failed"
            | "screenshot_target_not_visible"
            | "page_changed_during_capture"
            | "screenshot_too_large"
            | "evaluate_not_json"
            | "evaluate_timeout"
            | "evaluate_result_too_large"
            | "upload_file_invalid"
            | "upload_target_not_file_input"
    )
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn validate_fill_text(text: &str) -> Result<(), ToolError> {
    if utf16_len(text) > PAGE_AUTOMATION_MAX_FILL_CHARS {
        return Err(invalid_argument(format!(
            "Fill text must not exceed {PAGE_AUTOMATION_MAX_FILL_CHARS} characters."
        )));
    }
    Ok(())
}

fn parse_snapshot_id(snapshot_id: &str) -> Option<u64> {
    let value = snapshot_id.strip_prefix('s')?;
    let (epoch, sequence) = value.split_once('-')?;
    if epoch.is_empty()
        || sequence.is_empty()
        || sequence.contains('-')
        || !epoch.bytes().all(|byte| byte.is_ascii_digit())
        || !sequence.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    epoch.parse().ok()
}

fn is_document_token(token: &str) -> bool {
    token.len() == 32
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn is_element_ref(element_ref: &str) -> bool {
    if let Some(top_frame_ref) = element_ref.strip_prefix('e') {
        return !top_frame_ref.is_empty()
            && top_frame_ref.bytes().all(|byte| byte.is_ascii_digit());
    }
    let Some((frame, element)) = element_ref.split_once(':') else {
        return false;
    };
    is_child_frame_id(frame)
        && element.strip_prefix('e').is_some_and(|value| {
            !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn is_frame_id(frame_id: &str) -> bool {
    frame_id == "top" || is_child_frame_id(frame_id)
}

fn is_child_frame_id(frame_id: &str) -> bool {
    frame_id
        .strip_prefix('f')
        .is_some_and(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
}

fn element_ref_matches_frame(element_ref: &str, frame_id: &str) -> bool {
    match element_ref.split_once(':') {
        Some((element_frame_id, _)) => element_frame_id == frame_id,
        None => frame_id == "top",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::types::ToolError;

    #[test]
    fn validates_phase_three_screenshot_and_coordinate_requests() {
        let error = PageScreenshotRequest {
            mode: ScreenshotMode::Element,
            element_ref: None,
            annotate: false,
        }
        .validate()
        .unwrap_err();
        assert_eq!(error.code, "invalid_argument");

        for (x, y) in [(f64::NAN, 1.0), (1.0, f64::INFINITY)] {
            assert_eq!(
                PageAutomationOperation::click_coordinates(
                    "s0-1",
                    x,
                    y,
                    MouseButton::Left,
                    1,
                    None,
                )
                .unwrap_err()
                .code,
                "invalid_argument"
            );
        }
        assert_eq!(
            MouseButton::parse("primary").unwrap_err().code,
            "invalid_argument"
        );
        assert_eq!(
            PageAutomationOperation::click_coordinates(
                "s0-1",
                1.0,
                1.0,
                MouseButton::Left,
                3,
                None,
            )
            .unwrap_err()
            .code,
            "invalid_argument"
        );
        for rect in [
            CssRect {
                x: 0.0,
                y: 0.0,
                width: -1.0,
                height: 1.0,
            },
            CssRect {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: f64::NAN,
            },
        ] {
            assert_eq!(
                PageAutomationOperation::click_coordinates(
                    "s0-1",
                    1.0,
                    1.0,
                    MouseButton::Left,
                    1,
                    Some(rect),
                )
                .unwrap_err()
                .code,
                "invalid_argument"
            );
        }
    }

    #[test]
    fn validates_phase_three_platform_errors_limits_and_visibility() {
        assert_eq!(
            ensure_supported_platform(false).unwrap_err().code,
            "unsupported_platform"
        );
        assert_eq!(
            live_webview_required().retry.as_deref(),
            Some("Bring the WebPage into the visible native area, then retry browser_screenshot.")
        );

        let oversized =
            serde_json::Value::String("x".repeat(PAGE_AUTOMATION_MAX_EVALUATE_RESPONSE_BYTES));
        assert_eq!(
            validate_evaluate_result(&oversized).unwrap_err().code,
            "evaluate_result_too_large"
        );

        let source = PageScreenshotSource {
            display_mode: PageDisplayMode::Hidden,
            cached: None,
        };
        assert_eq!(
            source
                .ensure_available(ScreenshotMode::Viewport)
                .unwrap_err()
                .code,
            "screenshot_failed"
        );
        for mode in [ScreenshotMode::Element, ScreenshotMode::FullPage] {
            assert_eq!(
                source.ensure_available(mode).unwrap_err().code,
                "live_webview_required"
            );
        }
    }

    #[test]
    fn deserializes_each_page_automation_operation() {
        let operations = [
            serde_json::json!({"kind": "snapshot"}),
            serde_json::json!({"kind": "click", "snapshotId": "s0-1", "elementRef": "e1"}),
            serde_json::json!({"kind": "hover", "snapshotId": "s0-1", "elementRef": "e1"}),
            serde_json::json!({"kind": "fill", "snapshotId": "s0-1", "elementRef": "e1", "text": "hello"}),
            serde_json::json!({"kind": "fill_form", "snapshotId": "s0-1", "fields": [{"elementRef": "e1", "text": "hello"}]}),
            serde_json::json!({"kind": "select_option", "snapshotId": "s0-1", "elementRef": "e1", "values": ["one"]}),
            serde_json::json!({"kind": "press_key", "key": "Enter"}),
            serde_json::json!({"kind": "scroll", "deltaX": -10, "deltaY": 20}),
            serde_json::json!({"kind": "wait", "condition": {"kind": "time", "milliseconds": 250}, "timeoutMs": 500}),
            serde_json::json!({"kind": "screenshot_element", "snapshotId": "s0-1", "elementRef": "e1", "annotate": true}),
            serde_json::json!({"kind": "screenshot_full_page", "annotate": false}),
            serde_json::json!({"kind": "click_coordinates", "snapshotId": "s0-1", "x": 10.0, "y": 20.0, "button": "left", "clickCount": 1}),
            serde_json::json!({"kind": "evaluate", "script": "1 + 1"}),
            serde_json::json!({"kind": "upload_files", "snapshotId": "s0-1", "elementRef": "e1", "files": [{"name": "a.txt", "mimeType": "text/plain", "size": 1, "bytesBase64": "YQ=="}]}),
            serde_json::json!({"kind": "set_dialog_handler", "action": "dismiss"}),
        ];

        for operation in operations {
            serde_json::from_value::<PageAutomationOperation>(operation)
                .expect("operation must deserialize");
        }
    }

    #[test]
    fn rejects_fill_text_longer_than_the_protocol_limit() {
        let error = PageAutomationOperation::fill("s0-1", "e1", "x".repeat(10_001))
            .expect_err("fill text over the protocol limit must fail");

        assert_eq!(error.code, "invalid_argument");
    }

    #[test]
    fn rejects_wait_timeout_above_the_protocol_limit() {
        let error = PageAutomationOperation::wait(
            WaitCondition::Time { milliseconds: 1 },
            PAGE_AUTOMATION_MAX_WAIT_TIMEOUT_MS + 1,
        )
        .expect_err("wait timeout over the protocol limit must fail");

        assert_eq!(error.code, "invalid_argument");
    }

    #[test]
    fn rejects_negative_time_waits_during_deserialization() {
        let error = serde_json::from_value::<PageAutomationOperation>(serde_json::json!({
            "kind": "wait",
            "condition": {"kind": "time", "milliseconds": -1},
            "timeoutMs": 500,
        }))
        .expect_err("negative time waits must fail");

        assert!(error.to_string().contains("invalid value"));
    }

    #[test]
    fn serializes_stale_element_errors_with_actionable_retry() {
        let error = ToolError::new(
            "stale_element",
            "The page changed after this element was observed.",
        )
        .with_retry("Call browser_snapshot and use a returned elementRef");

        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({
                "code": "stale_element",
                "message": "The page changed after this element was observed.",
                "retry": "Call browser_snapshot and use a returned elementRef",
            })
        );
    }

    #[test]
    fn validates_snapshot_references_ids_and_document_tokens() {
        let snapshot = CompactSnapshot::from_value(valid_snapshot("f2:e7")).unwrap();
        assert_eq!(snapshot.elements[0].element_ref, "f2:e7");

        assert_invalid_snapshot(valid_snapshot("frame-2:e7"));

        let mut invalid_snapshot_id = valid_snapshot("e7");
        invalid_snapshot_id["snapshotId"] = serde_json::json!("snapshot-7");
        assert_invalid_snapshot(invalid_snapshot_id);

        let mut invalid_document_token = valid_snapshot("e7");
        invalid_document_token["documentToken"] =
            serde_json::json!("ABCDEF0123456789ABCDEF0123456789");
        assert_invalid_snapshot(invalid_document_token);
    }

    #[test]
    fn parses_nested_bridge_success_and_error_envelopes() {
        let success = PageAutomationBridgeResult {
            request_id: "pa-1".into(),
            document_id: "document-1".into(),
            page_node_id: "page-1".into(),
            result: serde_json::json!({
                "action": {"kind": "click"},
                "snapshot": valid_snapshot("f2:e7"),
            }),
        };
        let parsed = success.success_result().unwrap();
        assert_eq!(parsed.action.unwrap().kind, PageAutomationActionKind::Click);
        assert_eq!(parsed.snapshot.snapshot_id, "s2-4");

        let failure = PageAutomationBridgeResult {
            result: serde_json::json!({
                "error": {
                    "code": "stale_element",
                    "message": "The page changed after this element was observed.",
                    "retry": "Call browser_snapshot and use a returned elementRef"
                }
            }),
            ..success.clone()
        };
        assert_eq!(
            failure.compact_snapshot().unwrap_err().code,
            "stale_element"
        );

        let unknown_action = PageAutomationBridgeResult {
            result: serde_json::json!({
                "action": {"kind": "custom_unknown"},
                "snapshot": valid_snapshot("f2:e7")
            }),
            ..success.clone()
        };
        assert_eq!(
            unknown_action.success_result().unwrap_err().code,
            "invalid_argument"
        );
        let unknown_error = PageAutomationBridgeResult {
            result: serde_json::json!({
                "error": {"code": "custom_error", "message": "not allowed"}
            }),
            ..success
        };
        assert_eq!(
            unknown_error.success_result().unwrap_err().code,
            "invalid_argument"
        );
    }

    #[test]
    fn validates_utf16_snapshot_and_element_text_limits() {
        let mut within_limit = valid_snapshot("f2:e7");
        within_limit["compactText"] = serde_json::json!("界".repeat(20_000));
        CompactSnapshot::from_value(within_limit).unwrap();

        let mut over_snapshot_limit = valid_snapshot("f2:e7");
        over_snapshot_limit["compactText"] = serde_json::json!("界".repeat(20_001));
        assert_eq!(
            CompactSnapshot::from_value(over_snapshot_limit)
                .unwrap_err()
                .code,
            "snapshot_too_large"
        );

        let mut element_limit = valid_snapshot("f2:e7");
        element_limit["elements"][0]["name"] = serde_json::json!("😀".repeat(256));
        element_limit["elements"][0]["value"] = serde_json::json!("😀".repeat(256));
        element_limit["elements"][0]["placeholder"] = serde_json::json!("😀".repeat(256));
        CompactSnapshot::from_value(element_limit).unwrap();

        let mut over_element_limit = valid_snapshot("f2:e7");
        over_element_limit["elements"][0]["name"] = serde_json::json!("😀".repeat(257));
        assert_eq!(
            CompactSnapshot::from_value(over_element_limit)
                .unwrap_err()
                .code,
            "snapshot_too_large"
        );

        PageAutomationOperation::fill("s0-1", "e1", "😀".repeat(5_000)).unwrap();
        assert_eq!(
            PageAutomationOperation::fill("s0-1", "e1", "😀".repeat(5_001))
                .unwrap_err()
                .code,
            "invalid_argument"
        );
    }

    #[test]
    fn bridge_request_requires_and_serializes_navigation_epoch_in_camel_case() {
        let request = PageAutomationBridgeRequest {
            request_id: "pa-1".into(),
            document_id: "document-1".into(),
            page_node_id: "page-1".into(),
            navigation_epoch: 3,
            operation: PageAutomationOperation::Snapshot,
        };

        assert_eq!(
            serde_json::to_value(&request).unwrap(),
            serde_json::json!({
                "requestId": "pa-1",
                "documentId": "document-1",
                "pageNodeId": "page-1",
                "navigationEpoch": 3,
                "operation": {"kind": "snapshot"},
            })
        );
        assert!(
            serde_json::from_value::<PageAutomationBridgeRequest>(serde_json::json!({
                "requestId": "pa-1",
                "documentId": "document-1",
                "pageNodeId": "page-1",
                "operation": {"kind": "snapshot"},
            }))
            .is_err()
        );
    }

    fn valid_snapshot(element_ref: &str) -> serde_json::Value {
        serde_json::json!({
            "navigationEpoch": 2,
            "documentToken": "0123456789abcdef0123456789abcdef",
            "snapshotId": "s2-4",
            "url": "https://example.com/",
            "title": "Example",
            "compactText": "Example",
            "elements": [{
                "ref": element_ref,
                "role": "button",
                "name": "Submit",
                "tagName": "button",
                "frameId": "f2",
            }],
            "frames": [{"frameId": "f2", "url": "https://frame.example/", "status": "ok"}],
            "truncated": false,
        })
    }

    fn assert_invalid_snapshot(value: serde_json::Value) {
        assert_eq!(
            CompactSnapshot::from_value(value).unwrap_err().code,
            "invalid_argument"
        );
    }
}
