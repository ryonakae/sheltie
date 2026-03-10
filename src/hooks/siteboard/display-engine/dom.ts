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
