// リサイズとドラッグの操作上限
export const PAGE_MIN_WIDTH = 320;
export const PAGE_MIN_HEIGHT = 200;
export const DRAG_THRESHOLD = 3;

// ズーム制御の境界とアニメーション
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 1.5;
export const LOW_ZOOM_HIDE_THRESHOLD = 0.3;
export const ZOOM_SENSITIVITY = 0.001;
export const ZOOM_RESET_TARGET = 1;
export const ZOOM_RESET_DURATION_SEC = 0.24;
export const ZOOM_ANIMATION_EASE = [0.215, 0.61, 0.355, 1] as const;
export const ZOOM_END_DEBOUNCE_MS = 250;
export const WHEEL_PAN_END_DEBOUNCE_MS = 150;

// スクショ切替の判定しきい値
export const HYSTERESIS_PX = 4;
export const NATIVE_SAFE_MARGIN_PX = 50;
export const PRE_CAPTURE_MARGIN_PX = 50;
export const CAPTURE_MIN_INTERVAL_MS = 1000;
export const PRE_DISPLAY_MARGIN_PX = 50;
export const SCREENSHOT_REFRESH_INTERVAL_MS = 2000;

// 付箋色
export const STICKY_NOTE_COLORS = [
  { bgClass: 'bg-yellow-100', borderClass: 'border-yellow-300', textClass: 'text-yellow-700' }, // 薄黄色
  { bgClass: 'bg-pink-100', borderClass: 'border-pink-300', textClass: 'text-pink-700' }, // 薄ピンク
  { bgClass: 'bg-cyan-100', borderClass: 'border-cyan-300', textClass: 'text-cyan-700' }, // 薄水色
  { bgClass: 'bg-emerald-100', borderClass: 'border-emerald-300', textClass: 'text-emerald-700' }, // 薄緑
] as const;
