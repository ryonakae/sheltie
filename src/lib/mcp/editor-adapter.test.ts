import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  focusNodes,
  getEditorState,
  getPageScreenshotSource,
  registerMcpEditorAdapter,
  requireMcpEditorAdapter,
  type McpEditorAdapter,
} from '@/lib/mcp/editor-adapter';

function emptyBoardScreenshot() {
  return {
    mimeType: 'image/png' as const,
    base64: '',
    width: 1,
    height: 1,
    worldBounds: { x: 0, y: 0, width: 1, height: 1 },
    includedNodeIds: [],
    missingScreenshotNodeIds: [],
  };
}

function createAdapter(name: string): McpEditorAdapter {
  return {
    getEditorState: () => ({
      selectedNodeIds: [`${name}-node`],
      selectedEdgeIds: [`${name}-edge`],
      viewport: { zoom: 1, panX: 0, panY: 0 },
    }),
    focusNodes: vi.fn(async (nodeIds: string[]) => ({ focusedNodeIds: nodeIds })),
    getWebpageScreenshots: async () => [],
    getPageScreenshotSource: async () => ({ displayMode: 'hidden' }),
    captureBoardScreenshot: async () => emptyBoardScreenshot(),
  };
}

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('MCP editor adapter', () => {
  it('returns a stable renderer_unavailable error without a registration', () => {
    expect(() => requireMcpEditorAdapter()).toThrow(
      expect.objectContaining({ code: 'renderer_unavailable' }),
    );
  });

  it('keeps the latest registration when an older cleanup runs', () => {
    const unregisterA = registerMcpEditorAdapter(createAdapter('a'));
    cleanup = registerMcpEditorAdapter(createAdapter('b'));

    unregisterA();

    expect(getEditorState().selectedNodeIds).toEqual(['b-node']);
  });

  it('becomes unavailable when the current registration is cleaned up', () => {
    cleanup = registerMcpEditorAdapter(createAdapter('current'));
    cleanup();
    cleanup = undefined;

    expect(() => getEditorState()).toThrow(
      expect.objectContaining({ code: 'renderer_unavailable' }),
    );
  });

  it('returns defensive copies without mutating adapter state', () => {
    const source = {
      selectedNodeIds: ['node-1'],
      selectedEdgeIds: ['edge-1'],
      viewport: { zoom: 2, panX: 10, panY: 20 },
    };
    cleanup = registerMcpEditorAdapter({
      getEditorState: () => source,
      focusNodes: async (nodeIds) => ({ focusedNodeIds: nodeIds }),
      getWebpageScreenshots: async () => [],
      getPageScreenshotSource: async () => ({ displayMode: 'hidden' }),
      captureBoardScreenshot: async () => emptyBoardScreenshot(),
    });

    const result = getEditorState();
    result.selectedNodeIds.push('changed');
    result.viewport.panX = 999;

    expect(source).toEqual({
      selectedNodeIds: ['node-1'],
      selectedEdgeIds: ['edge-1'],
      viewport: { zoom: 2, panX: 10, panY: 20 },
    });
  });

  it('returns the exact read-only screenshot source without changing editor state', async () => {
    const source = {
      displayMode: 'screenshot' as const,
      cached: {
        base64: 'cG5n',
        width: 640,
        height: 480,
        capturedAt: '2026-07-17T00:00:00.000Z',
        capturedUrl: 'https://example.com/',
      },
    };
    const adapter = createAdapter('source');
    const getSource = vi.fn(async () => source);
    adapter.getPageScreenshotSource = getSource;
    cleanup = registerMcpEditorAdapter(adapter);

    await expect(getPageScreenshotSource('page-1')).resolves.toEqual(source);
    expect(getSource).toHaveBeenCalledWith('page-1');
    expect(adapter.focusNodes).not.toHaveBeenCalled();
  });

  it('preserves hidden mode without a cache and becomes unavailable after cleanup', async () => {
    const adapter = createAdapter('hidden');
    adapter.getPageScreenshotSource = vi.fn(async () => ({ displayMode: 'hidden' as const }));
    cleanup = registerMcpEditorAdapter(adapter);

    await expect(getPageScreenshotSource('page-hidden')).resolves.toEqual({
      displayMode: 'hidden',
    });
    cleanup();
    cleanup = undefined;

    await expect(getPageScreenshotSource('page-hidden')).rejects.toEqual(
      expect.objectContaining({ code: 'renderer_unavailable' }),
    );
  });

  it('forwards focus IDs and returns the adapter result', async () => {
    const adapter = createAdapter('focus');
    cleanup = registerMcpEditorAdapter(adapter);
    const nodeIds = ['node-2', 'node-1'];

    await expect(focusNodes(nodeIds)).resolves.toEqual({ focusedNodeIds: nodeIds });
    expect(adapter.focusNodes).toHaveBeenCalledWith(nodeIds);
  });
});
