import {
  HYSTERESIS_PX,
  MAX_ZOOM,
  MIN_ZOOM,
  NATIVE_SAFE_MARGIN_BOTTOM_PX,
  NATIVE_SAFE_MARGIN_PX,
} from '@/constants';
import { getNodeFrameRect } from '@/lib/sheltie-node-frame';
import type { BoardNode } from '@/types';

const FIT_VIEW_PADDING_PX = 64;
const FIT_VIEW_SEARCH_ITERATIONS = 20;

export type FitViewportPadding =
  | number
  | { top?: number; right?: number; bottom?: number; left?: number };

interface ResolvedPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

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

export interface SheltieViewportTarget {
  x: number;
  y: number;
  zoom: number;
}

type FitTargetNode = Pick<BoardNode, 'type' | 'x' | 'y' | 'width' | 'height'>;

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

export function getNodeBounds(nodes: FitTargetNode[]): Bounds | null {
  if (nodes.length === 0) return null;

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const rect = getNodeFrameRect(node);
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
): SheltieViewportTarget {
  return {
    x: viewportWidth / 2 - bounds.centerX * zoom,
    y: viewportHeight / 2 - bounds.centerY * zoom,
    zoom,
  };
}

function getCenteredViewportWithPadding(
  bounds: Bounds,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  padding: ResolvedPadding,
): SheltieViewportTarget {
  const availableCenterX = padding.left + (viewportWidth - padding.left - padding.right) / 2;
  const availableCenterY = padding.top + (viewportHeight - padding.top - padding.bottom) / 2;
  return {
    x: availableCenterX - bounds.centerX * zoom,
    y: availableCenterY - bounds.centerY * zoom,
    zoom,
  };
}

export function resolveCenteredViewport(
  nodes: FitTargetNode[],
  viewportWidth: number,
  viewportHeight: number,
  zoom = 1,
): SheltieViewportTarget {
  const bounds = getNodeBounds(nodes);
  if (!bounds) {
    return { x: 0, y: 0, zoom };
  }

  return getCenteredViewport(bounds, viewportWidth, viewportHeight, zoom);
}

function normalizePadding(padding: FitViewportPadding | undefined): ResolvedPadding {
  if (padding == null) {
    return {
      top: FIT_VIEW_PADDING_PX,
      right: FIT_VIEW_PADDING_PX,
      bottom: FIT_VIEW_PADDING_PX,
      left: FIT_VIEW_PADDING_PX,
    };
  }
  if (typeof padding === 'number') {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  return {
    top: padding.top ?? 0,
    right: padding.right ?? 0,
    bottom: padding.bottom ?? 0,
    left: padding.left ?? 0,
  };
}

// webpage の placeholder が display-engine の isFullyInsideNativeSafeArea を満たす必要がある。
// fit 直後に screenshot へ降格しないよう、hysteresis 分を足して安全側で底上げする。
function applyNativeSafeAreaFloor(base: ResolvedPadding, nodes: FitTargetNode[]): ResolvedPadding {
  const containsWebpage = nodes.some((node) => node.type === 'webpage');
  if (!containsWebpage) return base;
  return {
    top: Math.max(base.top, NATIVE_SAFE_MARGIN_PX + HYSTERESIS_PX),
    right: Math.max(base.right, NATIVE_SAFE_MARGIN_PX + HYSTERESIS_PX),
    bottom: Math.max(base.bottom, NATIVE_SAFE_MARGIN_BOTTOM_PX + HYSTERESIS_PX),
    left: Math.max(base.left, NATIVE_SAFE_MARGIN_PX + HYSTERESIS_PX),
  };
}

function fitsWithinViewport(
  bounds: Bounds,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  padding: ResolvedPadding,
): boolean {
  const availableWidth = Math.max(1, viewportWidth - padding.left - padding.right);
  const availableHeight = Math.max(1, viewportHeight - padding.top - padding.bottom);
  return bounds.width * zoom <= availableWidth && bounds.height * zoom <= availableHeight;
}

/**
 * 与えられたノード群がビューポートに収まる zoom + pan を求める。
 *
 * - `padding` には数値または `{ top, right, bottom, left }` を指定可能。未指定方向は 0 として扱う。
 * - 旧 API の `paddingPx: number` も後方互換で受け付ける。`padding` が指定されていればそちらを優先。
 * - ノードに `webpage` が 1 つでも含まれていれば、display-engine の native safe area を満たすため
 *   padding を `NATIVE_SAFE_MARGIN_(BOTTOM_)PX + HYSTERESIS_PX` 以上に自動で底上げする。
 *   テキスト・付箋のみのケースは底上げ未発動で従来挙動を維持する。
 */
export function resolveFitViewport(
  nodes: FitTargetNode[],
  viewportWidth: number,
  viewportHeight: number,
  options?: {
    minZoom?: number;
    maxZoom?: number;
    paddingPx?: number;
    padding?: FitViewportPadding;
  },
): SheltieViewportTarget | null {
  if (nodes.length === 0) return null;

  const minZoom = options?.minZoom ?? MIN_ZOOM;
  const maxZoom = options?.maxZoom ?? MAX_ZOOM;
  const basePadding = normalizePadding(options?.padding ?? options?.paddingPx);
  const padding = applyNativeSafeAreaFloor(basePadding, nodes);

  const bounds = getNodeBounds(nodes);
  if (!bounds) return null;

  let low = minZoom;
  let high = maxZoom;

  for (let iteration = 0; iteration < FIT_VIEW_SEARCH_ITERATIONS; iteration += 1) {
    const mid = (low + high) / 2;
    if (fitsWithinViewport(bounds, viewportWidth, viewportHeight, mid, padding)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const zoom = fitsWithinViewport(bounds, viewportWidth, viewportHeight, high, padding)
    ? high
    : low;

  return getCenteredViewportWithPadding(bounds, viewportWidth, viewportHeight, zoom, padding);
}
