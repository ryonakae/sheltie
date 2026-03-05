import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';

import type { EditCommand } from '@/lib/edit-commands';
import type { ProjectState, ThemeMode } from '@/types';

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
    zoom: number,
  ): Promise<string> =>
    invoke('create_page_webview', {
      pageId,
      url,
      x,
      y,
      width,
      height,
      zoom,
    }),

  /**
   * Webview の frame（物理サイズ）と viewScale をアトミックに更新する。
   * _WKLayoutModeDynamicSizeComputedFromViewScale により CSS viewport = frame.size / zoom となる。
   * Rust 側で viewport units 用サイズも論理サイズに同期するため、svh/lvh/dvh も一貫する。
   */
  async updateBounds(
    pageId: string,
    x: number,
    y: number,
    width: number,
    height: number,
    zoom: number,
  ): Promise<void> {
    try {
      await invoke('update_page_webview_bounds', {
        pageId,
        x,
        y,
        width,
        height,
        zoom,
      });
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

  /** ページ Webview の不透明度を設定する（macOS のみ有効。非対応 OS は no-op） */
  async setOpacity(pageId: string, opacity: number): Promise<void> {
    try {
      await invoke('set_page_webview_opacity', { pageId, opacity });
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

  /**
   * 複数 Webview の frame + viewScale を一括更新する（show/hide なし、操作中のリアルタイム同期用）。
   * pageId から label に変換して Rust コマンドに渡す。
   * 各 entry は viewport units 用の論理サイズ同期も同時に実行される。
   */
  async updateAllBounds(
    entries: {
      pageId: string;
      x: number;
      y: number;
      w: number;
      h: number;
      zoom: number;
    }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    try {
      await invoke('batch_update_page_webview_bounds', {
        entries: entries.map(({ pageId, x, y, w, h, zoom }) => ({
          pageId,
          x,
          y,
          width: w,
          height: h,
          zoom,
        })),
      });
    } catch {
      // no-op
    }
  },

  /**
   * パン操作専用: 複数 Webview の位置のみを一括更新する。
   * パン中は size や zoom は変化しないため、より軽量な IPC コマンドを使用して追従遅延を軽減する。
   */
  async updateAllPositions(
    entries: {
      pageId: string;
      x: number;
      y: number;
    }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    try {
      await invoke('batch_update_webview_positions', { entries });
    } catch {
      // no-op
    }
  },

  /** 複数 Webview の frame + viewScale を更新してから一括表示（操作完了時） */
  async showAllWithBounds(
    entries: {
      pageId: string;
      label: string;
      x: number;
      y: number;
      w: number;
      h: number;
      zoom: number;
    }[],
  ): Promise<void> {
    await Promise.all(
      entries.map(async ({ pageId, label, x, y, w, h, zoom }) => {
        await this.updateBounds(pageId, x, y, w, h, zoom);
        await this.show(label);
      }),
    );
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

  /**
   * Webview のスクリーンショットを PNG ファイルに保存し、絶対パスを返す（macOS のみ）。
   * 保存先: app_data_dir/screenshots/{projectId}/{pageId}.png（既存ファイルは上書き）
   * 失敗時は null
   */
  async saveScreenshot(pageId: string, projectId: string): Promise<string | null> {
    try {
      return await invoke<string>('save_webview_screenshot', { pageId, projectId });
    } catch {
      return null;
    }
  },

  /**
   * 複数ページの既存スクリーンショットパスを一括取得する（起動時の復元用）。
   * 存在するファイルのみ [pageId, absolutePath] のペアで返す。
   */
  async getExistingScreenshotPaths(
    projectId: string,
    pageIds: string[],
  ): Promise<Array<[string, string]>> {
    try {
      return await invoke<Array<[string, string]>>('get_existing_screenshot_paths', {
        projectId,
        pageIds,
      });
    } catch {
      return [];
    }
  },

  /** ページのスクリーンショットファイルを削除する（ページ削除時のクリーンアップ用） */
  async deleteScreenshot(pageId: string, projectId: string): Promise<void> {
    try {
      await invoke('delete_screenshot', { pageId, projectId });
    } catch {
      // no-op
    }
  },

  /** Rust → JS: ナビゲーション URL 変更イベントをリッスン */
  onPageNavigated: (pageId: string, callback: (payload: { url: string }) => void) =>
    listen<{ url: string }>(`page-navigated-${pageId}`, (event) => callback(event.payload)),

  /** Rust → JS: タイトル変更イベントをリッスン */
  onPageTitleChanged: (pageId: string, callback: (payload: { title: string }) => void) =>
    listen<{ title: string }>(`page-title-changed-${pageId}`, (event) => callback(event.payload)),

  /** Rust → JS: Webview 内スクロール完了イベントをリッスン */
  onPageScrollEnded: (pageId: string, callback: () => void) =>
    listen(`page-scroll-ended-${pageId}`, () => callback()),
};

// ── 型定義 ───────────────────────────────────────────────────────

export type NavigationState = {
  can_go_back: boolean;
  can_go_forward: boolean;
};

export const onEditCommand = (callback: (command: EditCommand) => void) =>
  listen<EditCommand>('edit-command', (event) => callback(event.payload));

// ── プラットフォーム情報 ──────────────────────────────────────────

export type PlatformInfo = {
  platform: string;
  trafficLightWidth: number;
};

export const getPlatformInfo = async (): Promise<PlatformInfo> => {
  const [platform, trafficLightWidth] = await invoke<[string, number]>('get_platform_info');
  return { platform, trafficLightWidth };
};
