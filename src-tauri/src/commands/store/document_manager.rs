use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

use crate::mcp::types::DocumentSummary;

pub(super) const DOCUMENT_WINDOW_LABEL_PREFIX: &str = "document-";
pub(super) const DOCUMENT_WINDOW_TABBING_IDENTIFIER: &str = "sheltie-document";

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
    pub(super) creation_index: usize,
    pub(super) file_path: Option<PathBuf>,
    pub(super) untitled_index: usize,
    pub(super) tabbing_identifier: String,
    pub(super) pending_tab_host_label: Option<String>,
    /// 自動生成された untitled（引数なし起動・Dock reopen）だけ true。
    /// AppKit の transient document に相当し、置き換え対象の資格を表す
    pub(super) transient: bool,
    pub(super) edited: bool,
    /// この window の present 時に閉じるべき置き換え対象 window のラベル
    pub(super) pending_replacement_target: Option<String>,
}

impl WindowRecord {
    /// 置き換え資格。transient は剥奪せず、判定時点の edited を見るため
    /// 編集を undo で戻した window は再び置き換え対象になる
    fn is_replaceable(&self) -> bool {
        self.transient && !self.edited && self.file_path.is_none()
    }

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
        transient: bool,
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
            creation_index: inner.next_window_index,
            file_path: file_path.clone(),
            untitled_index,
            tabbing_identifier,
            pending_tab_host_label: match disposition {
                DocumentWindowDisposition::Standalone => None,
                DocumentWindowDisposition::TabInGroup { host_label } => Some(host_label.clone()),
            },
            transient,
            edited: false,
            pending_replacement_target: None,
        };

        if let Some(path) = file_path {
            inner.file_windows.insert(path, label.clone());
        }
        inner.windows.insert(label.clone(), record.clone());

        Ok((label, record))
    }

    pub(super) fn set_window_edited(&self, label: &str, edited: bool) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire document state lock".to_string())?;

        let record = inner
            .windows
            .get_mut(label)
            .ok_or_else(|| format!("window '{label}' state not found"))?;
        record.edited = edited;
        Ok(())
    }

    /// AppKit の transient document 置き換え規則:
    /// document window がちょうど 1 枚で、それが自動生成 (transient) の
    /// 未編集 untitled のときだけ、その window が置き換え対象になる
    pub(super) fn transient_window_to_replace(&self) -> Option<String> {
        let inner = self.inner.lock().ok()?;
        if inner.windows.len() != 1 {
            return None;
        }

        inner
            .windows
            .iter()
            .find_map(|(label, record)| record.is_replaceable().then(|| label.clone()))
    }

    pub(super) fn set_pending_replacement(
        &self,
        label: &str,
        target_label: &str,
    ) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire document state lock".to_string())?;

        if !inner.windows.contains_key(target_label) {
            return Err(format!("window '{target_label}' state not found"));
        }

        let record = inner
            .windows
            .get_mut(label)
            .ok_or_else(|| format!("window '{label}' state not found"))?;
        record.pending_replacement_target = Some(target_label.to_string());
        Ok(())
    }

    /// present 時に置き換え対象を取り出す。open から present までの間に
    /// 対象が編集・保存・クローズされていた場合はデータ保護のため中止する
    pub(super) fn take_pending_replacement(&self, label: &str) -> Result<Option<String>, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire document state lock".to_string())?;

        let record = inner
            .windows
            .get_mut(label)
            .ok_or_else(|| format!("window '{label}' state not found"))?;
        let Some(target) = record.pending_replacement_target.take() else {
            return Ok(None);
        };

        let still_eligible = inner
            .windows
            .get(&target)
            .map(WindowRecord::is_replaceable)
            .unwrap_or(false);
        Ok(still_eligible.then_some(target))
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

    pub fn contains_document(&self, label: &str) -> Result<bool, String> {
        self.inner
            .lock()
            .map(|inner| inner.windows.contains_key(label))
            .map_err(|_| "failed to acquire document state lock".to_string())
    }

    pub fn document_summaries(
        &self,
        focused_label: Option<&str>,
    ) -> Result<Vec<DocumentSummary>, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "failed to acquire document state lock".to_string())?;
        let mut summaries = inner
            .windows
            .iter()
            .map(|(label, record)| {
                (
                    record.creation_index,
                    DocumentSummary {
                        document_id: label.clone(),
                        file_path: record
                            .file_path
                            .as_ref()
                            .map(|path| path.to_string_lossy().to_string()),
                        untitled_index: record.untitled_index,
                        focused: focused_label == Some(label.as_str()),
                    },
                )
            })
            .collect::<Vec<_>>();
        summaries.sort_by_key(|(creation_index, _)| *creation_index);
        Ok(summaries.into_iter().map(|(_, summary)| summary).collect())
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
        let (label, record) = state.reserve_window(None, &standalone(), false).unwrap();
        assert_eq!(label, "document-1");
        assert_eq!(record.untitled_index, 1);
        assert!(record.file_path.is_none());
        assert!(record.pending_tab_host_label.is_none());
    }

    #[test]
    fn reserve_window_records_transient_flag() {
        let state = DocumentManagerState::default();
        let (_l1, transient_record) = state.reserve_window(None, &standalone(), true).unwrap();
        let (_l2, normal_record) = state.reserve_window(None, &standalone(), false).unwrap();
        assert!(transient_record.transient);
        assert!(!normal_record.transient);
        assert!(!transient_record.edited);
    }

    #[test]
    fn transient_window_to_replace_returns_single_pristine_transient_untitled() {
        let state = DocumentManagerState::default();
        let (label, _) = state.reserve_window(None, &standalone(), true).unwrap();
        assert_eq!(state.transient_window_to_replace(), Some(label));
    }

    #[test]
    fn transient_window_to_replace_ignores_non_transient_window() {
        let state = DocumentManagerState::default();
        let _ = state.reserve_window(None, &standalone(), false).unwrap();
        assert_eq!(state.transient_window_to_replace(), None);
    }

    #[test]
    fn transient_window_to_replace_ignores_edited_window_and_recovers_when_unedited() {
        let state = DocumentManagerState::default();
        let (label, _) = state.reserve_window(None, &standalone(), true).unwrap();

        state.set_window_edited(&label, true).unwrap();
        assert_eq!(state.transient_window_to_replace(), None);

        // Undo で完全に元へ戻った場合は置き換え対象に復活する
        state.set_window_edited(&label, false).unwrap();
        assert_eq!(state.transient_window_to_replace(), Some(label));
    }

    #[test]
    fn transient_window_to_replace_requires_exactly_one_window() {
        let state = DocumentManagerState::default();
        let _ = state.reserve_window(None, &standalone(), true).unwrap();
        let _ = state.reserve_window(None, &standalone(), false).unwrap();
        assert_eq!(state.transient_window_to_replace(), None);
    }

    #[test]
    fn transient_window_to_replace_ignores_file_backed_window() {
        let state = DocumentManagerState::default();
        let path = PathBuf::from("/tmp/test.sheltie");
        let _ = state
            .reserve_window(Some(path), &standalone(), true)
            .unwrap();
        assert_eq!(state.transient_window_to_replace(), None);
    }

    #[test]
    fn set_window_edited_fails_for_unknown_window() {
        let state = DocumentManagerState::default();
        assert!(state.set_window_edited("document-999", true).is_err());
    }

    #[test]
    fn take_pending_replacement_returns_target_once() {
        let state = DocumentManagerState::default();
        let (target, _) = state.reserve_window(None, &standalone(), true).unwrap();
        let (opener, _) = state
            .reserve_window(
                Some(PathBuf::from("/tmp/test.sheltie")),
                &standalone(),
                false,
            )
            .unwrap();

        state.set_pending_replacement(&opener, &target).unwrap();

        assert_eq!(
            state.take_pending_replacement(&opener).unwrap(),
            Some(target)
        );
        assert_eq!(state.take_pending_replacement(&opener).unwrap(), None);
    }

    #[test]
    fn take_pending_replacement_aborts_when_target_was_edited() {
        let state = DocumentManagerState::default();
        let (target, _) = state.reserve_window(None, &standalone(), true).unwrap();
        let (opener, _) = state
            .reserve_window(
                Some(PathBuf::from("/tmp/test.sheltie")),
                &standalone(),
                false,
            )
            .unwrap();
        state.set_pending_replacement(&opener, &target).unwrap();

        // open から present までの間にユーザーが編集したケース
        state.set_window_edited(&target, true).unwrap();

        assert_eq!(state.take_pending_replacement(&opener).unwrap(), None);
    }

    #[test]
    fn take_pending_replacement_aborts_when_target_already_closed() {
        let state = DocumentManagerState::default();
        let (target, _) = state.reserve_window(None, &standalone(), true).unwrap();
        let (opener, _) = state
            .reserve_window(
                Some(PathBuf::from("/tmp/test.sheltie")),
                &standalone(),
                false,
            )
            .unwrap();
        state.set_pending_replacement(&opener, &target).unwrap();

        state.unregister_window(&target);

        assert_eq!(state.take_pending_replacement(&opener).unwrap(), None);
    }

    #[test]
    fn take_pending_replacement_returns_none_without_reservation() {
        let state = DocumentManagerState::default();
        let (label, _) = state.reserve_window(None, &standalone(), false).unwrap();
        assert_eq!(state.take_pending_replacement(&label).unwrap(), None);
    }

    #[test]
    fn set_pending_replacement_fails_for_unknown_target() {
        let state = DocumentManagerState::default();
        let (opener, _) = state.reserve_window(None, &standalone(), false).unwrap();
        assert!(state
            .set_pending_replacement(&opener, "document-999")
            .is_err());
    }

    #[test]
    fn untitled_index_increments_for_subsequent_untitled_windows() {
        let state = DocumentManagerState::default();
        let (_l1, r1) = state.reserve_window(None, &standalone(), false).unwrap();
        let (_l2, r2) = state.reserve_window(None, &standalone(), false).unwrap();
        let (_l3, r3) = state.reserve_window(None, &standalone(), false).unwrap();
        assert_eq!(r1.untitled_index, 1);
        assert_eq!(r2.untitled_index, 2);
        assert_eq!(r3.untitled_index, 3);
    }

    #[test]
    fn unregister_frees_untitled_index_for_reuse() {
        let state = DocumentManagerState::default();
        let _ = state.reserve_window(None, &standalone(), false).unwrap();
        let (label2, _) = state.reserve_window(None, &standalone(), false).unwrap();
        let _ = state.reserve_window(None, &standalone(), false).unwrap();

        state.unregister_window(&label2);

        // 最小未使用番号 (2) を採番する
        let (_l4, r4) = state.reserve_window(None, &standalone(), false).unwrap();
        assert_eq!(r4.untitled_index, 2);
    }

    #[test]
    fn reserve_with_file_path_uses_untitled_index_zero() {
        let state = DocumentManagerState::default();
        let path = PathBuf::from("/tmp/test.sheltie");
        let (_label, record) = state
            .reserve_window(Some(path.clone()), &standalone(), false)
            .unwrap();
        assert_eq!(record.untitled_index, 0);
        assert_eq!(record.file_path, Some(path));
    }

    #[test]
    fn reserving_same_file_path_twice_fails() {
        let state = DocumentManagerState::default();
        let path = PathBuf::from("/tmp/test.sheltie");
        let _ = state
            .reserve_window(Some(path.clone()), &standalone(), false)
            .unwrap();
        assert!(state
            .reserve_window(Some(path), &standalone(), false)
            .is_err());
    }

    #[test]
    fn rollback_releases_file_path_so_it_can_be_reserved_again() {
        let state = DocumentManagerState::default();
        let path = PathBuf::from("/tmp/test.sheltie");
        let (label, _) = state
            .reserve_window(Some(path.clone()), &standalone(), false)
            .unwrap();
        state.rollback_window(&label);
        assert!(state
            .reserve_window(Some(path), &standalone(), false)
            .is_ok());
    }

    #[test]
    fn tab_in_group_inherits_host_tabbing_identifier() {
        let state = DocumentManagerState::default();
        let (host_label, host_record) = state.reserve_window(None, &standalone(), false).unwrap();
        let (_child_label, child_record) = state
            .reserve_window(None, &tab_in_group(&host_label), false)
            .unwrap();
        assert_eq!(
            child_record.tabbing_identifier,
            host_record.tabbing_identifier
        );
        assert_eq!(
            child_record.pending_tab_host_label,
            Some(host_label.clone())
        );
    }

    #[test]
    fn tab_in_group_with_unknown_host_fails() {
        let state = DocumentManagerState::default();
        assert!(state
            .reserve_window(None, &tab_in_group("document-999"), false)
            .is_err());
    }

    #[test]
    fn existing_window_label_for_path_returns_label_when_tracked() {
        let state = DocumentManagerState::default();
        let path = PathBuf::from("/tmp/test.sheltie");
        let (label, _) = state
            .reserve_window(Some(path.clone()), &standalone(), false)
            .unwrap();
        assert_eq!(state.existing_window_label_for_path(&path), Some(label));
        assert_eq!(
            state.existing_window_label_for_path(Path::new("/tmp/other.sheltie")),
            None
        );
    }

    #[test]
    fn update_window_file_path_releases_old_and_registers_new() {
        let state = DocumentManagerState::default();
        let old_path = PathBuf::from("/tmp/old.sheltie");
        let new_path = PathBuf::from("/tmp/new.sheltie");
        let (label, _) = state
            .reserve_window(Some(old_path.clone()), &standalone(), false)
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
        let path_a = PathBuf::from("/tmp/a.sheltie");
        let path_b = PathBuf::from("/tmp/b.sheltie");
        let (label_a, _) = state
            .reserve_window(Some(path_a), &standalone(), false)
            .unwrap();
        let _ = state
            .reserve_window(Some(path_b.clone()), &standalone(), false)
            .unwrap();

        assert!(state.update_window_file_path(&label_a, path_b).is_err());
    }

    #[test]
    fn ensure_window_can_use_file_path_allows_same_window_to_keep_path() {
        let state = DocumentManagerState::default();
        let path = PathBuf::from("/tmp/test.sheltie");
        let (label, _) = state
            .reserve_window(Some(path.clone()), &standalone(), false)
            .unwrap();
        assert!(state.ensure_window_can_use_file_path(&label, &path).is_ok());
    }

    #[test]
    fn take_pending_tab_attachment_returns_value_once() {
        let state = DocumentManagerState::default();
        let (host_label, _) = state.reserve_window(None, &standalone(), false).unwrap();
        let (child_label, _) = state
            .reserve_window(None, &tab_in_group(&host_label), false)
            .unwrap();

        let first = state.take_pending_tab_attachment(&child_label).unwrap();
        assert!(first.is_some());
        assert_eq!(first.as_ref().unwrap().0, host_label);

        let second = state.take_pending_tab_attachment(&child_label).unwrap();
        assert!(second.is_none());
    }

    #[test]
    fn document_summaries_follow_creation_order_and_mark_focus() {
        let state = DocumentManagerState::default();
        let (first_label, _) = state.reserve_window(None, &standalone(), false).unwrap();
        let (second_label, _) = state.reserve_window(None, &standalone(), false).unwrap();
        let (third_label, _) = state.reserve_window(None, &standalone(), false).unwrap();
        state.unregister_window(&second_label);

        let summaries = state.document_summaries(Some(&third_label)).unwrap();
        assert_eq!(
            summaries
                .iter()
                .map(|summary| summary.document_id.as_str())
                .collect::<Vec<_>>(),
            vec![first_label.as_str(), third_label.as_str()]
        );
        assert!(!summaries[0].focused);
        assert!(summaries[1].focused);
    }

    #[test]
    fn window_context_returns_serialized_form() {
        let state = DocumentManagerState::default();
        let path = PathBuf::from("/tmp/test.sheltie");
        let (label, _) = state
            .reserve_window(Some(path.clone()), &standalone(), false)
            .unwrap();
        let context = state.window_context(&label).unwrap();
        assert_eq!(context.file_path, Some(path.to_string_lossy().to_string()));
        assert_eq!(context.untitled_index, 0);
    }
}
