import { WEB_PAGE_FRAME_PADDING } from '@/constants';
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

// Webサイトノードはコンテンツ（Webview）の上下左右に world 固定 padding を持つ。
// テキスト/付箋ノードはフレーム padding を持たない（chrome=0）。
function getFramePadding(node: Pick<BoardNode, 'type'>): number {
  if (node.type === 'text' || node.type === 'stickynote') {
    return 0;
  }
  return WEB_PAGE_FRAME_PADDING;
}

export function getNodeChromeHeight(node: Pick<BoardNode, 'type'>): number {
  return getFramePadding(node) * 2;
}

export function getNodeChromeWidth(node: Pick<BoardNode, 'type'>): number {
  return getFramePadding(node) * 2;
}

export function getNodeFrameHeight(node: Pick<BoardNode, 'type' | 'height'>): number {
  return node.height + getNodeChromeHeight(node);
}

export function getNodeFrameWidth(node: Pick<BoardNode, 'type' | 'width'>): number {
  return node.width + getNodeChromeWidth(node);
}

export function getNodeFrameRect(
  node: Pick<BoardNode, 'type' | 'x' | 'y' | 'width' | 'height'>,
): NodeFrameRect {
  const width = getNodeFrameWidth(node);
  const height = getNodeFrameHeight(node);
  return {
    x: node.x,
    y: node.y,
    width,
    height,
    left: node.x,
    top: node.y,
    right: node.x + width,
    bottom: node.y + height,
  };
}
