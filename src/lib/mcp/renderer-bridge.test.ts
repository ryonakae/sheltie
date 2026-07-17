import { describe, expect, it } from 'vitest';

import { createRendererResponse } from '@/lib/mcp/renderer-bridge';

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
