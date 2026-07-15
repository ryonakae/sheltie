import type { Project } from '@/types';

const UNTITLED_PREFIX = 'Untitled';
const SHELTIE_EXTENSION = '.sheltie';

export function getUntitledDisplayName(index: number): string {
  return index <= 1 ? UNTITLED_PREFIX : `${UNTITLED_PREFIX} ${index}`;
}

export function getDisplayNameFromFilePath(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const baseName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
  if (!baseName) return UNTITLED_PREFIX;
  return baseName.endsWith(SHELTIE_EXTENSION)
    ? baseName.slice(0, -SHELTIE_EXTENSION.length) || UNTITLED_PREFIX
    : baseName;
}

export function getProjectDisplayName(
  project: Pick<Project, 'filePath' | 'untitledIndex'>,
): string {
  return project.filePath
    ? getDisplayNameFromFilePath(project.filePath)
    : getUntitledDisplayName(project.untitledIndex);
}
