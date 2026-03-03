import { create } from 'zustand';

import {
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  DEFAULT_STICKY_NOTE_HEIGHT,
  DEFAULT_STICKY_NOTE_WIDTH,
  DEFAULT_VIEWPORT,
  HOME_ID,
  MAX_VERTICAL_SEARCH_STEPS,
  PAGE_GAP,
  SIDEBAR_DEFAULT_WIDTH,
} from '@/renderer/constants';
import { type Page, type Project, type ProjectState, type Viewport } from '@/renderer/types/tab';

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

function isVerticalOverlapping(y: number, h: number, page: Pick<Page, 'y' | 'height'>): boolean {
  return !(y + h <= page.y || page.y + page.height <= y);
}

function isHorizontalOverlapping(x: number, w: number, page: Pick<Page, 'x' | 'width'>): boolean {
  return !(x + w <= page.x || page.x + page.width <= x);
}

function findNonOverlappingPosition(
  pages: Page[],
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (pages.length === 0) {
    return { x, y };
  }

  for (let step = 0; step <= MAX_VERTICAL_SEARCH_STEPS; step++) {
    const yCandidates = step === 0 ? [0] : [step * PAGE_GAP, -step * PAGE_GAP];
    for (const yOffset of yCandidates) {
      const candidateY = y + yOffset;
      const sameRowPages = pages.filter((page) => isVerticalOverlapping(candidateY, height, page));

      if (sameRowPages.length === 0) {
        return { x, y: candidateY };
      }

      let candidateX = x;
      while (true) {
        const overlapPages = sameRowPages.filter((page) =>
          isHorizontalOverlapping(candidateX, width, page),
        );
        if (overlapPages.length === 0) {
          return { x: candidateX, y: candidateY };
        }

        const rightmost = Math.max(...overlapPages.map((page) => page.x + page.width));
        candidateX = rightmost + PAGE_GAP;
      }
    }
  }

  const fallbackY = Math.max(...pages.map((page) => page.y + page.height)) + PAGE_GAP;
  return { x, y: fallbackY };
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
  /** プロジェクトにページを追加する（url 省略時は空フレームとして追加） */
  addPage: (
    projectId: string,
    url?: string,
    options?: { x: number; y: number; width: number; height: number },
  ) => Page | null;
  /** 空フレームに URL を初回設定する（url + addedUrl + title を同時更新） */
  setPageUrl: (projectId: string, pageId: string, url: string) => void;
  /** プロジェクトからページを削除する */
  removePage: (projectId: string, pageId: string) => void;
  /** ページの位置を更新する（ドラッグ完了時） */
  updatePagePosition: (projectId: string, pageId: string, x: number, y: number) => void;
  /** ページのサイズを更新する（リサイズ完了時） */
  updatePageSize: (projectId: string, pageId: string, width: number, height: number) => void;
  /** ページの URL とタイトルを更新する（webview のナビゲーション後） */
  updatePageUrl: (projectId: string, pageId: string, url: string, title: string) => void;
  /** ページタイトルを更新する（Webview のタイトル変更時） */
  updatePageTitle: (projectId: string, pageId: string, title: string) => void;
  /** アートボードのズーム・パンを更新する */
  updateViewport: (projectId: string, viewport: Partial<Viewport>) => void;
  /** ページを配列末尾に移動して最前面に表示する */
  bringPageToFront: (projectId: string, pageId: string) => void;
  /** 付箋を追加する */
  addStickyNote: (
    projectId: string,
    options?: { x: number; y: number; width: number; height: number },
  ) => Page | null;
  /** 付箋のテキスト内容を更新する */
  updateStickyNoteContent: (projectId: string, pageId: string, content: string) => void;
  /** 付箋のカラーインデックスを次の色に進める */
  cycleStickyNoteColor: (projectId: string, pageId: string) => void;
  /** 現在表示中の url を addedUrl として固定する（リロード先を遷移後の URL に更新） */
  pinPageUrl: (projectId: string, pageId: string) => void;
  /** ネイティブ Webview 作成後にラベルをページに紐付ける（ランタイムのみ・永続化不要） */
  setPageWebviewLabel: (projectId: string, pageId: string, label: string) => void;
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

  addPage: (projectId, url = '', options) => {
    let createdPage: Page | null = null;

    set((state) => {
      const nextState = state.projects.map((p) => {
        if (p.id !== projectId) return p;
        let title = '新規ページ';
        if (url) {
          try {
            title = new URL(url).hostname;
          } catch {
            title = url;
          }
        }
        const nextPage: Page = {
          id: crypto.randomUUID(),
          url,
          title,
          addedUrl: url || undefined,
          x: 0,
          y: 0,
          width: options?.width ?? DEFAULT_PAGE_WIDTH,
          height: options?.height ?? DEFAULT_PAGE_HEIGHT,
          createdAt: Date.now(),
        };
        const positioned = findNonOverlappingPosition(
          p.pages,
          options?.x ?? 0,
          options?.y ?? 0,
          nextPage.width,
          nextPage.height,
        );
        const newPage = {
          ...nextPage,
          x: positioned.x,
          y: positioned.y,
        };
        createdPage = newPage;
        return {
          ...p,
          pages: [...p.pages, newPage],
        };
      });
      return { projects: nextState };
    });

    return createdPage;
  },

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
          pages: p.pages.map((pg) => {
            if (pg.id !== pageId) return pg;
            // URL・タイトルが同一なら参照を維持して不要な再レンダリングを防ぐ
            // 空タイトルの場合は既存タイトルを維持（on_navigation の URL 正規化後に来る空文字を無視）
            if (pg.url === url && (pg.title === title || !title)) return pg;
            return { ...pg, url, title: title || pg.title };
          }),
        };
      }),
    })),

  updatePageTitle: (projectId, pageId, title) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          pages: p.pages.map((pg) => {
            if (pg.id !== pageId || pg.title === title) return pg;
            return { ...pg, title };
          }),
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
        // 既に末尾（最前面）なら配列を再構築しない（冪等化）
        if (p.pages[p.pages.length - 1]?.id === pageId) return p;
        return {
          ...p,
          pages: [...p.pages.filter((pg) => pg.id !== pageId), page],
        };
      }),
    })),

  setPageUrl: (projectId, pageId, url) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          pages: p.pages.map((pg) => {
            if (pg.id !== pageId) return pg;
            let title = url;
            try {
              title = new URL(url).hostname;
            } catch {
              // パース失敗時はそのまま使用
            }
            return { ...pg, url, addedUrl: url, title };
          }),
        };
      }),
    })),

  addStickyNote: (projectId, options) => {
    let createdPage: Page | null = null;

    set((state) => {
      const nextState = state.projects.map((p) => {
        if (p.id !== projectId) return p;
        const nextPage: Page = {
          id: crypto.randomUUID(),
          type: 'stickynote',
          url: '',
          title: 'Sticky Note',
          content: '',
          colorIndex: 0,
          x: 0,
          y: 0,
          width: options?.width ?? DEFAULT_STICKY_NOTE_WIDTH,
          height: options?.height ?? DEFAULT_STICKY_NOTE_HEIGHT,
          createdAt: Date.now(),
        };
        const positioned = findNonOverlappingPosition(
          p.pages,
          options?.x ?? 0,
          options?.y ?? 0,
          nextPage.width,
          nextPage.height,
        );
        const newPage = { ...nextPage, x: positioned.x, y: positioned.y };
        createdPage = newPage;
        return { ...p, pages: [...p.pages, newPage] };
      });
      return { projects: nextState };
    });

    return createdPage;
  },

  updateStickyNoteContent: (projectId, pageId, content) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          pages: p.pages.map((pg) => (pg.id === pageId ? { ...pg, content } : pg)),
        };
      }),
    })),

  cycleStickyNoteColor: (projectId, pageId) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          pages: p.pages.map((pg) => {
            if (pg.id !== pageId) return pg;
            return { ...pg, colorIndex: ((pg.colorIndex ?? 0) + 1) % 4 };
          }),
        };
      }),
    })),

  pinPageUrl: (projectId, pageId) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          pages: p.pages.map((pg) => {
            if (pg.id !== pageId) return pg;
            // 既に addedUrl と url が同一なら参照を維持して不要な再レンダリングを防ぐ
            if (!pg.url || pg.addedUrl === pg.url) return pg;
            return { ...pg, addedUrl: pg.url };
          }),
        };
      }),
    })),

  setPageWebviewLabel: (projectId, pageId, label) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          pages: p.pages.map((pg) => (pg.id === pageId ? { ...pg, webviewLabel: label } : pg)),
        };
      }),
    })),

  _restoreState: (restoredState) =>
    set({
      // webviewLabel はランタイム専用のため、復元時に必ずクリアする
      projects: restoredState.projects.map((p) => ({
        ...p,
        pages: p.pages.map(({ webviewLabel: _wl, ...pg }) => pg),
      })),
      openIds: restoredState.openIds,
      activeId: restoredState.activeId,
    }),

  _setLoaded: () => set({ isLoaded: true }),
}));

export const selectActiveProject = (state: ProjectStore): Project | undefined =>
  state.projects.find((p) => p.id === state.activeId);

export const selectIsHome = (state: ProjectStore): boolean => state.activeId === HOME_ID;
