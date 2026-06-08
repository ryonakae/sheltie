// Webview レイアウト系の DEV ログ/計測ユーティリティ。
// display-engine と webview lifecycle で共有する（重複定義を避ける）。

export interface SerializedRect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export function roundDebugValue(value: number): number {
  return Number(value.toFixed(2));
}

export function serializeRect(rect: DOMRect | null): SerializedRect | null {
  if (!rect) return null;
  return {
    left: roundDebugValue(rect.left),
    top: roundDebugValue(rect.top),
    width: roundDebugValue(rect.width),
    height: roundDebugValue(rect.height),
    right: roundDebugValue(rect.right),
    bottom: roundDebugValue(rect.bottom),
  };
}

export function readCanvasZoomDebugValue(element: HTMLElement | null): string | null {
  if (!element) return null;
  const container = element.closest('[data-siteboard-container]') as HTMLElement | null;
  if (!container) return null;
  const computedValue = window.getComputedStyle(container).getPropertyValue('--canvas-zoom').trim();
  return computedValue || container.style.getPropertyValue('--canvas-zoom') || null;
}

/** `[webview-layout][scope] message` 形式で DEV 時のみ console 出力するロガーを生成する */
export function createScopedLogger(
  scope: string,
): (message: string, details: Record<string, unknown>) => void {
  return (message, details) => {
    if (!import.meta.env.DEV) return;
    console.info(`[webview-layout][${scope}] ${message}`, details);
  };
}
