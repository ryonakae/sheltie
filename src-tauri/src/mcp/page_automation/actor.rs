use std::{
    collections::{HashMap, HashSet},
    future::Future,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use super::{
    images::{
        annotate_css_rect, crop_css_rect, decode_png, encode_capped_png, EncodedPng,
        FullPageComposer,
    },
    protocol::{
        bridge_rejected, evaluate_timeout, invalid_argument, page_changed_during_capture,
        request_timeout, screenshot_target_not_visible, screenshot_too_large, webview_not_ready,
        CompactSnapshot, CssRect, PageAutomationActionResult, PageAutomationBridgeRequest,
        PageAutomationBridgeResult, PageAutomationOperation, PageAutomationSuccessResult, PageKey,
        PageViewportGeometry, PAGE_AUTOMATION_EVALUATE_TIMEOUT_MS,
        PAGE_AUTOMATION_MAX_FULL_PAGE_TILES,
    },
};
use crate::mcp::types::ToolError;
use tokio::sync::{oneshot, watch, Mutex as AsyncMutex, OwnedMutexGuard};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct NavigationProgress {
    epoch: u64,
    finished_epoch: Option<u64>,
    final_url: Option<String>,
    requires_new_document_token: bool,
}

struct PageActor {
    execution: Arc<AsyncMutex<()>>,
    navigation: watch::Sender<NavigationProgress>,
    last_document: Mutex<Option<(u64, String)>>,
    removed: AtomicBool,
}

impl PageActor {
    fn new() -> Self {
        let (navigation, _) = watch::channel(NavigationProgress::default());
        Self {
            execution: Arc::new(AsyncMutex::new(())),
            navigation,
            last_document: Mutex::new(None),
            removed: AtomicBool::new(false),
        }
    }
}

struct PendingRequest {
    key: PageKey,
    window_label: String,
    webview_label: String,
    sender: oneshot::Sender<Result<PageAutomationBridgeResult, ToolError>>,
}

struct PendingRegistration<'a> {
    state: &'a PageAutomationState,
    request_id: String,
}

impl Drop for PendingRegistration<'_> {
    fn drop(&mut self) {
        self.state.remove_pending(&self.request_id);
    }
}

#[derive(Default)]
struct PageAutomationInner {
    actors: HashMap<PageKey, Arc<PageActor>>,
    pending: HashMap<String, PendingRequest>,
}

pub struct PageAutomationState {
    inner: Mutex<PageAutomationInner>,
    timeout: Duration,
}

pub struct NavigationMarker {
    key: PageKey,
    pub epoch: u64,
    pub document_token: String,
    _execution: OwnedMutexGuard<()>,
}

impl Default for PageAutomationState {
    fn default() -> Self {
        Self::with_timeout(Duration::from_millis(
            super::protocol::PAGE_AUTOMATION_REQUEST_TIMEOUT_MS,
        ))
    }
}

impl PageAutomationState {
    fn with_timeout(timeout: Duration) -> Self {
        Self {
            inner: Mutex::new(PageAutomationInner::default()),
            timeout,
        }
    }

    pub fn register_page(&self, key: PageKey) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire page automation state".to_string())?;
        inner
            .actors
            .entry(key)
            .or_insert_with(|| Arc::new(PageActor::new()));
        Ok(())
    }

    pub fn note_committed_navigation(&self, key: &PageKey, url: String) -> Result<u64, String> {
        let actor = self.actor(key).map_err(|error| error.message)?;
        let mut progress = actor.navigation.borrow().clone();
        progress.epoch = progress.epoch.saturating_add(1);
        progress.finished_epoch = Some(progress.epoch);
        progress.final_url = Some(normalize_url(&url)?);
        progress.requires_new_document_token = true;
        actor.navigation.send_replace(progress.clone());
        Ok(progress.epoch)
    }

    pub fn note_spa_navigation(&self, key: &PageKey, url: String) -> Result<u64, String> {
        let actor = self.actor(key).map_err(|error| error.message)?;
        let mut progress = actor.navigation.borrow().clone();
        progress.epoch = progress.epoch.saturating_add(1);
        progress.finished_epoch = Some(progress.epoch);
        progress.final_url = Some(normalize_url(&url)?);
        progress.requires_new_document_token = false;
        actor.navigation.send_replace(progress.clone());
        Ok(progress.epoch)
    }

    pub fn remove_page(&self, key: &PageKey) -> Result<(), String> {
        let pending = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "failed to acquire page automation state".to_string())?;
            if let Some(actor) = inner.actors.remove(key) {
                actor.removed.store(true, Ordering::Release);
            }
            let request_ids = inner
                .pending
                .iter()
                .filter_map(|(request_id, request)| {
                    (&request.key == key).then_some(request_id.clone())
                })
                .collect::<Vec<_>>();
            request_ids
                .into_iter()
                .filter_map(|request_id| inner.pending.remove(&request_id))
                .collect::<Vec<_>>()
        };
        for request in pending {
            let _ = request.sender.send(Err(webview_not_ready()));
        }
        Ok(())
    }

    pub fn complete(
        &self,
        window_label: &str,
        webview_label: &str,
        result: PageAutomationBridgeResult,
    ) -> Result<(), String> {
        let request_id = result.request_id.clone();
        if !is_page_request_id(&request_id) {
            return Err("page automation requestId is invalid".to_string());
        }
        let pending = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "failed to acquire page automation state".to_string())?;
            let expected = inner.pending.get(&request_id).ok_or_else(|| {
                "page automation request is unknown or already completed".to_string()
            })?;
            let identity_matches = expected.window_label == window_label
                && expected.webview_label == webview_label
                && result.document_id == expected.key.document_id
                && result.page_node_id == expected.key.page_node_id;
            // 不一致の completion で pending を消費すると、requestId を推測した別ページが
            // 正規 request を失敗させられる。一致した場合だけ取り出す。
            if !identity_matches {
                return Err("page automation completion identity mismatch".to_string());
            }
            inner
                .pending
                .remove(&request_id)
                .expect("pending request exists after lookup")
        };
        pending
            .sender
            .send(Ok(result))
            .map_err(|_| "page automation request receiver is no longer available".to_string())
    }

    pub async fn execute_with<Dispatch>(
        &self,
        key: PageKey,
        window_label: String,
        webview_label: String,
        operation: PageAutomationOperation,
        mut dispatch: Dispatch,
    ) -> Result<PageAutomationSuccessResult, ToolError>
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
    {
        operation.validate()?;
        let is_evaluate = matches!(operation, PageAutomationOperation::Evaluate { .. });
        let actor = self.actor(&key)?;
        let _execution = actor.execution.lock().await;
        self.ensure_actor_current(&key, &actor)?;
        let mut navigation = actor.navigation.subscribe();
        let expected_action_kind = operation.action_kind();
        let mut action_metadata = expected_action_kind.map(|kind| PageAutomationActionResult {
            kind,
            input_trusted: None,
            value: serde_json::Value::Null,
            files: None,
            dialogs: None,
            configured: None,
            geometry: None,
        });
        let initial_progress = navigation.borrow().clone();
        let request = PageAutomationBridgeRequest {
            request_id: self.allocate_request_id()?,
            document_id: key.document_id.clone(),
            page_node_id: key.page_node_id.clone(),
            navigation_epoch: initial_progress.epoch,
            operation,
        };
        let (receiver, _pending) = self.register_and_dispatch(
            &key,
            &actor,
            &window_label,
            &webview_label,
            &request,
            &mut dispatch,
        )?;
        let request_timeout_duration = if is_evaluate {
            self.timeout
                .min(Duration::from_millis(PAGE_AUTOMATION_EVALUATE_TIMEOUT_MS))
        } else {
            self.timeout
        };
        let request_deadline = tokio::time::Instant::now() + request_timeout_duration;
        let outcome = self
            .await_result_or_navigation(
                receiver,
                &mut navigation,
                request.navigation_epoch,
                request_deadline,
            )
            .await
            .map_err(|error| {
                if is_evaluate && error.code == "request_timeout" {
                    evaluate_timeout()
                } else {
                    error
                }
            })?;

        if let RequestOutcome::Completed(result) = outcome {
            let success = result.success_result()?;
            if success.snapshot.navigation_epoch != request.navigation_epoch
                || success.action.as_ref().map(|action| action.kind) != expected_action_kind
            {
                return Err(bridge_rejected());
            }
            if expected_action_kind.is_none()
                && navigation.borrow().epoch == request.navigation_epoch
            {
                self.verify_snapshot_identity(&actor, &initial_progress, &success.snapshot)?;
                return Ok(PageAutomationSuccessResult {
                    snapshot: success.snapshot,
                    action: None,
                });
            }
            if expected_action_kind.is_some() {
                action_metadata = success.action;
                tokio::time::sleep(Duration::from_millis(
                    super::protocol::PAGE_AUTOMATION_SETTLE_DELAY_MS,
                ))
                .await;
            }
        }

        let allow_current_epoch =
            expected_action_kind.is_some() && navigation.borrow().epoch == request.navigation_epoch;
        self.settle_snapshot_with(
            &key,
            &actor,
            &window_label,
            &webview_label,
            &mut navigation,
            request.navigation_epoch,
            allow_current_epoch,
            None,
            action_metadata,
            &mut dispatch,
        )
        .await
    }

    pub async fn execute_raw_with<Dispatch>(
        &self,
        key: PageKey,
        window_label: String,
        webview_label: String,
        operation: PageAutomationOperation,
        mut dispatch: Dispatch,
    ) -> Result<PageAutomationActionResult, ToolError>
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
    {
        let actor = self.actor(&key)?;
        let _execution = actor.execution.lock().await;
        self.execute_raw_locked_with(
            &key,
            &actor,
            &window_label,
            &webview_label,
            operation,
            &mut dispatch,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn capture_element_with<Dispatch, Capture, CaptureFuture>(
        &self,
        key: PageKey,
        window_label: String,
        webview_label: String,
        snapshot_id: String,
        element_ref: String,
        annotate: bool,
        mut dispatch: Dispatch,
        mut capture: Capture,
    ) -> Result<EncodedPng, ToolError>
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
        Capture: FnMut() -> CaptureFuture,
        CaptureFuture: Future<Output = Result<Vec<u8>, ToolError>>,
    {
        let actor = self.actor(&key)?;
        let _execution = actor.execution.lock().await;
        self.ensure_actor_current(&key, &actor)?;
        let capture_epoch = actor.navigation.borrow().epoch;
        let action = self
            .execute_raw_locked_with(
                &key,
                &actor,
                &window_label,
                &webview_label,
                PageAutomationOperation::ScreenshotElement {
                    snapshot_id,
                    element_ref,
                    annotate,
                },
                &mut dispatch,
            )
            .await
            .map_err(|error| self.capture_error_for_epoch(&actor, capture_epoch, error))?;
        self.ensure_capture_epoch(&actor, capture_epoch)?;
        let (rect, viewport) = action.screenshot_element_geometry()?;
        if viewport.viewport_width <= 0.0
            || viewport.viewport_height <= 0.0
            || rect.x < 0.0
            || rect.y < 0.0
            || rect.x + rect.width > viewport.viewport_width
            || rect.y + rect.height > viewport.viewport_height
        {
            return Err(screenshot_target_not_visible());
        }
        let bytes = capture()
            .await
            .map_err(|error| self.capture_error_for_epoch(&actor, capture_epoch, error))?;
        self.ensure_capture_epoch(&actor, capture_epoch)?;
        let mut image = decode_png(&bytes)?;
        let scale = f64::from(image.width()) / viewport.viewport_width;
        if !scale.is_finite() || scale <= 0.0 {
            return Err(screenshot_too_large());
        }
        image = crop_css_rect(&image, rect, scale)?;
        if annotate {
            annotate_css_rect(
                &mut image,
                CssRect {
                    x: 0.0,
                    y: 0.0,
                    width: rect.width,
                    height: rect.height,
                },
                scale,
            )?;
        }
        encode_capped_png(&image)
    }

    pub async fn capture_full_page_with<Dispatch, Capture, CaptureFuture>(
        &self,
        key: PageKey,
        window_label: String,
        webview_label: String,
        annotate: bool,
        mut dispatch: Dispatch,
        mut capture: Capture,
    ) -> Result<EncodedPng, ToolError>
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
        Capture: FnMut() -> CaptureFuture,
        CaptureFuture: Future<Output = Result<Vec<u8>, ToolError>>,
    {
        let actor = self.actor(&key)?;
        let _execution = actor.execution.lock().await;
        self.ensure_actor_current(&key, &actor)?;
        let capture_epoch = actor.navigation.borrow().epoch;
        let geometry = self
            .execute_raw_locked_with(
                &key,
                &actor,
                &window_label,
                &webview_label,
                PageAutomationOperation::ScreenshotFullPage { annotate },
                &mut dispatch,
            )
            .await
            .map_err(|error| self.capture_error_for_epoch(&actor, capture_epoch, error))?
            .screenshot_full_page_geometry()?;
        self.ensure_capture_epoch(&actor, capture_epoch)?;
        let original_scroll = (geometry.scroll_x, geometry.scroll_y);
        let result = self
            .capture_full_page_tiles_locked_with(
                &key,
                &actor,
                &window_label,
                &webview_label,
                capture_epoch,
                geometry,
                &mut dispatch,
                &mut capture,
            )
            .await;
        let restore = self
            .restore_scroll_locked_with(
                &key,
                &actor,
                &window_label,
                &webview_label,
                original_scroll,
                &mut dispatch,
            )
            .await
            .map_err(|error| self.capture_error_for_epoch(&actor, capture_epoch, error));
        self.ensure_capture_epoch(&actor, capture_epoch)?;
        match result {
            Ok(image) => {
                restore?;
                Ok(image)
            }
            Err(error) => {
                let _ = restore;
                Err(error)
            }
        }
    }

    async fn execute_raw_locked_with<Dispatch>(
        &self,
        key: &PageKey,
        actor: &Arc<PageActor>,
        window_label: &str,
        webview_label: &str,
        operation: PageAutomationOperation,
        dispatch: &mut Dispatch,
    ) -> Result<PageAutomationActionResult, ToolError>
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
    {
        operation.validate()?;
        let expected_action_kind = operation.raw_action_kind().ok_or_else(|| {
            invalid_argument("The operation does not return a raw page automation result.")
        })?;
        self.ensure_actor_current(key, actor)?;
        let mut navigation = actor.navigation.subscribe();
        let initial_epoch = navigation.borrow().epoch;
        let request = PageAutomationBridgeRequest {
            request_id: self.allocate_request_id()?,
            document_id: key.document_id.clone(),
            page_node_id: key.page_node_id.clone(),
            navigation_epoch: initial_epoch,
            operation,
        };
        let (receiver, _pending) = self.register_and_dispatch(
            key,
            actor,
            window_label,
            webview_label,
            &request,
            dispatch,
        )?;
        let deadline = tokio::time::Instant::now() + self.timeout;
        let outcome = self
            .await_result_or_navigation(receiver, &mut navigation, initial_epoch, deadline)
            .await?;
        let RequestOutcome::Completed(result) = outcome else {
            return Err(bridge_rejected());
        };
        if navigation.borrow().epoch != initial_epoch {
            return Err(bridge_rejected());
        }
        let action = result.raw_action_result()?;
        if action.kind != expected_action_kind {
            return Err(bridge_rejected());
        }
        Ok(action)
    }

    #[allow(clippy::too_many_arguments)]
    async fn capture_full_page_tiles_locked_with<Dispatch, Capture, CaptureFuture>(
        &self,
        key: &PageKey,
        actor: &Arc<PageActor>,
        window_label: &str,
        webview_label: &str,
        capture_epoch: u64,
        geometry: PageViewportGeometry,
        dispatch: &mut Dispatch,
        capture: &mut Capture,
    ) -> Result<EncodedPng, ToolError>
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
        Capture: FnMut() -> CaptureFuture,
        CaptureFuture: Future<Output = Result<Vec<u8>, ToolError>>,
    {
        let positions = full_page_tile_positions(geometry)?;
        let mut composer: Option<FullPageComposer> = None;
        let mut captured_offsets = HashSet::new();
        let mut capture_scale: Option<f64> = None;
        for (position_x, position_y) in positions {
            self.ensure_capture_epoch(actor, capture_epoch)?;
            let action = self
                .execute_raw_locked_with(
                    key,
                    actor,
                    window_label,
                    webview_label,
                    PageAutomationOperation::ScreenshotScroll {
                        x: position_x,
                        y: position_y,
                    },
                    dispatch,
                )
                .await
                .map_err(|error| self.capture_error_for_epoch(actor, capture_epoch, error))?;
            self.ensure_capture_epoch(actor, capture_epoch)?;
            let current = action.screenshot_full_page_geometry()?;
            let maximum_scroll_x = (geometry.document_width - geometry.viewport_width).max(0.0);
            let maximum_scroll_y = (geometry.document_height - geometry.viewport_height).max(0.0);
            let expected_scroll_x = position_x.min(maximum_scroll_x);
            let expected_scroll_y = position_y.min(maximum_scroll_y);
            if current.viewport_width != geometry.viewport_width
                || current.viewport_height != geometry.viewport_height
                || current.document_width != geometry.document_width
                || current.document_height != geometry.document_height
                || (current.scroll_x - expected_scroll_x).abs() > 0.5
                || (current.scroll_y - expected_scroll_y).abs() > 0.5
            {
                return Err(page_changed_during_capture());
            }
            let expected_scale = capture_scale.unwrap_or(1.0);
            let expected_offset = (
                css_offset_to_pixels(current.scroll_x, expected_scale)?,
                css_offset_to_pixels(current.scroll_y, expected_scale)?,
            );
            if capture_scale.is_some() && captured_offsets.contains(&expected_offset) {
                continue;
            }
            let bytes = capture()
                .await
                .map_err(|error| self.capture_error_for_epoch(actor, capture_epoch, error))?;
            self.ensure_capture_epoch(actor, capture_epoch)?;
            let image = decode_png(&bytes)?;
            let scale = f64::from(image.width()) / geometry.viewport_width;
            if !scale.is_finite() || scale <= 0.0 {
                return Err(screenshot_too_large());
            }
            if let Some(previous_scale) = capture_scale {
                if (previous_scale - scale).abs() > f64::EPSILON {
                    return Err(screenshot_too_large());
                }
            } else {
                capture_scale = Some(scale);
            }
            let offset = (
                css_offset_to_pixels(current.scroll_x, scale)?,
                css_offset_to_pixels(current.scroll_y, scale)?,
            );
            if !captured_offsets.insert(offset) {
                continue;
            }
            if composer.is_none() {
                composer = Some(FullPageComposer::new(
                    &image,
                    geometry.viewport_width,
                    geometry.viewport_height,
                    geometry.document_width,
                    geometry.document_height,
                )?);
            }
            composer
                .as_mut()
                .expect("composer is initialized from the first tile")
                .add_tile(&image, current.scroll_x, current.scroll_y)?;
        }
        let stitched = composer.ok_or_else(screenshot_too_large)?.finish();
        encode_capped_png(&stitched)
    }

    #[allow(clippy::too_many_arguments)]
    async fn restore_scroll_locked_with<Dispatch>(
        &self,
        key: &PageKey,
        actor: &Arc<PageActor>,
        window_label: &str,
        webview_label: &str,
        original_scroll: (f64, f64),
        dispatch: &mut Dispatch,
    ) -> Result<(), ToolError>
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
    {
        let _ = self
            .execute_raw_locked_with(
                key,
                actor,
                window_label,
                webview_label,
                PageAutomationOperation::ScreenshotRestore {
                    x: original_scroll.0,
                    y: original_scroll.1,
                },
                dispatch,
            )
            .await?;
        Ok(())
    }

    fn ensure_capture_epoch(&self, actor: &PageActor, epoch: u64) -> Result<(), ToolError> {
        if actor.navigation.borrow().epoch == epoch {
            Ok(())
        } else {
            Err(page_changed_during_capture())
        }
    }

    fn capture_error_for_epoch(
        &self,
        actor: &PageActor,
        epoch: u64,
        error: ToolError,
    ) -> ToolError {
        if actor.navigation.borrow().epoch == epoch {
            error
        } else {
            page_changed_during_capture()
        }
    }

    pub async fn prepare_navigation_with<Dispatch>(
        &self,
        key: PageKey,
        window_label: String,
        webview_label: String,
        mut dispatch: Dispatch,
    ) -> Result<NavigationMarker, ToolError>
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
    {
        let actor = self.actor(&key)?;
        if actor
            .last_document
            .lock()
            .map_err(|_| bridge_rejected())?
            .is_none()
        {
            self.execute_with(
                key.clone(),
                window_label,
                webview_label,
                PageAutomationOperation::Snapshot,
                &mut dispatch,
            )
            .await?;
        }
        let execution = actor.execution.clone().lock_owned().await;
        self.ensure_actor_current(&key, &actor)?;
        let progress = actor.navigation.borrow().clone();
        let document_token = actor
            .last_document
            .lock()
            .map_err(|_| bridge_rejected())?
            .as_ref()
            .map(|(_, token)| token.clone())
            .ok_or_else(webview_not_ready)?;
        Ok(NavigationMarker {
            key,
            epoch: progress.epoch,
            document_token,
            _execution: execution,
        })
    }

    pub async fn snapshot_after_navigation_with<Dispatch>(
        &self,
        marker: NavigationMarker,
        window_label: String,
        webview_label: String,
        mut dispatch: Dispatch,
    ) -> Result<CompactSnapshot, ToolError>
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
    {
        let actor = self.actor(&marker.key)?;
        self.ensure_actor_current(&marker.key, &actor)?;
        let mut navigation = actor.navigation.subscribe();
        let result = self
            .settle_snapshot_with(
                &marker.key,
                &actor,
                &window_label,
                &webview_label,
                &mut navigation,
                marker.epoch,
                false,
                Some(&marker.document_token),
                None,
                &mut dispatch,
            )
            .await?;
        Ok(result.snapshot)
    }

    #[allow(clippy::too_many_arguments)]
    async fn settle_snapshot_with<Dispatch>(
        &self,
        key: &PageKey,
        actor: &Arc<PageActor>,
        window_label: &str,
        webview_label: &str,
        navigation: &mut watch::Receiver<NavigationProgress>,
        previous_epoch: u64,
        allow_current_epoch: bool,
        rejected_token: Option<&str>,
        action: Option<PageAutomationActionResult>,
        dispatch: &mut Dispatch,
    ) -> Result<PageAutomationSuccessResult, ToolError>
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
    {
        let settlement_deadline = tokio::time::Instant::now()
            + Duration::from_millis(super::protocol::PAGE_AUTOMATION_SETTLE_TIMEOUT_MS);
        loop {
            self.ensure_actor_current(key, actor)?;
            let progress = Self::await_finished_navigation_after(
                navigation,
                previous_epoch,
                allow_current_epoch,
                settlement_deadline,
            )
            .await?;
            let snapshot_request = PageAutomationBridgeRequest {
                request_id: self.allocate_request_id()?,
                document_id: key.document_id.clone(),
                page_node_id: key.page_node_id.clone(),
                navigation_epoch: progress.epoch,
                operation: PageAutomationOperation::Snapshot,
            };
            let registration = self.register_and_dispatch(
                key,
                actor,
                window_label,
                webview_label,
                &snapshot_request,
                dispatch,
            );
            let (receiver, _pending) = match registration {
                Ok(registration) => registration,
                Err(error) if error.code == "webview_not_ready" => return Err(error),
                Err(_) => {
                    Self::wait_for_settlement_retry(settlement_deadline).await?;
                    continue;
                }
            };
            if actor.removed.load(Ordering::Acquire) {
                return Err(webview_not_ready());
            }
            match self
                .await_result_or_navigation(
                    receiver,
                    navigation,
                    snapshot_request.navigation_epoch,
                    settlement_deadline,
                )
                .await
            {
                Ok(RequestOutcome::Completed(result)) => {
                    match self.validate_success(actor, &progress, &snapshot_request, result) {
                        Ok(success)
                            if navigation.borrow().epoch == snapshot_request.navigation_epoch
                                && (!progress.requires_new_document_token
                                    || rejected_token.is_none_or(|token| {
                                        token != success.snapshot.document_token
                                    })) =>
                        {
                            return Ok(PageAutomationSuccessResult {
                                snapshot: success.snapshot,
                                action,
                            });
                        }
                        Ok(_) | Err(_) => {
                            Self::wait_for_settlement_retry(settlement_deadline).await?;
                        }
                    }
                }
                Ok(RequestOutcome::Navigated) => continue,
                Err(error) if error.code == "request_timeout" => return Err(error),
                Err(_) => Self::wait_for_settlement_retry(settlement_deadline).await?,
            }
        }
    }

    /// requestId は推測不能にする。連番だと、completion command を持つ任意の
    /// HTTP(S) ページが他ページ向けの ID を当てて automation を妨害できる。
    fn allocate_request_id(&self) -> Result<String, ToolError> {
        Ok(format!("pa-{}", uuid::Uuid::new_v4()))
    }

    fn actor(&self, key: &PageKey) -> Result<Arc<PageActor>, ToolError> {
        let inner = self.inner.lock().map_err(|_| webview_not_ready())?;
        inner.actors.get(key).cloned().ok_or_else(webview_not_ready)
    }

    fn ensure_actor_current(&self, key: &PageKey, actor: &Arc<PageActor>) -> Result<(), ToolError> {
        if actor.removed.load(Ordering::Acquire) {
            return Err(webview_not_ready());
        }
        let current = self.actor(key)?;
        if !Arc::ptr_eq(&current, actor) {
            return Err(webview_not_ready());
        }
        Ok(())
    }

    fn validate_success(
        &self,
        actor: &PageActor,
        progress: &NavigationProgress,
        request: &PageAutomationBridgeRequest,
        result: PageAutomationBridgeResult,
    ) -> Result<PageAutomationSuccessResult, ToolError> {
        let success = result.success_result()?;
        if success.snapshot.navigation_epoch != request.navigation_epoch {
            return Err(bridge_rejected());
        }
        self.verify_snapshot_identity(actor, progress, &success.snapshot)?;
        Ok(success)
    }

    fn verify_snapshot_identity(
        &self,
        actor: &PageActor,
        progress: &NavigationProgress,
        snapshot: &CompactSnapshot,
    ) -> Result<(), ToolError> {
        if let Some(final_url) = progress.final_url.as_deref() {
            let snapshot_url = normalize_url(&snapshot.url).map_err(|_| bridge_rejected())?;
            if snapshot_url != final_url {
                return Err(bridge_rejected());
            }
        }
        self.verify_document_token(actor, progress, snapshot)
    }

    async fn wait_for_settlement_retry(deadline: tokio::time::Instant) -> Result<(), ToolError> {
        let delay = Duration::from_millis(super::protocol::PAGE_AUTOMATION_SETTLE_POLL_MS);
        if tokio::time::Instant::now() + delay > deadline {
            return Err(request_timeout());
        }
        tokio::time::sleep(delay).await;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn register_and_dispatch<'a, Dispatch>(
        &'a self,
        key: &PageKey,
        actor: &Arc<PageActor>,
        window_label: &str,
        webview_label: &str,
        request: &PageAutomationBridgeRequest,
        dispatch: &mut Dispatch,
    ) -> Result<
        (
            oneshot::Receiver<Result<PageAutomationBridgeResult, ToolError>>,
            PendingRegistration<'a>,
        ),
        ToolError,
    >
    where
        Dispatch: FnMut(PageAutomationBridgeRequest) -> Result<(), ToolError>,
    {
        if !is_page_request_id(&request.request_id) {
            return Err(bridge_rejected());
        }
        let request_id = request.request_id.clone();
        let (sender, receiver) = oneshot::channel();
        let mut inner = self.inner.lock().map_err(|_| webview_not_ready())?;
        let actor_is_current = inner
            .actors
            .get(key)
            .is_some_and(|current| Arc::ptr_eq(current, actor));
        if actor.removed.load(Ordering::Acquire) || !actor_is_current {
            return Err(webview_not_ready());
        }
        inner.pending.insert(
            request_id.clone(),
            PendingRequest {
                key: key.clone(),
                window_label: window_label.to_string(),
                webview_label: webview_label.to_string(),
                sender,
            },
        );
        if let Err(error) = dispatch(request.clone()) {
            inner.pending.remove(&request_id);
            return Err(error);
        }
        drop(inner);
        Ok((
            receiver,
            PendingRegistration {
                state: self,
                request_id: request_id.to_string(),
            },
        ))
    }

    fn remove_pending(&self, request_id: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.pending.remove(request_id);
        }
    }

    async fn await_result_or_navigation(
        &self,
        mut receiver: oneshot::Receiver<Result<PageAutomationBridgeResult, ToolError>>,
        navigation: &mut watch::Receiver<NavigationProgress>,
        request_epoch: u64,
        deadline: tokio::time::Instant,
    ) -> Result<RequestOutcome, ToolError> {
        loop {
            let timeout = deadline.saturating_duration_since(tokio::time::Instant::now());
            if timeout.is_zero() {
                return Err(request_timeout());
            }
            tokio::select! {
                result = &mut receiver => {
                    return match result {
                        Ok(result) => result.map(RequestOutcome::Completed),
                        Err(_) => Err(webview_not_ready()),
                    };
                }
                changed = navigation.changed() => {
                    if changed.is_err() {
                        return Err(webview_not_ready());
                    }
                    if navigation.borrow().epoch > request_epoch {
                        return Ok(RequestOutcome::Navigated);
                    }
                }
                _ = tokio::time::sleep(timeout) => return Err(request_timeout()),
            }
        }
    }

    async fn await_finished_navigation_after(
        navigation: &mut watch::Receiver<NavigationProgress>,
        previous_epoch: u64,
        allow_current_epoch: bool,
        deadline: tokio::time::Instant,
    ) -> Result<NavigationProgress, ToolError> {
        loop {
            let progress = navigation.borrow().clone();
            if allow_current_epoch && progress.epoch == previous_epoch {
                return Ok(progress);
            }
            if progress.epoch > previous_epoch
                && progress.finished_epoch == Some(progress.epoch)
                && progress.final_url.is_some()
            {
                return Ok(progress);
            }
            let timeout = deadline.saturating_duration_since(tokio::time::Instant::now());
            if timeout.is_zero() {
                return Err(request_timeout());
            }
            tokio::select! {
                changed = navigation.changed() => {
                    if changed.is_err() {
                        return Err(webview_not_ready());
                    }
                }
                _ = tokio::time::sleep(timeout) => return Err(request_timeout()),
            }
        }
    }

    fn verify_document_token(
        &self,
        actor: &PageActor,
        navigation: &NavigationProgress,
        snapshot: &CompactSnapshot,
    ) -> Result<(), ToolError> {
        let mut previous = actor.last_document.lock().map_err(|_| bridge_rejected())?;
        if let Some((previous_epoch, previous_token)) = previous.as_ref() {
            if *previous_epoch == snapshot.navigation_epoch
                && previous_token != &snapshot.document_token
            {
                return Err(bridge_rejected());
            }
            if *previous_epoch < snapshot.navigation_epoch
                && navigation.requires_new_document_token
                && previous_token == &snapshot.document_token
            {
                return Err(bridge_rejected());
            }
        }
        *previous = Some((snapshot.navigation_epoch, snapshot.document_token.clone()));
        Ok(())
    }

    #[cfg(test)]
    fn pending_count(&self) -> usize {
        self.inner
            .lock()
            .map(|inner| inner.pending.len())
            .unwrap_or_default()
    }
}

fn is_page_request_id(request_id: &str) -> bool {
    request_id.strip_prefix("pa-").is_some_and(|value| {
        !value.is_empty()
            && value
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
    })
}

fn normalize_url(url: &str) -> Result<String, String> {
    tauri::Url::parse(url)
        .map(|url| url.to_string())
        .map_err(|error| format!("invalid navigation URL: {error}"))
}

fn full_page_tile_positions(geometry: PageViewportGeometry) -> Result<Vec<(f64, f64)>, ToolError> {
    if geometry.viewport_width <= 1.0
        || geometry.viewport_height <= 1.0
        || geometry.document_width < geometry.viewport_width
        || geometry.document_height < geometry.viewport_height
    {
        return Err(bridge_rejected());
    }
    let horizontal = tile_axis_positions(geometry.document_width, geometry.viewport_width)?;
    let vertical = tile_axis_positions(geometry.document_height, geometry.viewport_height)?;
    let count = horizontal
        .len()
        .checked_mul(vertical.len())
        .ok_or_else(screenshot_too_large)?;
    if count > PAGE_AUTOMATION_MAX_FULL_PAGE_TILES {
        return Err(screenshot_too_large());
    }
    Ok(vertical
        .into_iter()
        .flat_map(|y| horizontal.iter().copied().map(move |x| (x, y)))
        .collect())
}

fn tile_axis_positions(document: f64, viewport: f64) -> Result<Vec<f64>, ToolError> {
    let maximum_scroll = (document - viewport).max(0.0);
    let step = viewport - 1.0;
    let mut positions = vec![0.0];
    while *positions.last().expect("positions starts with zero") < maximum_scroll {
        let previous = *positions.last().expect("positions starts with zero");
        let next = (previous + step).min(maximum_scroll);
        if next <= previous {
            return Err(bridge_rejected());
        }
        if positions.len() == PAGE_AUTOMATION_MAX_FULL_PAGE_TILES {
            return Err(screenshot_too_large());
        }
        positions.push(next);
    }
    Ok(positions)
}

fn css_offset_to_pixels(offset: f64, scale: f64) -> Result<u32, ToolError> {
    if !offset.is_finite() || offset < 0.0 || !scale.is_finite() || scale <= 0.0 {
        return Err(bridge_rejected());
    }
    let pixels = (offset * scale).round();
    if !(0.0..=f64::from(u32::MAX)).contains(&pixels) {
        return Err(screenshot_too_large());
    }
    Ok(pixels as u32)
}

enum RequestOutcome {
    Completed(PageAutomationBridgeResult),
    Navigated,
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{codecs::png::PngEncoder, ColorType, ImageEncoder, Rgba, RgbaImage};
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn key(page_node_id: &str) -> PageKey {
        PageKey {
            document_id: "document-1".to_string(),
            page_node_id: page_node_id.to_string(),
        }
    }

    fn action_result(
        request: &PageAutomationBridgeRequest,
        token: &str,
        url: &str,
        kind: &str,
    ) -> PageAutomationBridgeResult {
        let mut action_result = result(request, token, url);
        action_result.result["action"] = json!({ "kind": kind });
        action_result
    }

    fn raw_action_result(
        request: &PageAutomationBridgeRequest,
        kind: &str,
    ) -> PageAutomationBridgeResult {
        serde_json::from_value(json!({
            "requestId": request.request_id,
            "documentId": request.document_id,
            "pageNodeId": request.page_node_id,
            "result": {"action": {"kind": kind, "configured": true}}
        }))
        .unwrap()
    }

    fn raw_geometry_result(
        request: &PageAutomationBridgeRequest,
        kind: &str,
        geometry: serde_json::Value,
    ) -> PageAutomationBridgeResult {
        serde_json::from_value(json!({
            "requestId": request.request_id,
            "documentId": request.document_id,
            "pageNodeId": request.page_node_id,
            "result": {"action": {"kind": kind, "geometry": geometry}}
        }))
        .unwrap()
    }

    fn png(image: &RgbaImage) -> Vec<u8> {
        let mut bytes = Vec::new();
        PngEncoder::new(&mut bytes)
            .write_image(
                image.as_raw(),
                image.width(),
                image.height(),
                ColorType::Rgba8.into(),
            )
            .unwrap();
        bytes
    }

    fn complete_in_thread(state: Arc<PageAutomationState>, result: PageAutomationBridgeResult) {
        std::thread::spawn(move || {
            state
                .complete("document-1", "page-document-1-page-a", result)
                .unwrap();
        });
    }

    fn result(
        request: &PageAutomationBridgeRequest,
        token: &str,
        url: &str,
    ) -> PageAutomationBridgeResult {
        serde_json::from_value(json!({
            "requestId": request.request_id,
            "documentId": request.document_id,
            "pageNodeId": request.page_node_id,
            "result": {
                "snapshot": {
                    "snapshotId": format!("s{}-1", request.navigation_epoch),
                    "documentToken": token,
                    "navigationEpoch": request.navigation_epoch,
                    "url": url,
                    "title": "Fixture",
                    "compactText": "",
                    "elements": [],
                    "frames": [],
                    "truncated": false
                }
            }
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn serializes_requests_per_page_but_allows_different_pages() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(2)));
        state.register_page(key("page-a")).unwrap();
        state.register_page(key("page-b")).unwrap();
        let active_a = Arc::new(AtomicUsize::new(0));
        let max_a = Arc::new(AtomicUsize::new(0));
        let active_total = Arc::new(AtomicUsize::new(0));
        let max_total = Arc::new(AtomicUsize::new(0));

        let run = |page: &'static str,
                   state: Arc<PageAutomationState>,
                   active_a: Arc<AtomicUsize>,
                   max_a: Arc<AtomicUsize>,
                   active_total: Arc<AtomicUsize>,
                   max_total: Arc<AtomicUsize>| {
            tokio::spawn(async move {
                let state_for_dispatch = state.clone();
                state
                    .execute_with(
                        key(page),
                        "document-1".into(),
                        format!("page-document-1-{page}"),
                        PageAutomationOperation::Snapshot,
                        move |request| {
                            let current_total = active_total.fetch_add(1, Ordering::SeqCst) + 1;
                            max_total.fetch_max(current_total, Ordering::SeqCst);
                            if page == "page-a" {
                                let current_a = active_a.fetch_add(1, Ordering::SeqCst) + 1;
                                max_a.fetch_max(current_a, Ordering::SeqCst);
                            }
                            let state = state_for_dispatch.clone();
                            let active_a = active_a.clone();
                            let active_total = active_total.clone();
                            tokio::spawn(async move {
                                tokio::time::sleep(Duration::from_millis(30)).await;
                                if page == "page-a" {
                                    active_a.fetch_sub(1, Ordering::SeqCst);
                                }
                                active_total.fetch_sub(1, Ordering::SeqCst);
                                state
                                    .complete(
                                        "document-1",
                                        &format!("page-document-1-{page}"),
                                        result(
                                            &request,
                                            "0123456789abcdef0123456789abcdef",
                                            "https://example.test",
                                        ),
                                    )
                                    .unwrap();
                            });
                            Ok(())
                        },
                    )
                    .await
                    .unwrap();
            })
        };

        let tasks = vec![
            run(
                "page-a",
                state.clone(),
                active_a.clone(),
                max_a.clone(),
                active_total.clone(),
                max_total.clone(),
            ),
            run(
                "page-a",
                state.clone(),
                active_a.clone(),
                max_a.clone(),
                active_total.clone(),
                max_total.clone(),
            ),
            run(
                "page-b",
                state.clone(),
                active_a.clone(),
                max_a.clone(),
                active_total.clone(),
                max_total.clone(),
            ),
        ];
        for task in tasks {
            task.await.unwrap();
        }
        assert_eq!(max_a.load(Ordering::SeqCst), 1);
        assert!(max_total.load(Ordering::SeqCst) >= 2);
    }

    #[tokio::test]
    async fn a_mismatched_completion_leaves_the_legitimate_request_pending() {
        // 悪意あるページが他ページ向けの requestId を推測して送っても、
        // 正規の待ち手を失敗させたり pending entry を消費したりしてはならない。
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(5)));
        state.register_page(key("page-a")).unwrap();
        let state_for_dispatch = state.clone();
        let outcome = state
            .execute_with(
                key("page-a"),
                "document-1".into(),
                "page-document-1-page-a".into(),
                PageAutomationOperation::Snapshot,
                move |request| {
                    let state = state_for_dispatch.clone();
                    std::thread::spawn(move || {
                        // 別 window を騙る completion
                        assert!(state
                            .complete(
                                "document-2",
                                "page-document-1-page-a",
                                result(
                                    &request,
                                    "0123456789abcdef0123456789abcdef",
                                    "https://example.test",
                                ),
                            )
                            .is_err());
                        assert_eq!(state.pending_count(), 1);

                        // payload の pageNodeId を偽装した completion
                        let mut mismatched = result(
                            &request,
                            "0123456789abcdef0123456789abcdef",
                            "https://example.test",
                        );
                        mismatched.page_node_id = "page-b".into();
                        assert!(state
                            .complete("document-1", "page-document-1-page-a", mismatched)
                            .is_err());
                        assert_eq!(state.pending_count(), 1);

                        // 正規の completion だけが pending を解決する
                        assert!(state
                            .complete(
                                "document-1",
                                "page-document-1-page-a",
                                result(
                                    &request,
                                    "0123456789abcdef0123456789abcdef",
                                    "https://example.test",
                                ),
                            )
                            .is_ok());
                    });
                    Ok(())
                },
            )
            .await;
        assert!(
            outcome.is_ok(),
            "the legitimate request must still succeed: {outcome:?}"
        );
        assert_eq!(state.pending_count(), 0);
    }

    #[test]
    fn request_ids_are_not_guessable() {
        let state = PageAutomationState::with_timeout(Duration::from_secs(1));
        let first = state.allocate_request_id().unwrap();
        let second = state.allocate_request_id().unwrap();

        assert_ne!(first, second);
        assert!(
            is_page_request_id(&first),
            "must stay a valid page request ID: {first}"
        );
        assert!(!first.ends_with("-1"), "must not be sequential: {first}");
        assert_eq!(first.len(), second.len());
    }

    #[tokio::test]
    async fn unknown_and_duplicate_completions_do_not_consume_another_request() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        state.register_page(key("page-a")).unwrap();
        let dispatch_state = state.clone();
        let outcome = state
            .execute_with(
                key("page-a"),
                "document-1".into(),
                "page-document-1-page-a".into(),
                PageAutomationOperation::Snapshot,
                move |request| {
                    let state = dispatch_state.clone();
                    std::thread::spawn(move || {
                        let mut unknown = result(
                            &request,
                            "0123456789abcdef0123456789abcdef",
                            "https://example.test",
                        );
                        unknown.request_id = "pa-999999".into();
                        assert!(state
                            .complete("document-1", "page-document-1-page-a", unknown)
                            .is_err());
                        assert_eq!(state.pending_count(), 1);
                        state
                            .complete(
                                "document-1",
                                "page-document-1-page-a",
                                result(
                                    &request,
                                    "0123456789abcdef0123456789abcdef",
                                    "https://example.test",
                                ),
                            )
                            .unwrap();
                        assert!(state
                            .complete(
                                "document-1",
                                "page-document-1-page-a",
                                result(
                                    &request,
                                    "0123456789abcdef0123456789abcdef",
                                    "https://example.test",
                                ),
                            )
                            .is_err());
                    });
                    Ok(())
                },
            )
            .await;
        assert!(outcome.is_ok());
        assert_eq!(state.pending_count(), 0);
    }

    #[tokio::test]
    async fn waits_for_finished_navigation_then_dispatches_a_fresh_snapshot() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        state
            .note_committed_navigation(&page_key, "https://old.test".into())
            .unwrap();
        let dispatch_count = Arc::new(AtomicUsize::new(0));
        let state_for_dispatch = state.clone();
        let key_for_dispatch = page_key.clone();
        let count_for_dispatch = dispatch_count.clone();

        let success = state
            .execute_with(
                page_key,
                "document-1".into(),
                "page-document-1-page-a".into(),
                PageAutomationOperation::Click {
                    snapshot_id: "1:1".into(),
                    element_ref: "e1".into(),
                },
                move |request| {
                    let call = count_for_dispatch.fetch_add(1, Ordering::SeqCst);
                    let state = state_for_dispatch.clone();
                    let key = key_for_dispatch.clone();
                    tokio::spawn(async move {
                        if call == 0 {
                            tokio::time::sleep(Duration::from_millis(20)).await;
                            state
                                .note_committed_navigation(&key, "https://new.test".into())
                                .unwrap();
                        } else {
                            state
                                .complete(
                                    "document-1",
                                    "page-document-1-page-a",
                                    result(
                                        &request,
                                        "fedcba9876543210fedcba9876543210",
                                        "https://new.test",
                                    ),
                                )
                                .unwrap();
                        }
                    });
                    Ok(())
                },
            )
            .await
            .unwrap();

        assert_eq!(dispatch_count.load(Ordering::SeqCst), 2);
        assert_eq!(success.snapshot.url, "https://new.test");
        assert_eq!(success.snapshot.navigation_epoch, 2);
        assert_eq!(
            success.action.unwrap().kind,
            super::super::protocol::PageAutomationActionKind::Click
        );
    }

    #[tokio::test]
    async fn rejects_reused_document_token_after_full_navigation() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        let first_state = state.clone();
        state
            .execute_with(
                page_key.clone(),
                "document-1".into(),
                "page-document-1-page-a".into(),
                PageAutomationOperation::Snapshot,
                move |request| {
                    complete_in_thread(
                        first_state.clone(),
                        result(
                            &request,
                            "0123456789abcdef0123456789abcdef",
                            "https://old.test",
                        ),
                    );
                    Ok(())
                },
            )
            .await
            .unwrap();
        state
            .note_committed_navigation(&page_key, "https://new.test".into())
            .unwrap();
        let second_state = state.clone();
        let error = state
            .execute_with(
                page_key,
                "document-1".into(),
                "page-document-1-page-a".into(),
                PageAutomationOperation::Snapshot,
                move |request| {
                    complete_in_thread(
                        second_state.clone(),
                        result(
                            &request,
                            "0123456789abcdef0123456789abcdef",
                            "https://new.test",
                        ),
                    );
                    Ok(())
                },
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, "bridge_rejected");
    }

    #[tokio::test]
    async fn removal_fails_pending_requests_and_cleans_state() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        let remove_state = state.clone();
        let remove_key = page_key.clone();
        let error = state
            .execute_with(
                page_key,
                "document-1".into(),
                "page-document-1-page-a".into(),
                PageAutomationOperation::Snapshot,
                move |_| {
                    let state = remove_state.clone();
                    let key = remove_key.clone();
                    std::thread::spawn(move || state.remove_page(&key).unwrap());
                    Ok(())
                },
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, "webview_not_ready");
        assert_eq!(state.pending_count(), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn timeout_and_caller_cancellation_remove_pending_entries() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_millis(
            15_000,
        )));
        state.register_page(key("page-a")).unwrap();
        let timeout_state = state.clone();
        let timeout_task = tokio::spawn(async move {
            timeout_state
                .execute_with(
                    key("page-a"),
                    "document-1".into(),
                    "page-document-1-page-a".into(),
                    PageAutomationOperation::Snapshot,
                    |_| Ok(()),
                )
                .await
        });
        tokio::task::yield_now().await;
        assert_eq!(state.pending_count(), 1);
        tokio::time::advance(Duration::from_millis(14_999)).await;
        assert!(!timeout_task.is_finished());
        tokio::time::advance(Duration::from_millis(1)).await;
        assert_eq!(
            timeout_task.await.unwrap().unwrap_err().code,
            "request_timeout"
        );
        assert_eq!(state.pending_count(), 0);

        let evaluate_state = state.clone();
        let evaluate_task = tokio::spawn(async move {
            evaluate_state
                .execute_with(
                    key("page-a"),
                    "document-1".into(),
                    "page-document-1-page-a".into(),
                    PageAutomationOperation::Evaluate {
                        script: "new Promise(() => {})".into(),
                    },
                    |_| Ok(()),
                )
                .await
        });
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_millis(
            PAGE_AUTOMATION_EVALUATE_TIMEOUT_MS - 1,
        ))
        .await;
        assert!(!evaluate_task.is_finished());
        tokio::time::advance(Duration::from_millis(1)).await;
        assert_eq!(
            evaluate_task.await.unwrap().unwrap_err().code,
            "evaluate_timeout"
        );
        assert_eq!(state.pending_count(), 0);

        let cancellation_state = state.clone();
        let cancellation_task = tokio::spawn(async move {
            cancellation_state
                .execute_with(
                    key("page-a"),
                    "document-1".into(),
                    "page-document-1-page-a".into(),
                    PageAutomationOperation::Snapshot,
                    |_| Ok(()),
                )
                .await
        });
        tokio::task::yield_now().await;
        assert_eq!(state.pending_count(), 1);
        cancellation_task.abort();
        let _ = cancellation_task.await;
        assert_eq!(state.pending_count(), 0);
    }

    #[tokio::test]
    async fn removal_rejects_an_active_and_a_queued_request_without_redispatch() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        let dispatches = Arc::new(AtomicUsize::new(0));
        let first_state = state.clone();
        let first_dispatches = dispatches.clone();
        let first_key = page_key.clone();
        let first = tokio::spawn(async move {
            first_state
                .execute_with(
                    first_key,
                    "document-1".into(),
                    "page-document-1-page-a".into(),
                    PageAutomationOperation::Snapshot,
                    move |_| {
                        first_dispatches.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    },
                )
                .await
        });
        while state.pending_count() == 0 {
            tokio::task::yield_now().await;
        }
        let second_state = state.clone();
        let second_dispatches = dispatches.clone();
        let second_key = page_key.clone();
        let second = tokio::spawn(async move {
            second_state
                .execute_with(
                    second_key,
                    "document-1".into(),
                    "page-document-1-page-a".into(),
                    PageAutomationOperation::Snapshot,
                    move |_| {
                        second_dispatches.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    },
                )
                .await
        });
        tokio::task::yield_now().await;
        state.remove_page(&page_key).unwrap();
        assert_eq!(first.await.unwrap().unwrap_err().code, "webview_not_ready");
        assert_eq!(second.await.unwrap().unwrap_err().code, "webview_not_ready");
        assert_eq!(dispatches.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn spa_navigation_accepts_the_same_token_only_at_the_reported_url() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        let first_state = state.clone();
        state
            .execute_with(
                page_key.clone(),
                "document-1".into(),
                "page-document-1-page-a".into(),
                PageAutomationOperation::Snapshot,
                move |request| {
                    complete_in_thread(
                        first_state.clone(),
                        result(
                            &request,
                            "0123456789abcdef0123456789abcdef",
                            "https://example.test/old",
                        ),
                    );
                    Ok(())
                },
            )
            .await
            .unwrap();
        state
            .note_spa_navigation(&page_key, "https://example.test/new".into())
            .unwrap();
        let second_state = state.clone();
        let success = state
            .execute_with(
                page_key,
                "document-1".into(),
                "page-document-1-page-a".into(),
                PageAutomationOperation::Snapshot,
                move |request| {
                    complete_in_thread(
                        second_state.clone(),
                        result(
                            &request,
                            "0123456789abcdef0123456789abcdef",
                            "https://example.test/new",
                        ),
                    );
                    Ok(())
                },
            )
            .await
            .unwrap();
        assert_eq!(success.snapshot.navigation_epoch, 1);
    }

    #[tokio::test]
    async fn non_navigating_action_refreshes_the_current_epoch_without_load_state() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        let initial_state = state.clone();
        state
            .execute_with(
                page_key.clone(),
                "document-1".into(),
                "page-document-1-page-a".into(),
                PageAutomationOperation::Snapshot,
                move |request| {
                    complete_in_thread(
                        initial_state.clone(),
                        result(
                            &request,
                            "0123456789abcdef0123456789abcdef",
                            "https://example.test",
                        ),
                    );
                    Ok(())
                },
            )
            .await
            .unwrap();
        let dispatches = Arc::new(AtomicUsize::new(0));
        let dispatch_state = state.clone();
        let dispatch_count = dispatches.clone();
        let success = state
            .execute_with(
                page_key,
                "document-1".into(),
                "page-document-1-page-a".into(),
                PageAutomationOperation::Click {
                    snapshot_id: "s0-1".into(),
                    element_ref: "e1".into(),
                },
                move |request| {
                    let call = dispatch_count.fetch_add(1, Ordering::SeqCst);
                    let response = if call == 0 {
                        let mut response = action_result(
                            &request,
                            "0123456789abcdef0123456789abcdef",
                            "https://example.test",
                            "click",
                        );
                        response.result["action"]["inputTrusted"] = json!(false);
                        response
                    } else {
                        result(
                            &request,
                            "0123456789abcdef0123456789abcdef",
                            "https://example.test",
                        )
                    };
                    complete_in_thread(dispatch_state.clone(), response);
                    Ok(())
                },
            )
            .await
            .unwrap();
        assert_eq!(dispatches.load(Ordering::SeqCst), 2);
        assert_eq!(success.snapshot.navigation_epoch, 0);
        assert_eq!(success.action.unwrap().input_trusted, Some(false));
    }

    #[tokio::test]
    async fn raw_operations_share_the_page_queue_with_semantic_actions() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        let raw_request = Arc::new(Mutex::new(None));
        let raw_request_for_dispatch = raw_request.clone();
        let raw_state = state.clone();
        let raw_task = tokio::spawn(async move {
            raw_state
                .execute_raw_with(
                    page_key,
                    "document-1".into(),
                    "page-document-1-page-a".into(),
                    PageAutomationOperation::SetDialogHandler {
                        action: super::super::protocol::DialogAction::Dismiss,
                        prompt_text: None,
                    },
                    move |request| {
                        *raw_request_for_dispatch.lock().unwrap() = Some(request);
                        Ok(())
                    },
                )
                .await
        });
        while state.pending_count() == 0 {
            tokio::task::yield_now().await;
        }

        let semantic_dispatches = Arc::new(AtomicUsize::new(0));
        let semantic_dispatches_for_task = semantic_dispatches.clone();
        let semantic_state = state.clone();
        let semantic_completion_state = semantic_state.clone();
        let semantic_key = key("page-a");
        let semantic_task = tokio::spawn(async move {
            semantic_state
                .execute_with(
                    semantic_key,
                    "document-1".into(),
                    "page-document-1-page-a".into(),
                    PageAutomationOperation::Snapshot,
                    move |request| {
                        semantic_dispatches_for_task.fetch_add(1, Ordering::SeqCst);
                        complete_in_thread(
                            semantic_completion_state.clone(),
                            result(
                                &request,
                                "0123456789abcdef0123456789abcdef",
                                "https://example.test",
                            ),
                        );
                        Ok(())
                    },
                )
                .await
        });
        tokio::task::yield_now().await;
        assert_eq!(semantic_dispatches.load(Ordering::SeqCst), 0);

        let request = raw_request.lock().unwrap().take().unwrap();
        state
            .complete(
                "document-1",
                "page-document-1-page-a",
                raw_action_result(&request, "set_dialog_handler"),
            )
            .unwrap();
        assert!(raw_task.await.unwrap().is_ok());
        assert!(semantic_task.await.unwrap().is_ok());
        assert_eq!(semantic_dispatches.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn raw_operations_do_not_block_different_pages() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        state.register_page(key("page-a")).unwrap();
        state.register_page(key("page-b")).unwrap();
        let raw_state = state.clone();
        let raw_task = tokio::spawn(async move {
            raw_state
                .execute_raw_with(
                    key("page-a"),
                    "document-1".into(),
                    "page-document-1-page-a".into(),
                    PageAutomationOperation::SetDialogHandler {
                        action: super::super::protocol::DialogAction::Dismiss,
                        prompt_text: None,
                    },
                    |_| Ok(()),
                )
                .await
        });
        while state.pending_count() == 0 {
            tokio::task::yield_now().await;
        }

        let other_state = state.clone();
        let other = state
            .execute_with(
                key("page-b"),
                "document-1".into(),
                "page-document-1-page-b".into(),
                PageAutomationOperation::Snapshot,
                move |request| {
                    let state = other_state.clone();
                    std::thread::spawn(move || {
                        state
                            .complete(
                                "document-1",
                                "page-document-1-page-b",
                                result(
                                    &request,
                                    "fedcba9876543210fedcba9876543210",
                                    "https://example.test",
                                ),
                            )
                            .unwrap();
                    });
                    Ok(())
                },
            )
            .await;
        assert!(other.is_ok());
        raw_task.abort();
        let _ = raw_task.await;
        assert_eq!(state.pending_count(), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn raw_operation_timeout_cleans_pending_state() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        state.register_page(key("page-a")).unwrap();
        let timeout_state = state.clone();
        let timed_out = tokio::spawn(async move {
            timeout_state
                .execute_raw_with(
                    key("page-a"),
                    "document-1".into(),
                    "page-document-1-page-a".into(),
                    PageAutomationOperation::SetDialogHandler {
                        action: super::super::protocol::DialogAction::Dismiss,
                        prompt_text: None,
                    },
                    |_| Ok(()),
                )
                .await
        });
        tokio::task::yield_now().await;
        assert_eq!(state.pending_count(), 1);
        tokio::time::advance(Duration::from_secs(1)).await;
        assert_eq!(
            timed_out.await.unwrap().unwrap_err().code,
            "request_timeout"
        );
        assert_eq!(state.pending_count(), 0);
    }

    #[tokio::test]
    async fn raw_operations_fail_when_the_navigation_epoch_changes() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        let dispatch_state = state.clone();
        let dispatch_key = page_key.clone();
        let outcome = state
            .execute_raw_with(
                page_key,
                "document-1".into(),
                "page-document-1-page-a".into(),
                PageAutomationOperation::SetDialogHandler {
                    action: super::super::protocol::DialogAction::Dismiss,
                    prompt_text: None,
                },
                move |_| {
                    let state = dispatch_state.clone();
                    let key = dispatch_key.clone();
                    std::thread::spawn(move || {
                        state
                            .note_spa_navigation(&key, "https://example.test/new".into())
                            .unwrap();
                    });
                    Ok(())
                },
            )
            .await;
        assert_eq!(outcome.unwrap_err().code, "bridge_rejected");
        assert_eq!(state.pending_count(), 0);
    }

    #[tokio::test]
    async fn raw_operations_reject_an_unexpected_action_kind() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        state.register_page(key("page-a")).unwrap();
        let dispatch_state = state.clone();
        let outcome = state
            .execute_raw_with(
                key("page-a"),
                "document-1".into(),
                "page-document-1-page-a".into(),
                PageAutomationOperation::SetDialogHandler {
                    action: super::super::protocol::DialogAction::Dismiss,
                    prompt_text: None,
                },
                move |request| {
                    complete_in_thread(
                        dispatch_state.clone(),
                        raw_action_result(&request, "click"),
                    );
                    Ok(())
                },
            )
            .await;
        assert_eq!(outcome.unwrap_err().code, "bridge_rejected");
    }

    #[tokio::test]
    async fn action_settlement_observes_a_delayed_spa_notification() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        state
            .note_committed_navigation(&page_key, "https://example.test/old".into())
            .unwrap();
        let dispatches = Arc::new(AtomicUsize::new(0));
        let dispatch_state = state.clone();
        let dispatch_key = page_key.clone();
        let dispatch_count = dispatches.clone();
        let success = state
            .execute_with(
                page_key,
                "document-1".into(),
                "page-document-1-page-a".into(),
                PageAutomationOperation::Click {
                    snapshot_id: "s1-1".into(),
                    element_ref: "e1".into(),
                },
                move |request| {
                    let call = dispatch_count.fetch_add(1, Ordering::SeqCst);
                    if call == 0 {
                        complete_in_thread(
                            dispatch_state.clone(),
                            action_result(
                                &request,
                                "0123456789abcdef0123456789abcdef",
                                "https://example.test/old",
                                "click",
                            ),
                        );
                        let state = dispatch_state.clone();
                        let key = dispatch_key.clone();
                        tokio::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(50)).await;
                            state
                                .note_spa_navigation(&key, "https://example.test/new".into())
                                .unwrap();
                        });
                    } else {
                        complete_in_thread(
                            dispatch_state.clone(),
                            result(
                                &request,
                                "0123456789abcdef0123456789abcdef",
                                "https://example.test/new",
                            ),
                        );
                    }
                    Ok(())
                },
            )
            .await
            .unwrap();
        assert_eq!(dispatches.load(Ordering::SeqCst), 2);
        assert_eq!(success.snapshot.navigation_epoch, 2);
        assert_eq!(success.snapshot.url, "https://example.test/new");
    }

    #[tokio::test]
    async fn element_capture_crops_at_the_native_scale_without_a_second_queue() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        let dispatch_state = state.clone();
        let mut source = RgbaImage::new(8, 8);
        for (x, y, pixel) in source.enumerate_pixels_mut() {
            *pixel = Rgba([x as u8, y as u8, 0, 255]);
        }
        let source = png(&source);

        let captured = state
            .capture_element_with(
                page_key,
                "document-1".into(),
                "page-document-1-page-a".into(),
                "s0-1".into(),
                "e1".into(),
                false,
                move |request| {
                    complete_in_thread(
                        dispatch_state.clone(),
                        raw_geometry_result(
                            &request,
                            "screenshot_element",
                            json!({
                                "element": {"x": 1.0, "y": 1.0, "width": 2.0, "height": 2.0},
                                "viewport": {
                                    "viewportWidth": 4.0, "viewportHeight": 4.0,
                                    "documentWidth": 4.0, "documentHeight": 4.0,
                                    "scrollX": 0.0, "scrollY": 0.0
                                }
                            }),
                        ),
                    );
                    Ok(())
                },
                move || std::future::ready(Ok(source.clone())),
            )
            .await
            .unwrap();

        assert_eq!((captured.width, captured.height), (4, 4));
        let cropped = decode_png(&captured.bytes).unwrap();
        assert_eq!(cropped.get_pixel(0, 0), &Rgba([2, 2, 0, 255]));
        assert_eq!(cropped.get_pixel(3, 3), &Rgba([5, 5, 0, 255]));
    }

    #[tokio::test]
    async fn full_page_capture_stitches_actual_offsets_and_restores_scroll() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        let dispatch_state = state.clone();
        let restore_count = Arc::new(AtomicUsize::new(0));
        let restore_count_for_dispatch = restore_count.clone();
        let tiles = Arc::new(Mutex::new(vec![
            png(&RgbaImage::from_pixel(4, 5, Rgba([255, 0, 0, 255]))),
            png(&RgbaImage::from_pixel(4, 5, Rgba([0, 255, 0, 255]))),
            png(&RgbaImage::from_pixel(4, 5, Rgba([0, 0, 255, 255]))),
        ]));
        let tiles_for_capture = tiles.clone();

        let captured = state
            .capture_full_page_with(
                page_key,
                "document-1".into(),
                "page-document-1-page-a".into(),
                false,
                move |request| {
                    let (kind, geometry) = match request.operation {
                        PageAutomationOperation::ScreenshotFullPage { .. } => (
                            "screenshot_full_page",
                            json!({
                                "viewportWidth": 4.0, "viewportHeight": 5.0,
                                "documentWidth": 4.0, "documentHeight": 12.0,
                                "scrollX": 0.0, "scrollY": 3.0
                            }),
                        ),
                        PageAutomationOperation::ScreenshotScroll { y, .. } => (
                            "screenshot_scroll",
                            json!({
                                "viewportWidth": 4.0, "viewportHeight": 5.0,
                                "documentWidth": 4.0, "documentHeight": 12.0,
                                "scrollX": 0.0, "scrollY": y
                            }),
                        ),
                        PageAutomationOperation::ScreenshotRestore { x, y } => {
                            restore_count_for_dispatch.fetch_add(1, Ordering::SeqCst);
                            assert_eq!((x, y), (0.0, 3.0));
                            (
                                "screenshot_restore",
                                json!({
                                    "viewportWidth": 4.0, "viewportHeight": 5.0,
                                    "documentWidth": 4.0, "documentHeight": 12.0,
                                    "scrollX": x, "scrollY": y
                                }),
                            )
                        }
                        _ => panic!("unexpected operation"),
                    };
                    complete_in_thread(
                        dispatch_state.clone(),
                        raw_geometry_result(&request, kind, geometry),
                    );
                    Ok(())
                },
                move || {
                    let bytes = tiles_for_capture.lock().unwrap().remove(0);
                    std::future::ready(Ok(bytes))
                },
            )
            .await
            .unwrap();

        let stitched = decode_png(&captured.bytes).unwrap();
        assert_eq!(stitched.dimensions(), (4, 12));
        assert_eq!(stitched.get_pixel(0, 3), &Rgba([255, 0, 0, 255]));
        assert_eq!(stitched.get_pixel(0, 4), &Rgba([0, 255, 0, 255]));
        assert_eq!(stitched.get_pixel(0, 7), &Rgba([0, 0, 255, 255]));
        assert_eq!(restore_count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn full_page_capture_attempts_restore_after_navigation_or_capture_failure() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        let dispatch_state = state.clone();
        let dispatch_key = page_key.clone();
        let restores = Arc::new(AtomicUsize::new(0));
        let restores_for_dispatch = restores.clone();

        let error = state
            .capture_full_page_with(
                page_key,
                "document-1".into(),
                "page-document-1-page-a".into(),
                false,
                move |request| {
                    match request.operation {
                        PageAutomationOperation::ScreenshotFullPage { .. } => complete_in_thread(
                            dispatch_state.clone(),
                            raw_geometry_result(
                                &request,
                                "screenshot_full_page",
                                json!({
                                    "viewportWidth": 4.0, "viewportHeight": 5.0,
                                    "documentWidth": 4.0, "documentHeight": 12.0,
                                    "scrollX": 0.0, "scrollY": 2.0
                                }),
                            ),
                        ),
                        PageAutomationOperation::ScreenshotScroll { .. } => {
                            let state = dispatch_state.clone();
                            let key = dispatch_key.clone();
                            std::thread::spawn(move || {
                                state
                                    .note_spa_navigation(
                                        &key,
                                        "https://example.test/changed".into(),
                                    )
                                    .unwrap();
                            });
                        }
                        PageAutomationOperation::ScreenshotRestore { x, y } => {
                            restores_for_dispatch.fetch_add(1, Ordering::SeqCst);
                            complete_in_thread(
                                dispatch_state.clone(),
                                raw_geometry_result(
                                    &request,
                                    "screenshot_restore",
                                    json!({
                                        "viewportWidth": 4.0, "viewportHeight": 5.0,
                                        "documentWidth": 4.0, "documentHeight": 12.0,
                                        "scrollX": x, "scrollY": y
                                    }),
                                ),
                            );
                        }
                        _ => panic!("unexpected operation"),
                    }
                    Ok(())
                },
                || std::future::ready(Err(screenshot_too_large())),
            )
            .await
            .unwrap_err();

        assert_eq!(error.code, "page_changed_during_capture");
        assert_eq!(restores.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn full_page_tile_positions_cover_horizontal_and_vertical_overflow() {
        let positions = full_page_tile_positions(PageViewportGeometry {
            viewport_width: 4.0,
            viewport_height: 5.0,
            document_width: 7.0,
            document_height: 12.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
        })
        .unwrap();

        assert_eq!(
            positions,
            vec![
                (0.0, 0.0),
                (3.0, 0.0),
                (0.0, 4.0),
                (3.0, 4.0),
                (0.0, 7.0),
                (3.0, 7.0)
            ]
        );
    }

    #[test]
    fn full_page_tile_limit_counts_unique_positions() {
        let error = full_page_tile_positions(PageViewportGeometry {
            viewport_width: 100.0,
            viewport_height: 10.0,
            document_width: 100.0,
            document_height: 586.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
        })
        .unwrap_err();
        assert_eq!(error.code, "screenshot_too_large");
    }

    #[tokio::test]
    async fn navigation_marker_accepts_the_same_token_after_spa_history_navigation() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        let initial_state = state.clone();
        let marker = state
            .prepare_navigation_with(
                page_key.clone(),
                "document-1".into(),
                "page-document-1-page-a".into(),
                move |request| {
                    complete_in_thread(
                        initial_state.clone(),
                        result(
                            &request,
                            "0123456789abcdef0123456789abcdef",
                            "https://example.test/current",
                        ),
                    );
                    Ok(())
                },
            )
            .await
            .unwrap();

        state
            .note_spa_navigation(&page_key, "https://example.test/previous".into())
            .unwrap();
        let replacement_state = state.clone();
        let snapshot = state
            .snapshot_after_navigation_with(
                marker,
                "document-1".into(),
                "page-document-1-page-a".into(),
                move |request| {
                    complete_in_thread(
                        replacement_state.clone(),
                        result(
                            &request,
                            "0123456789abcdef0123456789abcdef",
                            "https://example.test/previous",
                        ),
                    );
                    Ok(())
                },
            )
            .await
            .unwrap();

        assert_eq!(snapshot.navigation_epoch, 1);
        assert_eq!(snapshot.url, "https://example.test/previous");
    }

    #[tokio::test]
    async fn navigation_marker_holds_the_page_queue_until_the_replacement_snapshot() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
        let page_key = key("page-a");
        state.register_page(page_key.clone()).unwrap();
        let initial_state = state.clone();
        let marker = state
            .prepare_navigation_with(
                page_key.clone(),
                "document-1".into(),
                "page-document-1-page-a".into(),
                move |request| {
                    complete_in_thread(
                        initial_state.clone(),
                        result(
                            &request,
                            "0123456789abcdef0123456789abcdef",
                            "https://example.test/old",
                        ),
                    );
                    Ok(())
                },
            )
            .await
            .unwrap();
        assert_eq!(marker.epoch, 0);

        state
            .note_committed_navigation(&page_key, "https://example.test/new".into())
            .unwrap();
        let replacement_state = state.clone();
        let snapshot = state
            .snapshot_after_navigation_with(
                marker,
                "document-1".into(),
                "page-document-1-page-a".into(),
                move |request| {
                    complete_in_thread(
                        replacement_state.clone(),
                        result(
                            &request,
                            "fedcba9876543210fedcba9876543210",
                            "https://example.test/new",
                        ),
                    );
                    Ok(())
                },
            )
            .await
            .unwrap();
        assert_eq!(snapshot.navigation_epoch, 1);
        assert_eq!(snapshot.url, "https://example.test/new");
    }
}
