import { create } from 'zustand';

import {
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  DEFAULT_STICKY_NOTE_HEIGHT,
  DEFAULT_STICKY_NOTE_WIDTH,
  DEFAULT_VIEWPORT,
  HOME_ID,
  MAX_ZOOM,
  MAX_VERTICAL_SEARCH_STEPS,
  MIN_ZOOM,
  PAGE_GAP,
  SIDEBAR_DEFAULT_WIDTH,
} from '@/constants';
import {
  createProjectDocument,
  documentNodeToBoardNode,
  sanitizeProjectDocument,
} from '@/lib/project-document';
import {
  type BoardNode,
  type Project,
  type ProjectState,
  type ProjectWebviewRuntime,
  type SiteboardDocumentV1,
  type Viewport,
} from '@/types';

const NODE_HISTORY_LIMIT = 100;

interface ProjectNodeHistory {
  past: BoardNode[][];
  future: BoardNode[][];
}

type ProjectNodeHistories = Record<string, ProjectNodeHistory>;
type ProjectWebviewRuntimes = Record<string, ProjectWebviewRuntime>;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function sanitizeViewport(viewport?: Partial<Viewport>): Viewport {
  return {
    zoom: clampZoom(typeof viewport?.zoom === 'number' ? viewport.zoom : DEFAULT_VIEWPORT.zoom),
    panX: typeof viewport?.panX === 'number' ? viewport.panX : DEFAULT_VIEWPORT.panX,
    panY: typeof viewport?.panY === 'number' ? viewport.panY : DEFAULT_VIEWPORT.panY,
  };
}

function cloneNodes(nodes: BoardNode[]): BoardNode[] {
  return nodes.map((node) => ({ ...node }));
}

function createProject(count: number): Project {
  const title = `プロジェクト ${count}`;
  const nodes: BoardNode[] = [];
  return {
    id: crypto.randomUUID(),
    title,
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    lastOpenedAt: Date.now(),
    nodes,
    viewport: DEFAULT_VIEWPORT,
    lastSavedDocument: createProjectDocument({ title, nodes }),
  };
}

function createNodeId(): string {
  return crypto.randomUUID();
}

function isVerticalOverlapping(
  y: number,
  h: number,
  node: Pick<BoardNode, 'y' | 'height'>,
): boolean {
  return !(y + h <= node.y || node.y + node.height <= y);
}

function isHorizontalOverlapping(
  x: number,
  w: number,
  node: Pick<BoardNode, 'x' | 'width'>,
): boolean {
  return !(x + w <= node.x || node.x + node.width <= x);
}

function findNonOverlappingPosition(
  nodes: BoardNode[],
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (nodes.length === 0) {
    return { x, y };
  }

  for (let step = 0; step <= MAX_VERTICAL_SEARCH_STEPS; step++) {
    const yCandidates = step === 0 ? [0] : [step * PAGE_GAP, -step * PAGE_GAP];
    for (const yOffset of yCandidates) {
      const candidateY = y + yOffset;
      const sameRowNodes = nodes.filter((node) => isVerticalOverlapping(candidateY, height, node));

      if (sameRowNodes.length === 0) {
        return { x, y: candidateY };
      }

      let candidateX = x;
      while (true) {
        const overlapNodes = sameRowNodes.filter((node) =>
          isHorizontalOverlapping(candidateX, width, node),
        );
        if (overlapNodes.length === 0) {
          return { x: candidateX, y: candidateY };
        }

        const rightmost = Math.max(...overlapNodes.map((node) => node.x + node.width));
        candidateX = rightmost + PAGE_GAP;
      }
    }
  }

  const fallbackY = Math.max(...nodes.map((node) => node.y + node.height)) + PAGE_GAP;
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

function getProjectHistory(histories: ProjectNodeHistories, projectId: string): ProjectNodeHistory {
  return histories[projectId] ?? { past: [], future: [] };
}

function pushProjectHistory(
  histories: ProjectNodeHistories,
  projectId: string,
  nodes: BoardNode[],
): ProjectNodeHistories {
  const history = getProjectHistory(histories, projectId);
  const nextPast = [...history.past, cloneNodes(nodes)];
  if (nextPast.length > NODE_HISTORY_LIMIT) {
    nextPast.splice(0, nextPast.length - NODE_HISTORY_LIMIT);
  }
  return {
    ...histories,
    [projectId]: {
      past: nextPast,
      future: [],
    },
  };
}

function touchProjects(projects: Project[], id: string, timestamp = Date.now()): Project[] {
  return projects.map((project) =>
    project.id === id ? { ...project, lastOpenedAt: timestamp } : project,
  );
}

function getProjectWebviewRuntime(
  runtimes: ProjectWebviewRuntimes,
  projectId: string,
): ProjectWebviewRuntime {
  return runtimes[projectId] ?? { labelsByNodeId: {} };
}

function updateProjectWebviewRuntime(
  runtimes: ProjectWebviewRuntimes,
  projectId: string,
  updater: (runtime: ProjectWebviewRuntime) => ProjectWebviewRuntime | null,
): ProjectWebviewRuntimes {
  const current = getProjectWebviewRuntime(runtimes, projectId);
  const next = updater(current);
  if (!next) {
    if (!(projectId in runtimes)) return runtimes;
    const { [projectId]: _removed, ...rest } = runtimes;
    return rest;
  }
  if (next === current) return runtimes;
  return { ...runtimes, [projectId]: next };
}

function sanitizeNode(rawNode: Partial<BoardNode>): BoardNode {
  const type =
    rawNode.type === 'stickynote'
      ? 'stickynote'
      : rawNode.type === 'webpage'
        ? 'webpage'
        : undefined;
  const isSticky = type === 'stickynote';
  return {
    id: typeof rawNode.id === 'string' && rawNode.id ? rawNode.id : createNodeId(),
    type,
    title:
      typeof rawNode.title === 'string' && rawNode.title
        ? rawNode.title
        : isSticky
          ? 'Sticky Note'
          : '新規ページ',
    url: typeof rawNode.url === 'string' ? rawNode.url : '',
    addedUrl: typeof rawNode.addedUrl === 'string' ? rawNode.addedUrl : undefined,
    content: typeof rawNode.content === 'string' ? rawNode.content : isSticky ? '' : undefined,
    colorIndex:
      typeof rawNode.colorIndex === 'number' ? rawNode.colorIndex : isSticky ? 0 : undefined,
    x: typeof rawNode.x === 'number' ? rawNode.x : 0,
    y: typeof rawNode.y === 'number' ? rawNode.y : 0,
    width: typeof rawNode.width === 'number' ? rawNode.width : DEFAULT_PAGE_WIDTH,
    height: typeof rawNode.height === 'number' ? rawNode.height : DEFAULT_PAGE_HEIGHT,
  };
}

function sanitizeProject(rawProject: Partial<Project>, fallbackOrder: number): Project {
  const rawNodes = Array.isArray(rawProject?.nodes) ? rawProject.nodes : [];
  const title =
    typeof rawProject?.title === 'string' && rawProject.title
      ? rawProject.title
      : `プロジェクト ${fallbackOrder + 1}`;
  const nodes = rawNodes.map((node) => sanitizeNode(node));

  return {
    id: typeof rawProject?.id === 'string' && rawProject.id ? rawProject.id : crypto.randomUUID(),
    title,
    filePath:
      typeof rawProject?.filePath === 'string' && rawProject.filePath
        ? rawProject.filePath
        : undefined,
    sidebarWidth:
      typeof rawProject?.sidebarWidth === 'number'
        ? rawProject.sidebarWidth
        : SIDEBAR_DEFAULT_WIDTH,
    lastOpenedAt:
      typeof rawProject?.lastOpenedAt === 'number'
        ? rawProject.lastOpenedAt
        : Date.now() - fallbackOrder,
    nodes,
    viewport: sanitizeViewport(rawProject?.viewport),
    lastSavedDocument: sanitizeProjectDocument(rawProject?.lastSavedDocument, { title, nodes }),
  };
}

interface ProjectActions {
  createProject: () => void;
  openProject: (id: string) => void;
  closeProject: (id: string) => void;
  deleteProject: (id: string) => void;
  renameProject: (id: string, title: string) => void;
  setActive: (id: string) => void;
  reorderOpenProjects: (openIds: string[]) => void;
  updateSidebarWidth: (id: string, width: number) => void;
  importProjectFromFile: (document: SiteboardDocumentV1, filePath: string) => string;
  markProjectSaved: (projectId: string, filePath: string, document: SiteboardDocumentV1) => void;
  restoreProjectFromLastSaved: (projectId: string) => void;
  touchProjectLastOpened: (projectId: string) => void;
  addWebNode: (
    projectId: string,
    url?: string,
    options?: { x: number; y: number; width: number; height: number },
  ) => BoardNode | null;
  setWebNodeUrl: (projectId: string, nodeId: string, url: string) => void;
  removeNode: (projectId: string, nodeId: string) => void;
  updateNodePosition: (projectId: string, nodeId: string, x: number, y: number) => void;
  updateNodeSize: (projectId: string, nodeId: string, width: number, height: number) => void;
  updateNodeSizeWithoutHistory: (
    projectId: string,
    nodeId: string,
    width: number,
    height: number,
  ) => void;
  updateWebNodeUrl: (projectId: string, nodeId: string, url: string, title: string) => void;
  updateNodeTitle: (projectId: string, nodeId: string, title: string) => void;
  updateViewport: (projectId: string, viewport: Partial<Viewport>) => void;
  bringNodeToFront: (projectId: string, nodeId: string) => void;
  addStickyNoteNode: (
    projectId: string,
    options?: { x: number; y: number; width: number; height: number },
  ) => BoardNode | null;
  updateStickyNoteContent: (projectId: string, nodeId: string, content: string) => void;
  cycleStickyNoteColor: (projectId: string, nodeId: string) => void;
  pinWebNodeUrl: (projectId: string, nodeId: string) => void;
  setWebNodeWebviewLabel: (projectId: string, nodeId: string, label: string) => void;
  clearWebNodeWebviewLabel: (projectId: string, nodeId: string) => void;
  undoActiveProject: () => void;
  redoActiveProject: () => void;
  _restoreState: (state: ProjectState) => void;
  _setLoaded: () => void;
}

interface ProjectStore extends ProjectState, ProjectActions {
  isLoaded: boolean;
  nodeHistories: ProjectNodeHistories;
  webviewRuntime: ProjectWebviewRuntimes;
}

function replaceProjectNodes(
  state: ProjectStore,
  projectId: string,
  updater: (nodes: BoardNode[]) => BoardNode[] | null,
  historyMode: 'record' | 'skip' = 'record',
): ProjectStore | Pick<ProjectStore, 'projects' | 'nodeHistories'> {
  const projectIndex = state.projects.findIndex((project) => project.id === projectId);
  if (projectIndex === -1) return state;

  const project = state.projects[projectIndex];
  const nextNodes = updater(project.nodes);
  if (!nextNodes) return state;

  const nextProjects = [...state.projects];
  nextProjects[projectIndex] = { ...project, nodes: nextNodes };

  if (historyMode === 'skip') {
    return { projects: nextProjects, nodeHistories: state.nodeHistories };
  }

  return {
    projects: nextProjects,
    nodeHistories: pushProjectHistory(state.nodeHistories, projectId, project.nodes),
  };
}

export const useProjectStore = create<ProjectStore>()((set) => ({
  projects: [],
  openIds: [],
  activeId: HOME_ID,
  isLoaded: false,
  nodeHistories: {},
  webviewRuntime: {},

  createProject: () =>
    set((state) => {
      const now = Date.now();
      const newProject = { ...createProject(state.projects.length + 1), lastOpenedAt: now };
      return {
        projects: [...state.projects, newProject],
        openIds: [...state.openIds, newProject.id],
        activeId: newProject.id,
      };
    }),

  openProject: (id) =>
    set((state) => {
      const now = Date.now();
      const nextProjects = touchProjects(state.projects, id, now);
      if (state.openIds.includes(id)) {
        return { projects: nextProjects, activeId: id };
      }
      return { projects: nextProjects, openIds: [...state.openIds, id], activeId: id };
    }),

  closeProject: (id) =>
    set((state) => {
      const idx = state.openIds.indexOf(id);
      if (idx === -1) return state;
      const remaining = state.openIds.filter((projectId) => projectId !== id);
      const newActiveId =
        state.activeId === id ? resolveNextActiveId(idx, remaining) : state.activeId;
      return { openIds: remaining, activeId: newActiveId };
    }),

  deleteProject: (id) =>
    set((state) => {
      const openIdx = state.openIds.indexOf(id);
      const remainingOpenIds = state.openIds.filter((projectId) => projectId !== id);
      let newActiveId = state.activeId;
      if (state.activeId === id) {
        newActiveId = resolveNextActiveId(openIdx, remainingOpenIds);
      }
      const { [id]: _removedHistory, ...remainingHistories } = state.nodeHistories;
      const { [id]: _removedRuntime, ...remainingRuntime } = state.webviewRuntime;
      return {
        projects: state.projects.filter((project) => project.id !== id),
        openIds: remainingOpenIds,
        activeId: newActiveId,
        nodeHistories: remainingHistories,
        webviewRuntime: remainingRuntime,
      };
    }),

  renameProject: (id, title) =>
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === id ? { ...project, title } : project,
      ),
    })),

  setActive: (id) =>
    set((state) => {
      if (id === HOME_ID) {
        return { activeId: HOME_ID };
      }
      return { activeId: id, projects: touchProjects(state.projects, id) };
    }),

  reorderOpenProjects: (openIds) => set({ openIds }),

  updateSidebarWidth: (id, width) =>
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === id ? { ...project, sidebarWidth: width } : project,
      ),
    })),

  importProjectFromFile: (document, filePath) => {
    const now = Date.now();
    const nodes = document.nodes.map(documentNodeToBoardNode);
    const importedProject: Project = {
      id: crypto.randomUUID(),
      title: document.title,
      filePath,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      lastOpenedAt: now,
      nodes,
      viewport: DEFAULT_VIEWPORT,
      lastSavedDocument: createProjectDocument({ title: document.title, nodes }),
    };

    set((state) => ({
      projects: [...state.projects, importedProject],
      openIds: [...state.openIds, importedProject.id],
      activeId: importedProject.id,
    }));

    return importedProject.id;
  },

  markProjectSaved: (projectId, filePath, document) =>
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              filePath,
              lastSavedDocument: document,
            }
          : project,
      ),
    })),

  restoreProjectFromLastSaved: (projectId) =>
    set((state) => {
      const projectIndex = state.projects.findIndex((project) => project.id === projectId);
      if (projectIndex === -1) return state;

      const project = state.projects[projectIndex];
      const restoredNodes = project.lastSavedDocument.nodes.map(documentNodeToBoardNode);
      const nextProjects = [...state.projects];
      nextProjects[projectIndex] = {
        ...project,
        title: project.lastSavedDocument.title,
        nodes: restoredNodes,
      };
      const { [projectId]: _removedHistory, ...remainingHistories } = state.nodeHistories;
      const { [projectId]: _removedRuntime, ...remainingRuntime } = state.webviewRuntime;

      return {
        projects: nextProjects,
        nodeHistories: remainingHistories,
        webviewRuntime: remainingRuntime,
      };
    }),

  touchProjectLastOpened: (projectId) =>
    set((state) => ({
      projects: touchProjects(state.projects, projectId),
    })),

  addWebNode: (projectId, url = '', options) => {
    let createdNode: BoardNode | null = null;

    set((state) =>
      replaceProjectNodes(state, projectId, (nodes) => {
        let title = '新規ページ';
        if (url) {
          try {
            title = new URL(url).hostname;
          } catch {
            title = url;
          }
        }
        const newNodeBase: BoardNode = {
          id: createNodeId(),
          type: 'webpage',
          url,
          title,
          addedUrl: url || undefined,
          x: 0,
          y: 0,
          width: options?.width ?? DEFAULT_PAGE_WIDTH,
          height: options?.height ?? DEFAULT_PAGE_HEIGHT,
        };
        const positioned = findNonOverlappingPosition(
          nodes,
          options?.x ?? 0,
          options?.y ?? 0,
          newNodeBase.width,
          newNodeBase.height,
        );
        const newNode = {
          ...newNodeBase,
          x: positioned.x,
          y: positioned.y,
        };
        createdNode = newNode;
        return [...nodes, newNode];
      }),
    );

    return createdNode;
  },

  setWebNodeUrl: (projectId, nodeId, url) =>
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== projectId) return project;
        return {
          ...project,
          nodes: project.nodes.map((node) => {
            if (node.id !== nodeId) return node;
            let title = url;
            try {
              title = new URL(url).hostname;
            } catch {
              // パース失敗時はそのまま使用
            }
            return { ...node, url, addedUrl: url, title };
          }),
        };
      }),
    })),

  removeNode: (projectId, nodeId) =>
    set((state) => ({
      ...replaceProjectNodes(state, projectId, (nodes) => {
        if (!nodes.some((node) => node.id === nodeId)) return null;
        return nodes.filter((node) => node.id !== nodeId);
      }),
      webviewRuntime: updateProjectWebviewRuntime(state.webviewRuntime, projectId, (runtime) => {
        if (!(nodeId in runtime.labelsByNodeId)) return runtime;
        const { [nodeId]: _removedLabel, ...rest } = runtime.labelsByNodeId;
        if (Object.keys(rest).length === 0) {
          return null;
        }
        return { labelsByNodeId: rest };
      }),
    })),

  updateNodePosition: (projectId, nodeId, x, y) =>
    set((state) =>
      replaceProjectNodes(state, projectId, (nodes) => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (node.id !== nodeId) return node;
          if (node.x === x && node.y === y) return node;
          changed = true;
          return { ...node, x, y };
        });
        return changed ? nextNodes : null;
      }),
    ),

  updateNodeSize: (projectId, nodeId, width, height) =>
    set((state) =>
      replaceProjectNodes(state, projectId, (nodes) => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (node.id !== nodeId) return node;
          if (node.width === width && node.height === height) return node;
          changed = true;
          return { ...node, width, height };
        });
        return changed ? nextNodes : null;
      }),
    ),

  updateNodeSizeWithoutHistory: (projectId, nodeId, width, height) =>
    set((state) =>
      replaceProjectNodes(
        state,
        projectId,
        (nodes) => {
          let changed = false;
          const nextNodes = nodes.map((node) => {
            if (node.id !== nodeId) return node;
            if (node.width === width && node.height === height) return node;
            changed = true;
            return { ...node, width, height };
          });
          return changed ? nextNodes : null;
        },
        'skip',
      ),
    ),

  updateWebNodeUrl: (projectId, nodeId, url, title) =>
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== projectId) return project;
        return {
          ...project,
          nodes: project.nodes.map((node) => {
            if (node.id !== nodeId) return node;
            if (node.url === url && (node.title === title || !title)) return node;
            return { ...node, url, title: title || node.title };
          }),
        };
      }),
    })),

  updateNodeTitle: (projectId, nodeId, title) =>
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== projectId) return project;
        return {
          ...project,
          nodes: project.nodes.map((node) => {
            if (node.id !== nodeId || node.title === title) return node;
            return { ...node, title };
          }),
        };
      }),
    })),

  updateViewport: (projectId, viewport) =>
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== projectId) return project;
        const nextViewport =
          typeof viewport.zoom === 'number'
            ? { ...viewport, zoom: clampZoom(viewport.zoom) }
            : viewport;
        return { ...project, viewport: { ...project.viewport, ...nextViewport } };
      }),
    })),

  bringNodeToFront: (projectId, nodeId) =>
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== projectId) return project;
        const node = project.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) return project;
        if (project.nodes[project.nodes.length - 1]?.id === nodeId) return project;
        return {
          ...project,
          nodes: [...project.nodes.filter((candidate) => candidate.id !== nodeId), node],
        };
      }),
    })),

  addStickyNoteNode: (projectId, options) => {
    let createdNode: BoardNode | null = null;

    set((state) =>
      replaceProjectNodes(state, projectId, (nodes) => {
        const nextNode: BoardNode = {
          id: createNodeId(),
          type: 'stickynote',
          url: '',
          title: 'Sticky Note',
          content: '',
          colorIndex: 0,
          x: 0,
          y: 0,
          width: options?.width ?? DEFAULT_STICKY_NOTE_WIDTH,
          height: options?.height ?? DEFAULT_STICKY_NOTE_HEIGHT,
        };
        const positioned = findNonOverlappingPosition(
          nodes,
          options?.x ?? 0,
          options?.y ?? 0,
          nextNode.width,
          nextNode.height,
        );
        const newNode = { ...nextNode, x: positioned.x, y: positioned.y };
        createdNode = newNode;
        return [...nodes, newNode];
      }),
    );

    return createdNode;
  },

  updateStickyNoteContent: (projectId, nodeId, content) =>
    set((state) =>
      replaceProjectNodes(state, projectId, (nodes) => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (node.id !== nodeId) return node;
          if ((node.content ?? '') === content) return node;
          changed = true;
          return { ...node, content };
        });
        return changed ? nextNodes : null;
      }),
    ),

  cycleStickyNoteColor: (projectId, nodeId) =>
    set((state) =>
      replaceProjectNodes(state, projectId, (nodes) => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (node.id !== nodeId) return node;
          changed = true;
          return { ...node, colorIndex: ((node.colorIndex ?? 0) + 1) % 4 };
        });
        return changed ? nextNodes : null;
      }),
    ),

  pinWebNodeUrl: (projectId, nodeId) =>
    set((state) =>
      replaceProjectNodes(state, projectId, (nodes) => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (node.id !== nodeId) return node;
          if (!node.url || node.addedUrl === node.url) return node;
          changed = true;
          return { ...node, addedUrl: node.url };
        });
        return changed ? nextNodes : null;
      }),
    ),

  setWebNodeWebviewLabel: (projectId, nodeId, label) =>
    set((state) => ({
      webviewRuntime: updateProjectWebviewRuntime(state.webviewRuntime, projectId, (runtime) => {
        if (runtime.labelsByNodeId[nodeId] === label) return runtime;
        return {
          labelsByNodeId: {
            ...runtime.labelsByNodeId,
            [nodeId]: label,
          },
        };
      }),
    })),

  clearWebNodeWebviewLabel: (projectId, nodeId) =>
    set((state) => ({
      webviewRuntime: updateProjectWebviewRuntime(state.webviewRuntime, projectId, (runtime) => {
        if (!(nodeId in runtime.labelsByNodeId)) return runtime;
        const { [nodeId]: _removedLabel, ...rest } = runtime.labelsByNodeId;
        if (Object.keys(rest).length === 0) {
          return null;
        }
        return { labelsByNodeId: rest };
      }),
    })),

  undoActiveProject: () =>
    set((state) => {
      if (state.activeId === HOME_ID) return state;
      const projectId = state.activeId;
      const history = state.nodeHistories[projectId];
      if (!history || history.past.length === 0) return state;

      const projectIndex = state.projects.findIndex((project) => project.id === projectId);
      if (projectIndex === -1) return state;

      const project = state.projects[projectIndex];
      const previousNodes = history.past[history.past.length - 1];
      const nextPast = history.past.slice(0, -1);
      const nextFuture = [...history.future, cloneNodes(project.nodes)];
      const nextProjects = [...state.projects];
      nextProjects[projectIndex] = { ...project, nodes: cloneNodes(previousNodes) };

      return {
        projects: nextProjects,
        nodeHistories: {
          ...state.nodeHistories,
          [projectId]: {
            past: nextPast,
            future: nextFuture,
          },
        },
      };
    }),

  redoActiveProject: () =>
    set((state) => {
      if (state.activeId === HOME_ID) return state;
      const projectId = state.activeId;
      const history = state.nodeHistories[projectId];
      if (!history || history.future.length === 0) return state;

      const projectIndex = state.projects.findIndex((project) => project.id === projectId);
      if (projectIndex === -1) return state;

      const project = state.projects[projectIndex];
      const nextNodes = history.future[history.future.length - 1];
      const nextFuture = history.future.slice(0, -1);
      const nextPast = [...history.past, cloneNodes(project.nodes)];
      if (nextPast.length > NODE_HISTORY_LIMIT) {
        nextPast.splice(0, nextPast.length - NODE_HISTORY_LIMIT);
      }
      const nextProjects = [...state.projects];
      nextProjects[projectIndex] = { ...project, nodes: cloneNodes(nextNodes) };

      return {
        projects: nextProjects,
        nodeHistories: {
          ...state.nodeHistories,
          [projectId]: {
            past: nextPast,
            future: nextFuture,
          },
        },
      };
    }),

  _restoreState: (restoredState) =>
    set(() => {
      const rawProjects = Array.isArray(restoredState.projects) ? restoredState.projects : [];
      const restoredProjects = rawProjects.map((project, index) => sanitizeProject(project, index));
      const existingIds = new Set(restoredProjects.map((project) => project.id));
      const nextOpenIds = Array.isArray(restoredState.openIds)
        ? restoredState.openIds.filter(
            (id): id is string => typeof id === 'string' && existingIds.has(id),
          )
        : [];
      const nextActiveId =
        typeof restoredState.activeId === 'string' &&
        (restoredState.activeId === HOME_ID || existingIds.has(restoredState.activeId))
          ? restoredState.activeId
          : (nextOpenIds[0] ?? HOME_ID);

      return {
        projects: restoredProjects,
        openIds: nextOpenIds,
        activeId: nextActiveId,
        nodeHistories: {},
        webviewRuntime: {},
      };
    }),

  _setLoaded: () => set({ isLoaded: true }),
}));

export const selectActiveProject = (state: ProjectStore): Project | undefined =>
  state.projects.find((project) => project.id === state.activeId);

export const selectIsHome = (state: ProjectStore): boolean => state.activeId === HOME_ID;

const EMPTY_WEBVIEW_RUNTIME: ProjectWebviewRuntime = { labelsByNodeId: {} };

export const selectActiveProjectWebviewRuntime = (state: ProjectStore): ProjectWebviewRuntime => {
  if (state.activeId === HOME_ID) {
    return EMPTY_WEBVIEW_RUNTIME;
  }
  return state.webviewRuntime[state.activeId] ?? EMPTY_WEBVIEW_RUNTIME;
};
