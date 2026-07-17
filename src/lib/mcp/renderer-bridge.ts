import {
  captureBoardScreenshot,
  focusNodes,
  getEditorState,
  getPageScreenshotSource,
  getWebpageScreenshots,
} from '@/lib/mcp/editor-adapter';
import type {
  BoardOperation,
  McpToolError,
  RendererCommandHandlers,
  RendererRequest,
  RendererResponse,
} from '@/lib/mcp/types';
import { onMcpRendererRequest } from '@/lib/tauri-bridge/events';
import { api } from '@/lib/tauri-bridge/project';
import { useProjectStore } from '@/store/tab-store';

let currentRegistration: { token: symbol; handlers: RendererCommandHandlers } | null = null;

function normalizeToolError(error: unknown): McpToolError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return {
      code: error.code,
      message: error.message,
      ...('retry' in error && typeof error.retry === 'string' ? { retry: error.retry } : {}),
    };
  }

  return {
    code: 'renderer_unavailable',
    message: error instanceof Error ? error.message : 'Renderer command failed',
  };
}

export function registerMcpRendererCommandHandlers(handlers: RendererCommandHandlers): () => void {
  const token = Symbol('mcp-renderer-command-handlers');
  currentRegistration = { token, handlers };
  return () => {
    if (currentRegistration?.token === token) {
      currentRegistration = null;
    }
  };
}

function parseFocusNodeIds(params: unknown): string[] {
  if (
    typeof params !== 'object' ||
    params === null ||
    !('nodeIds' in params) ||
    !Array.isArray(params.nodeIds) ||
    params.nodeIds.some((nodeId) => typeof nodeId !== 'string' || nodeId.length === 0)
  ) {
    throw {
      code: 'validation_failed',
      message: 'focusNodes requires nodeIds to be an array of non-empty strings',
    };
  }

  return params.nodeIds;
}

function parsePageNodeId(params: unknown, command: string): string {
  if (
    typeof params !== 'object' ||
    params === null ||
    Array.isArray(params) ||
    !('pageNodeId' in params) ||
    typeof params.pageNodeId !== 'string' ||
    params.pageNodeId.length === 0
  ) {
    throw {
      code: 'validation_failed',
      message: `${command} requires pageNodeId to be a non-empty string`,
    };
  }
  return params.pageNodeId;
}

function parsePageNodeIds(params: unknown): string[] | undefined {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw {
      code: 'validation_failed',
      message: 'getWebpageScreenshots requires params to be an object',
    };
  }
  if (!('pageNodeIds' in params) || params.pageNodeIds === undefined) return undefined;
  if (
    !Array.isArray(params.pageNodeIds) ||
    params.pageNodeIds.some((nodeId) => typeof nodeId !== 'string' || nodeId.length === 0)
  ) {
    throw {
      code: 'validation_failed',
      message: 'getWebpageScreenshots requires pageNodeIds to be an array of non-empty strings',
    };
  }
  return params.pageNodeIds;
}

function parseGetBoardParams(params: unknown): {
  nodeIds?: string[];
  nodeTypes?: Array<'webpage' | 'stickynote' | 'text'>;
  includeEdges: boolean;
} {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw { code: 'validation_failed', message: 'getBoard requires params to be an object' };
  }
  const nodeIds = 'nodeIds' in params ? params.nodeIds : undefined;
  if (
    nodeIds !== undefined &&
    (!Array.isArray(nodeIds) ||
      nodeIds.some((nodeId) => typeof nodeId !== 'string' || nodeId.length === 0))
  ) {
    throw {
      code: 'validation_failed',
      message: 'getBoard requires nodeIds to be an array of non-empty strings',
    };
  }
  const nodeTypes = 'nodeTypes' in params ? params.nodeTypes : undefined;
  const validNodeTypes = new Set(['webpage', 'stickynote', 'text']);
  if (
    nodeTypes !== undefined &&
    (!Array.isArray(nodeTypes) ||
      nodeTypes.some((nodeType) => typeof nodeType !== 'string' || !validNodeTypes.has(nodeType)))
  ) {
    throw {
      code: 'validation_failed',
      message: 'getBoard nodeTypes must contain webpage, stickynote, or text',
    };
  }
  const includeEdges = 'includeEdges' in params ? params.includeEdges : true;
  if (typeof includeEdges !== 'boolean') {
    throw { code: 'validation_failed', message: 'getBoard includeEdges must be a boolean' };
  }
  return {
    ...(nodeIds ? { nodeIds: nodeIds as string[] } : {}),
    ...(nodeTypes ? { nodeTypes: nodeTypes as Array<'webpage' | 'stickynote' | 'text'> } : {}),
    includeEdges,
  };
}

function getBoard(params: unknown) {
  const project = useProjectStore.getState().project;
  if (!project) {
    throw {
      code: 'renderer_unavailable',
      message: 'No project is loaded in this document renderer',
    };
  }
  const parsed = parseGetBoardParams(params);
  const liveIds = new Set(project.nodes.map((node) => node.id));
  const unknownIds = parsed.nodeIds?.filter((nodeId) => !liveIds.has(nodeId)) ?? [];
  if (unknownIds.length > 0) {
    throw { code: 'validation_failed', message: `Unknown node IDs: ${unknownIds.join(', ')}` };
  }
  const requestedIds = parsed.nodeIds ? new Set(parsed.nodeIds) : null;
  const requestedTypes = parsed.nodeTypes ? new Set(parsed.nodeTypes) : null;
  const nodes = project.nodes.filter((node) => {
    const nodeType = node.type ?? 'webpage';
    return (
      (!requestedIds || requestedIds.has(node.id)) &&
      (!requestedTypes || requestedTypes.has(nodeType))
    );
  });
  const selectedIds = new Set(nodes.map((node) => node.id));
  const edges = parsed.includeEdges
    ? project.edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
    : [];
  return { nodes, edges };
}

function batchEditBoard(params: unknown) {
  if (
    typeof params !== 'object' ||
    params === null ||
    Array.isArray(params) ||
    !('operations' in params) ||
    !Array.isArray(params.operations)
  ) {
    throw {
      code: 'validation_failed',
      message: 'batchEditBoard requires operations to be an array',
    };
  }
  const invalidOperationIndex = params.operations.findIndex(
    (operation) => typeof operation !== 'object' || operation === null || Array.isArray(operation),
  );
  if (invalidOperationIndex >= 0) {
    throw {
      code: 'validation_failed',
      message: `Operation ${invalidOperationIndex}: operation must be an object`,
    };
  }
  const result = useProjectStore
    .getState()
    .applyMcpBoardBatch(params.operations as BoardOperation[]);
  if (!result.ok) {
    throw {
      code: result.error.code,
      message: `Operation ${result.error.operationIndex}: ${result.error.message}`,
    };
  }
  return {
    changed: result.changed,
    createdNodeIds: result.createdNodeIds,
    updatedNodeIds: result.updatedNodeIds,
    deletedNodeIds: result.deletedNodeIds,
    createdEdgeIds: result.createdEdgeIds,
    updatedEdgeIds: result.updatedEdgeIds,
    deletedEdgeIds: result.deletedEdgeIds,
    tempIdMap: result.tempIdMap,
  };
}

function parseBoardNodeIds(params: unknown): string[] | undefined {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw {
      code: 'validation_failed',
      message: 'getBoardScreenshot requires params to be an object',
    };
  }
  if (!('nodeIds' in params) || params.nodeIds === undefined) return undefined;
  if (
    !Array.isArray(params.nodeIds) ||
    params.nodeIds.some((nodeId) => typeof nodeId !== 'string' || nodeId.length === 0)
  ) {
    throw {
      code: 'validation_failed',
      message: 'getBoardScreenshot requires nodeIds to be an array of non-empty strings',
    };
  }
  return params.nodeIds;
}

export function createBuiltInRendererCommandHandlers(): RendererCommandHandlers {
  return {
    getEditorState: () => getEditorState(),
    getBoard: (params) => getBoard(params),
    batchEditBoard: (params) => batchEditBoard(params),
    focusNodes: (params) => focusNodes(parseFocusNodeIds(params)),
    getWebpageScreenshots: (params) => getWebpageScreenshots(parsePageNodeIds(params)),
    getPageScreenshotSource: (params) =>
      getPageScreenshotSource(parsePageNodeId(params, 'getPageScreenshotSource')),
    getBoardScreenshot: (params) => captureBoardScreenshot(parseBoardNodeIds(params)),
  };
}

export async function createRendererResponse(
  request: RendererRequest,
  handlers: RendererCommandHandlers,
): Promise<RendererResponse> {
  let response: RendererResponse;
  const handler = handlers[request.command];
  if (!handler) {
    response = {
      requestId: request.requestId,
      result: {
        ok: false,
        error: {
          code: 'renderer_unavailable',
          message: `Renderer command is not registered: ${request.command}`,
          retry: 'Wait for the document renderer to finish loading, then retry',
        },
      },
    };
  } else {
    try {
      response = {
        requestId: request.requestId,
        result: { ok: true, data: await handler(request.params) },
      };
    } catch (error) {
      response = {
        requestId: request.requestId,
        result: { ok: false, error: normalizeToolError(error) },
      };
    }
  }

  return response;
}

async function handleRendererRequest(request: RendererRequest): Promise<void> {
  const response = await createRendererResponse(request, currentRegistration?.handlers ?? {});
  try {
    await api.completeMcpRendererRequest(response);
  } catch (error) {
    console.error('[mcp] failed to complete renderer request:', error);
  }
}

export async function setupMcpRendererBridge(
  initialHandlers?: RendererCommandHandlers,
): Promise<() => void> {
  const unregister = registerMcpRendererCommandHandlers({
    ...createBuiltInRendererCommandHandlers(),
    ...initialHandlers,
  });
  const unlisten = await onMcpRendererRequest((request) => {
    void handleRendererRequest(request);
  });

  return () => {
    unlisten();
    unregister();
  };
}
