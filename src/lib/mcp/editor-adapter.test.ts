import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  focusNodes,
  getEditorState,
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

  it('forwards focus IDs and returns the adapter result', async () => {
    const adapter = createAdapter('focus');
    cleanup = registerMcpEditorAdapter(adapter);
    const nodeIds = ['node-2', 'node-1'];

    await expect(focusNodes(nodeIds)).resolves.toEqual({ focusedNodeIds: nodeIds });
    expect(adapter.focusNodes).toHaveBeenCalledWith(nodeIds);
  });
});
