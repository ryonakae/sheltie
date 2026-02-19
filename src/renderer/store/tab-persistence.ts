import { useTabStore } from './tab-store';

const SAVE_DEBOUNCE_MS = 500;

// HMR で setupTabPersistence() が再実行されても多重登録を防ぐためのガード
let initialized = false;

/**
 * タブ状態の IPC 永続化をセットアップする。
 * React マウント前に 1 度だけ呼び出すこと。
 *
 * - 起動時: electron-store から状態を読み込んで復元
 * - 変更時: 500ms デバウンスで electron-store に保存
 * - クローズ前: 最新状態を即時保存してウィンドウを破棄
 */
export function setupTabPersistence(): void {
  if (initialized) return;
  initialized = true;

  // 1. 起動時: 保存済み状態を読み込んで復元
  window.api
    .loadTabState()
    .then((saved) => {
      useTabStore.getState()._restoreState(saved);
      useTabStore.getState()._setLoaded();
    })
    .catch(() => {
      useTabStore.getState()._setLoaded();
    });

  // 2. 状態変更時: デバウンスで保存
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  useTabStore.subscribe((state, prevState) => {
    if (!state.isLoaded) return;
    // tabs か activeId が変わった場合のみ保存
    if (state.tabs === prevState.tabs && state.activeId === prevState.activeId) return;

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      // デバウンス後に getState() で最新状態を取得する
      const { tabs, activeId } = useTabStore.getState();
      window.api.saveTabState({ tabs, activeId }).catch(() => {
        // 保存失敗は無視（次の変更時に再試行される）
      });
    }, SAVE_DEBOUNCE_MS);
  });

  // 3. ウィンドウクローズ前の最終保存
  window.api.onSaveBeforeClose(() => {
    if (saveTimer) clearTimeout(saveTimer);
    const { tabs, activeId } = useTabStore.getState();
    window.api.closeReady({ tabs, activeId }).catch(() => {});
  });
}
