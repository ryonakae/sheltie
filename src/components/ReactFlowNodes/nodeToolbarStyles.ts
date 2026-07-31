/**
 * ノード / エッジのツールバー段で共有する外観。
 * StickyNote / Text / WebPage / Arrow の 4 ツールバーで重複していた定義を集約したもの。
 */

/** ツールバーのコンテナ（pill）。ArrowToolbar は先頭に `nodrag nopan` を足す */
export const TOOLBAR_CONTAINER_CLASSNAME =
  'flex items-center gap-0.5 rounded-lg bg-zinc-800 px-1 py-0.5 shadow-lg';

/**
 * ボタンの共通部分（hover を含まない）。
 * WebPageToolbar は無効状態のボタンを持つため hover を条件付きで足す。
 */
export const TOOLBAR_BUTTON_BASE_CLASSNAME =
  'nodrag flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-medium transition-colors';

/** 常に hover するボタン用 */
export const TOOLBAR_BUTTON_CLASSNAME = `${TOOLBAR_BUTTON_BASE_CLASSNAME} hover:bg-white/20`;

export const TOOLBAR_BUTTON_ACTIVE_CLASSNAME = 'bg-white/25 text-white';

export const TOOLBAR_BUTTON_INACTIVE_CLASSNAME = 'text-white/70';

export const TOOLBAR_DIVIDER_CLASSNAME = 'mx-0.5 h-4 w-px bg-white/20';

/** カラースウォッチ（付箋色 / エッジ色） */
export const TOOLBAR_SWATCH_CLASSNAME =
  'nodrag flex size-7 items-center justify-center rounded-sm transition-colors hover:bg-white/20';

export const TOOLBAR_SWATCH_ACTIVE_CLASSNAME = 'bg-white/25';
