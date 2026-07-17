import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerMcpEditorAdapter } from '@/lib/mcp/editor-adapter';
import {
  createBuiltInRendererCommandHandlers,
  createRendererResponse,
} from '@/lib/mcp/renderer-bridge';

let cleanupAdapter: (() => void) | undefined;

afterEach(() => {
  cleanupAdapter?.();
  cleanupAdapter = undefined;
});

describe('createRendererResponse', () => {
  it('returns handler data for a registered command', async () => {
    await expect(
      createRendererResponse(
        {
          requestId: 'request-1',
          command: 'getBoard',
          params: { includeEdges: true },
        },
        {
          getBoard: (params) => ({ params, nodes: [] }),
        },
      ),
    ).resolves.toEqual({
      requestId: 'request-1',
      result: {
        ok: true,
        data: { params: { includeEdges: true }, nodes: [] },
      },
    });
  });

  it('preserves stable tool errors thrown by handlers', async () => {
    await expect(
      createRendererResponse(
        {
          requestId: 'request-1',
          command: 'getBoard',
          params: {},
        },
        {
          getBoard: () => {
            throw {
              code: 'validation_failed',
              message: 'includeEdges must be a boolean',
              retry: 'Pass true or false',
            };
          },
        },
      ),
    ).resolves.toEqual({
      requestId: 'request-1',
      result: {
        ok: false,
        error: {
          code: 'validation_failed',
          message: 'includeEdges must be a boolean',
          retry: 'Pass true or false',
        },
      },
    });
  });

  it('returns renderer_unavailable for an unregistered command', async () => {
    await expect(
      createRendererResponse(
        {
          requestId: 'request-1',
          command: 'getBoard',
          params: {},
        },
        {},
      ),
    ).resolves.toEqual({
      requestId: 'request-1',
      result: {
        ok: false,
        error: {
          code: 'renderer_unavailable',
          message: 'Renderer command is not registered: getBoard',
          retry: 'Wait for the document renderer to finish loading, then retry',
        },
      },
    });
  });
});

describe('built-in editor commands', () => {
  it('returns the registered editor state', async () => {
    cleanupAdapter = registerMcpEditorAdapter({
      getEditorState: () => ({
        selectedNodeIds: ['node-1'],
        selectedEdgeIds: ['edge-1'],
        viewport: { zoom: 1.5, panX: 10, panY: -20 },
      }),
      focusNodes: async (nodeIds) => ({ focusedNodeIds: nodeIds }),
    });

    const response = await createRendererResponse(
      { requestId: 'editor-state', command: 'getEditorState', params: { documentId: 'doc-1' } },
      createBuiltInRendererCommandHandlers(),
    );

    expect(response.result).toEqual({
      ok: true,
      data: {
        selectedNodeIds: ['node-1'],
        selectedEdgeIds: ['edge-1'],
        viewport: { zoom: 1.5, panX: 10, panY: -20 },
      },
    });
  });

  it('validates and forwards focus node IDs', async () => {
    const focusNodes = vi.fn(async (nodeIds: string[]) => ({ focusedNodeIds: nodeIds }));
    cleanupAdapter = registerMcpEditorAdapter({
      getEditorState: () => ({
        selectedNodeIds: [],
        selectedEdgeIds: [],
        viewport: { zoom: 1, panX: 0, panY: 0 },
      }),
      focusNodes,
    });

    const response = await createRendererResponse(
      {
        requestId: 'focus',
        command: 'focusNodes',
        params: { documentId: 'doc-1', nodeIds: ['node-2', 'node-1'] },
      },
      createBuiltInRendererCommandHandlers(),
    );

    expect(focusNodes).toHaveBeenCalledWith(['node-2', 'node-1']);
    expect(response.result).toEqual({
      ok: true,
      data: { focusedNodeIds: ['node-2', 'node-1'] },
    });
  });

  it('rejects malformed focus params', async () => {
    const response = await createRendererResponse(
      {
        requestId: 'focus-invalid',
        command: 'focusNodes',
        params: { nodeIds: ['node-1', null] },
      },
      createBuiltInRendererCommandHandlers(),
    );

    expect(response.result).toEqual({
      ok: false,
      error: {
        code: 'validation_failed',
        message: 'focusNodes requires nodeIds to be an array of non-empty strings',
      },
    });
  });

  it('reports unavailable when the editor adapter is not mounted', async () => {
    const response = await createRendererResponse(
      { requestId: 'unavailable', command: 'getEditorState', params: {} },
      createBuiltInRendererCommandHandlers(),
    );

    expect(response.result).toEqual({
      ok: false,
      error: {
        code: 'renderer_unavailable',
        message: 'MCP editor adapter is not available',
        retry: 'Wait for the document renderer to finish loading, then retry',
      },
    });
  });
});
