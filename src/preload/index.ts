// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

import type { ProjectStoreApi } from '../shared/types';

const api: ProjectStoreApi = {
  loadProjectState: () => ipcRenderer.invoke('project-state:load'),
  saveProjectState: (state) => ipcRenderer.invoke('project-state:save', state),
  onSaveBeforeClose: (callback) => {
    ipcRenderer.on('save-before-close', () => callback());
  },
  closeReady: (state) => ipcRenderer.invoke('project-state:close-ready', state),
};

contextBridge.exposeInMainWorld('api', api);
