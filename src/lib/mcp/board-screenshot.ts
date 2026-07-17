import { toPng } from 'html-to-image';

import { getNodeFrameRect } from '@/lib/sheltie-node-frame';
import type { BoardEdge, BoardNode } from '@/types';
import { isWebPageNode } from '@/types';

const BOARD_CAPTURE_PADDING = 64;
const BOARD_CAPTURE_MAXIMUM_SIDE = 2048;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const CAPTURE_EXCLUDE_SELECTORS = [
  '.react-flow__handle',
  '.react-flow__resize-control',
  '.react-flow__nodesselection',
  '.react-flow__nodesselection-rect',
  'svg.react-flow__connectionline',
  '[data-edge-selection-endpoint]',
  '.react-flow__node-toolbar',
  '.react-flow__edge-toolbar',
  '[data-selection-toolbar]',
  '[data-board-capture-exclude]',
];

export interface BoardCaptureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardCaptureSelection {
  nodes: BoardNode[];
  edges: BoardEdge[];
  includedNodeIds: string[];
}

export interface BoardScreenshotResult {
  mimeType: 'image/png';
  base64: string;
  width: number;
  height: number;
  worldBounds: BoardCaptureBounds;
  includedNodeIds: string[];
  missingScreenshotNodeIds: string[];
}

function validationFailed(message: string): never {
  throw { code: 'validation_failed', message };
}

function screenshotFailed(message: string): never {
  throw {
    code: 'screenshot_failed',
    message,
    retry: 'Wait for the board renderer to finish loading, then retry',
  };
}

export function resolveBoardCaptureSelection(
  nodes: readonly BoardNode[],
  edges: readonly BoardEdge[],
  nodeIds?: readonly string[],
): BoardCaptureSelection {
  if (nodeIds && new Set(nodeIds).size !== nodeIds.length) {
    validationFailed('nodeIds must not contain duplicate IDs');
  }
  const liveIds = new Set(nodes.map((node) => node.id));
  const unknownIds = nodeIds?.filter((nodeId) => !liveIds.has(nodeId)) ?? [];
  if (unknownIds.length > 0) {
    validationFailed(`Unknown node IDs: ${unknownIds.join(', ')}`);
  }

  const requestedIds = nodeIds ? new Set(nodeIds) : null;
  const selectedNodes = requestedIds
    ? nodes.filter((node) => requestedIds.has(node.id))
    : [...nodes];
  if (selectedNodes.length === 0) validationFailed('Board screenshot requires at least one node');

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  return {
    nodes: selectedNodes,
    edges: edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)),
    includedNodeIds: selectedNodes.map((node) => node.id),
  };
}

export function resolveBoardCaptureBounds(
  nodes: readonly Pick<BoardNode, 'type' | 'x' | 'y' | 'width' | 'height'>[],
  padding: number,
): BoardCaptureBounds {
  if (nodes.length === 0) validationFailed('Board screenshot requires at least one node');
  if (!Number.isFinite(padding) || padding < 0)
    validationFailed('Capture padding must be non-negative');

  const frames = nodes.map((node) => {
    if (![node.x, node.y, node.width, node.height].every(Number.isFinite)) {
      validationFailed('Board contains non-finite node geometry');
    }
    if (node.width <= 0 || node.height <= 0) {
      validationFailed('Board contains invalid node dimensions');
    }
    return getNodeFrameRect(node);
  });
  const left = Math.min(...frames.map((frame) => frame.left));
  const top = Math.min(...frames.map((frame) => frame.top));
  const right = Math.max(...frames.map((frame) => frame.right));
  const bottom = Math.max(...frames.map((frame) => frame.bottom));
  return {
    x: left - padding,
    y: top - padding,
    width: right - left + padding * 2,
    height: bottom - top + padding * 2,
  };
}

export function resolveBoardCaptureScale(
  bounds: Pick<BoardCaptureBounds, 'width' | 'height'>,
  maximumSide: number,
): number {
  if (
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    !Number.isFinite(maximumSide) ||
    maximumSide <= 0
  ) {
    validationFailed('Board capture dimensions must be positive');
  }
  return Math.min(1, maximumSide / Math.max(bounds.width, bounds.height));
}

export function resolveMissingScreenshotNodeIds(
  nodes: readonly BoardNode[],
  screenshotUrlsByNodeId: Readonly<Record<string, string>>,
): string[] {
  return nodes
    .filter((node) => isWebPageNode(node) && !screenshotUrlsByNodeId[node.id])
    .map((node) => node.id);
}

function retainSelectedElements(
  clone: HTMLElement,
  includedNodeIds: ReadonlySet<string>,
  includedEdgeIds: ReadonlySet<string>,
): void {
  clone.querySelectorAll<HTMLElement>('.react-flow__node').forEach((element) => {
    const nodeId = element.dataset.id;
    if (!nodeId || !includedNodeIds.has(nodeId)) element.remove();
  });
  clone.querySelectorAll<SVGGElement>('.react-flow__edge').forEach((element) => {
    const edgeId = element.dataset.id;
    if (!edgeId || !includedEdgeIds.has(edgeId)) element.remove();
  });
}

function normalizeCaptureClone(
  clone: HTMLElement,
  selection: BoardCaptureSelection,
  bounds: BoardCaptureBounds,
): void {
  retainSelectedElements(
    clone,
    new Set(selection.includedNodeIds),
    new Set(selection.edges.map((edge) => edge.id)),
  );
  for (const selector of CAPTURE_EXCLUDE_SELECTORS) {
    clone.querySelectorAll(selector).forEach((element) => element.remove());
  }
  clone.querySelectorAll<HTMLElement>('[data-display-mode]').forEach((element) => {
    element.dataset.displayMode = 'screenshot';
  });
  clone.querySelectorAll('.selected').forEach((element) => element.classList.remove('selected'));
  Object.assign(clone.style, {
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    transform: `translate(${-bounds.x}px, ${-bounds.y}px) scale(1)`,
    transformOrigin: '0 0',
  });
}

export async function captureBoardScreenshot({
  viewportElement,
  nodes,
  edges,
  screenshotUrlsByNodeId,
  backgroundColor,
  nodeIds,
}: {
  viewportElement: HTMLElement | null;
  nodes: readonly BoardNode[];
  edges: readonly BoardEdge[];
  screenshotUrlsByNodeId: Readonly<Record<string, string>>;
  backgroundColor: string;
  nodeIds?: readonly string[];
}): Promise<BoardScreenshotResult> {
  if (!viewportElement) screenshotFailed('React Flow viewport is not available');
  const flowRoot = viewportElement.closest<HTMLElement>('.react-flow');
  if (!flowRoot) screenshotFailed('React Flow root is not available');

  const selection = resolveBoardCaptureSelection(nodes, edges, nodeIds);
  const bounds = resolveBoardCaptureBounds(selection.nodes, BOARD_CAPTURE_PADDING);
  const scale = resolveBoardCaptureScale(bounds, BOARD_CAPTURE_MAXIMUM_SIDE);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const clone = viewportElement.cloneNode(true) as HTMLElement;
  normalizeCaptureClone(clone, selection, bounds);

  const host = document.createElement('div');
  host.dataset.boardCaptureExclude = 'host';
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
  });
  host.append(clone);
  flowRoot.append(host);

  try {
    const dataUrl = await toPng(clone, {
      width: bounds.width,
      height: bounds.height,
      canvasWidth: width,
      canvasHeight: height,
      backgroundColor,
      pixelRatio: 1,
      cacheBust: true,
      skipAutoScale: false,
      filter: (element) => !element.hasAttribute?.('data-board-capture-exclude'),
    });
    if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
      screenshotFailed('Board capture did not produce a PNG');
    }
    return {
      mimeType: 'image/png',
      base64: dataUrl.slice(PNG_DATA_URL_PREFIX.length),
      width,
      height,
      worldBounds: bounds,
      includedNodeIds: selection.includedNodeIds,
      missingScreenshotNodeIds: resolveMissingScreenshotNodeIds(
        selection.nodes,
        screenshotUrlsByNodeId,
      ),
    };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error) throw error;
    screenshotFailed('Failed to render board screenshot');
  } finally {
    host.remove();
  }
}
