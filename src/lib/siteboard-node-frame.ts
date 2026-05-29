import { WEB_PAGE_BOTTOM_BAR_HEIGHT, WEB_PAGE_TOP_BAR_HEIGHT } from '@/constants';
import type { BoardNode } from '@/types';

export interface NodeFrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function resolveLayoutZoom(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

export function getNodeChromeScreenHeight(node: Pick<BoardNode, 'type'>): number {
  if (node.type === 'text' || node.type === 'stickynote') {
    return 0;
  }

  return WEB_PAGE_TOP_BAR_HEIGHT + WEB_PAGE_BOTTOM_BAR_HEIGHT;
}

// ノード chrome は zoomPx で画面上の px が固定されるため、world 座標では zoom に応じて占有高さが変わる。
export function getNodeChromeHeight(node: Pick<BoardNode, 'type'>, zoom: number): number {
  return getNodeChromeScreenHeight(node) / resolveLayoutZoom(zoom);
}

export function getNodeFrameHeight(node: Pick<BoardNode, 'type' | 'height'>, zoom: number): number {
  return node.height + getNodeChromeHeight(node, zoom);
}

export function getNodeFrameRect(
  node: Pick<BoardNode, 'type' | 'x' | 'y' | 'width' | 'height'>,
  zoom: number,
): NodeFrameRect {
  const height = getNodeFrameHeight(node, zoom);
  return {
    x: node.x,
    y: node.y,
    width: node.width,
    height,
    left: node.x,
    top: node.y,
    right: node.x + node.width,
    bottom: node.y + height,
  };
}
