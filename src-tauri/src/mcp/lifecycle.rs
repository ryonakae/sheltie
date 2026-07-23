use std::sync::Mutex;

use axum::Router;
use rmcp::transport::streamable_http_server::{
    session::{local::LocalSessionManager, SessionManager},
    StreamableHttpServerConfig, StreamableHttpService,
};
use tauri::Manager;
use tauri_plugin_store::StoreExt;
use tokio_util::sync::CancellationToken;

use super::{
    broker::McpRequestBrokerState,
    service::{McpConnectionCounter, SheltieMcpService},
    MCP_BIND_ADDRESS,
};
use crate::commands::theme::STORE_PATH;

pub const MCP_ENABLED_KEY: &str = "mcpEnabled";

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum McpLifecycle {
    #[default]
    Disabled,
    Starting,
    Running,
    Stopping,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum McpLifecycleEvent {
    EnableRequested,
    Started,
    StartFailed,
    DisableRequested,
    Stopped,
}

pub fn reduce_lifecycle(state: McpLifecycle, event: McpLifecycleEvent) -> McpLifecycle {
    match (state, event) {
        (McpLifecycle::Disabled, McpLifecycleEvent::EnableRequested) => McpLifecycle::Starting,
        (McpLifecycle::Starting, McpLifecycleEvent::Started) => McpLifecycle::Running,
        (McpLifecycle::Starting, McpLifecycleEvent::StartFailed)
        | (McpLifecycle::Stopping, McpLifecycleEvent::Stopped) => McpLifecycle::Disabled,
        (McpLifecycle::Running, McpLifecycleEvent::DisableRequested)
        | (McpLifecycle::Starting, McpLifecycleEvent::DisableRequested) => McpLifecycle::Stopping,
        _ => state,
    }
}

pub fn parse_mcp_enabled(value: Option<&serde_json::Value>) -> bool {
    value.and_then(serde_json::Value::as_bool).unwrap_or(false)
}

pub fn load_mcp_enabled(app: &tauri::AppHandle) -> bool {
    app.store(STORE_PATH)
        .ok()
        .map(|store| {
            let value = store.get(MCP_ENABLED_KEY);
            parse_mcp_enabled(value.as_ref())
        })
        .unwrap_or(false)
}

pub fn set_mcp_enabled(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|error| format!("failed to open store: {error}"))?;
    let previous = store.get(MCP_ENABLED_KEY);
    store.set(MCP_ENABLED_KEY, serde_json::Value::Bool(enabled));
    if let Err(error) = store.save() {
        if let Some(previous) = previous {
            store.set(MCP_ENABLED_KEY, previous);
        } else {
            store.delete(MCP_ENABLED_KEY);
        }
        return Err(format!("failed to save store: {error}"));
    }
    Ok(())
}

#[derive(Default)]
pub struct McpServerState {
    inner: Mutex<McpServerInner>,
    operation_lock: tokio::sync::Mutex<()>,
    connections: std::sync::Arc<McpConnectionCounter>,
}

#[derive(Default)]
struct McpServerInner {
    lifecycle: McpLifecycle,
    running: Option<RunningMcpServer>,
    desired_generation: u64,
    desired_enabled: bool,
}

struct RunningMcpServer {
    cancellation: CancellationToken,
    sessions: std::sync::Arc<LocalSessionManager>,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl McpServerState {
    pub fn request_enabled(&self, enabled: bool) -> Result<u64, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire MCP lifecycle lock".to_string())?;
        inner.desired_generation = inner.desired_generation.wrapping_add(1);
        inner.desired_enabled = enabled;
        if !enabled {
            inner.lifecycle =
                reduce_lifecycle(inner.lifecycle, McpLifecycleEvent::DisableRequested);
            if let Some(running) = inner.running.as_ref() {
                running.cancellation.cancel();
            }
        }
        Ok(inner.desired_generation)
    }

    pub fn request_recovery_if_current(
        &self,
        failed_generation: u64,
        failed_enabled: bool,
        recovery_enabled: bool,
    ) -> Result<Option<u64>, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire MCP lifecycle lock".to_string())?;
        if inner.desired_generation != failed_generation || inner.desired_enabled != failed_enabled
        {
            return Ok(None);
        }

        inner.desired_generation = inner.desired_generation.wrapping_add(1);
        inner.desired_enabled = recovery_enabled;
        if !recovery_enabled {
            inner.lifecycle =
                reduce_lifecycle(inner.lifecycle, McpLifecycleEvent::DisableRequested);
            if let Some(running) = inner.running.as_ref() {
                running.cancellation.cancel();
            }
        }
        Ok(Some(inner.desired_generation))
    }

    pub fn desired_enabled(&self) -> Result<bool, String> {
        self.inner
            .lock()
            .map(|inner| inner.desired_enabled)
            .map_err(|_| "failed to acquire MCP lifecycle lock".to_string())
    }

    pub fn is_current_intent(&self, generation: u64, enabled: bool) -> Result<bool, String> {
        self.inner
            .lock()
            .map(|inner| inner.desired_generation == generation && inner.desired_enabled == enabled)
            .map_err(|_| "failed to acquire MCP lifecycle lock".to_string())
    }

    pub fn lifecycle(&self) -> Result<McpLifecycle, String> {
        self.inner
            .lock()
            .map(|inner| inner.lifecycle)
            .map_err(|_| "failed to acquire MCP lifecycle lock".to_string())
    }

    pub fn connection_counter(&self) -> std::sync::Arc<McpConnectionCounter> {
        self.connections.clone()
    }

    fn transition(&self, event: McpLifecycleEvent) -> Result<McpLifecycle, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire MCP lifecycle lock".to_string())?;
        inner.lifecycle = reduce_lifecycle(inner.lifecycle, event);
        Ok(inner.lifecycle)
    }

    fn install_running(
        &self,
        running: RunningMcpServer,
    ) -> Result<Option<RunningMcpServer>, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire MCP lifecycle lock".to_string())?;
        if inner.lifecycle != McpLifecycle::Starting {
            return Ok(Some(running));
        }
        inner.running = Some(running);
        inner.lifecycle = reduce_lifecycle(inner.lifecycle, McpLifecycleEvent::Started);
        Ok(None)
    }

    fn take_running_for_stop(&self) -> Result<Option<RunningMcpServer>, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire MCP lifecycle lock".to_string())?;
        inner.lifecycle = reduce_lifecycle(inner.lifecycle, McpLifecycleEvent::DisableRequested);
        Ok(inner.running.take())
    }

    fn finish_stop(&self) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire MCP lifecycle lock".to_string())?;
        inner.lifecycle = match inner.lifecycle {
            McpLifecycle::Stopping => reduce_lifecycle(inner.lifecycle, McpLifecycleEvent::Stopped),
            state => state,
        };
        Ok(())
    }
}

fn server_config(cancellation: CancellationToken) -> StreamableHttpServerConfig {
    StreamableHttpServerConfig::default()
        .with_allowed_hosts(["127.0.0.1:29978", "localhost:29978"])
        .with_allowed_origins(["http://127.0.0.1:29978", "http://localhost:29978"])
        .with_cancellation_token(cancellation)
}

fn mcp_router(
    app: tauri::AppHandle,
    cancellation: CancellationToken,
) -> (Router, std::sync::Arc<LocalSessionManager>) {
    let connections = app.state::<McpServerState>().connection_counter();
    mcp_router_with_factory(
        move || {
            Ok(SheltieMcpService::from_app(
                app.clone(),
                connections.clone(),
            ))
        },
        cancellation,
    )
}

fn mcp_router_with_factory(
    service_factory: impl Fn() -> Result<SheltieMcpService, std::io::Error> + Send + Sync + 'static,
    cancellation: CancellationToken,
) -> (Router, std::sync::Arc<LocalSessionManager>) {
    let sessions = std::sync::Arc::new(LocalSessionManager::default());
    let service: StreamableHttpService<SheltieMcpService, LocalSessionManager> =
        StreamableHttpService::new(
            service_factory,
            sessions.clone(),
            server_config(cancellation),
        );
    (Router::new().nest_service("/mcp", service), sessions)
}

async fn close_all_sessions(sessions: &LocalSessionManager) {
    let session_ids = sessions
        .sessions
        .read()
        .await
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    for session_id in session_ids {
        if let Err(error) = sessions.close_session(&session_id).await {
            log::warn!("failed to close MCP session {session_id}: {error}");
        }
    }
}

async fn shutdown_running_server(running: RunningMcpServer) {
    running.cancellation.cancel();
    close_all_sessions(&running.sessions).await;
    let _ = running.task.await;
    // An initialize request accepted before listener shutdown can create a session
    // after the first sweep. No new requests can enter after the Axum task exits.
    close_all_sessions(&running.sessions).await;
}

pub async fn apply_requested_enabled(
    app: tauri::AppHandle,
    generation: u64,
    enabled: bool,
) -> Result<bool, String> {
    apply_requested_enabled_inner(app, generation, enabled, true).await
}

pub async fn apply_requested_runtime_only(
    app: tauri::AppHandle,
    generation: u64,
    enabled: bool,
) -> Result<bool, String> {
    apply_requested_enabled_inner(app, generation, enabled, false).await
}

async fn apply_requested_enabled_inner(
    app: tauri::AppHandle,
    generation: u64,
    enabled: bool,
    persist: bool,
) -> Result<bool, String> {
    let state = app.state::<McpServerState>();
    let _operation = state.operation_lock.lock().await;
    if !state.is_current_intent(generation, enabled)? {
        return Ok(false);
    }

    if persist {
        set_mcp_enabled(&app, enabled)?;
        if !state.is_current_intent(generation, enabled)? {
            return Ok(false);
        }
    }

    if enabled && state.lifecycle()? == McpLifecycle::Stopping {
        stop(app.clone()).await?;
    }
    let transition = if enabled {
        start(app.clone()).await
    } else {
        stop(app.clone()).await
    };
    if !state.is_current_intent(generation, enabled)? {
        return Ok(false);
    }
    transition?;
    Ok(true)
}

pub async fn start(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<McpServerState>();
    if state.transition(McpLifecycleEvent::EnableRequested)? != McpLifecycle::Starting {
        return Ok(());
    }

    let listener = match tokio::net::TcpListener::bind(MCP_BIND_ADDRESS).await {
        Ok(listener) => listener,
        Err(error) => {
            state.transition(McpLifecycleEvent::StartFailed)?;
            return Err(format!(
                "failed to bind MCP server to {MCP_BIND_ADDRESS}: {error}"
            ));
        }
    };

    let cancellation = CancellationToken::new();
    let (router, sessions) = mcp_router(app.clone(), cancellation.child_token());
    let graceful_cancellation = cancellation.clone();
    let (accept_sender, accept_receiver) = tokio::sync::oneshot::channel();
    let task = tauri::async_runtime::spawn(async move {
        if accept_receiver.await.is_err() {
            return;
        }
        if let Err(error) = axum::serve(listener, router)
            .with_graceful_shutdown(async move { graceful_cancellation.cancelled_owned().await })
            .await
        {
            log::error!("MCP server stopped with an error: {error}");
        }
    });

    if let Err(error) = app.state::<McpRequestBrokerState>().resume() {
        cancellation.cancel();
        drop(accept_sender);
        let _ = task.await;
        state.transition(McpLifecycleEvent::StartFailed)?;
        return Err(error);
    }

    let running = RunningMcpServer {
        cancellation,
        sessions,
        task,
    };
    if let Some(interrupted) = state.install_running(running)? {
        app.state::<McpRequestBrokerState>().stop()?;
        drop(accept_sender);
        shutdown_running_server(interrupted).await;
        state.finish_stop()?;
    } else if accept_sender.send(()).is_err() {
        stop(app.clone()).await?;
        return Err("failed to start MCP listener task".to_string());
    }

    Ok(())
}

pub async fn stop(app: tauri::AppHandle) -> Result<(), String> {
    app.state::<McpRequestBrokerState>().stop()?;
    let state = app.state::<McpServerState>();
    let running = state.take_running_for_stop()?;
    if let Some(running) = running {
        shutdown_running_server(running).await;
    }
    state.finish_stop()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persisted_missing_value_defaults_to_disabled() {
        assert!(!parse_mcp_enabled(None));
    }

    #[test]
    fn persisted_boolean_value_is_respected() {
        assert!(parse_mcp_enabled(Some(&serde_json::Value::Bool(true))));
        assert!(!parse_mcp_enabled(Some(&serde_json::Value::Bool(false))));
    }

    #[test]
    fn start_failure_returns_to_disabled() {
        let next = reduce_lifecycle(McpLifecycle::Starting, McpLifecycleEvent::StartFailed);
        assert_eq!(next, McpLifecycle::Disabled);
    }

    #[test]
    fn disable_cancels_running_server() {
        let next = reduce_lifecycle(McpLifecycle::Running, McpLifecycleEvent::DisableRequested);
        assert_eq!(next, McpLifecycle::Stopping);
    }

    #[test]
    fn server_config_allows_only_expected_hosts_and_origins() {
        let config = server_config(CancellationToken::new());
        assert_eq!(
            config.allowed_hosts,
            vec!["127.0.0.1:29978", "localhost:29978"]
        );
        assert_eq!(
            config.allowed_origins,
            vec!["http://127.0.0.1:29978", "http://localhost:29978"]
        );
    }

    #[tokio::test]
    async fn transport_rejects_foreign_hosts_and_origins_without_cors() {
        use axum::{body::Body, http::Request};
        use tower::ServiceExt;

        let (router, _sessions) = mcp_router_with_factory(
            || {
                Err(std::io::Error::other(
                    "service must not start for rejected requests",
                ))
            },
            CancellationToken::new(),
        );
        let foreign_host = router
            .clone()
            .oneshot(
                Request::post("/mcp")
                    .header("host", "attacker.example")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(foreign_host.status(), 403);

        let foreign_origin = router
            .clone()
            .oneshot(
                Request::post("/mcp")
                    .header("host", "127.0.0.1:29978")
                    .header("origin", "https://attacker.example")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(foreign_origin.status(), 403);
        assert!(foreign_origin
            .headers()
            .get("access-control-allow-origin")
            .is_none());

        let local_without_origin = router
            .oneshot(
                Request::post("/mcp")
                    .header("host", "localhost:29978")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_ne!(local_without_origin.status(), 403);
    }

    #[tokio::test]
    async fn cancellation_stops_the_http_listener() {
        let cancellation = CancellationToken::new();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let task_cancellation = cancellation.clone();
        let (router, _sessions) = mcp_router_with_factory(
            || {
                Err(std::io::Error::other(
                    "service must not start for cancellation test",
                ))
            },
            task_cancellation.child_token(),
        );
        let task = tokio::spawn(async move {
            axum::serve(listener, router)
                .with_graceful_shutdown(async move { task_cancellation.cancelled_owned().await })
                .await
                .unwrap();
        });

        cancellation.cancel();
        tokio::time::timeout(std::time::Duration::from_secs(1), task)
            .await
            .expect("listener should stop after cancellation")
            .unwrap();
    }

    #[tokio::test]
    async fn closing_all_sessions_removes_active_sessions() {
        let sessions = LocalSessionManager::default();
        let (session_id, _transport) = sessions.create_session().await.unwrap();
        assert!(sessions.has_session(&session_id).await.unwrap());

        close_all_sessions(&sessions).await;

        assert!(!sessions.has_session(&session_id).await.unwrap());
        assert!(sessions.sessions.read().await.is_empty());
    }

    #[tokio::test]
    async fn shutdown_closes_a_session_created_during_listener_shutdown() {
        let sessions = std::sync::Arc::new(LocalSessionManager::default());
        let cancellation = CancellationToken::new();
        let task_sessions = sessions.clone();
        let task_cancellation = cancellation.clone();
        let task = tauri::async_runtime::spawn(async move {
            task_cancellation.cancelled().await;
            let _ = task_sessions.create_session().await.unwrap();
        });
        let running = RunningMcpServer {
            cancellation,
            sessions: sessions.clone(),
            task,
        };

        shutdown_running_server(running).await;

        assert!(sessions.sessions.read().await.is_empty());
    }

    #[test]
    fn desired_enabled_tracks_latest_requested_state() {
        let state = McpServerState::default();
        assert!(!state.desired_enabled().unwrap());

        state.request_enabled(true).unwrap();
        assert!(state.desired_enabled().unwrap());

        state.request_enabled(false).unwrap();
        assert!(!state.desired_enabled().unwrap());
    }

    #[test]
    fn latest_enablement_intent_wins_before_async_work_runs() {
        let state = McpServerState::default();
        let enable_generation = state.request_enabled(true).unwrap();
        let disable_generation = state.request_enabled(false).unwrap();

        assert!(!state.is_current_intent(enable_generation, true).unwrap());
        assert!(state.is_current_intent(disable_generation, false).unwrap());
    }

    #[test]
    fn stale_start_failure_cannot_rollback_a_newer_enable() {
        let state = McpServerState::default();
        let failed_generation = state.request_enabled(true).unwrap();
        state.request_enabled(false).unwrap();
        let latest_generation = state.request_enabled(true).unwrap();

        assert_eq!(
            state
                .request_recovery_if_current(failed_generation, true, false)
                .unwrap(),
            None
        );
        assert!(state.is_current_intent(latest_generation, true).unwrap());
    }

    #[test]
    fn current_start_failure_registers_a_disable_rollback() {
        let state = McpServerState::default();
        let failed_generation = state.request_enabled(true).unwrap();
        let rollback_generation = state
            .request_recovery_if_current(failed_generation, true, false)
            .unwrap()
            .expect("current failure should register rollback");

        assert!(state.is_current_intent(rollback_generation, false).unwrap());
    }

    #[test]
    fn current_disable_failure_can_restore_enabled_intent() {
        let state = McpServerState::default();
        let failed_generation = state.request_enabled(false).unwrap();
        let recovery_generation = state
            .request_recovery_if_current(failed_generation, false, true)
            .unwrap()
            .expect("current disable failure should register recovery");

        assert!(state.is_current_intent(recovery_generation, true).unwrap());
    }

    #[test]
    fn disable_intent_interrupts_a_start_in_progress() {
        let state = McpServerState::default();
        state
            .transition(McpLifecycleEvent::EnableRequested)
            .unwrap();
        assert_eq!(state.lifecycle().unwrap(), McpLifecycle::Starting);

        state.request_enabled(false).unwrap();
        assert_eq!(state.lifecycle().unwrap(), McpLifecycle::Stopping);
    }

    #[test]
    fn repeated_enable_and_disable_requests_are_idempotent() {
        assert_eq!(
            reduce_lifecycle(McpLifecycle::Running, McpLifecycleEvent::EnableRequested),
            McpLifecycle::Running
        );
        assert_eq!(
            reduce_lifecycle(McpLifecycle::Disabled, McpLifecycleEvent::DisableRequested),
            McpLifecycle::Disabled
        );
    }
}
