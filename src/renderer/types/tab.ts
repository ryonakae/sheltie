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
