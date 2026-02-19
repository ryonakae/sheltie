import { create } from 'zustand';

import { DEFAULT_PAGE_HEIGHT, DEFAULT_PAGE_WIDTH, DEFAULT_VIEWPORT, HOME_ID } from '../types/tab';
import type { Page, Project, ProjectState, Viewport } from '../types/tab';

const SIDEBAR_DEFAULT_WIDTH = 320;
const PAGE_GAP = 100;

function createProject(count: number): Project {
  return {
    id: crypto.randomUUID(),
    title: `プロジェクト ${count}`,
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    createdAt: Date.now(),
    pages: [],
    viewport: DEFAULT_VIEWPORT,
  };
}

/** 新規ページを既存ページの右端 + gap の位置に配置する */
function calcNextPageX(pages: Page[]): number {
  if (pages.length === 0) return 0;
  const rightmost = Math.max(...pages.map((p) => p.x + p.width));
  return rightmost + PAGE_GAP;
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
  /** プロジェクトにページを追加する */
  addPage: (projectId: string, url: string) => void;
  /** プロジェクトからページを削除する */
  removePage: (projectId: string, pageId: string) => void;
  /** ページの位置を更新する（ドラッグ完了時） */
  updatePagePosition: (projectId: string, pageId: string, x: number, y: number) => void;
  /** ページのサイズを更新する（リサイズ完了時） */
  updatePageSize: (projectId: string, pageId: string, width: number, height: number) => void;
  /** ページの URL とタイトルを更新する（webview のナビゲーション後） */
  updatePageUrl: (projectId: string, pageId: string, url: string, title: string) => void;
  /** アートボードのズーム・パンを更新する */
  updateViewport: (projectId: string, viewport: Partial<Viewport>) => void;
  /** ページを配列末尾に移動して最前面に表示する */
  bringPageToFront: (projectId: string, pageId: string) => void;
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

  addPage: (projectId, url) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        let hostname = url;
        try {
          hostname = new URL(url).hostname;
        } catch {
          // URL パース失敗時はそのまま使用
        }
        const newPage: Page = {
          id: crypto.randomUUID(),
          url,
          title: hostname,
          x: calcNextPageX(p.pages),
          y: 0,
          width: DEFAULT_PAGE_WIDTH,
          height: DEFAULT_PAGE_HEIGHT,
          createdAt: Date.now(),
        };
        return { ...p, pages: [...p.pages, newPage] };
      }),
    })),

  removePage: (projectId, pageId) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return { ...p, pages: p.pages.filter((pg) => pg.id !== pageId) };
      }),
    })),

  updatePagePosition: (projectId, pageId, x, y) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          pages: p.pages.map((pg) => (pg.id === pageId ? { ...pg, x, y } : pg)),
        };
      }),
    })),

  updatePageSize: (projectId, pageId, width, height) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          pages: p.pages.map((pg) => (pg.id === pageId ? { ...pg, width, height } : pg)),
        };
      }),
    })),

  updatePageUrl: (projectId, pageId, url, title) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          pages: p.pages.map((pg) => (pg.id === pageId ? { ...pg, url, title } : pg)),
        };
      }),
    })),

  updateViewport: (projectId, viewport) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return { ...p, viewport: { ...p.viewport, ...viewport } };
      }),
    })),

  bringPageToFront: (projectId, pageId) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        const page = p.pages.find((pg) => pg.id === pageId);
        if (!page) return p;
        return {
          ...p,
          pages: [...p.pages.filter((pg) => pg.id !== pageId), page],
        };
      }),
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
