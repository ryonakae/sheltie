import { useEffect, useReducer, useRef, useState } from 'react';

import { HOME_ID } from '../types/tab';
import type { Tab, TabAction, TabState } from '../types/tab';

const SIDEBAR_DEFAULT_WIDTH = 320;
const SAVE_DEBOUNCE_MS = 500;

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
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.id ? { ...t, sidebarWidth: action.width } : t,
        ),
      };
    case 'RESTORE_STATE':
      return action.state;
  }
}

export function useTabReducer() {
  const [state, dispatch] = useReducer(tabReducer, null, createInitialState);
  const [isLoaded, setIsLoaded] = useState(false);
  // クローズ時コールバックで最新状態を参照するための ref
  const stateRef = useRef(state);
  stateRef.current = state;

  // 起動時: 保存済み状態を読み込んで復元
  useEffect(() => {
    let cancelled = false;
    window.api
      .loadTabState()
      .then((saved) => {
        if (!cancelled) {
          dispatch({ type: 'RESTORE_STATE', state: saved });
          setIsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setIsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 状態変更時: デバウンスで保存
  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      window.api.saveTabState(state).catch(() => {
        // 保存失敗は無視（次の変更時に再試行される）
      });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state, isLoaded]);

  // ウィンドウクローズ前の最終保存
  useEffect(() => {
    window.api.onSaveBeforeClose(() => {
      window.api.closeReady(stateRef.current).catch(() => {});
    });
  }, []);

  return { state, dispatch, isLoaded } as const;
}
