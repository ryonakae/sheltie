export const HOME_ID = '__home__' as const;

export interface Tab {
  id: string;
  title: string;
  sidebarWidth: number;
}

export interface TabState {
  tabs: Tab[];
  activeId: string;
}

export type TabAction =
  | { type: 'ADD_TAB' }
  | { type: 'REMOVE_TAB'; id: string }
  | { type: 'SET_ACTIVE'; id: string }
  | { type: 'REORDER_TABS'; tabs: Tab[] }
  | { type: 'UPDATE_SIDEBAR_WIDTH'; id: string; width: number };
