import type { Project, ProjectState } from '../renderer/types/tab';

export type { Project, ProjectState };

export interface ProjectStoreApi {
  loadProjectState: () => Promise<ProjectState>;
  saveProjectState: (state: ProjectState) => Promise<void>;
  onSaveBeforeClose: (callback: () => void) => void;
  closeReady: (state: ProjectState) => Promise<void>;
}

export interface WindowControlsInfo {
  platform: NodeJS.Platform;
  /** macOS: trafficLightPosition から算出したスペーサー幅。Windows/Linux では 0 */
  trafficLightWidth: number;
}

/** WebContentsView の位置・サイズ (ウィンドウスクリーン座標系) */
export interface PageBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Artboard 領域のレイアウト情報 */
export interface ArtboardLayout {
  /** artboard 領域の左端オフセット (= sidebarWidth) */
  offsetX: number;
  /** artboard 領域の上端オフセット (= タブバー高さ) */
  offsetY: number;
  /** artboard 領域の幅 */
  areaWidth: number;
  /** artboard 領域の高さ */
  areaHeight: number;
}

export interface PageViewApi {
  /** ページ用 WebContentsView を作成して URL をロード */
  createPageView: (projectId: string, pageId: string, url: string) => Promise<void>;
  /** ページ用 WebContentsView を破棄 */
  destroyPageView: (pageId: string) => Promise<void>;
  /** 全ページの bounds を一括更新 (fire-and-forget) */
  batchUpdateBounds: (updates: Array<{ pageId: string; bounds: PageBounds }>, zoom: number) => void;
  /** 操作モード切り替え: true=mainView 最上位、false=pageViews 最上位 (fire-and-forget) */
  setInteractionMode: (isInteracting: boolean) => void;
  /** 指定プロジェクトのページのみ表示し他を非表示 */
  showProjectPages: (projectId: string) => Promise<void>;
  /** 指定ページを最前面に移動 (fire-and-forget) */
  bringToFront: (pageId: string) => void;
  /** 指定プロジェクトの全 WebContentsView を破棄 */
  destroyProjectPages: (projectId: string) => Promise<void>;
  /** artboard レイアウト情報を更新 (fire-and-forget) */
  updateArtboardLayout: (layout: ArtboardLayout) => void;
  /** ナビゲーション完了イベントのリスナーを登録 */
  onNavigated: (callback: (pageId: string, url: string, title: string) => void) => void;
  /** タイトル更新イベントのリスナーを登録 */
  onTitleUpdated: (callback: (pageId: string, title: string) => void) => void;
}

declare global {
  interface Window {
    api: ProjectStoreApi;
    windowControls: WindowControlsInfo;
    pageViewApi: PageViewApi;
  }
}
