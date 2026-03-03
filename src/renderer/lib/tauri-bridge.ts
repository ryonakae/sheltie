import { invoke } from '@tauri-apps/api/core';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';

import type { ProjectState, ThemeMode } from '@/shared/types';

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

  /** CSS transform injection でビジュアルスケーリングを適用する。
   * pageZoom と異なりビューポートサイズを変更せず、レイアウトリフローも発生しない。 */
  async setScale(pageId: string, scaleFactor: number): Promise<void> {
    try {
      await invoke('set_page_webview_scale', { pageId, scale: scaleFactor });
    } catch {
      // Webview 未作成・既破棄時は no-op
    }
  },

  /** ページ Webview のブラウザ履歴を1つ戻る */
  async goBack(pageId: string): Promise<void> {
    try {
      await invoke('go_back_page_webview', { pageId });
    } catch {
      // Webview 未作成・既破棄時は no-op
    }
  },

  /** ページ Webview のブラウザ履歴を1つ進める */
  async goForward(pageId: string): Promise<void> {
    try {
      await invoke('go_forward_page_webview', { pageId });
    } catch {
      // Webview 未作成・既破棄時は no-op
    }
  },

  /** ページ Webview の戻る/進み可否状態を取得する（macOS のみ正確。失敗時は両方 false） */
  async getNavigationState(pageId: string): Promise<NavigationState> {
    try {
      return await invoke<NavigationState>('get_navigation_state_page_webview', { pageId });
    } catch {
      return { can_go_back: false, can_go_forward: false };
    }
  },

  /** ページの Webview を指定 URL にナビゲートする（追加時 URL へのリセットに使用） */
  async reload(pageId: string, url: string): Promise<void> {
    try {
      await invoke('reload_page_webview', { pageId, url });
    } catch {
      // Webview 未作成・既破棄時は no-op
    }
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

// ── 型定義 ───────────────────────────────────────────────────────

export type NavigationState = {
  can_go_back: boolean;
  can_go_forward: boolean;
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
