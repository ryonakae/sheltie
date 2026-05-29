import ArrowRotateRight from '@gravity-ui/icons/ArrowRotateRight';
import ChevronLeft from '@gravity-ui/icons/ChevronLeft';
import ChevronRight from '@gravity-ui/icons/ChevronRight';
import Display from '@gravity-ui/icons/Display';
import Pin from '@gravity-ui/icons/Pin';
import Smartphone from '@gravity-ui/icons/Smartphone';
import { memo, type ComponentType, type SVGProps } from 'react';
import { twMerge } from 'tailwind-merge';

import { NodeTabletIcon } from '@/components/Node/NodeTabletIcon';
import { SIZE_PRESETS } from '@/constants';

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>;

const PRESET_ICONS: Record<string, SvgComponent> = {
  Mobile: Smartphone,
  Tablet: NodeTabletIcon,
  PC: Display,
};

interface WebPageToolbarProps {
  width: number;
  height: number;
  canGoBack: boolean;
  canGoForward: boolean;
  isMoved: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onPinUrl: () => void;
  onResizePreset: (width: number, height: number) => void;
}

export const WebPageToolbar = memo(function WebPageToolbar({
  width,
  height,
  canGoBack,
  canGoForward,
  isMoved,
  onGoBack,
  onGoForward,
  onReload,
  onPinUrl,
  onResizePreset,
}: WebPageToolbarProps) {
  const buttonBase =
    'nodrag flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-medium transition-colors';
  const enabledHover = 'hover:bg-white/20';
  const enabledColor = 'text-white/70';
  const activeClass = 'bg-white/25 text-white';
  const disabledClass = 'cursor-not-allowed text-white/30';

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-zinc-800 px-1 py-0.5 shadow-lg">
      <button
        type="button"
        className={twMerge(
          buttonBase,
          canGoBack ? `${enabledColor} ${enabledHover}` : disabledClass,
        )}
        disabled={!canGoBack}
        title="Go Back"
        onClick={onGoBack}
      >
        <ChevronLeft width={14} height={14} />
      </button>
      <button
        type="button"
        className={twMerge(
          buttonBase,
          canGoForward ? `${enabledColor} ${enabledHover}` : disabledClass,
        )}
        disabled={!canGoForward}
        title="Go Forward"
        onClick={onGoForward}
      >
        <ChevronRight width={14} height={14} />
      </button>
      <button
        type="button"
        className={twMerge(buttonBase, `${enabledColor} ${enabledHover}`)}
        title="Reload Page"
        onClick={onReload}
      >
        <ArrowRotateRight width={14} height={14} />
      </button>

      <div className="mx-0.5 h-4 w-px bg-white/20" />

      {SIZE_PRESETS.map((preset) => {
        const isActive = width === preset.width && height === preset.height;
        const Icon = PRESET_ICONS[preset.label];
        return (
          <button
            key={preset.label}
            type="button"
            className={twMerge(
              buttonBase,
              isActive ? activeClass : `${enabledColor} ${enabledHover}`,
            )}
            title={`Resize to ${preset.label} (${preset.width}×${preset.height})`}
            onClick={() => onResizePreset(preset.width, preset.height)}
          >
            <Icon width={14} height={14} />
          </button>
        );
      })}

      <div className="mx-0.5 h-4 w-px bg-white/20" />

      <span className="px-1.5 text-xs text-white/70 tabular-nums">
        {width} × {height}
      </span>

      {isMoved && (
        <>
          <div className="mx-0.5 h-4 w-px bg-white/20" />
          <button
            type="button"
            className={twMerge(buttonBase, `${enabledColor} ${enabledHover}`)}
            title="Pin Current Page as Default"
            onClick={onPinUrl}
          >
            <Pin width={14} height={14} />
          </button>
        </>
      )}
    </div>
  );
});
