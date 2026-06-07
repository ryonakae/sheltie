use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub(super) const DOCUMENT_WINDOW_LABEL_PREFIX: &str = "document-";
pub(super) const DOCUMENT_WINDOW_TABBING_IDENTIFIER: &str = "siteboard-document";

#[derive(Clone)]
pub(super) enum DocumentWindowDisposition {
    Standalone,
    TabInGroup { host_label: String },
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowContext {
    pub file_path: Option<String>,
    pub untitled_index: usize,
}

#[derive(Default)]
pub struct DocumentManagerState {
    inner: Mutex<DocumentManager>,
}

#[derive(Default)]
struct DocumentManager {
    next_window_index: usize,
    windows: HashMap<String, WindowRecord>,
    file_windows: HashMap<PathBuf, String>,
}

#[derive(Clone)]
pub(super) struct WindowRecord {
    pub(super) file_path: Option<PathBuf>,
    pub(super) untitled_index: usize,
    pub(super) tabbing_identifier: String,
    pub(super) pending_tab_host_label: Option<String>,
}

impl WindowRecord {
    fn to_context(&self) -> WindowContext {
        WindowContext {
            file_path: self
                .file_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            untitled_index: self.untitled_index,
        }
    }
}

impl DocumentManagerState {
    pub(super) fn reserve_window(
        &self,
        file_path: Option<PathBuf>,
        disposition: &DocumentWindowDisposition,
    ) -> Result<(String, WindowRecord), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire document state lock".to_string())?;

        if let Some(existing) = file_path
            .as_ref()
            .and_then(|path| inner.file_windows.get(path).cloned())
        {
            return Err(format!(
                "this file is already open in another window: {existing}"
            ));
        }

        inner.next_window_index += 1;
        let label = format!("{DOCUMENT_WINDOW_LABEL_PREFIX}{}", inner.next_window_index);
        let tabbing_identifier = match disposition {
            DocumentWindowDisposition::Standalone => {
                format!("{DOCUMENT_WINDOW_TABBING_IDENTIFIER}-{label}")
            }
            DocumentWindowDisposition::TabInGroup { host_label } => inner
                .windows
                .get(host_label)
                .map(|record| record.tabbing_identifier.clone())
                .ok_or_else(|| format!("host window '{host_label}' state not found"))?,
        };
        let untitled_index = if file_path.is_some() {
            0
        } else {
            // 使用中の untitled index を収集し、最小の未使用番号を割り当てる
            let used: std::collections::BTreeSet<usize> = inner
                .windows
                .values()
                .filter(|r| r.file_path.is_none())
                .map(|r| r.untitled_index)
                .collect();
            let mut index = 1;
            while used.contains(&index) {
                index += 1;
            }
            index
        };

        let record = WindowRecord {
            file_path: file_path.clone(),
            untitled_index,
            tabbing_identifier,
            pending_tab_host_label: match disposition {
                DocumentWindowDisposition::Standalone => None,
                DocumentWindowDisposition::TabInGroup { host_label } => Some(host_label.clone()),
            },
        };

        if let Some(path) = file_path {
            inner.file_windows.insert(path, label.clone());
        }
        inner.windows.insert(label.clone(), record.clone());

        Ok((label, record))
    }

    pub(super) fn rollback_window(&self, label: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(record) = inner.windows.remove(label) {
                if let Some(path) = record.file_path {
                    inner.file_windows.remove(&path);
                }
            }
        }
    }

    pub(super) fn window_context(&self, label: &str) -> Result<WindowContext, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire document state lock".to_string())?;

        inner
            .windows
            .get(label)
            .map(WindowRecord::to_context)
            .ok_or_else(|| format!("window '{label}' state not found"))
    }

    pub(super) fn existing_window_label_for_path(&self, path: &Path) -> Option<String> {
        self.inner
            .lock()
            .ok()
            .and_then(|inner| inner.file_windows.get(path).cloned())
    }

    pub(super) fn update_window_file_path(
        &self,
        label: &str,
        next_path: PathBuf,
    ) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire document state lock".to_string())?;

        if let Some(existing_label) = inner.file_windows.get(&next_path) {
            if existing_label != label {
                return Err("that file is already open in another window".to_string());
            }
        }

        let previous_path = inner
            .windows
            .get(label)
            .ok_or_else(|| format!("window '{label}' state not found"))?
            .file_path
            .clone();

        if let Some(path) = previous_path {
            inner.file_windows.remove(&path);
        }

        let record = inner
            .windows
            .get_mut(label)
            .ok_or_else(|| format!("window '{label}' state not found"))?;
        record.file_path = Some(next_path.clone());
        inner.file_windows.insert(next_path, label.to_string());

        Ok(())
    }

    pub(super) fn ensure_window_can_use_file_path(
        &self,
        label: &str,
        next_path: &Path,
    ) -> Result<(), String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire document state lock".to_string())?;

        if let Some(existing_label) = inner.file_windows.get(next_path) {
            if existing_label != label {
                return Err("that file is already open in another window".to_string());
            }
        }

        Ok(())
    }

    pub(super) fn unregister_window(&self, label: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(record) = inner.windows.remove(label) {
                if let Some(path) = record.file_path {
                    inner.file_windows.remove(&path);
                }
            }
        }
    }

    pub(super) fn take_pending_tab_attachment(
        &self,
        label: &str,
    ) -> Result<Option<(String, String)>, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire document state lock".to_string())?;

        let record = inner
            .windows
            .get_mut(label)
            .ok_or_else(|| format!("window '{label}' state not found"))?;
        let tabbing_identifier = record.tabbing_identifier.clone();
        let host_label = record.pending_tab_host_label.take();

        Ok(host_label.map(|host_label| (host_label, tabbing_identifier)))
    }
}
