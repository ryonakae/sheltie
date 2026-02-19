import { memo, useCallback } from 'react';
import type React from 'react';

import { useSortable } from '@dnd-kit/react/sortable';
import Xmark from '@gravity-ui/icons/Xmark';

import type { Project } from '../../types/tab';

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
        'group relative flex h-full cursor-pointer items-center gap-1 border-r border-b-2 border-gray-200 px-3 text-sm transition-colors select-none',
        isActive
          ? 'border-b-blue-500 bg-white text-gray-900'
          : 'border-b-transparent text-gray-500 hover:bg-gray-200/50 hover:text-gray-700',
        isDragging ? 'opacity-50' : '',
      ].join(' ')}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onClick={onActivate}
    >
      <span className="max-w-28 truncate">{project.title}</span>
      <button
        className="ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-300"
        onClick={handleClose}
        aria-label={`${project.title}を閉じる`}
      >
        <Xmark className="size-3" />
      </button>
    </div>
  );
});
