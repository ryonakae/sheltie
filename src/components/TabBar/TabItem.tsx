import { useSortable } from '@dnd-kit/react/sortable';
import Xmark from '@gravity-ui/icons/Xmark';
import { motion } from 'motion/react';
import { memo, useCallback, useState } from 'react';
import { twMerge } from 'tailwind-merge';

import type { Project } from '@/types';

interface TabItemProps {
  project: Project;
  index: number;
  isDirty: boolean;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}

export const TabItem = memo(function TabItem({
  project,
  index,
  isDirty,
  isActive,
  onActivate,
  onClose,
}: TabItemProps) {
  const { ref, isDragging } = useSortable({ id: project.id, index });
  const [isActionVisible, setIsActionVisible] = useState(false);

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose],
  );

  const handleClosePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
  }, []);

  const handlePointerOver = useCallback(() => {
    setIsActionVisible(true);
  }, []);

  const handlePointerOut = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const nextTarget = e.relatedTarget;
    if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) {
      return;
    }

    if (e.currentTarget.contains(document.activeElement)) {
      return;
    }

    setIsActionVisible(false);
  }, []);

  const handleFocusCapture = useCallback(() => {
    setIsActionVisible(true);
  }, []);

  const handleBlurCapture = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const nextFocusTarget = e.relatedTarget;
    if (nextFocusTarget instanceof Node && e.currentTarget.contains(nextFocusTarget)) {
      return;
    }

    setIsActionVisible(false);
  }, []);

  return (
    <motion.div
      ref={ref}
      className={twMerge(
        'relative flex h-full items-center gap-2 border-r border-border px-2 text-sm',
        isActive
          ? 'bg-surface text-foreground'
          : 'text-muted hover:bg-default/50 hover:text-foreground',
        isDragging ? 'opacity-50' : '',
      )}
      transition={{ duration: 0.15 }}
      onClick={onActivate}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
    >
      <span className="max-w-28 min-w-0 flex-1 truncate">{project.title}</span>
      <span className="relative size-5 shrink-0">
        {!isActionVisible && isDirty ? (
          <span
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            aria-hidden="true"
          >
            <span className="size-2 rounded-full bg-current" />
          </span>
        ) : null}
        <motion.button
          className={twMerge(
            'absolute inset-0 flex size-5 items-center justify-center rounded-full text-current transition-[opacity,background-color,color] duration-150 hover:bg-background-tertiary hover:text-foreground focus-visible:bg-background-tertiary focus-visible:text-foreground',
            isActionVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
          )}
          onPointerDown={handleClosePointerDown}
          onClick={handleClose}
          aria-label={`${project.title}を閉じる`}
          transition={{ duration: 0.15 }}
        >
          <Xmark className="size-3" />
        </motion.button>
      </span>
    </motion.div>
  );
});
