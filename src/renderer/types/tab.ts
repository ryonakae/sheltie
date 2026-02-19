export const HOME_ID = '__home__' as const;

export interface Page {
  id: string;
  url: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: number;
}

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export const DEFAULT_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 };
export const DEFAULT_PAGE_WIDTH = 1280;
export const DEFAULT_PAGE_HEIGHT = 800;

export interface Project {
  id: string;
  title: string;
  sidebarWidth: number;
  createdAt: number;
  pages: Page[];
  viewport: Viewport;
}

export interface ProjectState {
  /** 全永続プロジェクト */
  projects: Project[];
  /** タブバーに表示中のプロジェクト ID（順序がタブの並び順） */
  openIds: string[];
  /** 現在アクティブなプロジェクト ID（HOME_ID の場合はホーム画面） */
  activeId: string;
}
