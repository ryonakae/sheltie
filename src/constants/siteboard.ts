// リサイズとドラッグの操作上限
export const PAGE_MIN_WIDTH = 320;
export const PAGE_MIN_HEIGHT = 200;
export const STICKY_NOTE_MIN_WIDTH = 150;
export const STICKY_NOTE_MIN_HEIGHT = 150;
export const DRAG_THRESHOLD = 3;
export const DRAG_REPOSITION_GAP = 20;

// ズーム制御の境界とアニメーション
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 1.5;
export const LOW_ZOOM_HIDE_THRESHOLD = 0.3;
export const ZOOM_RESET_TARGET = 1;
export const ZOOM_RESET_DURATION_SEC = 0.24;
export const ZOOM_ANIMATION_EASE = [0.215, 0.61, 0.355, 1] as const;
export const ZOOM_END_DEBOUNCE_MS = 250;
export const WHEEL_PAN_END_DEBOUNCE_MS = 150;

// スクショ切替の判定しきい値
export const HYSTERESIS_PX = 4;
export const NATIVE_SAFE_MARGIN_PX = 25;
export const NATIVE_SAFE_MARGIN_BOTTOM_PX = 75;
export const PRE_DISPLAY_MARGIN_PX = 50;
export const WEBVIEW_REVEAL_DELAY_MS = 100;

// 付箋色
export const STICKY_NOTE_COLORS = [
  { bgClass: 'bg-yellow-100', borderClass: 'border-yellow-300', textClass: 'text-yellow-500' }, // 薄黄色
  { bgClass: 'bg-pink-100', borderClass: 'border-pink-300', textClass: 'text-pink-500' }, // 薄ピンク
  { bgClass: 'bg-cyan-100', borderClass: 'border-cyan-300', textClass: 'text-cyan-500' }, // 薄水色
  { bgClass: 'bg-emerald-100', borderClass: 'border-emerald-300', textClass: 'text-emerald-500' }, // 薄緑
] as const;
