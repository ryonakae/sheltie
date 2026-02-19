import { create } from 'zustand';

import { HOME_ID } from '../types/tab';
import type { Project, ProjectState } from '../types/tab';

const SIDEBAR_DEFAULT_WIDTH = 320;

function createProject(count: number): Project {
  return {
    id: crypto.randomUUID(),
    title: `プロジェクト ${count}`,
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    createdAt: Date.now(),
  };
}

/**
 * closeProject/deleteProject でアクティブなプロジェクトが除去された時のフォールバック先を求める。
 * 左隣 → 右隣 → HOME_ID の優先順。
 */
function resolveNextActiveId(removedIndex: number, remainingIds: string[]): string {
  const leftNeighbor = remainingIds[removedIndex - 1];
  const rightNeighbor = remainingIds[removedIndex];
  return leftNeighbor ?? rightNeighbor ?? HOME_ID;
}

interface ProjectActions {
  /** 新規プロジェクトを作成してタブバーに開く */
  createProject: () => void;
  /** プロジェクトをタブバーで開く（既に開いていればアクティブにするだけ） */
  openProject: (id: string) => void;
  /** タブバーからプロジェクトを閉じる（プロジェクト自体は残る） */
  closeProject: (id: string) => void;
  /** プロジェクトを完全に削除する */
  deleteProject: (id: string) => void;
  /** プロジェクト名を変更する */
  renameProject: (id: string, title: string) => void;
  setActive: (id: string) => void;
  reorderOpenProjects: (openIds: string[]) => void;
  updateSidebarWidth: (id: string, width: number) => void;
  /** 永続化モジュール専用: 起動時に保存済み状態を復元する */
  _restoreState: (state: ProjectState) => void;
  /** 永続化モジュール専用: 復元完了フラグを立てる */
  _setLoaded: () => void;
}

interface ProjectStore extends ProjectState, ProjectActions {
  isLoaded: boolean;
}

export const useProjectStore = create<ProjectStore>()((set) => ({
  projects: [],
  openIds: [],
  activeId: HOME_ID,
  isLoaded: false,

  createProject: () =>
    set((state) => {
      const newProject = createProject(state.projects.length + 1);
      return {
        projects: [...state.projects, newProject],
        openIds: [...state.openIds, newProject.id],
        activeId: newProject.id,
      };
    }),

  openProject: (id) =>
    set((state) => {
      // 既に開いていればアクティブにするだけ
      if (state.openIds.includes(id)) {
        return { activeId: id };
      }
      return { openIds: [...state.openIds, id], activeId: id };
    }),

  closeProject: (id) =>
    set((state) => {
      const idx = state.openIds.indexOf(id);
      if (idx === -1) return state;
      const remaining = state.openIds.filter((oid) => oid !== id);
      const newActiveId =
        state.activeId === id ? resolveNextActiveId(idx, remaining) : state.activeId;
      return { openIds: remaining, activeId: newActiveId };
    }),

  deleteProject: (id) =>
    set((state) => {
      const openIdx = state.openIds.indexOf(id);
      const remainingOpenIds = state.openIds.filter((oid) => oid !== id);
      let newActiveId = state.activeId;
      if (state.activeId === id) {
        newActiveId = resolveNextActiveId(openIdx, remainingOpenIds);
      }
      return {
        projects: state.projects.filter((p) => p.id !== id),
        openIds: remainingOpenIds,
        activeId: newActiveId,
      };
    }),

  renameProject: (id, title) =>
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? { ...p, title } : p)),
    })),

  setActive: (id) => set({ activeId: id }),

  reorderOpenProjects: (openIds) => set({ openIds }),

  updateSidebarWidth: (id, width) =>
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? { ...p, sidebarWidth: width } : p)),
    })),

  _restoreState: (restoredState) =>
    set({
      projects: restoredState.projects,
      openIds: restoredState.openIds,
      activeId: restoredState.activeId,
    }),

  _setLoaded: () => set({ isLoaded: true }),
}));

export const selectActiveProject = (state: ProjectStore): Project | undefined =>
  state.projects.find((p) => p.id === state.activeId);

export const selectIsHome = (state: ProjectStore): boolean => state.activeId === HOME_ID;
