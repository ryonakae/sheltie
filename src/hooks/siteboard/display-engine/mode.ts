import {
  HYSTERESIS_PX,
  NATIVE_SAFE_MARGIN_BOTTOM_PX,
  NATIVE_SAFE_MARGIN_PX,
  PRE_DISPLAY_MARGIN_PX,
} from '@/constants';
import type { DisplayMode } from '@/types';

export function isOutsideViewport(nodeRect: DOMRect, containerRect: DOMRect): boolean {
  return (
    nodeRect.right <= containerRect.left ||
    nodeRect.left >= containerRect.right ||
    nodeRect.bottom <= containerRect.top ||
    nodeRect.top >= containerRect.bottom
  );
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
