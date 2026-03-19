import { MAX_ZOOM, MIN_ZOOM } from '@/constants';
import { getNodeFrameRect } from '@/lib/siteboard-node-frame';
import type { BoardNode } from '@/types';

const FIT_VIEW_PADDING_PX = 64;
const FIT_VIEW_SEARCH_ITERATIONS = 20;

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface SiteboardViewportTarget {
  x: number;
  y: number;
  zoom: number;
}

function createBounds(left: number, top: number, right: number, bottom: number): Bounds {
  const width = right - left;
  const height = bottom - top;
  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

export function getNodeBounds(nodes: BoardNode[], zoom: number): Bounds | null {
  if (nodes.length === 0) return null;

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const rect = getNodeFrameRect(node, zoom);
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }

  return createBounds(left, top, right, bottom);
}

function getCenteredViewport(
  bounds: Bounds,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): SiteboardViewportTarget {
  return {
    x: viewportWidth / 2 - bounds.centerX * zoom,
    y: viewportHeight / 2 - bounds.centerY * zoom,
    zoom,
  };
}

export function resolveCenteredViewport(
  nodes: BoardNode[],
  viewportWidth: number,
  viewportHeight: number,
  zoom = 1,
): SiteboardViewportTarget {
  const bounds = getNodeBounds(nodes, zoom);
  if (!bounds) {
    return { x: 0, y: 0, zoom };
  }

  return getCenteredViewport(bounds, viewportWidth, viewportHeight, zoom);
}

function fitsWithinViewport(
  nodes: BoardNode[],
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  paddingPx: number,
): boolean {
  const bounds = getNodeBounds(nodes, zoom);
  if (!bounds) return true;

  const availableWidth = Math.max(1, viewportWidth - paddingPx * 2);
  const availableHeight = Math.max(1, viewportHeight - paddingPx * 2);

  return bounds.width * zoom <= availableWidth && bounds.height * zoom <= availableHeight;
}

export function resolveFitViewport(
  nodes: BoardNode[],
  viewportWidth: number,
  viewportHeight: number,
  options?: {
    minZoom?: number;
    maxZoom?: number;
    paddingPx?: number;
  },
): SiteboardViewportTarget | null {
  if (nodes.length === 0) return null;

  const minZoom = options?.minZoom ?? MIN_ZOOM;
  const maxZoom = options?.maxZoom ?? MAX_ZOOM;
  const paddingPx = options?.paddingPx ?? FIT_VIEW_PADDING_PX;

  let low = minZoom;
  let high = maxZoom;

  for (let iteration = 0; iteration < FIT_VIEW_SEARCH_ITERATIONS; iteration += 1) {
    const mid = (low + high) / 2;
    if (fitsWithinViewport(nodes, viewportWidth, viewportHeight, mid, paddingPx)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const zoom = fitsWithinViewport(nodes, viewportWidth, viewportHeight, high, paddingPx)
    ? high
    : low;
  const bounds = getNodeBounds(nodes, zoom);
  if (!bounds) return null;

  return getCenteredViewport(bounds, viewportWidth, viewportHeight, zoom);
}
