import type { BoardScreenshotResult } from '@/lib/mcp/board-screenshot';
import type { PageScreenshotSource } from '@/lib/mcp/types';
import type { WebpageScreenshotResult } from '@/lib/mcp/webpage-screenshots';
import type { Viewport } from '@/types';

export interface McpEditorState {
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  viewport: Viewport;
}

export interface McpEditorAdapter {
  getEditorState: () => McpEditorState;
  focusNodes: (nodeIds: string[]) => Promise<{ focusedNodeIds: string[] }>;
  getWebpageScreenshots: (pageNodeIds?: string[]) => Promise<WebpageScreenshotResult[]>;
  getPageScreenshotSource: (pageNodeId: string) => Promise<PageScreenshotSource>;
  captureBoardScreenshot: (nodeIds?: string[]) => Promise<BoardScreenshotResult>;
}

let currentRegistration: { token: symbol; adapter: McpEditorAdapter } | null = null;

export function registerMcpEditorAdapter(adapter: McpEditorAdapter): () => void {
  const token = Symbol('mcp-editor-adapter');
  currentRegistration = { token, adapter };

  return () => {
    if (currentRegistration?.token === token) {
      currentRegistration = null;
    }
  };
}

export function requireMcpEditorAdapter(): McpEditorAdapter {
  if (currentRegistration) return currentRegistration.adapter;

  throw {
    code: 'renderer_unavailable',
    message: 'MCP editor adapter is not available',
    retry: 'Wait for the document renderer to finish loading, then retry',
  };
}

export function getEditorState(): McpEditorState {
  const state = requireMcpEditorAdapter().getEditorState();
  return {
    selectedNodeIds: [...state.selectedNodeIds],
    selectedEdgeIds: [...state.selectedEdgeIds],
    viewport: { ...state.viewport },
  };
}

export async function focusNodes(nodeIds: string[]): Promise<{ focusedNodeIds: string[] }> {
  return requireMcpEditorAdapter().focusNodes([...nodeIds]);
}

export async function getWebpageScreenshots(
  pageNodeIds?: string[],
): Promise<WebpageScreenshotResult[]> {
  return requireMcpEditorAdapter().getWebpageScreenshots(
    pageNodeIds ? [...pageNodeIds] : undefined,
  );
}

export async function getPageScreenshotSource(pageNodeId: string): Promise<PageScreenshotSource> {
  const source = await requireMcpEditorAdapter().getPageScreenshotSource(pageNodeId);
  return {
    displayMode: source.displayMode,
    ...(source.cached ? { cached: { ...source.cached } } : {}),
  };
}

export async function captureBoardScreenshot(nodeIds?: string[]): Promise<BoardScreenshotResult> {
  return requireMcpEditorAdapter().captureBoardScreenshot(nodeIds ? [...nodeIds] : undefined);
}
