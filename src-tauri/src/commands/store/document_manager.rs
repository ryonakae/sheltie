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

#[cfg(test)]
mod tests {
    use super::*;

    fn standalone() -> DocumentWindowDisposition {
        DocumentWindowDisposition::Standalone
    }

    fn tab_in_group(host_label: &str) -> DocumentWindowDisposition {
        DocumentWindowDisposition::TabInGroup {
            host_label: host_label.to_string(),
        }
    }

    #[test]
    fn first_reserve_yields_document_1_and_untitled_index_1() {
        let state = DocumentManagerState::default();
        let (label, record) = state.reserve_window(None, &standalone()).unwrap();
        assert_eq!(label, "document-1");
        assert_eq!(record.untitled_index, 1);
        assert!(record.file_path.is_none());
        assert!(record.pending_tab_host_label.is_none());
    }

    #[test]
    fn untitled_index_increments_for_subsequent_untitled_windows() {
        let state = DocumentManagerState::default();
        let (_l1, r1) = state.reserve_window(None, &standalone()).unwrap();
        let (_l2, r2) = state.reserve_window(None, &standalone()).unwrap();
        let (_l3, r3) = state.reserve_window(None, &standalone()).unwrap();
        assert_eq!(r1.untitled_index, 1);
        assert_eq!(r2.untitled_index, 2);
        assert_eq!(r3.untitled_index, 3);
    }

    #[test]
    fn unregister_frees_untitled_index_for_reuse() {
        let state = DocumentManagerState::default();
        let _ = state.reserve_window(None, &standalone()).unwrap();
        let (label2, _) = state.reserve_window(None, &standalone()).unwrap();
        let _ = state.reserve_window(None, &standalone()).unwrap();

        state.unregister_window(&label2);

        // 最小未使用番号 (2) を採番する
        let (_l4, r4) = state.reserve_window(None, &standalone()).unwrap();
        assert_eq!(r4.untitled_index, 2);
    }

    #[test]
    fn reserve_with_file_path_uses_untitled_index_zero() {
        let state = DocumentManagerState::default();
        let path = PathBuf::from("/tmp/test.siteboard");
        let (_label, record) = state
            .reserve_window(Some(path.clone()), &standalone())
            .unwrap();
        assert_eq!(record.untitled_index, 0);
        assert_eq!(record.file_path, Some(path));
    }

    #[test]
    fn reserving_same_file_path_twice_fails() {
        let state = DocumentManagerState::default();
        let path = PathBuf::from("/tmp/test.siteboard");
        let _ = state
            .reserve_window(Some(path.clone()), &standalone())
            .unwrap();
        assert!(state.reserve_window(Some(path), &standalone()).is_err());
    }

    #[test]
    fn rollback_releases_file_path_so_it_can_be_reserved_again() {
        let state = DocumentManagerState::default();
        let path = PathBuf::from("/tmp/test.siteboard");
        let (label, _) = state
            .reserve_window(Some(path.clone()), &standalone())
            .unwrap();
        state.rollback_window(&label);
        assert!(state.reserve_window(Some(path), &standalone()).is_ok());
    }

    #[test]
    fn tab_in_group_inherits_host_tabbing_identifier() {
        let state = DocumentManagerState::default();
        let (host_label, host_record) = state.reserve_window(None, &standalone()).unwrap();
        let (_child_label, child_record) = state
            .reserve_window(None, &tab_in_group(&host_label))
            .unwrap();
        assert_eq!(child_record.tabbing_identifier, host_record.tabbing_identifier);
        assert_eq!(
            child_record.pending_tab_host_label,
            Some(host_label.clone())
        );
    }

    #[test]
    fn tab_in_group_with_unknown_host_fails() {
        let state = DocumentManagerState::default();
        assert!(state
            .reserve_window(None, &tab_in_group("document-999"))
            .is_err());
    }

    #[test]
    fn existing_window_label_for_path_returns_label_when_tracked() {
        let state = DocumentManagerState::default();
        let path = PathBuf::from("/tmp/test.siteboard");
        let (label, _) = state
            .reserve_window(Some(path.clone()), &standalone())
            .unwrap();
        assert_eq!(state.existing_window_label_for_path(&path), Some(label));
        assert_eq!(
            state.existing_window_label_for_path(Path::new("/tmp/other.siteboard")),
            None
        );
    }

    #[test]
    fn update_window_file_path_releases_old_and_registers_new() {
        let state = DocumentManagerState::default();
        let old_path = PathBuf::from("/tmp/old.siteboard");
        let new_path = PathBuf::from("/tmp/new.siteboard");
        let (label, _) = state
            .reserve_window(Some(old_path.clone()), &standalone())
            .unwrap();

        state
            .update_window_file_path(&label, new_path.clone())
            .unwrap();

        assert_eq!(state.existing_window_label_for_path(&old_path), None);
        assert_eq!(state.existing_window_label_for_path(&new_path), Some(label));
    }

    #[test]
    fn update_window_file_path_fails_when_path_belongs_to_another_window() {
        let state = DocumentManagerState::default();
        let path_a = PathBuf::from("/tmp/a.siteboard");
        let path_b = PathBuf::from("/tmp/b.siteboard");
        let (label_a, _) = state.reserve_window(Some(path_a), &standalone()).unwrap();
        let _ = state
            .reserve_window(Some(path_b.clone()), &standalone())
            .unwrap();

        assert!(state.update_window_file_path(&label_a, path_b).is_err());
    }

    #[test]
    fn ensure_window_can_use_file_path_allows_same_window_to_keep_path() {
        let state = DocumentManagerState::default();
        let path = PathBuf::from("/tmp/test.siteboard");
        let (label, _) = state
            .reserve_window(Some(path.clone()), &standalone())
            .unwrap();
        assert!(state.ensure_window_can_use_file_path(&label, &path).is_ok());
    }

    #[test]
    fn take_pending_tab_attachment_returns_value_once() {
        let state = DocumentManagerState::default();
        let (host_label, _) = state.reserve_window(None, &standalone()).unwrap();
        let (child_label, _) = state
            .reserve_window(None, &tab_in_group(&host_label))
            .unwrap();

        let first = state.take_pending_tab_attachment(&child_label).unwrap();
        assert!(first.is_some());
        assert_eq!(first.as_ref().unwrap().0, host_label);

        let second = state.take_pending_tab_attachment(&child_label).unwrap();
        assert!(second.is_none());
    }

    #[test]
    fn window_context_returns_serialized_form() {
        let state = DocumentManagerState::default();
        let path = PathBuf::from("/tmp/test.siteboard");
        let (label, _) = state
            .reserve_window(Some(path.clone()), &standalone())
            .unwrap();
        let context = state.window_context(&label).unwrap();
        assert_eq!(context.file_path, Some(path.to_string_lossy().to_string()));
        assert_eq!(context.untitled_index, 0);
    }
}
