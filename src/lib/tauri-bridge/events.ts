import { listen } from '@tauri-apps/api/event';

import type { EditCommand } from '@/lib/edit-commands';

import type { FileCommand } from './types';

export const onEditCommand = (callback: (command: EditCommand) => void) =>
  listen<EditCommand>('edit-command', (event) => callback(event.payload));

export const onFileCommand = (callback: (command: FileCommand) => void) =>
  listen<FileCommand>('file-command', (event) => callback(event.payload));
