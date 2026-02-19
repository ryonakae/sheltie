import { create } from 'zustand';

import { HOME_ID } from '../types/tab';
import type { Tab, TabState } from '../types/tab';

const SIDEBAR_DEFAULT_WIDTH = 320;

function createTab(count: number): Tab {
  return {
    id: crypto.randomUUID(),
    title: `タブ ${count}`,
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  };
}

interface TabActions {
  addTab: () => void;
  removeTab: (id: string) => void;
  setActive: (id: string) => void;
  reorderTabs: (tabs: Tab[]) => void;
  updateSidebarWidth: (id: string, width: number) => void;
  /** 永続化モジュール専用: 起動時に保存済み状態を復元する */
  _restoreState: (state: TabState) => void;
  /** 永続化モジュール専用: 復元完了フラグを立てる */
  _setLoaded: () => void;
}

interface TabStore extends TabState, TabActions {
  isLoaded: boolean;
}

export const useTabStore = create<TabStore>()((set) => ({
  tabs: [],
  activeId: HOME_ID,
  isLoaded: false,

  addTab: () =>
    set((state) => {
      const newTab = createTab(state.tabs.length + 1);
      return { tabs: [...state.tabs, newTab], activeId: newTab.id };
    }),

  removeTab: (id) =>
    set((state) => {
      const tabIndex = state.tabs.findIndex((t) => t.id === id);
      if (tabIndex === -1) return state;
      const remaining = state.tabs.filter((t) => t.id !== id);
      let newActiveId = state.activeId;
      if (state.activeId === id) {
        const leftNeighbor = remaining[tabIndex - 1];
        const rightNeighbor = remaining[tabIndex];
        newActiveId = leftNeighbor?.id ?? rightNeighbor?.id ?? HOME_ID;
      }
      return { tabs: remaining, activeId: newActiveId };
    }),

  setActive: (id) => set({ activeId: id }),

  reorderTabs: (tabs) => set({ tabs }),

  updateSidebarWidth: (id, width) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, sidebarWidth: width } : t)),
    })),

  _restoreState: (restoredState) =>
    set({ tabs: restoredState.tabs, activeId: restoredState.activeId }),

  _setLoaded: () => set({ isLoaded: true }),
}));

export const selectActiveTab = (state: TabStore): Tab | undefined =>
  state.tabs.find((t) => t.id === state.activeId);

export const selectIsHome = (state: TabStore): boolean => state.activeId === HOME_ID;
