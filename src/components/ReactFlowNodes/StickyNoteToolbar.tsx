import { memo, useCallback } from 'react';
import { twMerge } from 'tailwind-merge';

import {
  TOOLBAR_BUTTON_ACTIVE_CLASSNAME,
  TOOLBAR_BUTTON_CLASSNAME,
  TOOLBAR_BUTTON_INACTIVE_CLASSNAME,
  TOOLBAR_CONTAINER_CLASSNAME,
  TOOLBAR_DIVIDER_CLASSNAME,
  TOOLBAR_SWATCH_ACTIVE_CLASSNAME,
  TOOLBAR_SWATCH_CLASSNAME,
} from '@/components/ReactFlowNodes/nodeToolbarStyles';
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

  return (
    <div data-selection-toolbar={node.id} className={TOOLBAR_CONTAINER_CLASSNAME}>
      {FONT_SIZE_LABELS.map((label, index) => (
        <button
          key={label}
          type="button"
          className={twMerge(
            TOOLBAR_BUTTON_CLASSNAME,
            currentSizePreset === index
              ? TOOLBAR_BUTTON_ACTIVE_CLASSNAME
              : TOOLBAR_BUTTON_INACTIVE_CLASSNAME,
          )}
          title={`${TEXT_NODE_FONT_SIZE_PRESETS[index]}px`}
          onClick={() => handleFontSize(index as TextNodeFontSizePreset)}
        >
          {label}
        </button>
      ))}

      <div className={TOOLBAR_DIVIDER_CLASSNAME} />

      {STICKY_NOTE_COLORS.map((color, index) => (
        <button
          key={color.bgClass}
          type="button"
          className={twMerge(
            TOOLBAR_SWATCH_CLASSNAME,
            currentColorIndex === index ? TOOLBAR_SWATCH_ACTIVE_CLASSNAME : '',
          )}
          title={color.label}
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
