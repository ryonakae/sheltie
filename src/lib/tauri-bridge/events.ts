import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

import type { EditCommand } from '@/lib/edit-commands';

import type { FileCommand } from './types';

export const onEditCommand = (callback: (command: EditCommand) => void) =>
  getCurrentWebviewWindow().listen<EditCommand>('edit-command', (event) => callback(event.payload));

export const onFileCommand = (callback: (command: FileCommand) => void) =>
  getCurrentWebviewWindow().listen<FileCommand>('file-command', (event) => callback(event.payload));
