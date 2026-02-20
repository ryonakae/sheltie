import { View, WebContentsView, session, type BaseWindow } from 'electron';

import type { ArtboardLayout, PageBounds } from '../shared/types';

const PARTITION = 'persist:artboard';

interface PageViewEntry {
  pageId: string;
  projectId: string;
  view: WebContentsView;
}

/**
 * WebContentsView のライフサイクルを管理するクラス。
 * 各ページに対応する WebContentsView の生成・破棄・bounds 更新・z-order 制御を担う。
 */
export class PageViewManager {
  private entries = new Map<string, PageViewEntry>();
  private lastZoom = 1;
  private readonly clipView: View;

  constructor(
    private readonly win: BaseWindow,
    private readonly mainView: WebContentsView,
    private readonly bgView: WebContentsView,
  ) {
    // artboard 領域のクリップコンテナ。子の WebContentsView が artboard 端を超えた場合に
    // 視覚的にクリップされ、WebContents のビューポートサイズは維持されリフローが起きない
    this.clipView = new View();
    this.clipView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    // bgView(0) と mainView の間に clipView を挿入
    this.win.contentView.addChildView(this.clipView, 1);
    // mainView を末尾（最上位）に再配置
    this.win.contentView.addChildView(this.mainView);
  }

  /** ページ用 WebContentsView を生成して contentView に追加 */
  createPageView(projectId: string, pageId: string, url: string): void {
    if (this.entries.has(pageId)) return;

    const ses = session.fromPartition(PARTITION);
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    view.setBackgroundColor('#ffffff');
    // 初期状態は非表示（bounds 設定後に表示）
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

    void view.webContents.loadURL(url);

    // ナビゲーションイベントを mainView のレンダラーに転送
    view.webContents.on('did-navigate', () => {
      const navUrl = view.webContents.getURL();
      const title = view.webContents.getTitle();
      this.mainView.webContents.send('page-view:navigated', pageId, navUrl, title);
    });

    view.webContents.on('did-navigate-in-page', () => {
      const navUrl = view.webContents.getURL();
      const title = view.webContents.getTitle();
      this.mainView.webContents.send('page-view:navigated', pageId, navUrl, title);
    });

    view.webContents.on('page-title-updated', (_event, title) => {
      this.mainView.webContents.send('page-view:title-updated', pageId, title);
    });

    // clipView の子として追加 (末尾 = 最上位)
    this.clipView.addChildView(view);

    this.entries.set(pageId, { pageId, projectId, view });
  }

  /** WebContentsView を破棄 */
  destroyPageView(pageId: string): void {
    const entry = this.entries.get(pageId);
    if (!entry) return;

    this.clipView.removeChildView(entry.view);
    // BaseWindow では webContents は自動破棄されないため明示的にクローズ
    entry.view.webContents.close();
    this.entries.delete(pageId);
  }

  /** 全ページの bounds を一括更新 */
  batchUpdateBounds(updates: Array<{ pageId: string; bounds: PageBounds }>, zoom: number): void {
    const zoomChanged = zoom !== this.lastZoom;
    if (zoomChanged) {
      this.lastZoom = zoom;
    }

    for (const { pageId, bounds } of updates) {
      const entry = this.entries.get(pageId);
      if (!entry) continue;
      entry.view.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.max(0, Math.round(bounds.width)),
        height: Math.max(0, Math.round(bounds.height)),
      });
      if (zoomChanged) {
        entry.view.webContents.setZoomFactor(zoom);
      }
    }
  }

  /**
   * 操作モードの切り替え。
   * - isInteracting=true: mainView を最上位 → [bgView, clipView, mainView]
   * - isInteracting=false: clipView を最上位 → [bgView, mainView, clipView]
   */
  setInteractionMode(isInteracting: boolean): void {
    if (isInteracting) {
      // mainView を末尾（最上位）に移動
      this.win.contentView.addChildView(this.mainView);
    } else {
      // clipView を末尾（最上位）に移動して pageViews をクリック可能にする
      this.win.contentView.addChildView(this.clipView);
    }
  }

  /** 指定プロジェクトのページのみ表示し、他を非表示にする */
  showProjectPages(projectId: string): void {
    for (const entry of this.entries.values()) {
      entry.view.setVisible(entry.projectId === projectId);
    }
  }

  /** 指定ページを clipView 内で最前面に移動 */
  bringToFront(pageId: string): void {
    const entry = this.entries.get(pageId);
    if (!entry) return;

    this.clipView.addChildView(entry.view);
  }

  /** 指定プロジェクトの全 WebContentsView を破棄 */
  destroyProjectPages(projectId: string): void {
    for (const [pageId, entry] of this.entries) {
      if (entry.projectId === projectId) {
        this.clipView.removeChildView(entry.view);
        entry.view.webContents.close();
        this.entries.delete(pageId);
      }
    }
  }

  /** 全 WebContentsView を破棄（ウィンドウクローズ時） */
  destroyAll(): void {
    for (const entry of this.entries.values()) {
      this.clipView.removeChildView(entry.view);
      entry.view.webContents.close();
    }
    this.entries.clear();
  }

  /** clipView の bounds を artboard レイアウトに合わせて更新 */
  updateClipBounds(layout: ArtboardLayout): void {
    this.clipView.setBounds({
      x: layout.offsetX,
      y: layout.offsetY,
      width: layout.areaWidth,
      height: layout.areaHeight,
    });
  }

  /** bgView と mainView の bounds をウィンドウ全体にリサイズ */
  resizeViews(width: number, height: number): void {
    this.bgView.setBounds({ x: 0, y: 0, width, height });
    this.mainView.setBounds({ x: 0, y: 0, width, height });
  }
}
