import { message, open, save } from '@tauri-apps/plugin-dialog';

import {
  createProjectDocument,
  parseProjectDocument,
  serializeProjectDocument,
} from '@/lib/project-document';
import { api, type FileCommand } from '@/lib/tauri-bridge';
import { useProjectStore } from '@/store/tab-store';
import type { Project } from '@/types';

const SITEBOARD_EXTENSION = '.siteboard';
let inFlightCommand: Promise<void> = Promise.resolve();

export type SaveProjectResult =
  | { status: 'saved'; filePath: string }
  | { status: 'cancelled' }
  | { status: 'error' };

function getProjectById(projectId: string): Project | undefined {
  return useProjectStore.getState().projects.find((project) => project.id === projectId);
}

function getActiveProject(): Project | undefined {
  const { activeId } = useProjectStore.getState();
  return getProjectById(activeId);
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
  return cleaned || 'untitled';
}

function findProjectByFilePath(filePath: string): Project | undefined {
  const normalizedPath = normalizeSiteboardPath(filePath);
  return useProjectStore
    .getState()
    .projects.find(
      (project) => project.filePath && normalizeSiteboardPath(project.filePath) === normalizedPath,
    );
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

  const existingProject = findProjectByFilePath(selected);
  if (existingProject) {
    useProjectStore.getState().openProject(existingProject.id);
    return;
  }

  try {
    const contents = await api.loadProjectFile(selected);
    const document = parseProjectDocument(contents);
    useProjectStore.getState().importProjectFromFile(document, normalizeSiteboardPath(selected));
  } catch (error) {
    await showError(error instanceof Error ? error.message : 'ファイルを開けませんでした');
  }
}

async function runSaveProjectById(
  projectId: string,
  options: { saveAs?: boolean } = {},
): Promise<SaveProjectResult> {
  const project = getProjectById(projectId);
  if (!project) {
    return { status: 'error' };
  }

  let targetPath = project.filePath;
  if (options.saveAs || !targetPath) {
    const selectedPath = await save({
      title: options.saveAs ? 'Save Siteboard Project As' : 'Save Siteboard Project',
      defaultPath: targetPath ?? `${sanitizeFileName(project.title)}${SITEBOARD_EXTENSION}`,
      filters: [{ name: 'Siteboard Project', extensions: ['siteboard'] }],
    });

    if (!selectedPath) {
      return { status: 'cancelled' };
    }

    targetPath = selectedPath;
  }

  const normalizedTargetPath = normalizeSiteboardPath(targetPath);
  const conflictingProject = useProjectStore
    .getState()
    .projects.find(
      (candidate) =>
        candidate.id !== project.id &&
        candidate.filePath &&
        normalizeSiteboardPath(candidate.filePath) === normalizedTargetPath,
    );

  if (conflictingProject) {
    await showError('別のプロジェクトが同じ .siteboard ファイルを使用中です');
    return { status: 'error' };
  }

  const latestProject = getProjectById(projectId);
  if (!latestProject) {
    return { status: 'error' };
  }

  const document = createProjectDocument(latestProject);

  try {
    const savedPath = await api.saveProjectFile(
      normalizedTargetPath,
      serializeProjectDocument(document),
    );
    useProjectStore.getState().markProjectSaved(projectId, savedPath, document);
    return { status: 'saved', filePath: savedPath };
  } catch (error) {
    await showError(error instanceof Error ? error.message : 'ファイル保存に失敗しました');
    return { status: 'error' };
  }
}

export function openProjectFromDialog(): Promise<void> {
  return enqueueFileOperation(runOpenProjectFromDialog);
}

export function saveProjectById(
  projectId: string,
  options: { saveAs?: boolean } = {},
): Promise<SaveProjectResult> {
  return enqueueFileOperation(() => runSaveProjectById(projectId, options));
}

export async function runFileCommand(command: FileCommand): Promise<void> {
  await enqueueFileOperation(async () => {
    if (command === 'open') {
      await runOpenProjectFromDialog();
      return;
    }

    const activeProject = getActiveProject();
    if (!activeProject) {
      await showInfo('保存対象のプロジェクトがありません');
      return;
    }

    await runSaveProjectById(activeProject.id, { saveAs: command === 'save-as' });
  });
}
