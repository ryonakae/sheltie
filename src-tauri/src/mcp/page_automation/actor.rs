use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use super::protocol::{
    bridge_rejected, request_timeout, webview_not_ready, CompactSnapshot,
    PageAutomationActionResult, PageAutomationBridgeRequest, PageAutomationBridgeResult,
    PageAutomationOperation, PageAutomationSuccessResult, PageKey,
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
    next_request_id: u64,
    stopped: bool,
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
        if inner.stopped {
            return Err("page automation is stopped".to_string());
        }
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

    pub fn stop(&self) -> Result<(), String> {
        let pending = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "failed to acquire page automation state".to_string())?;
            inner.stopped = true;
            for actor in inner.actors.values() {
                actor.removed.store(true, Ordering::Release);
            }
            inner.actors.clear();
            inner
                .pending
                .drain()
                .map(|(_, request)| request)
                .collect::<Vec<_>>()
        };
        for request in pending {
            let _ = request.sender.send(Err(webview_not_ready()));
        }
        Ok(())
    }

    pub fn resume(&self) -> Result<(), String> {
        self.inner
            .lock()
            .map_err(|_| "failed to acquire page automation state".to_string())?
            .stopped = false;
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
            let pending = inner
                .pending
                .remove(&request_id)
                .expect("pending request exists after lookup");
            if !identity_matches {
                let _ = pending.sender.send(Err(bridge_rejected()));
                return Err("page automation completion identity mismatch".to_string());
            }
            pending
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
        let actor = self.actor(&key)?;
        let _execution = actor.execution.lock().await;
        self.ensure_actor_current(&key, &actor)?;
        let mut navigation = actor.navigation.subscribe();
        let original_action = operation
            .action_kind()
            .map(|kind| PageAutomationActionResult { kind });
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
        let request_deadline = tokio::time::Instant::now() + self.timeout;
        let outcome = self
            .await_result_or_navigation(
                receiver,
                &mut navigation,
                request.navigation_epoch,
                request_deadline,
            )
            .await?;

        if let RequestOutcome::Completed(result) = outcome {
            let success = result.success_result()?;
            if success.snapshot.navigation_epoch != request.navigation_epoch
                || success.action.as_ref().map(|action| action.kind)
                    != original_action.as_ref().map(|action| action.kind)
            {
                return Err(bridge_rejected());
            }
            if original_action.is_none() && navigation.borrow().epoch == request.navigation_epoch {
                self.verify_snapshot_identity(&actor, &initial_progress, &success.snapshot)?;
                return Ok(PageAutomationSuccessResult {
                    snapshot: success.snapshot,
                    action: None,
                });
            }
            if original_action.is_some() {
                tokio::time::sleep(Duration::from_millis(
                    super::protocol::PAGE_AUTOMATION_SETTLE_DELAY_MS,
                ))
                .await;
            }
        }

        let allow_current_epoch =
            original_action.is_some() && navigation.borrow().epoch == request.navigation_epoch;
        self.settle_snapshot_with(
            &key,
            &actor,
            &window_label,
            &webview_label,
            &mut navigation,
            request.navigation_epoch,
            allow_current_epoch,
            None,
            original_action,
            &mut dispatch,
        )
        .await
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
                                && rejected_token.is_none_or(|token| {
                                    token != success.snapshot.document_token
                                }) =>
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

    fn allocate_request_id(&self) -> Result<String, ToolError> {
        let mut inner = self.inner.lock().map_err(|_| webview_not_ready())?;
        inner.next_request_id = inner
            .next_request_id
            .checked_add(1)
            .ok_or_else(bridge_rejected)?;
        Ok(format!("pa-{}", inner.next_request_id))
    }

    fn actor(&self, key: &PageKey) -> Result<Arc<PageActor>, ToolError> {
        let inner = self.inner.lock().map_err(|_| webview_not_ready())?;
        if inner.stopped {
            return Err(webview_not_ready());
        }
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
        if inner.stopped || actor.removed.load(Ordering::Acquire) || !actor_is_current {
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
    request_id
        .strip_prefix("pa-")
        .is_some_and(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
}

fn normalize_url(url: &str) -> Result<String, String> {
    tauri::Url::parse(url)
        .map(|url| url.to_string())
        .map_err(|error| format!("invalid navigation URL: {error}"))
}

enum RequestOutcome {
    Completed(PageAutomationBridgeResult),
    Navigated,
}

#[cfg(test)]
mod tests {
    use super::*;
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
    async fn mismatched_completion_identity_fails_the_known_request() {
        let state = Arc::new(PageAutomationState::with_timeout(Duration::from_secs(1)));
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
                    });
                    Ok(())
                },
            )
            .await;
        assert_eq!(outcome.unwrap_err().code, "bridge_rejected");
        assert_eq!(state.pending_count(), 0);

        let payload_state = state.clone();
        let payload_outcome = state
            .execute_with(
                key("page-a"),
                "document-1".into(),
                "page-document-1-page-a".into(),
                PageAutomationOperation::Snapshot,
                move |request| {
                    let state = payload_state.clone();
                    std::thread::spawn(move || {
                        let mut mismatched = result(
                            &request,
                            "0123456789abcdef0123456789abcdef",
                            "https://example.test",
                        );
                        mismatched.page_node_id = "page-b".into();
                        assert!(state
                            .complete("document-1", "page-document-1-page-a", mismatched,)
                            .is_err());
                    });
                    Ok(())
                },
            )
            .await;
        assert_eq!(payload_outcome.unwrap_err().code, "bridge_rejected");
        assert_eq!(state.pending_count(), 0);
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
                        action_result(
                            &request,
                            "0123456789abcdef0123456789abcdef",
                            "https://example.test",
                            "click",
                        )
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
