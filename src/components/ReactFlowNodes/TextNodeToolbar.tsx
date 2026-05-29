import { memo, useCallback } from 'react';
import { twMerge } from 'tailwind-merge';

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

  const buttonBase =
    'nodrag flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-medium transition-colors hover:bg-white/20';
  const activeClass = 'bg-white/25 text-white';
  const inactiveClass = 'text-white/70';

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-zinc-800 px-1 py-0.5 shadow-lg">
      {/* フォントサイズプリセット */}
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

      {/* Bold */}
      <button
        type="button"
        className={twMerge(
          buttonBase,
          'font-bold',
          currentWeight === 'bold' ? activeClass : inactiveClass,
        )}
        title="太字"
        onClick={toggleBold}
      >
        B
      </button>

      {/* Italic */}
      <button
        type="button"
        className={twMerge(buttonBase, 'italic', currentItalic ? activeClass : inactiveClass)}
        title="斜体"
        onClick={toggleItalic}
      >
        I
      </button>

      {/* Strikethrough */}
      <button
        type="button"
        className={twMerge(
          buttonBase,
          'line-through',
          currentStrikethrough ? activeClass : inactiveClass,
        )}
        title="取り消し線"
        onClick={toggleStrikethrough}
      >
        S
      </button>

      <div className="mx-0.5 h-4 w-px bg-white/20" />

      {/* カラーパレット */}
      {TEXT_NODE_COLORS.map((color, index) => (
        <button
          key={color.label}
          type="button"
          className={twMerge(
            'nodrag flex size-7 items-center justify-center rounded-sm transition-colors hover:bg-white/20',
            currentColorIndex === index ? 'bg-white/25' : '',
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
