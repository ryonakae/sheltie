// ビューポート、ページ/付箋/テキストの既定値
export const DEFAULT_VIEWPORT = { zoom: 1, panX: 0, panY: 0 };
export const DEFAULT_PAGE_WIDTH = 393;
export const DEFAULT_PAGE_HEIGHT = 852;
export const DEFAULT_STICKY_NOTE_WIDTH = 200;
export const DEFAULT_STICKY_NOTE_HEIGHT = 200;
export const DEFAULT_TEXT_NODE_WIDTH = 200;
export const DEFAULT_TEXT_NODE_HEIGHT = 32;

// ページ自動配置に関する既定値
export const PAGE_GAP = 100;
export const MAX_VERTICAL_SEARCH_STEPS = 60;

// 永続化時の保存デバウンス
export const SAVE_DEBOUNCE_MS = 500;

// ノード外枠の chrome 高さ
export const WEB_PAGE_TOP_BAR_HEIGHT = 32;
export const WEB_PAGE_BOTTOM_BAR_HEIGHT = 32;

// 空フレーム追加時のセンタリングアニメーション
export const CANVAS_CENTER_ANIMATION_DURATION_SEC = 0.4;
export const CANVAS_CENTER_ANIMATION_EASE = [0.215, 0.61, 0.355, 1] as const;

// デバイスプリセット
export const SIZE_PRESETS = [
  { label: 'モバイル', width: 393, height: 852 },
  { label: 'タブレット', width: 768, height: 1024 },
  { label: 'PC', width: 1280, height: 800 },
] as const;
