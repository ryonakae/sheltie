import type { BoardEdge, BoardEdgeStyle, BoardNode, TextNodeFontSizePreset } from '@/types';

export type McpToolError = {
  code: string;
  message: string;
  retry?: string;
};

export type RendererCommand =
  | 'getEditorState'
  | 'getBoard'
  | 'batchEditBoard'
  | 'focusNodes'
  | 'getWebpageScreenshots'
  | 'getPageScreenshotSource'
  | 'getBoardScreenshot';

export type RendererRequest = {
  requestId: string;
  command: RendererCommand;
  params: unknown;
};

export type RendererResult = { ok: true; data: unknown } | { ok: false; error: McpToolError };

export type RendererResponse = {
  requestId: string;
  result: RendererResult;
};

export type PageScreenshotSource = {
  displayMode: 'native' | 'screenshot' | 'hidden';
  cached?: {
    base64: string;
    width: number;
    height: number;
    capturedAt: string;
    capturedUrl: string | null;
  };
};

export type RendererCommandHandler = (params: unknown) => unknown | Promise<unknown>;
export type RendererCommandHandlers = Partial<Record<RendererCommand, RendererCommandHandler>>;

export type BoardHandleId = 'top' | 'right' | 'bottom' | 'left';

type NodeGeometryInput = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type CreateNodeInput =
  | (NodeGeometryInput & {
      type: 'webpage';
      url?: string;
      title?: string;
    })
  | (NodeGeometryInput & {
      type: 'stickynote';
      title?: string;
      content?: string;
      colorIndex?: number;
      fontSizePreset?: TextNodeFontSizePreset;
    })
  | (NodeGeometryInput & {
      type: 'text';
      title?: string;
      text?: string;
      fontSizePreset?: TextNodeFontSizePreset;
      fontWeight?: 'normal' | 'bold';
      italic?: boolean;
      strikethrough?: boolean;
      textColorIndex?: number;
      widthMode?: 'auto' | 'fixed';
    });

type CommonNodePatch = Partial<{
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type UpdateNodePatch =
  | (CommonNodePatch & { type: 'webpage'; url?: string })
  | (CommonNodePatch & {
      type: 'stickynote';
      content?: string;
      colorIndex?: number;
      fontSizePreset?: TextNodeFontSizePreset;
    })
  | (CommonNodePatch & {
      type: 'text';
      text?: string;
      fontSizePreset?: TextNodeFontSizePreset;
      fontWeight?: 'normal' | 'bold';
      italic?: boolean;
      strikethrough?: boolean;
      textColorIndex?: number;
      widthMode?: 'auto' | 'fixed';
    });

export type CreateEdgeInput = {
  source: string;
  sourceHandle: BoardHandleId;
  target: string;
  targetHandle: BoardHandleId;
  style?: Partial<BoardEdgeStyle>;
};

export type BoardOperation =
  | { op: 'create_node'; tempId: string; node: CreateNodeInput }
  | { op: 'update_node'; nodeId: string; patch: UpdateNodePatch }
  | { op: 'delete_node'; nodeId: string }
  | { op: 'create_edge'; tempId: string; edge: CreateEdgeInput }
  | { op: 'update_edge'; edgeId: string; patch: Partial<BoardEdgeStyle> }
  | { op: 'delete_edge'; edgeId: string }
  | { op: 'reverse_edge'; edgeId: string }
  | {
      op: 'reorder_node';
      nodeId: string;
      position: 'front' | 'forward' | 'backward' | 'back';
    };

export type BatchEditBoardSuccess = {
  ok: true;
  changed: boolean;
  nodes: BoardNode[];
  edges: BoardEdge[];
  createdNodeIds: string[];
  updatedNodeIds: string[];
  deletedNodeIds: string[];
  createdEdgeIds: string[];
  updatedEdgeIds: string[];
  deletedEdgeIds: string[];
  tempIdMap: Record<string, string>;
};

export type BatchEditBoardFailure = {
  ok: false;
  changed: false;
  error: {
    operationIndex: number;
    code: 'validation_failed';
    message: string;
  };
};

export type BatchEditBoardResult = BatchEditBoardSuccess | BatchEditBoardFailure;
