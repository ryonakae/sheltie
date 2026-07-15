import { memo, useCallback } from 'react';
import { twMerge } from 'tailwind-merge';

import { STICKY_NOTE_COLORS, TEXT_NODE_FONT_SIZE_PRESETS } from '@/constants';
import type { StickyNoteNode, TextNodeFontSizePreset } from '@/types';

const FONT_SIZE_LABELS = ['S', 'M', 'L', 'XL'] as const;

interface StickyNoteToolbarProps {
  node: StickyNoteNode;
  onStyleChange: (
    nodeId: string,
    style: {
      colorIndex?: number;
      fontSizePreset?: TextNodeFontSizePreset;
    },
  ) => void;
}

export const StickyNoteToolbar = memo(function StickyNoteToolbar({
  node,
  onStyleChange,
}: StickyNoteToolbarProps) {
  const currentSizePreset = node.fontSizePreset ?? 1;
  const currentColorIndex = node.colorIndex ?? 0;

  const handleFontSize = useCallback(
    (preset: TextNodeFontSizePreset) => {
      onStyleChange(node.id, { fontSizePreset: preset });
    },
    [node.id, onStyleChange],
  );

  const handleColor = useCallback(
    (index: number) => {
      onStyleChange(node.id, { colorIndex: index });
    },
    [node.id, onStyleChange],
  );

  const buttonBase =
    'nodrag flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-medium transition-colors hover:bg-white/20';
  const activeClass = 'bg-white/25 text-white';
  const inactiveClass = 'text-white/70';

  return (
    <div
      data-selection-toolbar={node.id}
      className="flex items-center gap-0.5 rounded-lg bg-zinc-800 px-1 py-0.5 shadow-lg"
    >
      {FONT_SIZE_LABELS.map((label, index) => (
        <button
          key={label}
          type="button"
          className={twMerge(buttonBase, currentSizePreset === index ? activeClass : inactiveClass)}
          title={`${TEXT_NODE_FONT_SIZE_PRESETS[index]}px`}
          onClick={() => handleFontSize(index as TextNodeFontSizePreset)}
        >
          {label}
        </button>
      ))}

      <div className="mx-0.5 h-4 w-px bg-white/20" />

      {STICKY_NOTE_COLORS.map((color, index) => (
        <button
          key={color.bgClass}
          type="button"
          className={twMerge(
            'nodrag flex size-7 items-center justify-center rounded-sm transition-colors hover:bg-white/20',
            currentColorIndex === index ? 'bg-white/25' : '',
          )}
          title={color.bgClass}
          onClick={() => handleColor(index)}
        >
          <span
            className={twMerge('block size-3.5 rounded-full border border-white/30', color.bgClass)}
          />
        </button>
      ))}
    </div>
  );
});
