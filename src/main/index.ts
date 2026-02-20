import { app, BaseWindow, WebContentsView, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

import { registerProjectStateHandlers } from './store';
import { PageViewManager } from './page-view-manager';
import type { ArtboardLayout, PageBounds } from '../shared/types';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BaseWindow | null = null;
let pageViewManager: PageViewManager | null = null;

registerProjectStateHandlers(() => mainWindow);

const isMac = process.platform === 'darwin';

const TRAFFIC_LIGHT_POSITION = { x: 12, y: 10 };

/**
 * artboard 背景用の HTML (ドットパターン)。
 * bgView に読み込ませてキャンバス背景を描画する。
 */
const BG_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden;
    background-color: #f9fafb;
    background-image: radial-gradient(circle, #d1d5db 1px, transparent 1px);
    background-size: 24px 24px; }
</style></head><body></body></html>`;

const createWindow = () => {
  const win = new BaseWindow({
    width: 800,
    height: 600,
    show: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? { trafficLightPosition: TRAFFIC_LIGHT_POSITION }
      : { titleBarOverlay: { color: '#f3f4f6', symbolColor: '#374151', height: 36 } }),
  });

  mainWindow = win;

  // ── 背景 View (最下層: index=0) ──────────────────────────
  const bgView = new WebContentsView({
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.contentView.addChildView(bgView);
  void bgView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(BG_HTML)}`);

  // ── メイン View (React SPA: index=1, bgView の直上) ───────
  const mainView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // 背景を透明にして pageViews が透けて見えるようにする
  mainView.setBackgroundColor('#00000000');
  win.contentView.addChildView(mainView);

  // ── PageViewManager (pageViews を mainView と bgView の間に挿入) ─
  pageViewManager = new PageViewManager(win, mainView, bgView);

  // ウィンドウ全体を bgView と mainView が占有
  const resizeViews = () => {
    const { width, height } = win.getContentBounds();
    pageViewManager?.resizeViews(width, height);
  };
  resizeViews();
  win.on('resize', resizeViews);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainView.webContents.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainView.webContents.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // BaseWindow は ready-to-show を持たないため、mainView のロード完了をトリガーにする
  mainView.webContents.once('did-finish-load', () => {
    win.show();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainView.webContents.openDevTools();
  }

  // ウィンドウクローズ前にレンダラーへ最終保存を要求し、完了後に破棄する
  let isQuitting = false;
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      isQuitting = true;
      mainView.webContents.send('save-before-close');
    }
  });

  win.on('closed', () => {
    // 全 WebContentsView を明示的に破棄（BaseWindow は自動破棄しない）
    pageViewManager?.destroyAll();
    pageViewManager = null;
    mainWindow = null;
  });

  // ── IPC ハンドラー: PageView 操作 ─────────────────────────

  ipcMain.handle('page-view:create', (_event, projectId: string, pageId: string, url: string) => {
    pageViewManager?.createPageView(projectId, pageId, url);
  });

  ipcMain.handle('page-view:destroy', (_event, pageId: string) => {
    pageViewManager?.destroyPageView(pageId);
  });

  // 高頻度更新のため invoke でなく send (fire-and-forget)
  ipcMain.on(
    'page-view:batch-update-bounds',
    (_event, updates: Array<{ pageId: string; bounds: PageBounds }>, zoom: number) => {
      pageViewManager?.batchUpdateBounds(updates, zoom);
    },
  );

  ipcMain.on('page-view:set-interaction-mode', (_event, isInteracting: boolean) => {
    pageViewManager?.setInteractionMode(isInteracting);
  });

  ipcMain.handle('page-view:show-project', (_event, projectId: string) => {
    pageViewManager?.showProjectPages(projectId);
  });

  ipcMain.on('page-view:bring-to-front', (_event, pageId: string) => {
    pageViewManager?.bringToFront(pageId);
  });

  ipcMain.handle('page-view:destroy-project', (_event, projectId: string) => {
    pageViewManager?.destroyProjectPages(projectId);
  });

  ipcMain.on('page-view:update-artboard-layout', (_event, layout: ArtboardLayout) => {
    pageViewManager?.updateClipBounds(layout);
  });
};

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BaseWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
