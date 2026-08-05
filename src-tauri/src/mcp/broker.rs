use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
    time::Duration,
};

use tauri::{Emitter, Manager};
use tokio::sync::{oneshot, Mutex as AsyncMutex};
use uuid::Uuid;

use super::{
    types::{RendererCommand, RendererRequest, RendererResponse, ToolError},
    MCP_RENDERER_TIMEOUT,
};

struct PendingRequest {
    document_id: String,
    sender: oneshot::Sender<Result<serde_json::Value, ToolError>>,
}

#[derive(Default)]
struct BrokerInner {
    pending: HashMap<Uuid, PendingRequest>,
    stopped: bool,
}

struct PendingRegistration<'a> {
    broker: &'a McpRequestBrokerState,
    request_id: Uuid,
}

impl Drop for PendingRegistration<'_> {
    fn drop(&mut self) {
        self.broker.remove_pending(self.request_id);
    }
}

pub struct McpRequestBrokerState {
    inner: Mutex<BrokerInner>,
    document_locks: Mutex<HashMap<String, Weak<AsyncMutex<()>>>>,
    timeout: Duration,
}

impl Default for McpRequestBrokerState {
    fn default() -> Self {
        Self::with_timeout(MCP_RENDERER_TIMEOUT)
    }
}

impl McpRequestBrokerState {
    fn with_timeout(timeout: Duration) -> Self {
        Self {
            inner: Mutex::new(BrokerInner::default()),
            document_locks: Mutex::new(HashMap::new()),
            timeout,
        }
    }

    fn document_lock(&self, document_id: &str) -> Result<Arc<AsyncMutex<()>>, ToolError> {
        let mut locks = self.document_locks.lock().map_err(|_| {
            ToolError::new(
                "renderer_unavailable",
                "Failed to acquire document request lock",
            )
        })?;
        locks.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = locks.get(document_id).and_then(Weak::upgrade) {
            return Ok(lock);
        }
        let lock = Arc::new(AsyncMutex::new(()));
        locks.insert(document_id.to_string(), Arc::downgrade(&lock));
        Ok(lock)
    }

    async fn request_with<Exists, Emit>(
        &self,
        document_id: &str,
        command: RendererCommand,
        params: serde_json::Value,
        document_exists: Exists,
        emit: Emit,
    ) -> Result<serde_json::Value, ToolError>
    where
        Exists: Fn() -> bool,
        Emit: FnOnce(RendererRequest) -> Result<(), String>,
    {
        if !document_exists() {
            return Err(ToolError::new(
                "document_not_found",
                format!("Document {document_id} is not open"),
            )
            .with_retry("Call list_documents and use a returned documentId"));
        }

        let document_lock = self.document_lock(document_id)?;
        let _document_guard = document_lock.lock().await;
        if !document_exists() {
            return Err(ToolError::new(
                "document_not_found",
                format!("Document {document_id} is not open"),
            )
            .with_retry("Call list_documents and use a returned documentId"));
        }
        let request_id = Uuid::new_v4();
        let request = RendererRequest {
            request_id: request_id.to_string(),
            command,
            params,
        };
        let (sender, receiver) = oneshot::channel();
        {
            let mut inner = self.inner.lock().map_err(|_| {
                ToolError::new(
                    "renderer_unavailable",
                    "Failed to register renderer request",
                )
            })?;
            if inner.stopped {
                return Err(ToolError::new("server_stopped", "MCP server is stopped"));
            }
            inner.pending.insert(
                request_id,
                PendingRequest {
                    document_id: document_id.to_string(),
                    sender,
                },
            );
        }
        let _pending_registration = PendingRegistration {
            broker: self,
            request_id,
        };

        if let Err(error) = emit(request) {
            return Err(ToolError::new(
                "renderer_unavailable",
                format!("Failed to emit renderer request: {error}"),
            ));
        }

        match tokio::time::timeout(self.timeout, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(ToolError::new(
                "renderer_unavailable",
                "Renderer request channel closed before completion",
            )),
            Err(_) => Err(ToolError::new(
                "renderer_timeout",
                format!(
                    "Renderer did not respond within {} ms",
                    self.timeout.as_millis()
                ),
            )
            .with_retry("Retry after confirming the document window is responsive")),
        }
    }

    pub async fn request(
        &self,
        app: &tauri::AppHandle,
        document_id: &str,
        command: RendererCommand,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let documents = app.state::<crate::commands::store::DocumentManagerState>();
        self.request_with(
            document_id,
            command,
            params,
            || documents.contains_document(document_id).unwrap_or(false),
            |request| {
                app.emit_to(document_id, super::MCP_RENDERER_REQUEST_EVENT, request)
                    .map_err(|error| error.to_string())
            },
        )
        .await
    }

    pub fn resume(&self) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire MCP broker lock".to_string())?;
        inner.stopped = false;
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        let pending = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "failed to acquire MCP broker lock".to_string())?;
            inner.stopped = true;
            inner
                .pending
                .drain()
                .map(|(_, pending)| pending)
                .collect::<Vec<_>>()
        };
        for request in pending {
            let _ = request.sender.send(Err(ToolError::new(
                "server_stopped",
                "MCP server stopped before the renderer request completed",
            )));
        }
        Ok(())
    }

    pub fn complete(&self, document_id: &str, response: RendererResponse) -> Result<(), String> {
        let request_id = Uuid::parse_str(&response.request_id)
            .map_err(|_| "renderer response requestId is not a valid UUID".to_string())?;
        let pending = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "failed to acquire MCP broker lock".to_string())?;
            let expected_document_id = inner
                .pending
                .get(&request_id)
                .map(|entry| entry.document_id.as_str())
                .ok_or_else(|| "renderer request is unknown or already completed".to_string())?;
            if expected_document_id != document_id {
                return Err(format!(
                    "renderer response window mismatch: expected {expected_document_id}, got {document_id}"
                ));
            }
            inner
                .pending
                .remove(&request_id)
                .expect("pending request exists after verification")
        };

        pending
            .sender
            .send(response.result.into_result())
            .map_err(|_| "renderer request receiver is no longer available".to_string())
    }

    fn remove_pending(&self, request_id: Uuid) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.pending.remove(&request_id);
        }
    }

    #[cfg(test)]
    fn pending_count(&self) -> Result<usize, String> {
        self.inner
            .lock()
            .map(|inner| inner.pending.len())
            .map_err(|_| "failed to acquire MCP broker lock".to_string())
    }
}

#[tauri::command]
pub async fn complete_mcp_renderer_request(
    window: tauri::Window,
    state: tauri::State<'_, McpRequestBrokerState>,
    response: RendererResponse,
) -> Result<(), String> {
    state.complete(window.label(), response)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::mcp::types::{RendererCommand, RendererResponse, RendererResult};

    #[tokio::test]
    async fn matching_document_completion_returns_renderer_data() {
        let broker = Arc::new(McpRequestBrokerState::default());
        let emitted = Arc::new(Mutex::new(None));
        let task_broker = broker.clone();
        let task_emitted = emitted.clone();
        let task = tokio::spawn(async move {
            task_broker
                .request_with(
                    "document-1",
                    RendererCommand::GetPageScreenshotSource,
                    serde_json::json!({"pageNodeId": "page-1"}),
                    || true,
                    move |request| {
                        *task_emitted.lock().unwrap() = Some(request);
                        Ok(())
                    },
                )
                .await
        });

        tokio::task::yield_now().await;
        let request = emitted.lock().unwrap().clone().unwrap();
        assert_eq!(
            serde_json::to_value(request.command).unwrap(),
            serde_json::json!("getPageScreenshotSource")
        );
        broker
            .complete(
                "document-1",
                RendererResponse {
                    request_id: request.request_id,
                    result: RendererResult::success(serde_json::json!({
                        "displayMode": "hidden"
                    })),
                },
            )
            .unwrap();

        assert_eq!(
            task.await.unwrap().unwrap(),
            serde_json::json!({"displayMode": "hidden"})
        );
    }

    #[tokio::test]
    async fn wrong_document_cannot_complete_pending_request() {
        let broker = Arc::new(McpRequestBrokerState::default());
        let emitted = Arc::new(Mutex::new(None));
        let task_broker = broker.clone();
        let task_emitted = emitted.clone();
        let task = tokio::spawn(async move {
            task_broker
                .request_with(
                    "document-1",
                    RendererCommand::GetBoard,
                    serde_json::json!({}),
                    || true,
                    move |request| {
                        *task_emitted.lock().unwrap() = Some(request);
                        Ok(())
                    },
                )
                .await
        });

        tokio::task::yield_now().await;
        let request = emitted.lock().unwrap().clone().unwrap();
        let response = RendererResponse {
            request_id: request.request_id.clone(),
            result: RendererResult::success(serde_json::json!({"nodes": []})),
        };
        assert!(broker.complete("document-2", response).is_err());
        broker
            .complete(
                "document-1",
                RendererResponse {
                    request_id: request.request_id,
                    result: RendererResult::success(serde_json::json!({"nodes": []})),
                },
            )
            .unwrap();
        assert!(task.await.unwrap().is_ok());
    }

    #[tokio::test]
    async fn requests_serialize_per_document_but_not_across_documents() {
        let broker = Arc::new(McpRequestBrokerState::default());
        let emitted = Arc::new(Mutex::new(Vec::new()));

        let spawn_request = |document_id: &'static str, sequence: &'static str| {
            let task_broker = broker.clone();
            let task_emitted = emitted.clone();
            tokio::spawn(async move {
                task_broker
                    .request_with(
                        document_id,
                        RendererCommand::GetBoard,
                        serde_json::json!({"sequence": sequence}),
                        || true,
                        move |request| {
                            task_emitted.lock().unwrap().push(request);
                            Ok(())
                        },
                    )
                    .await
            })
        };

        let first_a = spawn_request("document-a", "a1");
        tokio::task::yield_now().await;
        let second_a = spawn_request("document-a", "a2");
        let first_b = spawn_request("document-b", "b1");
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;

        let initial = emitted.lock().unwrap().clone();
        assert_eq!(initial.len(), 2);
        assert!(initial
            .iter()
            .any(|request| request.params["sequence"] == "a1"));
        assert!(initial
            .iter()
            .any(|request| request.params["sequence"] == "b1"));
        assert!(!initial
            .iter()
            .any(|request| request.params["sequence"] == "a2"));

        let first_a_request = initial
            .iter()
            .find(|request| request.params["sequence"] == "a1")
            .unwrap();
        broker
            .complete(
                "document-a",
                RendererResponse {
                    request_id: first_a_request.request_id.clone(),
                    result: RendererResult::success(serde_json::json!({"done": "a1"})),
                },
            )
            .unwrap();
        tokio::task::yield_now().await;

        let all_emitted = emitted.lock().unwrap().clone();
        assert_eq!(all_emitted.len(), 3);
        for request in &all_emitted {
            let document_id = if request.params["sequence"] == "b1" {
                "document-b"
            } else {
                "document-a"
            };
            if request.request_id != first_a_request.request_id {
                broker
                    .complete(
                        document_id,
                        RendererResponse {
                            request_id: request.request_id.clone(),
                            result: RendererResult::success(serde_json::json!({"done": true})),
                        },
                    )
                    .unwrap();
            }
        }

        assert!(first_a.await.unwrap().is_ok());
        assert!(second_a.await.unwrap().is_ok());
        assert!(first_b.await.unwrap().is_ok());
    }

    #[tokio::test]
    async fn queued_request_rechecks_document_after_acquiring_lock() {
        use std::sync::atomic::{AtomicBool, Ordering};

        let broker = Arc::new(McpRequestBrokerState::default());
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let is_open = Arc::new(AtomicBool::new(true));

        let first_broker = broker.clone();
        let first_emitted = emitted.clone();
        let first = tokio::spawn(async move {
            first_broker
                .request_with(
                    "document-1",
                    RendererCommand::GetBoard,
                    serde_json::json!({"sequence": 1}),
                    || true,
                    move |request| {
                        first_emitted.lock().unwrap().push(request);
                        Ok(())
                    },
                )
                .await
        });
        tokio::task::yield_now().await;

        let second_broker = broker.clone();
        let second_emitted = emitted.clone();
        let second_is_open = is_open.clone();
        let second = tokio::spawn(async move {
            second_broker
                .request_with(
                    "document-1",
                    RendererCommand::GetBoard,
                    serde_json::json!({"sequence": 2}),
                    move || second_is_open.load(Ordering::Acquire),
                    move |request| {
                        second_emitted.lock().unwrap().push(request);
                        Ok(())
                    },
                )
                .await
        });
        tokio::task::yield_now().await;
        is_open.store(false, Ordering::Release);

        let first_request = emitted.lock().unwrap()[0].clone();
        broker
            .complete(
                "document-1",
                RendererResponse {
                    request_id: first_request.request_id,
                    result: RendererResult::success(serde_json::json!({})),
                },
            )
            .unwrap();

        assert!(first.await.unwrap().is_ok());
        let error = second.await.unwrap().unwrap_err();
        assert_eq!(error.code, "document_not_found");
        assert_eq!(emitted.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn aborted_renderer_wait_removes_pending_request() {
        let broker = Arc::new(McpRequestBrokerState::default());
        let task_broker = broker.clone();
        let task = tokio::spawn(async move {
            task_broker
                .request_with(
                    "document-1",
                    RendererCommand::GetBoard,
                    serde_json::json!({}),
                    || true,
                    |_| Ok(()),
                )
                .await
        });

        tokio::task::yield_now().await;
        assert_eq!(broker.pending_count().unwrap(), 1);
        task.abort();
        let _ = task.await;
        assert_eq!(broker.pending_count().unwrap(), 0);
    }

    #[tokio::test]
    async fn stop_fails_all_pending_requests() {
        let broker = Arc::new(McpRequestBrokerState::default());
        let task_broker = broker.clone();
        let task = tokio::spawn(async move {
            task_broker
                .request_with(
                    "document-1",
                    RendererCommand::GetBoard,
                    serde_json::json!({}),
                    || true,
                    |_| Ok(()),
                )
                .await
        });

        tokio::task::yield_now().await;
        broker.stop().unwrap();

        let error = task.await.unwrap().unwrap_err();
        assert_eq!(error.code, "server_stopped");
        assert_eq!(broker.pending_count().unwrap(), 0);
    }

    #[tokio::test]
    async fn timeout_removes_pending_request() {
        let broker = McpRequestBrokerState::with_timeout(Duration::from_millis(5));
        let error = broker
            .request_with(
                "document-1",
                RendererCommand::GetBoard,
                serde_json::json!({}),
                || true,
                |_| Ok(()),
            )
            .await
            .unwrap_err();

        assert_eq!(error.code, "renderer_timeout");
        assert_eq!(broker.pending_count().unwrap(), 0);
    }
}
