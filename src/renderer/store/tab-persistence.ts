import { SAVE_DEBOUNCE_MS } from '@/renderer/constants';
import { api } from '@/renderer/lib/tauri-bridge';
import { useProjectStore } from '@/renderer/store/tab-store';

// HMR で setupProjectPersistence() が再実行されても多重登録を防ぐためのガード
let initialized = false;

/**
 * プロジェクト状態の永続化をセットアップする。
 * React マウント前に 1 度だけ呼び出すこと。
 *
 * - 起動時: Tauri Store から状態を読み込んで復元
 * - 変更時: 500ms デバウンスで Tauri Store に保存
 * - クローズ前: 最新状態を即時保存してウィンドウを破棄
 */
export function setupProjectPersistence(): void {
  if (initialized) return;
  initialized = true;

  // 1. 起動時: 保存済み状態を読み込んで復元
  api
    .loadProjectState()
    .then((saved) => {
      useProjectStore.getState()._restoreState(saved);
      useProjectStore.getState()._setLoaded();
    })
    .catch(() => {
      useProjectStore.getState()._setLoaded();
    });

  // 2. 状態変更時: デバウンスで保存
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  useProjectStore.subscribe((state, prevState) => {
    if (!state.isLoaded) return;
    // projects, openIds, activeId のいずれかが変わった場合のみ保存
    if (
      state.projects === prevState.projects &&
      state.openIds === prevState.openIds &&
      state.activeId === prevState.activeId
    )
      return;

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { projects, openIds, activeId } = useProjectStore.getState();
      api.saveProjectState({ projects, openIds, activeId }).catch(() => {
        // 保存失敗は無視（次の変更時に再試行される）
      });
    }, SAVE_DEBOUNCE_MS);
  });

  // 3. ウィンドウクローズ前の最終保存
  api.onSaveBeforeClose(() => {
    if (saveTimer) clearTimeout(saveTimer);
    const { projects, openIds, activeId } = useProjectStore.getState();
    api.closeReady({ projects, openIds, activeId }).catch(() => {});
  });
}
