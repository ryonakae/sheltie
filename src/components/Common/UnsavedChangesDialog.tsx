import { invoke } from '@tauri-apps/api/core';

import {
  enterUnsavedChangesDialogDisplay,
  exitUnsavedChangesDialogDisplay,
} from '@/lib/unsaved-changes-dialog-display';

export type UnsavedChangesDecision = 'save' | 'discard' | 'cancel';

type WindowCloseUnsavedChangesDialogOptions = {
  kind: 'window-close';
  projectTitle: string;
};

type AppExitUnsavedChangesDialogOptions = {
  kind: 'app-exit';
  projectTitles: string[];
};

export type UnsavedChangesDialogOptions =
  | WindowCloseUnsavedChangesDialogOptions
  | AppExitUnsavedChangesDialogOptions;

export async function promptUnsavedChangesDialog(
  options: UnsavedChangesDialogOptions,
): Promise<UnsavedChangesDecision> {
  await enterUnsavedChangesDialogDisplay();

  try {
    const result = await invoke<string>('show_unsaved_changes_dialog', {
      params: {
        kind: options.kind,
        projectTitle: options.kind === 'window-close' ? options.projectTitle : undefined,
        projectTitles: options.kind === 'app-exit' ? options.projectTitles : undefined,
      },
    });
    return (result as UnsavedChangesDecision) ?? 'cancel';
  } catch (error) {
    console.error('[unsaved-changes] failed to show native dialog:', error);
    return 'cancel';
  } finally {
    exitUnsavedChangesDialogDisplay();
  }
}
