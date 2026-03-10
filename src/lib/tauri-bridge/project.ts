import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

import type { ProjectState } from '@/types';

export const api = {
  loadProjectState: (): Promise<ProjectState> => invoke('load_project_state'),

  saveProjectState: (state: ProjectState): Promise<void> => invoke('save_project_state', { state }),

  loadProjectFile: (path: string): Promise<string> => invoke('load_project_file', { path }),

  saveProjectFile: (path: string, contents: string): Promise<string> =>
    invoke('save_project_file', { path, contents }),

  onSaveBeforeClose: (callback: () => void | Promise<void>): void => {
    void getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      await callback();
    });
  },

  closeReady: (state: ProjectState): Promise<void> => invoke('close_ready', { state }),
};
