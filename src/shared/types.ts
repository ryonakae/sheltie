import type { Project, ProjectState } from '../renderer/types/tab';

export type { Project, ProjectState };

export interface ProjectStoreApi {
  loadProjectState: () => Promise<ProjectState>;
  saveProjectState: (state: ProjectState) => Promise<void>;
  onSaveBeforeClose: (callback: () => void) => void;
  closeReady: (state: ProjectState) => Promise<void>;
}

declare global {
  interface Window {
    api: ProjectStoreApi;
  }
}
