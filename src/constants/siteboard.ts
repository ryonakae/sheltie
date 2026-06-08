// リサイズとドラッグの操作上限
export const PAGE_MIN_WIDTH = 320;
export const PAGE_MIN_HEIGHT = 200;
export const STICKY_NOTE_MIN_WIDTH = 200;
export const STICKY_NOTE_MIN_HEIGHT = 200;
export const DRAG_THRESHOLD = 3;
export const DRAG_REPOSITION_GAP = 20;

// ズーム制御の境界とアニメーション
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 1.5;
export const ZOOM_SENSITIVITY = 0.001;
export const ZOOM_RESET_TARGET = 1;
export const ZOOM_RESET_DURATION_SEC = 0.24;
export const ZOOM_ANIMATION_EASE = [0.215, 0.61, 0.355, 1] as const;
export const ZOOM_END_DEBOUNCE_MS = 250;
export const WHEEL_PAN_END_DEBOUNCE_MS = 150;
// キーボードショートカットで使うズームのステップ値
export const ZOOM_STEPS = [0.25, 0.5, 1.0, 1.5] as const;

// スクショ切替の判定しきい値
export const HYSTERESIS_PX = 4;
export const NATIVE_SAFE_MARGIN_PX = 25;
export const NATIVE_SAFE_MARGIN_BOTTOM_PX = 96;
export const PRE_DISPLAY_MARGIN_PX = 50;
export const WEBVIEW_REVEAL_DELAY_MS = 100;

// 鮮度キャプチャ（保存スクショを最新に保つ撮影）の遅延。トリガ種別ごとに要求が異なる。
// nav は新コンテンツの描画待ち、load/scroll は既に描画済み/停止済みのため即時。
export const FRESHNESS_CAPTURE_DELAY_MS = {
  navigation: 1000,
  load: 0,
  scroll: 0,
} as const;

// テキストノードの最小幅
export const TEXT_NODE_MIN_WIDTH = 40;

// テキストノードのフォントサイズプリセット (S / M / L / XL)
export const TEXT_NODE_FONT_SIZE_PRESETS = [12, 16, 24, 36] as const;

// テキストノードの文字色プリセット（HeroUI セマンティックカラーに連動）
// value は HeroUI v3 の CSS 変数で、light/dark テーマに自動追従する
export const TEXT_NODE_COLORS = [
  { label: 'Foreground', value: 'var(--foreground)' },
  { label: 'Muted', value: 'var(--muted)' },
  { label: 'Accent', value: 'var(--accent)' },
  { label: 'Success', value: 'var(--success)' },
  { label: 'Warning', value: 'var(--warning)' },
  { label: 'Danger', value: 'var(--danger)' },
] as const;

// 付箋色
export const STICKY_NOTE_COLORS = [
  {
    bgClass: 'bg-yellow-100',
    borderClass: 'border-yellow-300',
    textClass: 'text-yellow-500',
    dividerColor: 'var(--color-yellow-300)',
  }, // 薄黄色
  {
    bgClass: 'bg-pink-100',
    borderClass: 'border-pink-300',
    textClass: 'text-pink-500',
    dividerColor: 'var(--color-pink-300)',
  }, // 薄ピンク
  {
    bgClass: 'bg-cyan-100',
    borderClass: 'border-cyan-300',
    textClass: 'text-cyan-500',
    dividerColor: 'var(--color-cyan-300)',
  }, // 薄水色
  {
    bgClass: 'bg-emerald-100',
    borderClass: 'border-emerald-300',
    textClass: 'text-emerald-500',
    dividerColor: 'var(--color-emerald-300)',
  }, // 薄緑
] as const;
