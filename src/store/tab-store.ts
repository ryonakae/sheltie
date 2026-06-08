import { create } from 'zustand';

import {
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  DEFAULT_STICKY_NOTE_HEIGHT,
  DEFAULT_STICKY_NOTE_WIDTH,
  DEFAULT_TEXT_NODE_HEIGHT,
  DEFAULT_TEXT_NODE_WIDTH,
  DEFAULT_VIEWPORT,
  MAX_ZOOM,
  MIN_ZOOM,
} from '@/constants';
import {
  documentEdgeToBoardEdge,
  documentNodeToBoardNode,
  sanitizeProjectDocument,
} from '@/lib/project-document';
import { findNonOverlappingPosition } from '@/lib/siteboard-placement';
import {
  appendCappedSnapshot,
  cloneEdges,
  cloneNodes,
  cloneSnapshot,
  type ProjectHistory,
  pushHistory,
} from '@/store/project-history';
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
  ) => BoardNode | null;
  setWebNodeUrl: (nodeId: string, url: string) => void;
  changeWebNodeUrl: (nodeId: string, url: string) => void;
  removeNode: (nodeId: string) => void;
  removeNodes: (nodeIds: string[]) => void;
  updateNodePosition: (nodeId: string, x: number, y: number) => void;
  updateNodePositions: (updates: Array<{ nodeId: string; x: number; y: number }>) => void;
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
  addStickyNoteNode: (options?: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => BoardNode | null;
  updateStickyNoteContent: (nodeId: string, content: string) => void;
  updateStickyNoteStyle: (
    nodeId: string,
    style: {
      colorIndex?: number;
      fontSizePreset?: TextNodeFontSizePreset;
    },
  ) => void;
  addTextNode: (options?: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => BoardNode | null;
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
  reverseEdge: (edgeId: string) => void;
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

/**
 * 単一ノードを書き換える共通ヘルパー。
 * patch は対象ノードを受け取り、変更後ノードを返す。変更不要なら null を返す。
 * いずれのノードも変わらなければ全体で null を返し、呼び出し側で no-op（履歴を積まない）にできる。
 */
export function patchNode(
  nodes: BoardNode[],
  nodeId: string,
  patch: (node: BoardNode) => BoardNode | null,
): BoardNode[] | null {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.id !== nodeId) return node;
    const patched = patch(node);
    if (!patched || patched === node) return node;
    changed = true;
    return patched;
  });
  return changed ? nextNodes : null;
}

/** record から指定キー（単一 id または id 集合）を取り除いた新しい record を返す */
export function omitKeys<T>(
  record: Record<string, T>,
  ids: string | ReadonlySet<string>,
): Record<string, T> {
  const shouldKeep =
    typeof ids === 'string' ? (id: string) => id !== ids : (id: string) => !ids.has(id);
  return Object.fromEntries(Object.entries(record).filter(([id]) => shouldKeep(id)));
}

function replaceProjectNodes(
  state: ProjectStore,
  updater: (nodes: BoardNode[]) => BoardNode[] | null,
): ProjectStore | Pick<ProjectStore, 'project' | 'history'> {
  if (!state.project) return state;

  const nextNodes = updater(state.project.nodes);
  if (!nextNodes) return state;

  return {
    project: { ...state.project, nodes: nextNodes },
    history: pushHistory(state.history, {
      nodes: state.project.nodes,
      edges: state.project.edges,
    }),
  };
}

/** 履歴を積まずにノードを書き換える（自動高さ調整など、Undo 対象にしたくない更新専用） */
function replaceProjectNodesWithoutHistory(
  state: ProjectStore,
  updater: (nodes: BoardNode[]) => BoardNode[] | null,
): ProjectStore | Pick<ProjectStore, 'project'> {
  if (!state.project) return state;

  const nextNodes = updater(state.project.nodes);
  if (!nextNodes) return state;

  return { project: { ...state.project, nodes: nextNodes } };
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

  addWebNode: (url = '', options) => {
    let createdNode: BoardNode | null = null;

    set((state) =>
      replaceProjectNodes(state, (nodes) => {
        let title = 'Untitled';
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
        ...replaceProjectNodes(state, (nodes) =>
          patchNode(nodes, nodeId, (node) => ({ ...node, url, addedUrl: url, title })),
        ),
        webviewRuntime: {
          labelsByNodeId: omitKeys(state.webviewRuntime.labelsByNodeId, nodeId),
          screenshotUrlsByNodeId: omitKeys(state.webviewRuntime.screenshotUrlsByNodeId, nodeId),
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
          labelsByNodeId: omitKeys(state.webviewRuntime.labelsByNodeId, nodeId),
          screenshotUrlsByNodeId: omitKeys(state.webviewRuntime.screenshotUrlsByNodeId, nodeId),
        },
      };
    }),

  removeNodes: (nodeIds) =>
    set((state) => {
      if (!state.project) return state;
      if (nodeIds.length === 0) return state;
      const removeSet = new Set(nodeIds);
      const nextNodes = state.project.nodes.filter((node) => !removeSet.has(node.id));
      if (nextNodes.length === state.project.nodes.length) return state;

      const nextEdges = state.project.edges.filter(
        (edge) => !removeSet.has(edge.source) && !removeSet.has(edge.target),
      );

      return {
        project: { ...state.project, nodes: nextNodes, edges: nextEdges },
        // 複数ノード削除を 1 つの履歴エントリにまとめる
        history: pushHistory(state.history, {
          nodes: state.project.nodes,
          edges: state.project.edges,
        }),
        webviewRuntime: {
          labelsByNodeId: omitKeys(state.webviewRuntime.labelsByNodeId, removeSet),
          screenshotUrlsByNodeId: omitKeys(state.webviewRuntime.screenshotUrlsByNodeId, removeSet),
        },
      };
    }),

  updateNodePosition: (nodeId, x, y) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) =>
        patchNode(nodes, nodeId, (node) =>
          node.x === x && node.y === y ? null : { ...node, x, y },
        ),
      ),
    ),

  updateNodePositions: (updates) =>
    set((state) =>
      // 複数ノードの位置を 1 つの履歴エントリにまとめて反映する
      replaceProjectNodes(state, (nodes) => {
        if (updates.length === 0) return null;
        const updateMap = new Map(updates.map((u) => [u.nodeId, u]));
        let changed = false;
        const nextNodes = nodes.map((node) => {
          const update = updateMap.get(node.id);
          if (!update) return node;
          if (node.x === update.x && node.y === update.y) return node;
          changed = true;
          return { ...node, x: update.x, y: update.y };
        });
        return changed ? nextNodes : null;
      }),
    ),

  updateNodeSize: (nodeId, width, height) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) =>
        patchNode(nodes, nodeId, (node) =>
          node.width === width && node.height === height ? null : { ...node, width, height },
        ),
      ),
    ),

  updateNodeBounds: (nodeId, x, y, width, height) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) =>
        patchNode(nodes, nodeId, (node) =>
          node.x === x && node.y === y && node.width === width && node.height === height
            ? null
            : { ...node, x, y, width, height },
        ),
      ),
    ),

  updateNodeSizeWithoutHistory: (nodeId, width, height) =>
    set((state) =>
      replaceProjectNodesWithoutHistory(state, (nodes) =>
        patchNode(nodes, nodeId, (node) =>
          node.width === width && node.height === height ? null : { ...node, width, height },
        ),
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
    set((state) =>
      // 重なり順変更は nodes 配列順を変える＝永続状態の変更なので履歴に記録する
      replaceProjectNodes(state, (nodes) => {
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) return null;
        if (nodes[nodes.length - 1]?.id === nodeId) return null;
        return [...nodes.filter((n) => n.id !== nodeId), node];
      }),
    ),

  sendNodeToBack: (nodeId) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) => {
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) return null;
        if (nodes[0]?.id === nodeId) return null;
        return [node, ...nodes.filter((n) => n.id !== nodeId)];
      }),
    ),

  bringNodeForward: (nodeId) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) => {
        const idx = nodes.findIndex((n) => n.id === nodeId);
        if (idx === -1 || idx === nodes.length - 1) return null;
        const node = nodes[idx];
        if (isWebPageNode(node)) return null;
        // WebPageNode をスキップして次の付箋/テキストを探す
        let swapIdx = -1;
        for (let i = idx + 1; i < nodes.length; i++) {
          if (!isWebPageNode(nodes[i])) {
            swapIdx = i;
            break;
          }
        }
        if (swapIdx === -1) return null;
        const result = [...nodes];
        // 対象ノードを取り出し、スワップ先の直後に挿入
        result.splice(idx, 1);
        result.splice(swapIdx, 0, node);
        return result;
      }),
    ),

  sendNodeBackward: (nodeId) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) => {
        const idx = nodes.findIndex((n) => n.id === nodeId);
        if (idx <= 0) return null;
        const node = nodes[idx];
        if (isWebPageNode(node)) return null;
        // WebPageNode をスキップして前の付箋/テキストを探す
        let swapIdx = -1;
        for (let i = idx - 1; i >= 0; i--) {
          if (!isWebPageNode(nodes[i])) {
            swapIdx = i;
            break;
          }
        }
        if (swapIdx === -1) return null;
        const result = [...nodes];
        result.splice(idx, 1);
        result.splice(swapIdx, 0, node);
        return result;
      }),
    ),

  addStickyNoteNode: (options) => {
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
          fontSizePreset: 1,
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
      replaceProjectNodes(state, (nodes) =>
        patchNode(nodes, nodeId, (node) =>
          (node.content ?? '') === content ? null : { ...node, content },
        ),
      ),
    ),

  updateStickyNoteStyle: (nodeId, style) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) =>
        patchNode(nodes, nodeId, (node) => ({ ...node, ...style })),
      ),
    ),

  addTextNode: (options) => {
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
      replaceProjectNodes(state, (nodes) =>
        patchNode(nodes, nodeId, (node) => ({ ...node, tiptapContent })),
      ),
    ),

  updateTextNodeStyle: (nodeId, style) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) =>
        patchNode(nodes, nodeId, (node) => ({ ...node, ...style })),
      ),
    ),

  updateTextNodeWidthMode: (nodeId, widthMode) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) =>
        patchNode(nodes, nodeId, (node) =>
          node.widthMode === widthMode ? null : { ...node, widthMode },
        ),
      ),
    ),

  pinWebNodeUrl: (nodeId) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) =>
        patchNode(nodes, nodeId, (node) =>
          !node.url || node.addedUrl === node.url ? null : { ...node, addedUrl: node.url },
        ),
      ),
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

  reverseEdge: (edgeId) =>
    set((state) =>
      replaceProjectEdges(state, (edges) => {
        const target = edges.find((e) => e.id === edgeId);
        if (!target) return null;
        // 反転後と同じ向きのエッジが既に存在する場合は重複を避けるため何もしない
        const reversedExists = edges.some(
          (e) =>
            e.id !== edgeId &&
            e.source === target.target &&
            e.sourceHandle === target.targetHandle &&
            e.target === target.source &&
            e.targetHandle === target.sourceHandle,
        );
        if (reversedExists) return null;
        return edges.map((e) =>
          e.id === edgeId
            ? {
                ...e,
                source: e.target,
                sourceHandle: e.targetHandle,
                target: e.source,
                targetHandle: e.sourceHandle,
              }
            : e,
        );
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
        labelsByNodeId: omitKeys(state.webviewRuntime.labelsByNodeId, nodeId),
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
        screenshotUrlsByNodeId: omitKeys(state.webviewRuntime.screenshotUrlsByNodeId, nodeId),
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
      const nextPast = appendCappedSnapshot(state.history.past, {
        nodes: state.project.nodes,
        edges: state.project.edges,
      });

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
