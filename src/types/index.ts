export type ThemeMode = 'system' | 'light' | 'dark';

/** ネイティブ Webview の表示モード */
export type DisplayMode = 'native' | 'screenshot' | 'hidden';

/** ボード上のノード種別 */
export type BoardNodeType = 'webpage' | 'stickynote';

export interface BoardNode {
  id: string;
  title: string;
  url: string;
  /** ノード種別（undefined は 'webpage' として扱う・後方互換） */
  type?: BoardNodeType;
  /** 追加時点のURLを保持し、リダイレクト後でも一覧で参照可能にする */
  addedUrl?: string;
  /** 付箋のテキスト内容 */
  content?: string;
  /** 付箋のカラーインデックス（STICKY_NOTE_COLORS への参照） */
  colorIndex?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebPageNode extends BoardNode {
  /** undefined は 'webpage' として扱う・後方互換 */
  type?: 'webpage';
}

export interface StickyNoteNode extends BoardNode {
  type: 'stickynote';
  content?: string;
  colorIndex?: number;
}

export interface SiteboardDocumentV1 {
  schemaVersion: 1;
  title: string;
  nodes: SiteboardDocumentNode[];
}

export type SiteboardDocumentNode =
  | {
      id: string;
      type: 'webpage';
      title: string;
      url: string;
      addedUrl?: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      id: string;
      type: 'stickynote';
      title: string;
      content: string;
      colorIndex: number;
      x: number;
      y: number;
      width: number;
      height: number;
    };

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface SizePreset {
  label: string;
  width: number;
  height: number;
}

export interface Project {
  id: string;
  title: string;
  filePath?: string;
  lastOpenedAt: number;
  nodes: BoardNode[];
  viewport: Viewport;
  lastSavedDocument: SiteboardDocumentV1;
}

/** URL 未設定の空フレームかどうか */
export function isNodeEmpty(node: BoardNode): boolean {
  return node.url === '';
}

/** 付箋ノードかどうか */
export function isStickyNoteNode(node: BoardNode): node is StickyNoteNode {
  return node.type === 'stickynote';
}

/** Webページノードかどうか（type が undefined の場合も 'webpage' 扱い = 後方互換） */
export function isWebPageNode(node: BoardNode): node is WebPageNode {
  return !isStickyNoteNode(node);
}

/**
 * ノードが追加時の URL から別ページに遷移したかどうかを判定する。
 * URL の正規化（末尾スラッシュ等）を考慮して比較する。
 */
export function isNodeMoved(node: BoardNode): boolean {
  if (!node.addedUrl) return false;
  try {
    return new URL(node.addedUrl).href !== new URL(node.url).href;
  } catch {
    return node.addedUrl !== node.url;
  }
}

export interface ProjectState {
  /** 全永続プロジェクト */
  projects: Project[];
  /** タブバーに表示中のプロジェクト ID（順序がタブの並び順） */
  openIds: string[];
  /** 現在アクティブなプロジェクト ID（HOME_ID の場合はホーム画面） */
  activeId: string;
}

export interface ProjectWebviewRuntime {
  labelsByNodeId: Record<string, string>;
  screenshotUrlsByNodeId: Record<string, string>;
}
