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

// ページ表示関連のヘッダー高さ
export const PAGE_CHROME_HEIGHT = 48;

// 空フレーム追加時のセンタリングアニメーション
export const CANVAS_CENTER_ANIMATION_DURATION_SEC = 0.4;
export const CANVAS_CENTER_ANIMATION_EASE = [0.215, 0.61, 0.355, 1] as const;

// デバイスプリセット
export const SIZE_PRESETS = [
  { label: 'モバイル', width: 375, height: 812 },
  { label: 'タブレット', width: 768, height: 1024 },
  { label: 'PC', width: 1280, height: 800 },
] as const;
