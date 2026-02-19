export const HOME_ID = '__home__' as const;

export interface Project {
  id: string;
  title: string;
  sidebarWidth: number;
  createdAt: number;
}

export interface ProjectState {
  /** 全永続プロジェクト */
  projects: Project[];
  /** タブバーに表示中のプロジェクト ID（順序がタブの並び順） */
  openIds: string[];
  /** 現在アクティブなプロジェクト ID（HOME_ID の場合はホーム画面） */
  activeId: string;
}
