import { HOME_ID } from '../types/tab';
import type { Tab, TabAction, TabState } from '../types/tab';

const SIDEBAR_DEFAULT_WIDTH = 320;

function createTab(count: number): Tab {
  return {
    id: crypto.randomUUID(),
    title: `タブ ${count}`,
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  };
}

export function createInitialState(): TabState {
  return {
    tabs: [],
    activeId: HOME_ID,
    homeSidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  };
}

export function tabReducer(state: TabState, action: TabAction): TabState {
  switch (action.type) {
    case 'ADD_TAB': {
      const newTab = createTab(state.tabs.length + 1);
      return { ...state, tabs: [...state.tabs, newTab], activeId: newTab.id };
    }
    case 'REMOVE_TAB': {
      const tabIndex = state.tabs.findIndex((t) => t.id === action.id);
      if (tabIndex === -1) return state;
      const remaining = state.tabs.filter((t) => t.id !== action.id);
      let newActiveId = state.activeId;
      if (state.activeId === action.id) {
        const leftNeighbor = remaining[tabIndex - 1];
        const rightNeighbor = remaining[tabIndex];
        newActiveId = leftNeighbor?.id ?? rightNeighbor?.id ?? HOME_ID;
      }
      return { ...state, tabs: remaining, activeId: newActiveId };
    }
    case 'SET_ACTIVE':
      return { ...state, activeId: action.id };
    case 'REORDER_TABS':
      return { ...state, tabs: action.tabs };
    case 'UPDATE_SIDEBAR_WIDTH':
      if (action.id === HOME_ID) {
        return { ...state, homeSidebarWidth: action.width };
      }
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.id ? { ...t, sidebarWidth: action.width } : t,
        ),
      };
  }
}
