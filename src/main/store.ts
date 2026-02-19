import { ipcMain } from 'electron';
import ElectronStore from 'electron-store';

import type { Project, ProjectState } from '../shared/types';

const schema = {
  projectState: {
    type: 'object' as const,
    properties: {
      projects: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            id: { type: 'string' as const },
            title: { type: 'string' as const },
            sidebarWidth: { type: 'number' as const },
            createdAt: { type: 'number' as const },
          },
          required: ['id', 'title', 'sidebarWidth', 'createdAt'],
        },
      },
      openIds: {
        type: 'array' as const,
        items: { type: 'string' as const },
      },
      activeId: { type: 'string' as const },
    },
    required: ['projects', 'openIds', 'activeId'],
  },
};

const DEFAULT_PROJECT_STATE: ProjectState = {
  projects: [] as Project[],
  openIds: [],
  activeId: '__home__',
};

type StoreSchema = { projectState: ProjectState };

const store = new ElectronStore<StoreSchema>({
  schema,
  defaults: { projectState: DEFAULT_PROJECT_STATE },
});

/** 旧 tabState 形式からのマイグレーション */
function migrateFromTabState(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacy = (store as any).get('tabState');
  if (!legacy) return;

  const now = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projects: Project[] = (legacy.tabs ?? []).map((t: any) => ({
    id: t.id,
    title: t.title,
    sidebarWidth: t.sidebarWidth,
    createdAt: now,
  }));

  const migrated: ProjectState = {
    projects,
    openIds: projects.map((p) => p.id),
    activeId: legacy.activeId ?? '__home__',
  };

  store.set('projectState', migrated);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (store as any).delete('tabState');
}

migrateFromTabState();

export function registerProjectStateHandlers(getWindow: () => Electron.BrowserWindow | null): void {
  ipcMain.handle('project-state:load', (): ProjectState => {
    return store.get('projectState', DEFAULT_PROJECT_STATE);
  });

  ipcMain.handle('project-state:save', (_event, state: ProjectState): void => {
    store.set('projectState', state);
  });

  ipcMain.handle('project-state:close-ready', (_event, state: ProjectState): void => {
    store.set('projectState', state);
    const win = getWindow();
    if (win) {
      win.destroy();
    }
  });
}
