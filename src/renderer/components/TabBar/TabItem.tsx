import { memo, useCallback } from 'react';

import { useSortable } from '@dnd-kit/react/sortable';
import Xmark from '@gravity-ui/icons/Xmark';

import type { Project } from '@/renderer/types/tab';

interface TabItemProps {
  project: Project;
  index: number;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}

export const TabItem = memo(function TabItem({
  project,
  index,
  isActive,
  onActivate,
  onClose,
}: TabItemProps) {
  const { ref, isDragging } = useSortable({ id: project.id, index });

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose],
  );

  return (
    <div
      ref={ref}
      className={[
        'group relative flex h-full cursor-pointer items-center gap-1 border-r border-b-2 border-border px-3 text-sm transition-colors select-none',
        isActive
          ? 'border-b-accent bg-surface text-foreground'
          : 'border-b-transparent text-muted hover:bg-default/50 hover:text-foreground',
        isDragging ? 'opacity-50' : '',
      ].join(' ')}
      onClick={onActivate}
    >
      <span className="max-w-28 truncate">{project.title}</span>
      <button
        className="ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100 hover:bg-background-tertiary"
        onClick={handleClose}
        aria-label={`${project.title}を閉じる`}
      >
        <Xmark className="size-3" />
      </button>
    </div>
  );
});
