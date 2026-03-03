import { useSortable } from '@dnd-kit/react/sortable';
import Xmark from '@gravity-ui/icons/Xmark';
import { motion } from 'motion/react';
import { memo, useCallback } from 'react';
import { twMerge } from 'tailwind-merge';

import type { Project } from '@/renderer/types/tab';

const containerVariants = {
  rest: {},
  hover: {},
} as const;

const closeButtonVariants = {
  rest: { opacity: 0 },
  hover: { opacity: 1 },
} as const;

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
    <motion.div
      ref={ref}
      className={twMerge(
        'relative flex h-full cursor-pointer items-center gap-1 border-r border-b-2 border-border px-3 text-sm select-none',
        isActive
          ? 'border-b-transparent bg-surface text-foreground'
          : 'border-b-transparent text-muted hover:bg-default/50 hover:text-foreground',
        isDragging ? 'opacity-50' : '',
      )}
      whileHover="hover"
      initial="rest"
      variants={containerVariants}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.15 }}
      onClick={onActivate}
    >
      <span className="max-w-28 truncate">{project.title}</span>
      <motion.button
        className="ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-background-tertiary"
        onClick={handleClose}
        aria-label={`${project.title}を閉じる`}
        variants={closeButtonVariants}
        initial="rest"
        whileTap={{ scale: 0.9 }}
        transition={{ duration: 0.15 }}
      >
        <Xmark className="size-3" />
      </motion.button>
    </motion.div>
  );
});
