import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';

import type { NavigationState } from './types';

/**
 * `skip: true` は Tauri の public 型には露出していないが、既存 runtime では
 * Webview ハンドル再取得の内部実装として使われている。
 * 直接利用箇所をこの module に閉じ込め、他レイヤーへ漏らさない。
 */
function getWebviewHandle(label: string): Webview {
  // @ts-expect-error skip は公開 API に型定義がないが runtime が解釈する
  return new Webview(getCurrentWindow(), label, { skip: true });
}

async function invokeOrNoop(command: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await invoke(command, payload);
  } catch {
    // Webview 未作成・既破棄時は no-op
  }
}

async function withWebviewHandleOrNoop(
  label: string,
  action: (webview: Webview) => Promise<void>,
): Promise<void> {
  try {
    await action(getWebviewHandle(label));
  } catch {
    // Webview 未作成・既破棄時は no-op
  }
}

export const webviewApi = {
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

  updateBounds: (
    pageId: string,
    x: number,
    y: number,
    width: number,
    height: number,
    zoom: number,
  ): Promise<void> =>
    invokeOrNoop('update_page_webview_bounds', {
      pageId,
      x,
      y,
      width,
      height,
      zoom,
    }),

  hide: (label: string): Promise<void> =>
    withWebviewHandleOrNoop(label, (webview) => webview.hide()),

  show: (label: string): Promise<void> =>
    withWebviewHandleOrNoop(label, (webview) => webview.show()),

  setOpacity: (pageId: string, opacity: number): Promise<void> =>
    invokeOrNoop('set_page_webview_opacity', { pageId, opacity }),

  destroy: (label: string): Promise<void> =>
    withWebviewHandleOrNoop(label, (webview) => webview.close()),

  async hideAll(labels: string[]): Promise<void> {
    await Promise.all(labels.map((label) => this.hide(label)));
  },

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
    await invokeOrNoop('batch_update_page_webview_bounds', {
      entries: entries.map(({ pageId, x, y, w, h, zoom }) => ({
        pageId,
        x,
        y,
        width: w,
        height: h,
        zoom,
      })),
    });
  },

  async updateAllPositions(
    entries: {
      pageId: string;
      x: number;
      y: number;
    }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await invokeOrNoop('batch_update_webview_positions', { entries });
  },

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

  goBack: (pageId: string): Promise<void> => invokeOrNoop('go_back_page_webview', { pageId }),

  goForward: (pageId: string): Promise<void> => invokeOrNoop('go_forward_page_webview', { pageId }),

  async getNavigationState(pageId: string): Promise<NavigationState> {
    try {
      return await invoke<NavigationState>('get_navigation_state_page_webview', { pageId });
    } catch {
      return { can_go_back: false, can_go_forward: false };
    }
  },

  reload: (pageId: string, url: string): Promise<void> =>
    invokeOrNoop('reload_page_webview', { pageId, url }),

  async captureScreenshot(pageId: string): Promise<string | null> {
    try {
      return await invoke<string>('capture_webview_screenshot', { pageId });
    } catch {
      return null;
    }
  },

  async saveScreenshot(
    pageId: string,
    projectId: string,
    options?: { hideAfterSnapshotRequest?: boolean },
  ): Promise<string | null> {
    try {
      return await invoke<string>('save_webview_screenshot', {
        pageId,
        projectId,
        hideAfterSnapshotRequest: options?.hideAfterSnapshotRequest,
      });
    } catch {
      return null;
    }
  },

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

  deleteScreenshot: (pageId: string, projectId: string): Promise<void> =>
    invokeOrNoop('delete_screenshot', { pageId, projectId }),

  onPageNavigated: (pageId: string, callback: (payload: { url: string }) => void) =>
    listen<{ url: string }>(`page-navigated-${pageId}`, (event) => callback(event.payload)),

  onPageTitleChanged: (pageId: string, callback: (payload: { title: string }) => void) =>
    listen<{ title: string }>(`page-title-changed-${pageId}`, (event) => callback(event.payload)),

  onPageScrollEnded: (pageId: string, callback: () => void) =>
    listen(`page-scroll-ended-${pageId}`, () => callback()),
};
