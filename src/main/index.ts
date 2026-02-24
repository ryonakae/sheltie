import { app, BaseWindow, WebContentsView, ipcMain, nativeTheme } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

import { registerProjectStateHandlers, getTheme, setTheme } from './store';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BaseWindow | null = null;

registerProjectStateHandlers(() => mainWindow);

const isMac = process.platform === 'darwin';

const TRAFFIC_LIGHT_POSITION = { x: 12, y: 10 };

/** Windows の titleBarOverlay をテーマに合わせて更新する */
function updateTitleBarOverlay(win: BaseWindow, isDark: boolean): void {
  if (isMac) return;
  win.setTitleBarOverlay(
    isDark
      ? { color: '#18181b', symbolColor: '#a1a1aa', height: 36 }
      : { color: '#f3f4f6', symbolColor: '#374151', height: 36 },
  );
}

const createWindow = () => {
  // 保存済みテーマを読み込み nativeTheme に反映
  const savedTheme = getTheme();
  nativeTheme.themeSource = savedTheme;
  const initialIsDark = nativeTheme.shouldUseDarkColors;

  const win = new BaseWindow({
    width: 800,
    height: 600,
    show: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? { trafficLightPosition: TRAFFIC_LIGHT_POSITION }
      : {
          titleBarOverlay: initialIsDark
            ? { color: '#18181b', symbolColor: '#a1a1aa', height: 36 }
            : { color: '#f3f4f6', symbolColor: '#374151', height: 36 },
        }),
  });

  mainWindow = win;

  // ── メイン View (React SPA) ────────────────────────────────
  // webviewTag: true で <webview> タグを有効化し、React DOM 内でウェブページを描画する
  const mainView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  win.contentView.addChildView(mainView);

  // OS のテーマ変更を監視して反映
  nativeTheme.on('updated', () => {
    const isDark = nativeTheme.shouldUseDarkColors;
    updateTitleBarOverlay(win, isDark);
    mainView.webContents.send('theme:changed', isDark);
  });

  // ウィンドウ全体を mainView が占有
  const resizeViews = () => {
    const { width, height } = win.getContentBounds();
    mainView.setBounds({ x: 0, y: 0, width, height });
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
    mainWindow = null;
  });

  // ── IPC ハンドラー: テーマ ─────────────────────────────────

  ipcMain.handle('theme:load', () => getTheme());

  ipcMain.handle('theme:set', (_event, mode: string) => {
    const validModes = ['system', 'light', 'dark'] as const;
    type ThemeMode = (typeof validModes)[number];
    if (!validModes.includes(mode as ThemeMode)) return false;
    setTheme(mode as ThemeMode);
    nativeTheme.themeSource = mode as ThemeMode;
    return nativeTheme.shouldUseDarkColors;
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
