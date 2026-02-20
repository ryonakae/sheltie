// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

import type { PageViewApi, ProjectStoreApi, ThemeApi } from '../shared/types';

const api: ProjectStoreApi = {
  loadProjectState: () => ipcRenderer.invoke('project-state:load'),
  saveProjectState: (state) => ipcRenderer.invoke('project-state:save', state),
  onSaveBeforeClose: (callback) => {
    ipcRenderer.on('save-before-close', () => callback());
  },
  closeReady: (state) => ipcRenderer.invoke('project-state:close-ready', state),
};

contextBridge.exposeInMainWorld('api', api);

// trafficLightPosition: { x: 12, y: 10 } ボタン直径 12px × 3 + 間隔 8px × 2 + 右マージン 6px
const TRAFFIC_LIGHT_WIDTH = 12 + 12 * 3 + 8 * 2 + 6;

contextBridge.exposeInMainWorld('windowControls', {
  platform: process.platform,
  trafficLightWidth: process.platform === 'darwin' ? TRAFFIC_LIGHT_WIDTH : 0,
});

const pageViewApi: PageViewApi = {
  createPageView: (projectId, pageId, url) =>
    ipcRenderer.invoke('page-view:create', projectId, pageId, url),

  destroyPageView: (pageId) => ipcRenderer.invoke('page-view:destroy', pageId),

  batchUpdateBounds: (updates, zoom) => {
    ipcRenderer.send('page-view:batch-update-bounds', updates, zoom);
  },

  setInteractionMode: (isInteracting) => {
    ipcRenderer.send('page-view:set-interaction-mode', isInteracting);
  },

  showProjectPages: (projectId) => ipcRenderer.invoke('page-view:show-project', projectId),

  bringToFront: (pageId) => {
    ipcRenderer.send('page-view:bring-to-front', pageId);
  },

  destroyProjectPages: (projectId) => ipcRenderer.invoke('page-view:destroy-project', projectId),

  updateArtboardLayout: (layout) => {
    ipcRenderer.send('page-view:update-artboard-layout', layout);
  },

  onNavigated: (callback) => {
    ipcRenderer.on('page-view:navigated', (_event, pageId: string, url: string, title: string) => {
      callback(pageId, url, title);
    });
  },

  onTitleUpdated: (callback) => {
    ipcRenderer.on('page-view:title-updated', (_event, pageId: string, title: string) => {
      callback(pageId, title);
    });
  },
};

contextBridge.exposeInMainWorld('pageViewApi', pageViewApi);

const themeApi: ThemeApi = {
  loadTheme: () => ipcRenderer.invoke('theme:load'),
  setTheme: (mode) => ipcRenderer.invoke('theme:set', mode),
  onThemeChanged: (callback) => {
    ipcRenderer.on('theme:changed', (_event, isDark: boolean) => callback(isDark));
  },
};

contextBridge.exposeInMainWorld('themeApi', themeApi);
