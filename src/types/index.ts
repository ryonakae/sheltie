export type ThemeMode = 'system' | 'light' | 'dark';

/** ネイティブ Webview の表示モード */
export type DisplayMode = 'native' | 'screenshot' | 'hidden';

/** ボード上のノード種別 */
export type BoardNodeType = 'webpage' | 'stickynote' | 'text';

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
  /** テキストノード: Tiptap JSON ドキュメント */
  tiptapContent?: object;
  /** テキストノード: フォントサイズプリセット */
  fontSizePreset?: TextNodeFontSizePreset;
  /** テキストノード: フォントウェイト */
  fontWeight?: 'normal' | 'bold';
  /** テキストノード: イタリック */
  italic?: boolean;
  /** テキストノード: 取り消し線 */
  strikethrough?: boolean;
  /** テキストノード: 文字色インデックス */
  textColorIndex?: number;
  /** テキストノード: 幅モード */
  widthMode?: 'auto' | 'fixed';
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
  fontSizePreset?: TextNodeFontSizePreset;
}

/** フォントサイズプリセット (0=S, 1=M, 2=L, 3=XL) */
export type TextNodeFontSizePreset = 0 | 1 | 2 | 3;

export interface TextNode extends BoardNode {
  type: 'text';
  /** Tiptap JSON ドキュメント */
  tiptapContent?: object;
  fontSizePreset?: TextNodeFontSizePreset;
  fontWeight?: 'normal' | 'bold';
  italic?: boolean;
  strikethrough?: boolean;
  /** TEXT_NODE_COLORS のインデックス */
  textColorIndex?: number;
  /** 幅モード: 'auto' = テキスト量に追従 / 'fixed' = ユーザー指定幅 */
  widthMode?: 'auto' | 'fixed';
}

export interface SiteboardDocumentV1 {
  schemaVersion: 1;
  title: string;
  nodes: SiteboardDocumentNode[];
}

export type EdgeStrokeWidth = 3 | 6;
export type EdgeLineStyle = 'solid' | 'dashed';
export type EdgeColorPreset =
  | 'default'
  | 'foreground'
  | 'muted'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger';

export interface BoardEdgeStyle {
  strokeWidth: EdgeStrokeWidth;
  lineStyle: EdgeLineStyle;
  colorPreset: EdgeColorPreset;
}

/** ボード上のエッジ（ノード間接続） */
export interface BoardEdge extends BoardEdgeStyle {
  id: string;
  source: string;
  sourceHandle: string | null;
  target: string;
  targetHandle: string | null;
}

export interface SiteboardDocumentEdge extends BoardEdgeStyle {
  id: string;
  source: string;
  sourceHandle: string | null;
  target: string;
  targetHandle: string | null;
}

export interface SiteboardDocumentV2 {
  schemaVersion: 2;
  nodes: SiteboardDocumentNode[];
  edges?: SiteboardDocumentEdge[];
}

export type SiteboardDocument = SiteboardDocumentV1 | SiteboardDocumentV2;

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
      fontSizePreset: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      id: string;
      type: 'text';
      title: string;
      tiptapContent?: object;
      fontSizePreset: number;
      fontWeight: 'normal' | 'bold';
      italic: boolean;
      strikethrough: boolean;
      textColorIndex: number;
      widthMode: 'auto' | 'fixed';
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
  filePath?: string;
  untitledIndex: number;
  nodes: BoardNode[];
  edges: BoardEdge[];
  viewport: Viewport;
  lastSavedDocument: SiteboardDocumentV2;
}

/** URL 未設定の空フレームかどうか */
export function isNodeEmpty(node: BoardNode): boolean {
  return node.url === '';
}

/** 付箋ノードかどうか */
export function isStickyNoteNode(node: BoardNode): node is StickyNoteNode {
  return node.type === 'stickynote';
}

/** テキストノードかどうか */
export function isTextNode(node: BoardNode): node is TextNode {
  return node.type === 'text';
}

function extractTiptapText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as { text?: unknown; content?: unknown };
  if (typeof record.text === 'string') return record.text;
  if (!Array.isArray(record.content)) return '';
  return record.content.map(extractTiptapText).join('');
}

/** テキストノードの本文が空（空白のみを含む）かどうか */
export function isTextNodeEmpty(node: TextNode): boolean {
  if (!node.tiptapContent) return true;
  return extractTiptapText(node.tiptapContent).trim() === '';
}

/** Webページノードかどうか（type が undefined の場合も 'webpage' 扱い = 後方互換） */
export function isWebPageNode(node: BoardNode): node is WebPageNode {
  return !isStickyNoteNode(node) && !isTextNode(node);
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
  project: Project | null;
}

export interface ProjectWebviewRuntime {
  labelsByNodeId: Record<string, string>;
  screenshotUrlsByNodeId: Record<string, string>;
}
