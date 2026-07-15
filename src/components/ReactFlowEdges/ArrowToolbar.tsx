import ArrowRightArrowLeft from '@gravity-ui/icons/ArrowRightArrowLeft';
import { memo, useCallback } from 'react';
import { twMerge } from 'tailwind-merge';

import { EDGE_COLOR_PRESETS, EDGE_LINE_STYLES, EDGE_STROKE_WIDTHS } from '@/constants';
import type { BoardEdge, BoardEdgeStyle, EdgeLineStyle, EdgeStrokeWidth } from '@/types';

import { EDGE_TOOLBAR_OFFSET_PX } from './arrowGeometry';

interface ArrowToolbarProps {
  edge: BoardEdge;
  onStyleChange: (edgeId: string, style: Partial<BoardEdgeStyle>) => void;
  onReverse: (edgeId: string) => void;
}

const buttonBase =
  'nodrag flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-medium transition-colors hover:bg-white/20';
const activeClass = 'bg-white/25 text-white';
const inactiveClass = 'text-white/70';
const separatorClass = 'mx-0.5 h-4 w-px bg-white/20';

function LineStylePreview({ lineStyle }: { lineStyle: EdgeLineStyle }) {
  return (
    <svg aria-hidden width={18} height={8} viewBox="0 0 18 8">
      <line
        x1={1}
        y1={4}
        x2={17}
        y2={4}
        stroke="currentColor"
        strokeWidth={2}
        strokeDasharray={lineStyle === 'dashed' ? '4 3' : undefined}
        strokeLinecap="round"
      />
    </svg>
  );
}

export const ArrowToolbar = memo(function ArrowToolbar({
  edge,
  onStyleChange,
  onReverse,
}: ArrowToolbarProps) {
  const handleStrokeWidth = useCallback(
    (strokeWidth: EdgeStrokeWidth) => onStyleChange(edge.id, { strokeWidth }),
    [edge.id, onStyleChange],
  );
  const handleLineStyle = useCallback(
    (lineStyle: EdgeLineStyle) => onStyleChange(edge.id, { lineStyle }),
    [edge.id, onStyleChange],
  );
  const handleReverse = useCallback(() => onReverse(edge.id), [edge.id, onReverse]);

  return (
    <div
      data-selection-toolbar={edge.id}
      className="nodrag nopan flex items-center gap-0.5 rounded-lg bg-zinc-800 px-1 py-0.5 shadow-lg"
      style={{ transform: `translateY(-${EDGE_TOOLBAR_OFFSET_PX}px)` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {EDGE_STROKE_WIDTHS.map((strokeWidth) => (
        <button
          key={strokeWidth}
          type="button"
          aria-label={`${strokeWidth}px stroke`}
          aria-pressed={edge.strokeWidth === strokeWidth}
          className={twMerge(
            buttonBase,
            edge.strokeWidth === strokeWidth ? activeClass : inactiveClass,
          )}
          onClick={() => handleStrokeWidth(strokeWidth)}
        >
          <span
            aria-hidden
            className="block w-4 rounded-full bg-current"
            style={{ height: strokeWidth }}
          />
        </button>
      ))}

      <div className={separatorClass} />

      {EDGE_LINE_STYLES.map((lineStyle) => (
        <button
          key={lineStyle}
          type="button"
          aria-label={lineStyle === 'solid' ? 'Solid line' : 'Dashed line'}
          aria-pressed={edge.lineStyle === lineStyle}
          className={twMerge(
            buttonBase,
            edge.lineStyle === lineStyle ? activeClass : inactiveClass,
          )}
          onClick={() => handleLineStyle(lineStyle)}
        >
          <LineStylePreview lineStyle={lineStyle} />
        </button>
      ))}

      <div className={separatorClass} />

      <button
        type="button"
        aria-label="Reverse direction"
        className={twMerge(buttonBase, inactiveClass)}
        onClick={handleReverse}
      >
        <ArrowRightArrowLeft width={14} height={14} />
      </button>

      <div className={separatorClass} />

      {EDGE_COLOR_PRESETS.map((preset) => (
        <button
          key={preset.key}
          type="button"
          aria-label={`${preset.key} color`}
          aria-pressed={edge.colorPreset === preset.key}
          className={twMerge(
            'nodrag flex size-7 items-center justify-center rounded-sm transition-colors hover:bg-white/20',
            edge.colorPreset === preset.key ? 'bg-white/25' : '',
          )}
          onClick={() => onStyleChange(edge.id, { colorPreset: preset.key })}
        >
          <span
            aria-hidden
            className="block size-3.5 rounded-full border border-white/30"
            style={{ backgroundColor: preset.value }}
          />
        </button>
      ))}
    </div>
  );
});
