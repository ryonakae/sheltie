import type { ArtboardLayout, PageBounds } from '../../shared/types';
import type { Page, Viewport } from '../types/tab';

/** PageTitleBar の高さ (h-8 = 32px)。WebContentsView の bounds はタイトルバーの下から開始する */
export const TITLE_BAR_HEIGHT = 32;

/** リサイズハンドル用インセット (px)。pageView の bounds をこの幅だけ内側にずらして
 * 外縁の React DOM ハンドルがクリック可能な領域を確保する */
export const RESIZE_INSET = 4;

/** タブバーの高さ (h-9 = 36px) */
export const TAB_BAR_HEIGHT = 36;

/**
 * キャンバス座標系の Page を clipView 相対の bounds に変換する。
 * タイトルバー・リサイズハンドル分のオフセットを考慮する。
 * artboard 領域でのクリッピングは clipView が担うため、ここでは行わない。
 */
export function calcPageScreenBounds(page: Page, viewport: Viewport): PageBounds {
  const { zoom, panX, panY } = viewport;

  // clipView の原点が artboard 左上なので layout.offsetX/offsetY は不要
  const x = (page.x + RESIZE_INSET) * zoom + panX;
  const y = (page.y + TITLE_BAR_HEIGHT + RESIZE_INSET) * zoom + panY;
  const width = (page.width - RESIZE_INSET * 2) * zoom;
  const height = (page.height - RESIZE_INSET) * zoom;

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height)),
  };
}

/** 全ページの bounds を一括計算する */
export function calcAllPageBounds(
  pages: Page[],
  viewport: Viewport,
): Array<{ pageId: string; bounds: PageBounds }> {
  return pages.map((page) => ({
    pageId: page.id,
    bounds: calcPageScreenBounds(page, viewport),
  }));
}

/**
 * artboard レイアウトを算出する。
 * containerRef の getBoundingClientRect() から artboard 領域の位置・サイズを取得する。
 */
export function calcArtboardLayout(containerEl: HTMLElement): ArtboardLayout {
  const rect = containerEl.getBoundingClientRect();
  return {
    offsetX: Math.round(rect.left),
    offsetY: Math.round(rect.top),
    areaWidth: Math.round(rect.width),
    areaHeight: Math.round(rect.height),
  };
}
