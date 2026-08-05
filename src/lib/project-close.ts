import {
  promptUnsavedChangesDialog,
  type UnsavedChangesDecision,
} from '@/components/Common/UnsavedChangesDialog';
import { saveCurrentProject } from '@/lib/file-commands';
import { getProjectDisplayName } from '@/lib/project-display-name';
import { isProjectDirty } from '@/lib/project-document';
import { api } from '@/lib/tauri-bridge';
import { useProjectStore } from '@/store/tab-store';
import type { Project } from '@/types';

let inFlightCloseOperation: Promise<void> | null = null;

function runExclusiveCloseOperation(operation: () => Promise<void>): Promise<void> {
  if (inFlightCloseOperation) {
    return inFlightCloseOperation;
  }

  const execution = operation().finally(() => {
    if (inFlightCloseOperation === execution) {
      inFlightCloseOperation = null;
    }
  });

  inFlightCloseOperation = execution;
  return execution;
}

function getProject(): Project | null {
  return useProjectStore.getState().project;
}

async function confirmUnsavedChanges(project: Project): Promise<UnsavedChangesDecision> {
  return promptUnsavedChangesDialog({
    kind: 'window-close',
    projectTitle: getProjectDisplayName(project),
  });
}

export function requestCurrentWindowClose(): Promise<void> {
  return runExclusiveCloseOperation(async () => {
    const project = getProject();
    if (!project) {
      await api.closeReady();
      return;
    }

    if (!isProjectDirty(project)) {
      await api.closeReady();
      return;
    }

    const decision = await confirmUnsavedChanges(project);
    if (decision === 'cancel') {
      return;
    }

    if (decision === 'save') {
      const result = await saveCurrentProject();
      if (result.status !== 'saved') {
        return;
      }
      await api.closeReady();
      return;
    }

    await api.closeReady();
  });
}

export const requestAppClose = requestCurrentWindowClose;
