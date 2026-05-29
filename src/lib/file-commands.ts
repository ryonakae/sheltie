import { message, open, save } from '@tauri-apps/plugin-dialog';

import { getProjectDisplayName } from '@/lib/project-display-name';
import { createProjectDocument, serializeProjectDocument } from '@/lib/project-document';
import { api, type FileCommand, type SaveProjectStatus } from '@/lib/tauri-bridge';
import { useProjectStore } from '@/store/tab-store';
import type { Project } from '@/types';

const SITEBOARD_EXTENSION = '.siteboard';
let inFlightCommand: Promise<void> = Promise.resolve();

export type SaveProjectResult =
  | { status: Extract<SaveProjectStatus, 'saved'>; filePath: string }
  | { status: Exclude<SaveProjectStatus, 'saved'> };

function getProject(): Project | null {
  return useProjectStore.getState().project;
}

function normalizeSiteboardPath(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : '';
  const base = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const lastDot = base.lastIndexOf('.');
  const normalizedBase =
    lastDot > 0
      ? `${base.slice(0, lastDot)}${SITEBOARD_EXTENSION}`
      : `${base}${SITEBOARD_EXTENSION}`;
  return `${dir}${normalizedBase}`;
}

function sanitizeFileName(name: string): string {
  const cleaned = Array.from(name.trim().replace(/[<>:"/\\|?*]/g, ' '), (char) =>
    char.charCodeAt(0) < 32 ? ' ' : char,
  )
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Untitled';
}

function enqueueFileOperation<T>(operation: () => Promise<T>): Promise<T> {
  const execution = inFlightCommand.catch(() => undefined).then(operation);
  inFlightCommand = execution.then(
    () => undefined,
    () => undefined,
  );
  return execution;
}

async function showInfo(messageText: string): Promise<void> {
  await message(messageText, {
    title: 'Siteboard',
    kind: 'info',
  });
}

async function showError(messageText: string): Promise<void> {
  await message(messageText, {
    title: 'Siteboard',
    kind: 'error',
  });
}

async function runOpenProjectFromDialog(): Promise<void> {
  const selected = await open({
    title: 'Open Siteboard Project',
    multiple: false,
    filters: [{ name: 'Siteboard Project', extensions: ['siteboard'] }],
  });

  if (!selected || Array.isArray(selected)) return;

  try {
    await api.openDocumentWindow(normalizeSiteboardPath(selected));
  } catch (error) {
    await showError(error instanceof Error ? error.message : 'Could not open the file');
  }
}

async function runNewDocumentTab(): Promise<void> {
  try {
    await api.newDocumentTab();
  } catch (error) {
    await showError(error instanceof Error ? error.message : 'Could not open a new tab');
  }
}

async function runNewDocumentWindow(): Promise<void> {
  try {
    await api.newDocumentWindow();
  } catch (error) {
    await showError(error instanceof Error ? error.message : 'Could not open a new window');
  }
}

async function runSaveCurrentProject(
  options: { saveAs?: boolean } = {},
): Promise<SaveProjectResult> {
  const project = getProject();
  if (!project) {
    return { status: 'error' };
  }

  let targetPath = project.filePath;
  if (options.saveAs || !targetPath) {
    const selectedPath = await save({
      title: options.saveAs ? 'Save Siteboard Project As' : 'Save Siteboard Project',
      defaultPath:
        targetPath ?? `${sanitizeFileName(getProjectDisplayName(project))}${SITEBOARD_EXTENSION}`,
      filters: [{ name: 'Siteboard Project', extensions: ['siteboard'] }],
    });

    if (!selectedPath) {
      return { status: 'cancelled' };
    }

    targetPath = selectedPath;
  }

  const normalizedTargetPath = normalizeSiteboardPath(targetPath);
  const latestProject = getProject();
  if (!latestProject) {
    return { status: 'error' };
  }

  const document = createProjectDocument(latestProject);

  try {
    const savedPath = await api.saveProjectFile(
      normalizedTargetPath,
      serializeProjectDocument(document),
    );
    useProjectStore.getState().markProjectSaved(savedPath, document);
    return { status: 'saved', filePath: savedPath };
  } catch (error) {
    await showError(error instanceof Error ? error.message : 'Failed to save the file');
    return { status: 'error' };
  }
}

export function openProjectFromDialog(): Promise<void> {
  return enqueueFileOperation(runOpenProjectFromDialog);
}

export function saveCurrentProject(options: { saveAs?: boolean } = {}): Promise<SaveProjectResult> {
  return enqueueFileOperation(() => runSaveCurrentProject(options));
}

export async function runFileCommand(command: FileCommand): Promise<void> {
  await enqueueFileOperation(async () => {
    if (command === 'new-tab') {
      await runNewDocumentTab();
      return;
    }

    if (command === 'new-window') {
      await runNewDocumentWindow();
      return;
    }

    if (command === 'open') {
      await runOpenProjectFromDialog();
      return;
    }

    const project = getProject();
    if (!project) {
      await showInfo('No project available to save');
      return;
    }

    await runSaveCurrentProject({ saveAs: command === 'save-as' });
  });
}
