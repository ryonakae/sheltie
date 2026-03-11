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
  documentEdgeToBoardEdge,
  documentNodeToBoardNode,
  sanitizeProjectDocument,
} from '@/lib/project-document';
import { getNodeFrameHeight, getNodeFrameRect } from '@/lib/siteboard-node-frame';
import {
  type BoardEdge,
  type BoardNode,
  type Project,
  type ProjectState,
  type ProjectWebviewRuntime,
  type SiteboardDocument,
  type Viewport,
} from '@/types';

const NODE_HISTORY_LIMIT = 100;

interface ProjectNodeHistory {
  past: ProjectHistorySnapshot[];
  future: ProjectHistorySnapshot[];
}

type ProjectNodeHistories = Record<string, ProjectNodeHistory>;
type ProjectWebviewRuntimes = Record<string, ProjectWebviewRuntime>;

interface ProjectHistorySnapshot {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

function createEmptyProjectWebviewRuntime(): ProjectWebviewRuntime {
  return {
    labelsByNodeId: {},
    screenshotUrlsByNodeId: {},
  };
}

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

function cloneEdges(edges: BoardEdge[]): BoardEdge[] {
  return edges.map((edge) => ({ ...edge }));
}

function cloneProjectHistorySnapshot(snapshot: ProjectHistorySnapshot): ProjectHistorySnapshot {
  return {
    nodes: cloneNodes(snapshot.nodes),
    edges: cloneEdges(snapshot.edges),
  };
}

function createProject(count: number): Project {
  const title = `プロジェクト ${count}`;
  const nodes: BoardNode[] = [];
  const edges: BoardEdge[] = [];
  return {
    id: crypto.randomUUID(),
    title,
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    lastOpenedAt: Date.now(),
    nodes,
    edges,
    viewport: DEFAULT_VIEWPORT,
    lastSavedDocument: createProjectDocument({ title, nodes, edges }),
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
  type: BoardNode['type'],
  x: number,
  y: number,
  width: number,
  height: number,
  zoom: number,
) {
  const existingRects = nodes.map((node) => getNodeFrameRect(node, zoom));
  const candidateFrameHeight = getNodeFrameHeight({ type, height }, zoom);

  if (nodes.length === 0) {
    return { x, y };
  }

  for (let step = 0; step <= MAX_VERTICAL_SEARCH_STEPS; step++) {
    const yCandidates = step === 0 ? [0] : [step * PAGE_GAP, -step * PAGE_GAP];
    for (const yOffset of yCandidates) {
      const candidateY = y + yOffset;
      const sameRowNodes = existingRects.filter((node) =>
        isVerticalOverlapping(candidateY, candidateFrameHeight, node),
      );

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

  const fallbackY = Math.max(...existingRects.map((node) => node.bottom)) + PAGE_GAP;
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
  snapshot: ProjectHistorySnapshot,
): ProjectNodeHistories {
  const history = getProjectHistory(histories, projectId);
  const nextPast = [...history.past, cloneProjectHistorySnapshot(snapshot)];
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
  return runtimes[projectId] ?? createEmptyProjectWebviewRuntime();
}

function isProjectWebviewRuntimeEmpty(runtime: ProjectWebviewRuntime): boolean {
  return (
    Object.keys(runtime.labelsByNodeId).length === 0 &&
    Object.keys(runtime.screenshotUrlsByNodeId).length === 0
  );
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

function sanitizeEdge(rawEdge: Partial<BoardEdge>): BoardEdge {
  return {
    id: typeof rawEdge.id === 'string' && rawEdge.id ? rawEdge.id : crypto.randomUUID(),
    source: typeof rawEdge.source === 'string' ? rawEdge.source : '',
    target: typeof rawEdge.target === 'string' ? rawEdge.target : '',
    sourceHandle: typeof rawEdge.sourceHandle === 'string' ? rawEdge.sourceHandle : undefined,
    targetHandle: typeof rawEdge.targetHandle === 'string' ? rawEdge.targetHandle : undefined,
    type: typeof rawEdge.type === 'string' ? rawEdge.type : undefined,
    label: typeof rawEdge.label === 'string' ? rawEdge.label : undefined,
  };
}

function sanitizeProject(rawProject: Partial<Project>, fallbackOrder: number): Project {
  const rawNodes = Array.isArray(rawProject?.nodes) ? rawProject.nodes : [];
  const rawEdges = Array.isArray(rawProject?.edges) ? rawProject.edges : [];
  const title =
    typeof rawProject?.title === 'string' && rawProject.title
      ? rawProject.title
      : `プロジェクト ${fallbackOrder + 1}`;
  const nodes = rawNodes.map((node) => sanitizeNode(node));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = rawEdges
    .map((edge) => sanitizeEdge(edge))
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

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
    edges,
    viewport: sanitizeViewport(rawProject?.viewport),
    lastSavedDocument: sanitizeProjectDocument(rawProject?.lastSavedDocument, {
      title,
      nodes,
      edges,
    }),
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
  importProjectFromFile: (document: SiteboardDocument, filePath: string) => string;
  markProjectSaved: (projectId: string, filePath: string, document: SiteboardDocument) => void;
  restoreProjectFromLastSaved: (projectId: string) => void;
  touchProjectLastOpened: (projectId: string) => void;
  addWebNode: (
    projectId: string,
    url?: string,
    options?: { x: number; y: number; width: number; height: number },
    zoom?: number,
  ) => BoardNode | null;
  setWebNodeUrl: (projectId: string, nodeId: string, url: string) => void;
  removeNode: (projectId: string, nodeId: string) => void;
  addEdge: (projectId: string, edge: BoardEdge) => BoardEdge | null;
  removeEdge: (projectId: string, edgeId: string) => void;
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
    zoom?: number,
  ) => BoardNode | null;
  updateStickyNoteContent: (projectId: string, nodeId: string, content: string) => void;
  cycleStickyNoteColor: (projectId: string, nodeId: string) => void;
  pinWebNodeUrl: (projectId: string, nodeId: string) => void;
  setWebNodeWebviewLabel: (projectId: string, nodeId: string, label: string) => void;
  clearWebNodeWebviewLabel: (projectId: string, nodeId: string) => void;
  hydrateProjectScreenshotUrls: (
    projectId: string,
    screenshotUrlsByNodeId: Record<string, string>,
  ) => void;
  setProjectScreenshotUrl: (projectId: string, nodeId: string, url: string) => void;
  clearProjectScreenshotUrl: (projectId: string, nodeId: string) => void;
  setProjectNodesWithoutHistory: (projectId: string, nodes: BoardNode[]) => void;
  setProjectEdgesWithoutHistory: (projectId: string, edges: BoardEdge[]) => void;
  recordProjectHistorySnapshot: (projectId: string, snapshot: ProjectHistorySnapshot) => void;
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
  updater: (project: Pick<Project, 'nodes' | 'edges'>) => ProjectHistorySnapshot | null,
  historyMode: 'record' | 'skip' = 'record',
): ProjectStore | Pick<ProjectStore, 'projects' | 'nodeHistories'> {
  const projectIndex = state.projects.findIndex((project) => project.id === projectId);
  if (projectIndex === -1) return state;

  const project = state.projects[projectIndex];
  const nextSnapshot = updater(project);
  if (!nextSnapshot) return state;

  const nextProjects = [...state.projects];
  nextProjects[projectIndex] = {
    ...project,
    nodes: nextSnapshot.nodes,
    edges: nextSnapshot.edges,
  };

  if (historyMode === 'skip') {
    return { projects: nextProjects, nodeHistories: state.nodeHistories };
  }

  return {
    projects: nextProjects,
    nodeHistories: pushProjectHistory(state.nodeHistories, projectId, {
      nodes: project.nodes,
      edges: project.edges,
    }),
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
    const edges = document.schemaVersion === 2 ? document.edges.map(documentEdgeToBoardEdge) : [];
    const importedProject: Project = {
      id: crypto.randomUUID(),
      title: document.title,
      filePath,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      lastOpenedAt: now,
      nodes,
      edges,
      viewport: DEFAULT_VIEWPORT,
      lastSavedDocument: createProjectDocument({ title: document.title, nodes, edges }),
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
      const restoredEdges =
        project.lastSavedDocument.schemaVersion === 2
          ? project.lastSavedDocument.edges.map(documentEdgeToBoardEdge)
          : [];
      const nextProjects = [...state.projects];
      nextProjects[projectIndex] = {
        ...project,
        title: project.lastSavedDocument.title,
        nodes: restoredNodes,
        edges: restoredEdges,
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

  addWebNode: (projectId, url = '', options, zoom = 1) => {
    let createdNode: BoardNode | null = null;

    set((state) =>
      replaceProjectNodes(state, projectId, ({ nodes, edges }) => {
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
          newNodeBase.type,
          options?.x ?? 0,
          options?.y ?? 0,
          newNodeBase.width,
          newNodeBase.height,
          zoom,
        );
        const newNode = {
          ...newNodeBase,
          x: positioned.x,
          y: positioned.y,
        };
        createdNode = newNode;
        return { nodes: [...nodes, newNode], edges: cloneEdges(edges) };
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
      ...replaceProjectNodes(state, projectId, ({ nodes, edges }) => {
        if (!nodes.some((node) => node.id === nodeId)) return null;
        return {
          nodes: nodes.filter((node) => node.id !== nodeId),
          edges: edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
        };
      }),
      webviewRuntime: updateProjectWebviewRuntime(state.webviewRuntime, projectId, (runtime) => {
        if (!(nodeId in runtime.labelsByNodeId) && !(nodeId in runtime.screenshotUrlsByNodeId)) {
          return runtime;
        }
        const { [nodeId]: _removedLabel, ...remainingLabels } = runtime.labelsByNodeId;
        const { [nodeId]: _removedScreenshot, ...remainingScreenshotUrls } =
          runtime.screenshotUrlsByNodeId;
        const nextRuntime = {
          labelsByNodeId: remainingLabels,
          screenshotUrlsByNodeId: remainingScreenshotUrls,
        };
        if (isProjectWebviewRuntimeEmpty(nextRuntime)) {
          return null;
        }
        return nextRuntime;
      }),
    })),

  addEdge: (projectId, edge) => {
    let createdEdge: BoardEdge | null = null;

    set((state) =>
      replaceProjectNodes(state, projectId, ({ nodes, edges }) => {
        if (
          !nodes.some((node) => node.id === edge.source) ||
          !nodes.some((node) => node.id === edge.target)
        ) {
          return null;
        }

        const nextEdge = sanitizeEdge({
          ...edge,
          id: edge.id || crypto.randomUUID(),
        });
        createdEdge = nextEdge;
        return { nodes: cloneNodes(nodes), edges: [...edges, nextEdge] };
      }),
    );

    return createdEdge;
  },

  removeEdge: (projectId, edgeId) =>
    set((state) =>
      replaceProjectNodes(state, projectId, ({ nodes, edges }) => {
        if (!edges.some((edge) => edge.id === edgeId)) return null;
        return {
          nodes: cloneNodes(nodes),
          edges: edges.filter((edge) => edge.id !== edgeId),
        };
      }),
    ),

  updateNodePosition: (projectId, nodeId, x, y) =>
    set((state) =>
      replaceProjectNodes(state, projectId, ({ nodes, edges }) => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (node.id !== nodeId) return node;
          if (node.x === x && node.y === y) return node;
          changed = true;
          return { ...node, x, y };
        });
        return changed ? { nodes: nextNodes, edges: cloneEdges(edges) } : null;
      }),
    ),

  updateNodeSize: (projectId, nodeId, width, height) =>
    set((state) =>
      replaceProjectNodes(state, projectId, ({ nodes, edges }) => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (node.id !== nodeId) return node;
          if (node.width === width && node.height === height) return node;
          changed = true;
          return { ...node, width, height };
        });
        return changed ? { nodes: nextNodes, edges: cloneEdges(edges) } : null;
      }),
    ),

  updateNodeSizeWithoutHistory: (projectId, nodeId, width, height) =>
    set((state) =>
      replaceProjectNodes(
        state,
        projectId,
        ({ nodes, edges }) => {
          let changed = false;
          const nextNodes = nodes.map((node) => {
            if (node.id !== nodeId) return node;
            if (node.width === width && node.height === height) return node;
            changed = true;
            return { ...node, width, height };
          });
          return changed ? { nodes: nextNodes, edges: cloneEdges(edges) } : null;
        },
        'skip',
      ),
    ),

  updateWebNodeUrl: (projectId, nodeId, url, title) =>
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== projectId) return project;
        // map 前にターゲットノードを確認し、値が変わらない場合は project の参照を保持する。
        // これにより Siteboard コンポーネントの不要な再レンダリングを防ぐ。
        const target = project.nodes.find((n) => n.id === nodeId);
        if (!target) return project;
        if (target.url === url && (target.title === title || !title)) return project;
        return {
          ...project,
          nodes: project.nodes.map((node) => {
            if (node.id !== nodeId) return node;
            return { ...node, url, title: title || node.title };
          }),
        };
      }),
    })),

  updateNodeTitle: (projectId, nodeId, title) =>
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== projectId) return project;
        const target = project.nodes.find((n) => n.id === nodeId);
        if (!target || target.title === title) return project;
        return {
          ...project,
          nodes: project.nodes.map((node) => {
            if (node.id !== nodeId) return node;
            return { ...node, title };
          }),
        };
      }),
    })),

  updateViewport: (projectId, viewport) =>
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== projectId) return project;

        const nextViewport = {
          zoom:
            typeof viewport.zoom === 'number' ? clampZoom(viewport.zoom) : project.viewport.zoom,
          panX: typeof viewport.panX === 'number' ? viewport.panX : project.viewport.panX,
          panY: typeof viewport.panY === 'number' ? viewport.panY : project.viewport.panY,
        };

        if (
          project.viewport.zoom === nextViewport.zoom &&
          project.viewport.panX === nextViewport.panX &&
          project.viewport.panY === nextViewport.panY
        ) {
          return project;
        }

        return { ...project, viewport: nextViewport };
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

  addStickyNoteNode: (projectId, options, zoom = 1) => {
    let createdNode: BoardNode | null = null;

    set((state) =>
      replaceProjectNodes(state, projectId, ({ nodes, edges }) => {
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
          nextNode.type,
          options?.x ?? 0,
          options?.y ?? 0,
          nextNode.width,
          nextNode.height,
          zoom,
        );
        const newNode = { ...nextNode, x: positioned.x, y: positioned.y };
        createdNode = newNode;
        return { nodes: [...nodes, newNode], edges: cloneEdges(edges) };
      }),
    );

    return createdNode;
  },

  updateStickyNoteContent: (projectId, nodeId, content) =>
    set((state) =>
      replaceProjectNodes(state, projectId, ({ nodes, edges }) => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (node.id !== nodeId) return node;
          if ((node.content ?? '') === content) return node;
          changed = true;
          return { ...node, content };
        });
        return changed ? { nodes: nextNodes, edges: cloneEdges(edges) } : null;
      }),
    ),

  cycleStickyNoteColor: (projectId, nodeId) =>
    set((state) =>
      replaceProjectNodes(state, projectId, ({ nodes, edges }) => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (node.id !== nodeId) return node;
          changed = true;
          return { ...node, colorIndex: ((node.colorIndex ?? 0) + 1) % 4 };
        });
        return changed ? { nodes: nextNodes, edges: cloneEdges(edges) } : null;
      }),
    ),

  pinWebNodeUrl: (projectId, nodeId) =>
    set((state) =>
      replaceProjectNodes(state, projectId, ({ nodes, edges }) => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (node.id !== nodeId) return node;
          if (!node.url || node.addedUrl === node.url) return node;
          changed = true;
          return { ...node, addedUrl: node.url };
        });
        return changed ? { nodes: nextNodes, edges: cloneEdges(edges) } : null;
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
          screenshotUrlsByNodeId: runtime.screenshotUrlsByNodeId,
        };
      }),
    })),

  clearWebNodeWebviewLabel: (projectId, nodeId) =>
    set((state) => ({
      webviewRuntime: updateProjectWebviewRuntime(state.webviewRuntime, projectId, (runtime) => {
        if (!(nodeId in runtime.labelsByNodeId)) return runtime;
        const { [nodeId]: _removedLabel, ...rest } = runtime.labelsByNodeId;
        const nextRuntime = {
          labelsByNodeId: rest,
          screenshotUrlsByNodeId: runtime.screenshotUrlsByNodeId,
        };
        if (isProjectWebviewRuntimeEmpty(nextRuntime)) {
          return null;
        }
        return nextRuntime;
      }),
    })),

  hydrateProjectScreenshotUrls: (projectId, screenshotUrlsByNodeId) =>
    set((state) => ({
      webviewRuntime: updateProjectWebviewRuntime(state.webviewRuntime, projectId, (runtime) => {
        let changed = false;
        const nextScreenshotUrls = { ...runtime.screenshotUrlsByNodeId };

        for (const [nodeId, url] of Object.entries(screenshotUrlsByNodeId)) {
          if (!url || nextScreenshotUrls[nodeId] === url) continue;
          nextScreenshotUrls[nodeId] = url;
          changed = true;
        }

        if (!changed) return runtime;
        return {
          labelsByNodeId: runtime.labelsByNodeId,
          screenshotUrlsByNodeId: nextScreenshotUrls,
        };
      }),
    })),

  setProjectScreenshotUrl: (projectId, nodeId, url) =>
    set((state) => ({
      webviewRuntime: updateProjectWebviewRuntime(state.webviewRuntime, projectId, (runtime) => {
        if (runtime.screenshotUrlsByNodeId[nodeId] === url) return runtime;
        return {
          labelsByNodeId: runtime.labelsByNodeId,
          screenshotUrlsByNodeId: {
            ...runtime.screenshotUrlsByNodeId,
            [nodeId]: url,
          },
        };
      }),
    })),

  clearProjectScreenshotUrl: (projectId, nodeId) =>
    set((state) => ({
      webviewRuntime: updateProjectWebviewRuntime(state.webviewRuntime, projectId, (runtime) => {
        if (!(nodeId in runtime.screenshotUrlsByNodeId)) return runtime;
        const { [nodeId]: _removedScreenshot, ...rest } = runtime.screenshotUrlsByNodeId;
        const nextRuntime = {
          labelsByNodeId: runtime.labelsByNodeId,
          screenshotUrlsByNodeId: rest,
        };
        if (isProjectWebviewRuntimeEmpty(nextRuntime)) {
          return null;
        }
        return nextRuntime;
      }),
    })),

  setProjectNodesWithoutHistory: (projectId, nodes) =>
    set((state) =>
      replaceProjectNodes(
        state,
        projectId,
        ({ edges }) => ({
          nodes: [...nodes],
          edges: cloneEdges(edges),
        }),
        'skip',
      ),
    ),

  setProjectEdgesWithoutHistory: (projectId, edges) =>
    set((state) =>
      replaceProjectNodes(
        state,
        projectId,
        ({ nodes }) => ({
          nodes: cloneNodes(nodes),
          edges: [...edges],
        }),
        'skip',
      ),
    ),

  recordProjectHistorySnapshot: (projectId, snapshot) =>
    set((state) => {
      const projectExists = state.projects.some((project) => project.id === projectId);
      if (!projectExists) return state;
      return {
        nodeHistories: pushProjectHistory(state.nodeHistories, projectId, snapshot),
      };
    }),

  undoActiveProject: () =>
    set((state) => {
      if (state.activeId === HOME_ID) return state;
      const projectId = state.activeId;
      const history = state.nodeHistories[projectId];
      if (!history || history.past.length === 0) return state;

      const projectIndex = state.projects.findIndex((project) => project.id === projectId);
      if (projectIndex === -1) return state;

      const project = state.projects[projectIndex];
      const previousSnapshot = history.past[history.past.length - 1];
      const nextPast = history.past.slice(0, -1);
      const nextFuture = [
        ...history.future,
        cloneProjectHistorySnapshot({ nodes: project.nodes, edges: project.edges }),
      ];
      const nextProjects = [...state.projects];
      nextProjects[projectIndex] = {
        ...project,
        nodes: cloneNodes(previousSnapshot.nodes),
        edges: cloneEdges(previousSnapshot.edges),
      };

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
      const nextSnapshot = history.future[history.future.length - 1];
      const nextFuture = history.future.slice(0, -1);
      const nextPast = [
        ...history.past,
        cloneProjectHistorySnapshot({ nodes: project.nodes, edges: project.edges }),
      ];
      if (nextPast.length > NODE_HISTORY_LIMIT) {
        nextPast.splice(0, nextPast.length - NODE_HISTORY_LIMIT);
      }
      const nextProjects = [...state.projects];
      nextProjects[projectIndex] = {
        ...project,
        nodes: cloneNodes(nextSnapshot.nodes),
        edges: cloneEdges(nextSnapshot.edges),
      };

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

const EMPTY_WEBVIEW_RUNTIME: ProjectWebviewRuntime = createEmptyProjectWebviewRuntime();
const EMPTY_LABELS: Record<string, string> = {};
const EMPTY_SCREENSHOT_URLS: Record<string, string> = {};

export const selectActiveProjectWebviewRuntime = (state: ProjectStore): ProjectWebviewRuntime => {
  if (state.activeId === HOME_ID) {
    return EMPTY_WEBVIEW_RUNTIME;
  }
  return state.webviewRuntime[state.activeId] ?? EMPTY_WEBVIEW_RUNTIME;
};

/** webviewLabel のみを購読するセレクター。スクリーンショット更新で再レンダリングしない */
export const selectActiveProjectWebviewLabels = (state: ProjectStore): Record<string, string> => {
  if (state.activeId === HOME_ID) return EMPTY_LABELS;
  return state.webviewRuntime[state.activeId]?.labelsByNodeId ?? EMPTY_LABELS;
};

/** screenshotUrl のみを購読するセレクター（初期シード用途。スクリーンショット更新で変化する） */
export const selectActiveProjectScreenshotUrls = (state: ProjectStore): Record<string, string> => {
  if (state.activeId === HOME_ID) return EMPTY_SCREENSHOT_URLS;
  return state.webviewRuntime[state.activeId]?.screenshotUrlsByNodeId ?? EMPTY_SCREENSHOT_URLS;
};
