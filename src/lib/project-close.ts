import {
  promptUnsavedChangesDialog,
  type UnsavedChangesDecision,
  type UnsavedChangesReason,
} from '@/components/Common/UnsavedChangesDialog';
import { HOME_ID } from '@/constants';
import { saveProjectById } from '@/lib/file-commands';
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

function getProjectById(projectId: string): Project | undefined {
  return useProjectStore.getState().projects.find((project) => project.id === projectId);
}

function getAppCloseProjectOrder(): string[] {
  const { activeId, openIds } = useProjectStore.getState();
  if (activeId === HOME_ID) {
    return [...openIds];
  }
  return [activeId, ...openIds.filter((projectId) => projectId !== activeId)];
}

function discardProjectChanges(projectId: string): void {
  const project = getProjectById(projectId);
  if (!project) return;

  if (project.filePath) {
    useProjectStore.getState().restoreProjectFromLastSaved(projectId);
    return;
  }

  useProjectStore.getState().deleteProject(projectId);
}

async function confirmUnsavedChanges(options: {
  projectTitle: string;
  reason: UnsavedChangesReason;
}): Promise<UnsavedChangesDecision> {
  return promptUnsavedChangesDialog(options);
}

async function resolveDirtyProjectBeforeClose(
  projectId: string,
  reason: UnsavedChangesReason,
): Promise<boolean> {
  const project = getProjectById(projectId);
  if (!project) return true;

  if (!isProjectDirty(project)) {
    if (!project.filePath && reason === 'app-close') {
      useProjectStore.getState().deleteProject(projectId);
    }
    return true;
  }

  const decision = await confirmUnsavedChanges({
    projectTitle: project.title,
    reason,
  });

  if (decision === 'cancel') {
    return false;
  }

  if (decision === 'save') {
    const result = await saveProjectById(projectId);
    return result.status === 'saved';
  }

  discardProjectChanges(projectId);
  return true;
}

export function requestProjectTabClose(projectId: string): Promise<void> {
  return runExclusiveCloseOperation(async () => {
    const project = getProjectById(projectId);
    if (!project) return;

    if (!isProjectDirty(project)) {
      if (project.filePath) {
        useProjectStore.getState().closeProject(projectId);
      } else {
        useProjectStore.getState().deleteProject(projectId);
      }
      return;
    }

    const didResolve = await resolveDirtyProjectBeforeClose(projectId, 'tab-close');
    if (!didResolve) return;

    const latestProject = getProjectById(projectId);
    if (!latestProject) return;

    if (latestProject.filePath) {
      useProjectStore.getState().closeProject(projectId);
      return;
    }

    useProjectStore.getState().deleteProject(projectId);
  });
}

export function requestAppClose(): Promise<void> {
  return runExclusiveCloseOperation(async () => {
    for (const projectId of [...useProjectStore.getState().openIds]) {
      const project = getProjectById(projectId);
      if (project && !project.filePath && !isProjectDirty(project)) {
        useProjectStore.getState().deleteProject(projectId);
      }
    }

    for (const projectId of getAppCloseProjectOrder()) {
      const didResolve = await resolveDirtyProjectBeforeClose(projectId, 'app-close');
      if (!didResolve) {
        return;
      }
    }

    const { projects, openIds, activeId } = useProjectStore.getState();
    await api.closeReady({ projects, openIds, activeId });
  });
}
