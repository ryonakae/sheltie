import {
  HYSTERESIS_PX,
  NATIVE_SAFE_MARGIN_BOTTOM_PX,
  NATIVE_SAFE_MARGIN_PX,
  PRE_DISPLAY_MARGIN_PX,
} from '@/constants';
import type { DisplayMode } from '@/types';

import type { SelectionToolbarRect } from './dom';

export function isOutsideViewport(nodeRect: DOMRect, containerRect: DOMRect): boolean {
  return (
    nodeRect.right <= containerRect.left ||
    nodeRect.left >= containerRect.right ||
    nodeRect.bottom <= containerRect.top ||
    nodeRect.top >= containerRect.bottom
  );
}

export function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function isFullyInsideNativeSafeArea(nodeRect: DOMRect, containerRect: DOMRect): boolean {
  return (
    nodeRect.left >= containerRect.left + NATIVE_SAFE_MARGIN_PX - HYSTERESIS_PX &&
    nodeRect.right <= containerRect.right - NATIVE_SAFE_MARGIN_PX + HYSTERESIS_PX &&
    nodeRect.top >= containerRect.top + NATIVE_SAFE_MARGIN_PX - HYSTERESIS_PX &&
    nodeRect.bottom <= containerRect.bottom - NATIVE_SAFE_MARGIN_BOTTOM_PX + HYSTERESIS_PX
  );
}

export function isOutsideExpandedViewport(nodeRect: DOMRect, containerRect: DOMRect): boolean {
  return (
    nodeRect.right <= containerRect.left - PRE_DISPLAY_MARGIN_PX ||
    nodeRect.left >= containerRect.right + PRE_DISPLAY_MARGIN_PX ||
    nodeRect.bottom <= containerRect.top - PRE_DISPLAY_MARGIN_PX ||
    nodeRect.top >= containerRect.bottom + PRE_DISPLAY_MARGIN_PX
  );
}

export function resolveViewportDisplayMode(
  nodeRect: DOMRect,
  containerRect: DOMRect,
  hasStoredScreenshot: boolean,
): DisplayMode {
  if (isOutsideViewport(nodeRect, containerRect)) {
    return 'hidden';
  }
  if (isFullyInsideNativeSafeArea(nodeRect, containerRect)) {
    return 'native';
  }
  return hasStoredScreenshot ? 'screenshot' : 'native';
}

export interface DisplayModeDemotionFlags {
  unsavedChangesDialogOpen: boolean;
  isContextMenuTarget: boolean;
  isSettling: boolean;
  isToolbarOccluded: boolean;
}

// native のときだけ、いずれかの降格条件が立っていれば screenshot/hidden へ落とす。
// screenshot が無ければ hidden に退避する。
export function applyDisplayModeDemotions(
  initialMode: DisplayMode,
  hasDisplayableScreenshot: boolean,
  flags: DisplayModeDemotionFlags,
): DisplayMode {
  if (initialMode !== 'native') return initialMode;
  const shouldDemote =
    flags.unsavedChangesDialogOpen ||
    flags.isContextMenuTarget ||
    flags.isSettling ||
    flags.isToolbarOccluded;
  if (!shouldDemote) return 'native';
  return hasDisplayableScreenshot ? 'screenshot' : 'hidden';
}

// 選択中ノードのツールバーが対象ページに被っているか。自分自身のツールバーは除外する。
export function isToolbarOccluded(
  nodeId: string,
  nodeRect: DOMRect,
  toolbarRects: SelectionToolbarRect[],
): boolean {
  return toolbarRects.some(
    (toolbar) => toolbar.ownerId !== nodeId && rectsOverlap(toolbar.rect, nodeRect),
  );
}

// macOS で screenshot→native へ復帰する際は show/hide ではなく opacity を 0→1 でフェードさせる。
// それ以外（他 OS、別の遷移）は通常の show/hide で良い。
export function shouldUseOpacityReveal(
  isMacOs: boolean,
  currentAttr: DisplayMode,
  nextMode: DisplayMode,
): boolean {
  return isMacOs && currentAttr === 'screenshot' && nextMode === 'native';
}
