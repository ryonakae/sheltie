import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { Webview } from '@tauri-apps/api/webview';

import type { ProjectState } from '@/shared/types';
import type { ThemeMode } from '@/shared/types';

// ── プロジェクト状態 ─────────────────────────────────────────────

export const api = {
  loadProjectState: (): Promise<ProjectState> => invoke('load_project_state'),

  saveProjectState: (state: ProjectState): Promise<void> => invoke('save_project_state', { state }),

  onSaveBeforeClose: (callback: () => void): void => {
    // Tauri の CloseRequested イベントでクローズ前保存を処理
    void getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      callback();
    });
  },

  closeReady: (state: ProjectState): Promise<void> => invoke('close_ready', { state }),
};

// ── テーマ ───────────────────────────────────────────────────────

export const themeApi = {
  loadTheme: (): Promise<ThemeMode> => invoke('load_theme'),

  setTheme: (mode: ThemeMode): Promise<boolean> => invoke('set_theme', { mode }),

  onThemeChanged: (callback: (isDark: boolean) => void): void => {
    void getCurrentWindow().onThemeChanged(({ payload }) => {
      callback(payload === 'dark');
    });
  },
};

// ── Webview 管理 ─────────────────────────────────────────────────

/**
 * ラベルから Webview ハンドルを同期取得する。
 * `skip: true` により IPC なしでインスタンスを構築できる（Tauri 内部の安定パターン）。
 * 存在しないラベルでの操作は各メソッドの try-catch で吸収する。
 */
function getWebviewHandle(label: string): Webview {
  // @ts-expect-error skip は公開 API に型定義がないが Tauri 内部で使用されている安定パターン
  return new Webview(getCurrentWindow(), label, { skip: true });
}

export const webviewApi = {
  /** ページ用ネイティブ Webview を作成する（Rust でイベントハンドラーも登録） */
  create: (
    pageId: string,
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<string> => invoke('create_page_webview', { pageId, url, x, y, width, height }),

  /** Webview の位置・サイズを更新 */
  async updateBounds(
    label: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<void> {
    try {
      const wv = getWebviewHandle(label);
      await Promise.all([
        wv.setPosition(new LogicalPosition(x, y)),
        wv.setSize(new LogicalSize(width, height)),
      ]);
    } catch {
      // Webview 未作成・既破棄時は no-op
    }
  },

  async hide(label: string): Promise<void> {
    try {
      await getWebviewHandle(label).hide();
    } catch {
      // no-op
    }
  },

  async show(label: string): Promise<void> {
    try {
      await getWebviewHandle(label).show();
    } catch {
      // no-op
    }
  },

  async destroy(label: string): Promise<void> {
    try {
      await getWebviewHandle(label).close();
    } catch {
      // no-op
    }
  },

  /** 複数 Webview を一括非表示（ドラッグ/ズーム/パン操作開始時） */
  async hideAll(labels: string[]): Promise<void> {
    await Promise.all(labels.map((l) => this.hide(l)));
  },

  /** 複数 Webview の座標を一括更新（show/hide なし、操作中のリアルタイム同期用） */
  async updateAllBounds(
    entries: { label: string; x: number; y: number; w: number; h: number }[],
  ): Promise<void> {
    await Promise.all(entries.map(({ label, x, y, w, h }) => this.updateBounds(label, x, y, w, h)));
  },

  /** 複数 Webview の座標を更新してから一括表示（操作完了時） */
  async showAllWithBounds(
    entries: { label: string; x: number; y: number; w: number; h: number }[],
  ): Promise<void> {
    await Promise.all(
      entries.map(async ({ label, x, y, w, h }) => {
        await this.updateBounds(label, x, y, w, h);
        await this.show(label);
      }),
    );
  },

  /** Webview のスクリーンショットを取得し base64 Data URL を返す（macOS のみ）。失敗時は null */
  async captureScreenshot(pageId: string): Promise<string | null> {
    try {
      return await invoke<string>('capture_webview_screenshot', { pageId });
    } catch {
      return null;
    }
  },

  /** Rust → JS: ナビゲーション URL 変更イベントをリッスン */
  onPageNavigated: (pageId: string, callback: (payload: { url: string }) => void) =>
    listen<{ url: string }>(`page-navigated-${pageId}`, (event) => callback(event.payload)),

  /** Rust → JS: タイトル変更イベントをリッスン */
  onPageTitleChanged: (pageId: string, callback: (payload: { title: string }) => void) =>
    listen<{ title: string }>(`page-title-changed-${pageId}`, (event) => callback(event.payload)),
};

// ── プラットフォーム情報 ──────────────────────────────────────────

export type PlatformInfo = {
  platform: string;
  trafficLightWidth: number;
};

export const getPlatformInfo = async (): Promise<PlatformInfo> => {
  const [platform, trafficLightWidth] = await invoke<[string, number]>('get_platform_info');
  return { platform, trafficLightWidth };
};
