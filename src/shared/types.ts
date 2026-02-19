import type { Tab, TabState } from '../renderer/types/tab';

export type { Tab, TabState };

export interface TabStoreApi {
  loadTabState: () => Promise<TabState>;
  saveTabState: (state: TabState) => Promise<void>;
  onSaveBeforeClose: (callback: () => void) => void;
  closeReady: (state: TabState) => Promise<void>;
}

declare global {
  interface Window {
    api: TabStoreApi;
  }
}
