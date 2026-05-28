import { create } from 'zustand';

import {
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  DEFAULT_STICKY_NOTE_HEIGHT,
  DEFAULT_STICKY_NOTE_WIDTH,
  DEFAULT_TEXT_NODE_HEIGHT,
  DEFAULT_TEXT_NODE_WIDTH,
  DEFAULT_VIEWPORT,
  MAX_VERTICAL_SEARCH_STEPS,
  MAX_ZOOM,
  MIN_ZOOM,
  PAGE_GAP,
} from '@/constants';
import {
  documentEdgeToBoardEdge,
  documentNodeToBoardNode,
  sanitizeProjectDocument,
} from '@/lib/project-document';
import { getNodeFrameHeight, getNodeFrameRect } from '@/lib/siteboard-node-frame';
import type {
  BoardEdge,
  BoardNode,
  Project,
  ProjectState,
  ProjectWebviewRuntime,
  SiteboardDocumentV2,
  TextNodeFontSizePreset,
  Viewport,
} from '@/types';
import { isWebPageNode } from '@/types';

const HISTORY_LIMIT = 100;

interface ProjectSnapshot {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

interface ProjectHistory {
  past: ProjectSnapshot[];
  future: ProjectSnapshot[];
}

interface ProjectActions {
  initializeProject: (params: {
    filePath?: string;
    untitledIndex: number;
    document?: SiteboardDocumentV2;
  }) => void;
  markProjectSaved: (filePath: string, document: SiteboardDocumentV2) => void;
  restoreProjectFromLastSaved: () => void;
  addWebNode: (
    url?: string,
    options?: { x: number; y: number; width: number; height: number },
    zoom?: number,
  ) => BoardNode | null;
  setWebNodeUrl: (nodeId: string, url: string) => void;
  changeWebNodeUrl: (nodeId: string, url: string) => void;
  removeNode: (nodeId: string) => void;
  updateNodePosition: (nodeId: string, x: number, y: number) => void;
  updateNodeSize: (nodeId: string, width: number, height: number) => void;
  updateNodeBounds: (nodeId: string, x: number, y: number, width: number, height: number) => void;
  updateNodeSizeWithoutHistory: (nodeId: string, width: number, height: number) => void;
  updateWebNodeUrl: (nodeId: string, url: string, title: string) => void;
  updateNodeTitle: (nodeId: string, title: string) => void;
  updateViewport: (viewport: Partial<Viewport>) => void;
  bringNodeToFront: (nodeId: string) => void;
  sendNodeToBack: (nodeId: string) => void;
  bringNodeForward: (nodeId: string) => void;
  sendNodeBackward: (nodeId: string) => void;
  addStickyNoteNode: (
    options?: { x: number; y: number; width: number; height: number },
    zoom?: number,
  ) => BoardNode | null;
  updateStickyNoteContent: (nodeId: string, content: string) => void;
  cycleStickyNoteColor: (nodeId: string) => void;
  addTextNode: (
    options?: { x: number; y: number; width: number; height: number },
    zoom?: number,
  ) => BoardNode | null;
  updateTextNodeContent: (nodeId: string, tiptapContent: object) => void;
  updateTextNodeStyle: (
    nodeId: string,
    style: {
      fontSizePreset?: TextNodeFontSizePreset;
      fontWeight?: 'normal' | 'bold';
      italic?: boolean;
      strikethrough?: boolean;
      textColorIndex?: number;
    },
  ) => void;
  updateTextNodeWidthMode: (nodeId: string, widthMode: 'auto' | 'fixed') => void;
  addEdge: (edge: BoardEdge) => void;
  removeEdges: (edgeIds: string[]) => void;
  pinWebNodeUrl: (nodeId: string) => void;
  setWebNodeWebviewLabel: (nodeId: string, label: string) => void;
  clearWebNodeWebviewLabel: (nodeId: string) => void;
  hydrateProjectScreenshotUrls: (screenshotUrlsByNodeId: Record<string, string>) => void;
  setProjectScreenshotUrl: (nodeId: string, url: string) => void;
  clearProjectScreenshotUrl: (nodeId: string) => void;
  undoProject: () => void;
  redoProject: () => void;
  _setLoaded: () => void;
}

interface ProjectStore extends ProjectState, ProjectActions {
  isLoaded: boolean;
  history: ProjectHistory;
  webviewRuntime: ProjectWebviewRuntime;
}

function createEmptyProjectWebviewRuntime(): ProjectWebviewRuntime {
  return {
    labelsByNodeId: {},
    screenshotUrlsByNodeId: {},
  };
}

function cloneNodes(nodes: BoardNode[]): BoardNode[] {
  return nodes.map((node) => ({ ...node }));
}

function cloneEdges(edges: BoardEdge[]): BoardEdge[] {
  return edges.map((edge) => ({ ...edge }));
}

function cloneSnapshot(snapshot: { nodes: BoardNode[]; edges: BoardEdge[] }): ProjectSnapshot {
  return { nodes: cloneNodes(snapshot.nodes), edges: cloneEdges(snapshot.edges) };
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function createProject(params: {
  filePath?: string;
  untitledIndex: number;
  document?: SiteboardDocumentV2;
}): Project {
  const nodes = params.document?.nodes.map(documentNodeToBoardNode) ?? [];
  const edges = params.document?.edges?.map(documentEdgeToBoardEdge) ?? [];

  return {
    id: crypto.randomUUID(),
    filePath: params.filePath,
    untitledIndex: params.untitledIndex,
    nodes,
    edges,
    viewport: DEFAULT_VIEWPORT,
    lastSavedDocument: sanitizeProjectDocument(params.document, { nodes, edges }),
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
  options?: { keepY?: boolean },
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
      if (options?.keepY) {
        const sameRowNodes = existingRects.filter((node) =>
          isVerticalOverlapping(candidateY, candidateFrameHeight, node),
        );
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

function pushHistory(
  history: ProjectHistory,
  snapshot: { nodes: BoardNode[]; edges: BoardEdge[] },
): ProjectHistory {
  const nextPast = [...history.past, cloneSnapshot(snapshot)];
  if (nextPast.length > HISTORY_LIMIT) {
    nextPast.splice(0, nextPast.length - HISTORY_LIMIT);
  }
  return {
    past: nextPast,
    future: [],
  };
}

function replaceProjectNodes(
  state: ProjectStore,
  updater: (nodes: BoardNode[]) => BoardNode[] | null,
  historyMode: 'record' | 'skip' = 'record',
): ProjectStore | Pick<ProjectStore, 'project' | 'history'> {
  if (!state.project) return state;

  const nextNodes = updater(state.project.nodes);
  if (!nextNodes) return state;

  const nextProject = { ...state.project, nodes: nextNodes };
  if (historyMode === 'skip') {
    return { project: nextProject, history: state.history };
  }

  return {
    project: nextProject,
    history: pushHistory(state.history, {
      nodes: state.project.nodes,
      edges: state.project.edges,
    }),
  };
}

function replaceProjectEdges(
  state: ProjectStore,
  updater: (edges: BoardEdge[]) => BoardEdge[] | null,
): ProjectStore | Pick<ProjectStore, 'project' | 'history'> {
  if (!state.project) return state;

  const nextEdges = updater(state.project.edges);
  if (!nextEdges) return state;

  return {
    project: { ...state.project, edges: nextEdges },
    history: pushHistory(state.history, {
      nodes: state.project.nodes,
      edges: state.project.edges,
    }),
  };
}

export const useProjectStore = create<ProjectStore>()((set) => ({
  project: null,
  isLoaded: false,
  history: { past: [], future: [] },
  webviewRuntime: createEmptyProjectWebviewRuntime(),

  initializeProject: (params) =>
    set({
      project: createProject(params),
      history: { past: [], future: [] },
      webviewRuntime: createEmptyProjectWebviewRuntime(),
    }),

  markProjectSaved: (filePath, document) =>
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            filePath,
            lastSavedDocument: document,
          }
        : null,
    })),

  restoreProjectFromLastSaved: () =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          nodes: state.project.lastSavedDocument.nodes.map(documentNodeToBoardNode),
          edges: state.project.lastSavedDocument.edges?.map(documentEdgeToBoardEdge) ?? [],
        },
        history: { past: [], future: [] },
        webviewRuntime: createEmptyProjectWebviewRuntime(),
      };
    }),

  addWebNode: (url = '', options, zoom = 1) => {
    let createdNode: BoardNode | null = null;

    set((state) =>
      replaceProjectNodes(state, (nodes) => {
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
          { keepY: true },
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

  setWebNodeUrl: (nodeId, url) =>
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            nodes: state.project.nodes.map((node) => {
              if (node.id !== nodeId) return node;
              let title = url;
              try {
                title = new URL(url).hostname;
              } catch {
                // URL パース失敗時はそのまま使用
              }
              return { ...node, url, addedUrl: url, title };
            }),
          }
        : null,
    })),

  changeWebNodeUrl: (nodeId, url) =>
    set((state) => {
      if (!state.project) return state;

      let title = url;
      try {
        title = new URL(url).hostname;
      } catch {
        // URL パース失敗時はそのまま使用
      }

      return {
        ...replaceProjectNodes(state, (nodes) => {
          return nodes.map((node) => {
            if (node.id !== nodeId) return node;
            return { ...node, url, addedUrl: url, title };
          });
        }),
        webviewRuntime: {
          labelsByNodeId: Object.fromEntries(
            Object.entries(state.webviewRuntime.labelsByNodeId).filter(([id]) => id !== nodeId),
          ),
          screenshotUrlsByNodeId: Object.fromEntries(
            Object.entries(state.webviewRuntime.screenshotUrlsByNodeId).filter(
              ([id]) => id !== nodeId,
            ),
          ),
        },
      };
    }),

  removeNode: (nodeId) =>
    set((state) => {
      if (!state.project) return state;
      const hasNode = state.project.nodes.some((node) => node.id === nodeId);
      if (!hasNode) return state;

      const nextNodes = state.project.nodes.filter((node) => node.id !== nodeId);
      const nextEdges = state.project.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId,
      );

      return {
        project: { ...state.project, nodes: nextNodes, edges: nextEdges },
        history: pushHistory(state.history, {
          nodes: state.project.nodes,
          edges: state.project.edges,
        }),
        webviewRuntime: {
          labelsByNodeId: Object.fromEntries(
            Object.entries(state.webviewRuntime.labelsByNodeId).filter(([id]) => id !== nodeId),
          ),
          screenshotUrlsByNodeId: Object.fromEntries(
            Object.entries(state.webviewRuntime.screenshotUrlsByNodeId).filter(
              ([id]) => id !== nodeId,
            ),
          ),
        },
      };
    }),

  updateNodePosition: (nodeId, x, y) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) => {
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

  updateNodeSize: (nodeId, width, height) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) => {
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

  updateNodeBounds: (nodeId, x, y, width, height) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (node.id !== nodeId) return node;
          if (node.x === x && node.y === y && node.width === width && node.height === height) {
            return node;
          }
          changed = true;
          return { ...node, x, y, width, height };
        });
        return changed ? nextNodes : null;
      }),
    ),

  updateNodeSizeWithoutHistory: (nodeId, width, height) =>
    set((state) =>
      replaceProjectNodes(
        state,
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

  updateWebNodeUrl: (nodeId, url, title) =>
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            nodes: state.project.nodes.map((node) => {
              if (node.id !== nodeId) return node;
              if (node.url === url && (node.title === title || !title)) return node;
              return { ...node, url, title: title || node.title };
            }),
          }
        : null,
    })),

  updateNodeTitle: (nodeId, title) =>
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            nodes: state.project.nodes.map((node) => {
              if (node.id !== nodeId || node.title === title) return node;
              return { ...node, title };
            }),
          }
        : null,
    })),

  updateViewport: (viewport) =>
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            viewport: {
              ...state.project.viewport,
              ...viewport,
              ...(typeof viewport.zoom === 'number' ? { zoom: clampZoom(viewport.zoom) } : {}),
            },
          }
        : null,
    })),

  bringNodeToFront: (nodeId) =>
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            nodes: (() => {
              const { nodes } = state.project;
              const node = nodes.find((n) => n.id === nodeId);
              if (!node) return nodes;
              if (nodes[nodes.length - 1]?.id === nodeId) return nodes;
              return [...nodes.filter((n) => n.id !== nodeId), node];
            })(),
          }
        : null,
    })),

  sendNodeToBack: (nodeId) =>
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            nodes: (() => {
              const { nodes } = state.project;
              const node = nodes.find((n) => n.id === nodeId);
              if (!node) return nodes;
              if (nodes[0]?.id === nodeId) return nodes;
              return [node, ...nodes.filter((n) => n.id !== nodeId)];
            })(),
          }
        : null,
    })),

  bringNodeForward: (nodeId) =>
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            nodes: (() => {
              const { nodes } = state.project;
              const idx = nodes.findIndex((n) => n.id === nodeId);
              if (idx === -1 || idx === nodes.length - 1) return nodes;
              const node = nodes[idx];
              if (isWebPageNode(node)) return nodes;
              // WebPageNode をスキップして次の付箋/テキストを探す
              let swapIdx = -1;
              for (let i = idx + 1; i < nodes.length; i++) {
                if (!isWebPageNode(nodes[i])) {
                  swapIdx = i;
                  break;
                }
              }
              if (swapIdx === -1) return nodes;
              const result = [...nodes];
              // 対象ノードを取り出し、スワップ先の直後に挿入
              result.splice(idx, 1);
              result.splice(swapIdx, 0, node);
              return result;
            })(),
          }
        : null,
    })),

  sendNodeBackward: (nodeId) =>
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            nodes: (() => {
              const { nodes } = state.project;
              const idx = nodes.findIndex((n) => n.id === nodeId);
              if (idx <= 0) return nodes;
              const node = nodes[idx];
              if (isWebPageNode(node)) return nodes;
              // WebPageNode をスキップして前の付箋/テキストを探す
              let swapIdx = -1;
              for (let i = idx - 1; i >= 0; i--) {
                if (!isWebPageNode(nodes[i])) {
                  swapIdx = i;
                  break;
                }
              }
              if (swapIdx === -1) return nodes;
              const result = [...nodes];
              result.splice(idx, 1);
              result.splice(swapIdx, 0, node);
              return result;
            })(),
          }
        : null,
    })),

  addStickyNoteNode: (options, zoom = 1) => {
    let createdNode: BoardNode | null = null;

    set((state) =>
      replaceProjectNodes(state, (nodes) => {
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
        return [...nodes, newNode];
      }),
    );

    return createdNode;
  },

  updateStickyNoteContent: (nodeId, content) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) => {
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

  cycleStickyNoteColor: (nodeId) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (node.id !== nodeId) return node;
          changed = true;
          return { ...node, colorIndex: ((node.colorIndex ?? 0) + 1) % 4 };
        });
        return changed ? nextNodes : null;
      }),
    ),

  addTextNode: (options, zoom = 1) => {
    let createdNode: BoardNode | null = null;

    set((state) =>
      replaceProjectNodes(state, (nodes) => {
        const nextNode: BoardNode = {
          id: createNodeId(),
          type: 'text',
          url: '',
          title: 'Text',
          tiptapContent: undefined,
          fontSizePreset: 1,
          fontWeight: 'normal',
          italic: false,
          strikethrough: false,
          textColorIndex: 0,
          widthMode: 'auto',
          x: 0,
          y: 0,
          width: options?.width ?? DEFAULT_TEXT_NODE_WIDTH,
          height: options?.height ?? DEFAULT_TEXT_NODE_HEIGHT,
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
        return [...nodes, newNode];
      }),
    );

    return createdNode;
  },

  updateTextNodeContent: (nodeId, tiptapContent) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (node.id !== nodeId) return node;
          changed = true;
          return { ...node, tiptapContent };
        });
        return changed ? nextNodes : null;
      }),
    ),

  updateTextNodeStyle: (nodeId, style) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (node.id !== nodeId) return node;
          changed = true;
          return { ...node, ...style };
        });
        return changed ? nextNodes : null;
      }),
    ),

  updateTextNodeWidthMode: (nodeId, widthMode) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (node.id !== nodeId) return node;
          if (node.widthMode === widthMode) return node;
          changed = true;
          return { ...node, widthMode };
        });
        return changed ? nextNodes : null;
      }),
    ),

  pinWebNodeUrl: (nodeId) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) => {
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

  addEdge: (edge) =>
    set((state) =>
      replaceProjectEdges(state, (edges) => {
        const exists = edges.some(
          (e) =>
            e.source === edge.source &&
            e.sourceHandle === edge.sourceHandle &&
            e.target === edge.target &&
            e.targetHandle === edge.targetHandle,
        );
        if (exists) return null;
        return [...edges, edge];
      }),
    ),

  removeEdges: (edgeIds) =>
    set((state) =>
      replaceProjectEdges(state, (edges) => {
        const idSet = new Set(edgeIds);
        const nextEdges = edges.filter((e) => !idSet.has(e.id));
        return nextEdges.length === edges.length ? null : nextEdges;
      }),
    ),

  setWebNodeWebviewLabel: (nodeId, label) =>
    set((state) => ({
      webviewRuntime:
        state.webviewRuntime.labelsByNodeId[nodeId] === label
          ? state.webviewRuntime
          : {
              ...state.webviewRuntime,
              labelsByNodeId: {
                ...state.webviewRuntime.labelsByNodeId,
                [nodeId]: label,
              },
            },
    })),

  clearWebNodeWebviewLabel: (nodeId) =>
    set((state) => ({
      webviewRuntime: {
        ...state.webviewRuntime,
        labelsByNodeId: Object.fromEntries(
          Object.entries(state.webviewRuntime.labelsByNodeId).filter(([id]) => id !== nodeId),
        ),
      },
    })),

  hydrateProjectScreenshotUrls: (screenshotUrlsByNodeId) =>
    set((state) => ({
      webviewRuntime: {
        ...state.webviewRuntime,
        screenshotUrlsByNodeId: {
          ...state.webviewRuntime.screenshotUrlsByNodeId,
          ...screenshotUrlsByNodeId,
        },
      },
    })),

  setProjectScreenshotUrl: (nodeId, url) =>
    set((state) => ({
      webviewRuntime: {
        ...state.webviewRuntime,
        screenshotUrlsByNodeId: {
          ...state.webviewRuntime.screenshotUrlsByNodeId,
          [nodeId]: url,
        },
      },
    })),

  clearProjectScreenshotUrl: (nodeId) =>
    set((state) => ({
      webviewRuntime: {
        ...state.webviewRuntime,
        screenshotUrlsByNodeId: Object.fromEntries(
          Object.entries(state.webviewRuntime.screenshotUrlsByNodeId).filter(
            ([id]) => id !== nodeId,
          ),
        ),
      },
    })),

  undoProject: () =>
    set((state) => {
      if (!state.project || state.history.past.length === 0) return state;

      const previous = state.history.past[state.history.past.length - 1];
      return {
        project: {
          ...state.project,
          nodes: cloneNodes(previous.nodes),
          edges: cloneEdges(previous.edges),
        },
        history: {
          past: state.history.past.slice(0, -1),
          future: [
            ...state.history.future,
            cloneSnapshot({ nodes: state.project.nodes, edges: state.project.edges }),
          ],
        },
      };
    }),

  redoProject: () =>
    set((state) => {
      if (!state.project || state.history.future.length === 0) return state;

      const next = state.history.future[state.history.future.length - 1];
      const nextPast = [
        ...state.history.past,
        cloneSnapshot({ nodes: state.project.nodes, edges: state.project.edges }),
      ];
      if (nextPast.length > HISTORY_LIMIT) {
        nextPast.splice(0, nextPast.length - HISTORY_LIMIT);
      }

      return {
        project: {
          ...state.project,
          nodes: cloneNodes(next.nodes),
          edges: cloneEdges(next.edges),
        },
        history: {
          past: nextPast,
          future: state.history.future.slice(0, -1),
        },
      };
    }),

  _setLoaded: () => set({ isLoaded: true }),
}));

export const selectProject = (state: ProjectStore): Project | null => state.project;

export const selectProjectWebviewRuntime = (state: ProjectStore): ProjectWebviewRuntime =>
  state.webviewRuntime;
