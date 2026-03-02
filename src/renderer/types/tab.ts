export const HOME_ID = '__home__' as const;

/** ネイティブ Webview の表示モード */
export type DisplayMode = 'native' | 'screenshot' | 'hidden';

/** ページの種類 */
export type PageType = 'webpage' | 'stickynote';

export interface Page {
  id: string;
  url: string;
  title: string;
  /** ページ種別（undefined は 'webpage' として扱う・後方互換） */
  type?: PageType;
  /** 追加時点のURLを保持し、リダイレクト後でも一覧で参照可能にする */
  addedUrl?: string;
  /** 付箋のテキスト内容 */
  content?: string;
  /** 付箋のカラーインデックス（STICKY_NOTE_COLORS への参照） */
  colorIndex?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: number;
  /** Tauri Webview のラベル（ランタイムのみ・永続化不要） */
  webviewLabel?: string;
}

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export const DEFAULT_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 };
export const DEFAULT_PAGE_WIDTH = 375;
export const DEFAULT_PAGE_HEIGHT = 812;
export const DEFAULT_STICKY_NOTE_WIDTH = 200;
export const DEFAULT_STICKY_NOTE_HEIGHT = 200;

/** 付箋のカラーパレット */
export const STICKY_NOTE_COLORS = [
  { bg: '#FFF9C4', border: '#FBC02D' }, // 薄黄色
  { bg: '#FCE4EC', border: '#E91E63' }, // 薄ピンク
  { bg: '#E0F7FA', border: '#00ACC1' }, // 薄水色
  { bg: '#E8F5E9', border: '#43A047' }, // 薄緑
] as const;

export interface SizePreset {
  label: string;
  width: number;
  height: number;
}

export const SIZE_PRESETS: readonly SizePreset[] = [
  { label: 'モバイル', width: 375, height: 812 },
  { label: 'タブレット', width: 768, height: 1024 },
  { label: 'PC', width: 1280, height: 800 },
];

export interface Project {
  id: string;
  title: string;
  sidebarWidth: number;
  createdAt: number;
  pages: Page[];
  viewport: Viewport;
}

/** URL 未設定の空フレームかどうか */
export function isPageEmpty(page: Page): boolean {
  return page.url === '';
}

/** 付箋ページかどうか */
export function isStickyNote(page: Page): boolean {
  return page.type === 'stickynote';
}

/** Webページかどうか（type が undefined の場合も 'webpage' 扱い = 後方互換） */
export function isWebPage(page: Page): boolean {
  return !isStickyNote(page);
}

/**
 * ページが追加時の URL から別ページに遷移したかどうかを判定する。
 * URL の正規化（末尾スラッシュ等）を考慮して比較する。
 */
export function isPageMoved(page: Page): boolean {
  if (!page.addedUrl) return false;
  try {
    return new URL(page.addedUrl).href !== new URL(page.url).href;
  } catch {
    return page.addedUrl !== page.url;
  }
}

export interface ProjectState {
  /** 全永続プロジェクト */
  projects: Project[];
  /** タブバーに表示中のプロジェクト ID（順序がタブの並び順） */
  openIds: string[];
  /** 現在アクティブなプロジェクト ID（HOME_ID の場合はホーム画面） */
  activeId: string;
}
