import { ipcMain } from 'electron';
import ElectronStore from 'electron-store';

import type { Tab, TabState } from '../shared/types';

const schema = {
  tabState: {
    type: 'object' as const,
    properties: {
      tabs: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            id: { type: 'string' as const },
            title: { type: 'string' as const },
            sidebarWidth: { type: 'number' as const },
          },
          required: ['id', 'title', 'sidebarWidth'],
        },
      },
      activeId: { type: 'string' as const },
    },
    required: ['tabs', 'activeId'],
  },
};

const DEFAULT_TAB_STATE: TabState = {
  tabs: [] as Tab[],
  activeId: '__home__',
};

type StoreSchema = { tabState: TabState };

const store = new ElectronStore<StoreSchema>({ schema, defaults: { tabState: DEFAULT_TAB_STATE } });

export function registerTabStateHandlers(getWindow: () => Electron.BrowserWindow | null): void {
  ipcMain.handle('tab-state:load', (): TabState => {
    return store.get('tabState', DEFAULT_TAB_STATE);
  });

  ipcMain.handle('tab-state:save', (_event, state: TabState): void => {
    store.set('tabState', state);
  });

  ipcMain.handle('tab-state:close-ready', (_event, state: TabState): void => {
    store.set('tabState', state);
    const win = getWindow();
    if (win) {
      win.destroy();
    }
  });
}
