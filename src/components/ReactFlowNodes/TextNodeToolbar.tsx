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
import { TEXT_NODE_COLORS, TEXT_NODE_FONT_SIZE_PRESETS } from '@/constants';
import type { TextNode, TextNodeFontSizePreset } from '@/types';

const FONT_SIZE_LABELS = ['S', 'M', 'L', 'XL'] as const;

interface TextNodeToolbarProps {
  node: TextNode;
  onStyleChange: (
    nodeId: string,
    style: {
      fontSizePreset?: TextNodeFontSizePreset;
      fontWeight?: 'normal' | 'bold';
      italic?: boolean;
      strikethrough?: boolean;
      textColorIndex?: number;
    },
  ) => void;
}

export const TextNodeToolbar = memo(function TextNodeToolbar({
  node,
  onStyleChange,
}: TextNodeToolbarProps) {
  const currentSizePreset = node.fontSizePreset ?? 1;
  const currentWeight = node.fontWeight ?? 'normal';
  const currentItalic = node.italic ?? false;
  const currentStrikethrough = node.strikethrough ?? false;
  const currentColorIndex = node.textColorIndex ?? 0;

  const handleFontSize = useCallback(
    (preset: TextNodeFontSizePreset) => {
      onStyleChange(node.id, { fontSizePreset: preset });
    },
    [node.id, onStyleChange],
  );

  const toggleBold = useCallback(() => {
    onStyleChange(node.id, { fontWeight: currentWeight === 'bold' ? 'normal' : 'bold' });
  }, [node.id, currentWeight, onStyleChange]);

  const toggleItalic = useCallback(() => {
    onStyleChange(node.id, { italic: !currentItalic });
  }, [node.id, currentItalic, onStyleChange]);

  const toggleStrikethrough = useCallback(() => {
    onStyleChange(node.id, { strikethrough: !currentStrikethrough });
  }, [node.id, currentStrikethrough, onStyleChange]);

  const handleColor = useCallback(
    (index: number) => {
      onStyleChange(node.id, { textColorIndex: index });
    },
    [node.id, onStyleChange],
  );

  return (
    <div data-selection-toolbar={node.id} className={TOOLBAR_CONTAINER_CLASSNAME}>
      {/* フォントサイズプリセット */}
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

      {/* Bold */}
      <button
        type="button"
        className={twMerge(
          TOOLBAR_BUTTON_CLASSNAME,
          'font-bold',
          currentWeight === 'bold'
            ? TOOLBAR_BUTTON_ACTIVE_CLASSNAME
            : TOOLBAR_BUTTON_INACTIVE_CLASSNAME,
        )}
        title="Bold"
        onClick={toggleBold}
      >
        B
      </button>

      {/* Italic */}
      <button
        type="button"
        className={twMerge(
          TOOLBAR_BUTTON_CLASSNAME,
          'italic',
          currentItalic ? TOOLBAR_BUTTON_ACTIVE_CLASSNAME : TOOLBAR_BUTTON_INACTIVE_CLASSNAME,
        )}
        title="Italic"
        onClick={toggleItalic}
      >
        I
      </button>

      {/* Strikethrough */}
      <button
        type="button"
        className={twMerge(
          TOOLBAR_BUTTON_CLASSNAME,
          'line-through',
          currentStrikethrough
            ? TOOLBAR_BUTTON_ACTIVE_CLASSNAME
            : TOOLBAR_BUTTON_INACTIVE_CLASSNAME,
        )}
        title="Strikethrough"
        onClick={toggleStrikethrough}
      >
        S
      </button>

      <div className={TOOLBAR_DIVIDER_CLASSNAME} />

      {/* カラーパレット */}
      {TEXT_NODE_COLORS.map((color, index) => (
        <button
          key={color.label}
          type="button"
          className={twMerge(
            TOOLBAR_SWATCH_CLASSNAME,
            currentColorIndex === index ? TOOLBAR_SWATCH_ACTIVE_CLASSNAME : '',
          )}
          title={color.label}
          onClick={() => handleColor(index)}
        >
          <span
            className="block size-3.5 rounded-full border border-white/30"
            style={{ backgroundColor: color.value }}
          />
        </button>
      ))}
    </div>
  );
});
