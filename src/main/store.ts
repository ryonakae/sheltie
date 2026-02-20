import { ipcMain } from 'electron';
import ElectronStore from 'electron-store';

import type { Project, ProjectState, ThemeMode } from '../shared/types';

const schema = {
  theme: {
    type: 'string' as const,
    enum: ['system', 'light', 'dark'],
  },
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
            pages: { type: 'array' as const },
            viewport: { type: 'object' as const },
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

const DEFAULT_VIEWPORT = { zoom: 1, panX: 0, panY: 0 };

type StoreSchema = { projectState: ProjectState; theme: ThemeMode };

const store = new ElectronStore<StoreSchema>({
  schema,
  defaults: { projectState: DEFAULT_PROJECT_STATE, theme: 'system' },
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
    pages: [],
    viewport: DEFAULT_VIEWPORT,
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

/** pages/viewport フィールドがない既存プロジェクトにデフォルト値を補完する */
function migrateToArtboard(): void {
  const state = store.get('projectState', DEFAULT_PROJECT_STATE);
  let migrated = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updatedProjects = state.projects.map((p: any) => {
    const needsMigration = !('pages' in p) || !('viewport' in p);
    if (!needsMigration) return p;
    migrated = true;
    return {
      ...p,
      pages: p.pages ?? [],
      viewport: p.viewport ?? DEFAULT_VIEWPORT,
    };
  });

  if (migrated) {
    store.set('projectState', { ...state, projects: updatedProjects });
  }
}

migrateFromTabState();
migrateToArtboard();

export function getTheme(): ThemeMode {
  return store.get('theme', 'system');
}

export function setTheme(mode: ThemeMode): void {
  store.set('theme', mode);
}

export function registerProjectStateHandlers(getWindow: () => Electron.BaseWindow | null): void {
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
