import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

import type { WindowContext } from '@/lib/tauri-bridge/types';

export const api = {
  loadWindowContext: (): Promise<WindowContext> => invoke('load_window_context'),

  presentDocumentWindow: (): Promise<void> => invoke('present_document_window'),

  setDocumentEdited: (edited: boolean): Promise<void> => invoke('set_document_edited', { edited }),

  newDocumentTab: (): Promise<void> => invoke('new_document_tab'),

  newDocumentWindow: (): Promise<void> => invoke('new_document_window'),

  openDocumentWindow: (path: string): Promise<void> => invoke('open_document_window', { path }),

  loadProjectFile: (path: string): Promise<string> => invoke('load_project_file', { path }),

  saveProjectFile: (path: string, contents: string): Promise<string> =>
    invoke('save_project_file', { path, contents }),

  onSaveBeforeClose: (callback: () => void | Promise<void>): void => {
    void getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      await callback();
    });
  },

  completeAppExit: (windowLabels: string[]): Promise<void> =>
    invoke('complete_app_exit', { windowLabels }),

  abortAppExit: (): Promise<void> => invoke('abort_app_exit'),

  closeReady: (): Promise<void> => invoke('close_ready'),
};
