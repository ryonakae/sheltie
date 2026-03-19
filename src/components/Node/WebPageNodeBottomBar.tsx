import Display from '@gravity-ui/icons/Display';
import Smartphone from '@gravity-ui/icons/Smartphone';
import { twMerge } from 'tailwind-merge';

import { AppButton } from '@/components/Common/AppButton';
import { NodeTabletIcon } from '@/components/Node/NodeTabletIcon';
import { SIZE_PRESETS } from '@/constants';

import type { ComponentType, SVGProps } from 'react';

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>;

const PRESET_ICONS: Record<string, SvgComponent> = {
  モバイル: Smartphone,
  タブレット: NodeTabletIcon,
  PC: Display,
};

export interface WebPageNodeBottomBarProps {
  width: number;
  height: number;
  hidePresetControls: boolean;
  onResizePreset: (width: number, height: number) => void;
}

export function WebPageNodeBottomBar({
  width,
  height,
  hidePresetControls,
  onResizePreset,
}: WebPageNodeBottomBarProps) {
  const presetIconStyle = {
    width: 14,
    height: 14,
  };
  const toolbarButtonStyle = {
    width: 24,
    minWidth: 24,
    height: 24,
    minHeight: 24,
    padding: 0,
  } as const;

  return (
    <div className="flex h-8 w-full items-center overflow-hidden bg-transparent px-2 text-[11px] leading-[15px]">
      <div className="flex shrink-0 items-center gap-0.5">
        {!hidePresetControls &&
          SIZE_PRESETS.map((preset) => {
            const isActive = width === preset.width && height === preset.height;
            const Icon = PRESET_ICONS[preset.label];
            return (
              <AppButton
                size="xs"
                key={preset.label}
                className={twMerge(
                  'pointer-events-auto shrink-0 hover:bg-default-hover',
                  isActive ? 'text-accent' : 'text-muted hover:text-foreground',
                )}
                style={toolbarButtonStyle}
                onMouseDown={(e) => e.stopPropagation()}
                onPress={() => onResizePreset(preset.width, preset.height)}
                aria-label={`${preset.label}サイズに変更 (${preset.width}×${preset.height})`}
              >
                <Icon style={presetIconStyle} />
              </AppButton>
            );
          })}
      </div>

      <span className="ml-auto shrink-0 px-1 text-muted">
        {width} × {height}
      </span>
    </div>
  );
}
