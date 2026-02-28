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
  /** Tauri Webview のラベル（ランタイムのみ・永続化不要） */
  webviewLabel?: string;
}

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export const DEFAULT_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 };
export const DEFAULT_PAGE_WIDTH = 1280;
export const DEFAULT_PAGE_HEIGHT = 800;

export interface SizePreset {
  label: string;
  width: number;
  height: number;
}

export const SIZE_PRESETS: readonly SizePreset[] = [
  { label: 'モバイル', width: 375, height: 812 },
  { label: 'タブレット', width: 768, height: 1024 },
  { label: 'PC', width: 1280, height: 800 },
];

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
