const CANVAS_ZOOM_CSS_VAR = 'var(--canvas-zoom, 1)';

export function zoomPx(px: number): string {
  return `calc(${px}px / ${CANVAS_ZOOM_CSS_VAR})`;
}

export function zoomPxList(...values: number[]): string {
  return values.map((value) => (value === 0 ? '0' : zoomPx(value))).join(' ');
}
