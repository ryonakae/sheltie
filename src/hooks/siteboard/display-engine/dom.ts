import type { DisplayMode } from '@/types';

export interface WebPageElements {
  wrapper: HTMLElement | null;
  placeholder: HTMLElement | null;
}

export function getWebPageElements(
  canvasEl: HTMLDivElement | null,
  nodeId: string,
): WebPageElements {
  const wrapper = canvasEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null;
  const placeholder = wrapper?.querySelector('[data-webview-placeholder]') as HTMLElement | null;
  return { wrapper, placeholder };
}

export function setDisplayModeAttribute(wrapper: HTMLElement | null, mode: DisplayMode): void {
  if (wrapper?.getAttribute('data-display-mode') !== mode) {
    wrapper?.setAttribute('data-display-mode', mode);
  }
}

export interface SelectionToolbarRect {
  ownerId: string;
  rect: DOMRect;
}

// 単独選択時に表示されるノードツールバー（data-node-toolbar）の矩形を集める。
// ネイティブ Webview の上に重なるとツールバーが下に潜るため、降格判定の入力に使う。
export function getSelectionToolbarRects(canvasEl: HTMLElement | null): SelectionToolbarRect[] {
  if (!canvasEl) return [];
  const elements = canvasEl.querySelectorAll<HTMLElement>('[data-node-toolbar]');
  const rects: SelectionToolbarRect[] = [];
  elements.forEach((element) => {
    rects.push({
      ownerId: element.getAttribute('data-node-toolbar') ?? '',
      rect: element.getBoundingClientRect(),
    });
  });
  return rects;
}
