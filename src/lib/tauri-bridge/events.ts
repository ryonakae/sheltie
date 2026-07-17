import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

import type { EditCommand } from '@/lib/edit-commands';

import type { FileCommand, McpRendererRequest, ViewCommand } from './types';

export const onEditCommand = (callback: (command: EditCommand) => void) =>
  getCurrentWebviewWindow().listen<EditCommand>('edit-command', (event) => callback(event.payload));

export const onFileCommand = (callback: (command: FileCommand) => void) =>
  getCurrentWebviewWindow().listen<FileCommand>('file-command', (event) => callback(event.payload));

export const onViewCommand = (callback: (command: ViewCommand) => void) =>
  getCurrentWebviewWindow().listen<ViewCommand>('view-command', (event) => callback(event.payload));

export const onAppExitRequested = (callback: () => void) =>
  getCurrentWebviewWindow().listen('app-exit-requested', () => callback());

export const onMcpRendererRequest = (callback: (request: McpRendererRequest) => void) =>
  getCurrentWebviewWindow().listen<McpRendererRequest>('mcp-renderer-request', (event) =>
    callback(event.payload),
  );
