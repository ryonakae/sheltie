import type { CSSProperties } from 'react';

// StickyNote / WebPage の選択 UI で共通利用する見た目トークン。
export const selectionHandleBaseStyle = {
  width: 'calc(14px / var(--canvas-zoom, 1))',
  height: 'calc(14px / var(--canvas-zoom, 1))',
  border: 'calc(2px / var(--canvas-zoom, 1)) solid #3b82f6',
  borderRadius: 'calc(4px / var(--canvas-zoom, 1))',
  backgroundColor: '#fff',
} satisfies CSSProperties;

export const selectionFrameOverlayStyle = {
  outline: 'calc(2px / var(--canvas-zoom, 1)) solid #3b82f6',
} satisfies CSSProperties;
