import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';

import type { NavigationState } from './types';

export interface SavedScreenshot {
  filePath: string;
  capturedAt: string;
  capturedUrl: string | null;
}

export interface ExistingScreenshot extends SavedScreenshot {
  pageId: string;
}

/**
 * `skip: true` は Tauri の public 型には露出していないが、既存 runtime では
 * Webview ハンドル再取得の内部実装として使われている。
 * 直接利用箇所をこの module に閉じ込め、他レイヤーへ漏らさない。
 */
function getWebviewHandle(label: string): Webview {
  // @ts-expect-error skip は公開 API に型定義がないが runtime が解釈する
  return new Webview(getCurrentWindow(), label, { skip: true });
}

function logWebviewWarning(
  command: string,
  context: Record<string, unknown>,
  error: unknown,
): void {
  if (!import.meta.env.DEV) return;
  console.warn(`[webviewApi] ${command} failed`, { ...context, error });
}

function logWebviewCommand(command: string, context: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  console.info(`[webviewApi] ${command}`, context);
}

async function invokeOrWarn(
  command: string,
  payload: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<void> {
  try {
    await invoke(command, payload);
  } catch (error) {
    logWebviewWarning(command, context, error);
  }
}

async function invokeWithFallback<T>(
  command: string,
  payload: Record<string, unknown>,
  fallback: T,
  context: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, payload);
  } catch (error) {
    logWebviewWarning(command, context, error);
    return fallback;
  }
}

async function withWebviewHandleOrWarn(
  label: string,
  command: string,
  action: (webview: Webview) => Promise<void>,
): Promise<void> {
  try {
    await action(getWebviewHandle(label));
  } catch (error) {
    logWebviewWarning(command, { label }, error);
  }
}

export const webviewApi = {
  create: async (
    pageId: string,
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
    zoom: number,
  ): Promise<string> => {
    const payload = {
      pageId,
      url,
      x,
      y,
      width,
      height,
      zoom,
    };
    logWebviewCommand('create_page_webview', payload);
    const label = await invoke<string>('create_page_webview', payload);
    logWebviewCommand('create_page_webview:resolved', { pageId, label });
    return label;
  },

  updateBounds: async (
    label: string,
    x: number,
    y: number,
    width: number,
    height: number,
    zoom: number,
  ): Promise<void> => {
    logWebviewCommand('update_page_webview_bounds', {
      label,
      x,
      y,
      width,
      height,
      zoom,
    });
    await invokeOrWarn(
      'update_page_webview_bounds',
      {
        label,
        x,
        y,
        width,
        height,
        zoom,
      },
      { label },
    );
  },

  hide: (label: string): Promise<void> =>
    withWebviewHandleOrWarn(label, 'hide', (webview) => webview.hide()),

  show: (label: string): Promise<void> =>
    withWebviewHandleOrWarn(label, 'show', (webview) => webview.show()),

  setOpacity: (label: string, opacity: number): Promise<void> =>
    invokeOrWarn('set_page_webview_opacity', { label, opacity }, { label }),

  destroy: async (pageId: string, label: string): Promise<void> => {
    await invokeOrWarn('unregister_page_automation_page', { pageId }, { pageId, label });
    await withWebviewHandleOrWarn(label, 'destroy', (webview) => webview.close());
  },

  async hideAll(labels: string[]): Promise<void> {
    await Promise.all(labels.map((label) => this.hide(label)));
  },

  async updateAllBounds(
    entries: {
      label: string;
      x: number;
      y: number;
      w: number;
      h: number;
      zoom: number;
    }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await invokeOrWarn(
      'batch_update_page_webview_bounds',
      {
        entries: entries.map(({ label, x, y, w, h, zoom }) => ({
          label,
          x,
          y,
          width: w,
          height: h,
          zoom,
        })),
      },
      { labels: entries.map(({ label }) => label) },
    );
  },

  async updateAllPositions(
    entries: {
      label: string;
      x: number;
      y: number;
    }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await invokeOrWarn(
      'batch_update_webview_positions',
      { entries },
      { labels: entries.map(({ label }) => label) },
    );
  },

  async showAllWithBounds(
    entries: {
      label: string;
      x: number;
      y: number;
      w: number;
      h: number;
      zoom: number;
    }[],
  ): Promise<void> {
    await Promise.all(
      entries.map(async ({ label, x, y, w, h, zoom }) => {
        await this.updateBounds(label, x, y, w, h, zoom);
        await this.show(label);
      }),
    );
  },

  goBack: (label: string): Promise<void> =>
    invokeOrWarn('go_back_page_webview', { label }, { label }),

  goForward: (label: string): Promise<void> =>
    invokeOrWarn('go_forward_page_webview', { label }, { label }),

  getNavigationState: (label: string): Promise<NavigationState> =>
    invokeWithFallback<NavigationState>(
      'get_navigation_state_page_webview',
      { label },
      { can_go_back: false, can_go_forward: false },
      { label },
    ),

  reload: (label: string, url: string): Promise<void> =>
    invokeOrWarn('reload_page_webview', { label, url }, { label }),

  captureScreenshot: (label: string): Promise<string | null> =>
    invokeWithFallback<string | null>('capture_webview_screenshot', { label }, null, { label }),

  async saveScreenshot(
    label: string,
    pageId: string,
    projectId: string,
    capturedUrl: string,
    options?: { hideAfterSnapshotRequest?: boolean },
  ): Promise<SavedScreenshot | null> {
    return invokeWithFallback<SavedScreenshot | null>(
      'save_webview_screenshot',
      {
        label,
        pageId,
        projectId,
        capturedUrl,
        hideAfterSnapshotRequest: options?.hideAfterSnapshotRequest,
      },
      null,
      { label, pageId, projectId },
    );
  },

  async getExistingScreenshotPaths(
    projectId: string,
    pageIds: string[],
  ): Promise<ExistingScreenshot[]> {
    return invokeWithFallback<ExistingScreenshot[]>(
      'get_existing_screenshot_paths',
      {
        projectId,
        pageIds,
      },
      [],
      { projectId, pageIds },
    );
  },

  /** 起動時に、最終更新から TTL を超えたスクリーンショットキャッシュを回収する */
  pruneScreenshotCache: (): Promise<void> => invoke('prune_screenshot_cache'),

  deleteScreenshot: (pageId: string, projectId: string): Promise<void> =>
    invokeOrWarn('delete_screenshot', { pageId, projectId }, { pageId, projectId }),

  onPageNavigated: (pageId: string, callback: (payload: { url: string }) => void) =>
    listen<{ url: string }>(`page-navigated-${pageId}`, (event) => callback(event.payload)),

  onPageTitleChanged: (pageId: string, callback: (payload: { title: string }) => void) =>
    listen<{ title: string }>(`page-title-changed-${pageId}`, (event) => callback(event.payload)),

  onPageScrollEnded: (pageId: string, callback: () => void) =>
    listen(`page-scroll-ended-${pageId}`, () => callback()),
};
