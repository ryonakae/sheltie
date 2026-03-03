// キャンバス/ツールバーのサイズはキャンバスズーム基準で計算する
export const CANVAS_ZOOM_VAR = 'var(--canvas-zoom, 1)';

// ツールバーのサイズ/余白/角丸
export const TOOLBAR_HEIGHT = `calc(24px / ${CANVAS_ZOOM_VAR})`;
export const TOOLBAR_RADIUS = `calc(8px / ${CANVAS_ZOOM_VAR})`;
export const TOOLBAR_ICON_SIZE = `calc(14px / ${CANVAS_ZOOM_VAR})`;
export const TOOLBAR_PADDING = `calc(8px / ${CANVAS_ZOOM_VAR})`;
export const TOOLBAR_BUTTON_PADDING = `calc(2px / ${CANVAS_ZOOM_VAR})`;
export const TOOLBAR_GAP = `calc(6px / ${CANVAS_ZOOM_VAR})`;

// ツールチップと小サイズアイコンボタンの既定値
export const DEFAULT_TOOLTIP_DELAY = 300;
export const XS_ICON_BUTTON_CLASS = 'h-6 min-h-6 w-6 min-w-6 px-0';

// ホームID、ビューポート、ページ/付箋の既定値
export const HOME_ID = '__home__' as const;
export const DEFAULT_VIEWPORT = { zoom: 1, panX: 0, panY: 0 };
export const DEFAULT_PAGE_WIDTH = 375;
export const DEFAULT_PAGE_HEIGHT = 812;
export const DEFAULT_STICKY_NOTE_WIDTH = 200;
export const DEFAULT_STICKY_NOTE_HEIGHT = 200;

// サイドバー・ページ自動配置に関する既定値
export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 384;
export const SIDEBAR_DEFAULT_WIDTH = 240;
export const PAGE_GAP = 100;
export const MAX_VERTICAL_SEARCH_STEPS = 60;

// 永続化時の保存デバウンス
export const SAVE_DEBOUNCE_MS = 500;

// リサイズとドラッグの操作上限
export const PAGE_MIN_WIDTH = 320;
export const PAGE_MIN_HEIGHT = 200;
export const DRAG_THRESHOLD = 3;

// ズーム制御の境界とアニメーション
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 1.5;
export const ZOOM_SENSITIVITY = 0.001;
export const ZOOM_RESET_TARGET = 1;
export const ZOOM_RESET_DURATION_SEC = 0.24;
export const ZOOM_ANIMATION_EASE = [0.215, 0.61, 0.355, 1] as const;
export const ZOOM_END_DEBOUNCE_MS = 250;
export const WHEEL_PAN_END_DEBOUNCE_MS = 150;
export const ZOOM_REFLOW_SETTLE_MS = 180;
export const ZOOM_REFLOW_SETTLE_RAF_COUNT = 2;

// ページ表示関連のヘッダー高さ
export const PAGE_CHROME_HEIGHT = 48;

// スクショ切替の判定しきい値
export const HYSTERESIS_PX = 4;
export const NATIVE_SAFE_MARGIN_PX = 50;
export const PRE_CAPTURE_MARGIN_PX = 50;
export const CAPTURE_MIN_INTERVAL_MS = 1000;
export const PRE_DISPLAY_MARGIN_PX = 50;
export const SCREENSHOT_REFRESH_INTERVAL_MS = 2000;

// リサイズハンドル描画サイズ
export const CANVAS_ZOOM_BASE = `calc(12px / ${CANVAS_ZOOM_VAR})`;
export const PAGE_RESIZE_HANDLE_SIZE = CANVAS_ZOOM_BASE;
export const PAGE_RESIZE_HANDLE_OFFSET = CANVAS_ZOOM_BASE;
export const PAGE_RESIZE_CORNER_SIZE = CANVAS_ZOOM_BASE;

// 空フレーム追加時のセンタリングアニメーション
export const CANVAS_CENTER_ANIMATION_DURATION_SEC = 0.4;
export const CANVAS_CENTER_ANIMATION_EASE = [0.215, 0.61, 0.355, 1] as const;

// 付箋色とデバイスプリセット
export const STICKY_NOTE_COLORS = [
  { bgClass: 'bg-yellow-100', borderClass: 'border-yellow-300', textClass: 'text-yellow-700' }, // 薄黄色
  { bgClass: 'bg-pink-100', borderClass: 'border-pink-300', textClass: 'text-pink-700' }, // 薄ピンク
  { bgClass: 'bg-cyan-100', borderClass: 'border-cyan-300', textClass: 'text-cyan-700' }, // 薄水色
  { bgClass: 'bg-emerald-100', borderClass: 'border-emerald-300', textClass: 'text-emerald-700' }, // 薄緑
] as const;

export const SIZE_PRESETS = [
  { label: 'モバイル', width: 375, height: 812 },
  { label: 'タブレット', width: 768, height: 1024 },
  { label: 'PC', width: 1280, height: 800 },
] as const;
