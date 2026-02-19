import type { Project, ProjectState } from '../renderer/types/tab';

export type { Project, ProjectState };

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
  }
}
