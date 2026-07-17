import { focusNodes, getEditorState } from '@/lib/mcp/editor-adapter';
import type {
  McpToolError,
  RendererCommandHandlers,
  RendererRequest,
  RendererResponse,
} from '@/lib/mcp/types';
import { onMcpRendererRequest } from '@/lib/tauri-bridge/events';
import { api } from '@/lib/tauri-bridge/project';

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

export function createBuiltInRendererCommandHandlers(): RendererCommandHandlers {
  return {
    getEditorState: () => getEditorState(),
    focusNodes: (params) => focusNodes(parseFocusNodeIds(params)),
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
