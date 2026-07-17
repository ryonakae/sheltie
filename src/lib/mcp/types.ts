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

export type RendererCommandHandler = (params: unknown) => unknown | Promise<unknown>;
export type RendererCommandHandlers = Partial<Record<RendererCommand, RendererCommandHandler>>;
