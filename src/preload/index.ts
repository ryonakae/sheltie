// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

import type { TabStoreApi } from '../shared/types';

const api: TabStoreApi = {
  loadTabState: () => ipcRenderer.invoke('tab-state:load'),
  saveTabState: (state) => ipcRenderer.invoke('tab-state:save', state),
  onSaveBeforeClose: (callback) => {
    ipcRenderer.on('save-before-close', () => callback());
  },
  closeReady: (state) => ipcRenderer.invoke('tab-state:close-ready', state),
};

contextBridge.exposeInMainWorld('api', api);
