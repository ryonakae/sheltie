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
      getWebpageScreenshots: async () => [],
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
      getWebpageScreenshots: async () => [],
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

  it('validates and forwards optional WebPage screenshot IDs', async () => {
    const getWebpageScreenshots = vi.fn(async (pageNodeIds?: string[]) =>
      (pageNodeIds ?? []).map((pageNodeId) => ({ pageNodeId, freshness: 'missing' as const })),
    );
    cleanupAdapter = registerMcpEditorAdapter({
      getEditorState: () => ({
        selectedNodeIds: [],
        selectedEdgeIds: [],
        viewport: { zoom: 1, panX: 0, panY: 0 },
      }),
      focusNodes: async (nodeIds) => ({ focusedNodeIds: nodeIds }),
      getWebpageScreenshots,
    });

    const response = await createRendererResponse(
      {
        requestId: 'screenshots',
        command: 'getWebpageScreenshots',
        params: { documentId: 'doc-1', pageNodeIds: ['page-2', 'page-1'] },
      },
      createBuiltInRendererCommandHandlers(),
    );

    expect(getWebpageScreenshots).toHaveBeenCalledWith(['page-2', 'page-1']);
    expect(response.result).toEqual({
      ok: true,
      data: [
        { pageNodeId: 'page-2', freshness: 'missing' },
        { pageNodeId: 'page-1', freshness: 'missing' },
      ],
    });
  });

  it('rejects malformed WebPage screenshot params', async () => {
    const response = await createRendererResponse(
      {
        requestId: 'screenshots-invalid',
        command: 'getWebpageScreenshots',
        params: { pageNodeIds: ['page-1', 2] },
      },
      createBuiltInRendererCommandHandlers(),
    );

    expect(response.result).toEqual({
      ok: false,
      error: {
        code: 'validation_failed',
        message: 'getWebpageScreenshots requires pageNodeIds to be an array of non-empty strings',
      },
    });

    const arrayResponse = await createRendererResponse(
      {
        requestId: 'screenshots-array',
        command: 'getWebpageScreenshots',
        params: [],
      },
      createBuiltInRendererCommandHandlers(),
    );
    expect(arrayResponse.result).toMatchObject({
      ok: false,
      error: { code: 'validation_failed' },
    });
  });

  it('reports unavailable when the editor adapter is not mounted', async () => {
    const response = await createRendererResponse(
      { requestId: 'unavailable', command: 'getWebpageScreenshots', params: {} },
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
