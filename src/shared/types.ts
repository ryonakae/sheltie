import type { Project, ProjectState } from '../renderer/types/tab';

export type { Project, ProjectState };

export type ThemeMode = 'system' | 'light' | 'dark';

export interface ThemeApi {
  loadTheme: () => Promise<ThemeMode>;
  setTheme: (mode: ThemeMode) => Promise<boolean>;
  onThemeChanged: (callback: (isDark: boolean) => void) => void;
}

export interface ProjectStoreApi {
  loadProjectState: () => Promise<ProjectState>;
  saveProjectState: (state: ProjectState) => Promise<void>;
  onSaveBeforeClose: (callback: () => void) => void;
  closeReady: (state: ProjectState) => Promise<void>;
}

export interface WindowControlsInfo {
  platform: NodeJS.Platform;
  /** macOS: trafficLightPosition から算出したスペーサー幅。Windows/Linux では 0 */
  trafficLightWidth: number;
}

declare global {
  interface Window {
    api: ProjectStoreApi;
    windowControls: WindowControlsInfo;
    themeApi: ThemeApi;
  }
}
