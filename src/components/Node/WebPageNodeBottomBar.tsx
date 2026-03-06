import Display from '@gravity-ui/icons/Display';
import Smartphone from '@gravity-ui/icons/Smartphone';
import { twMerge } from 'tailwind-merge';

import { AppButton } from '@/components/Common/AppButton';
import { NodeTabletIcon } from '@/components/Node/NodeTabletIcon';
import { SIZE_PRESETS } from '@/constants';
import { zoomPx } from '@/lib/canvas-zoom';

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
  const bottomBarStyle = {
    height: zoomPx(32),
    paddingInline: zoomPx(8),
    fontSize: zoomPx(11),
    lineHeight: zoomPx(15),
    borderRadius: `0 0 ${zoomPx(16)} ${zoomPx(16)}`,
  };
  const presetGroupStyle = { gap: zoomPx(2) };
  const presetIconStyle = {
    width: zoomPx(14),
    height: zoomPx(14),
  };

  return (
    <div className="flex shrink-0 items-center overflow-hidden bg-default" style={bottomBarStyle}>
      <div className="flex shrink-0 items-center" style={presetGroupStyle}>
        {!hidePresetControls &&
          SIZE_PRESETS.map((preset) => {
            const isActive = width === preset.width && height === preset.height;
            const Icon = PRESET_ICONS[preset.label];
            return (
              <AppButton
                size="xs"
                scaleWithCanvasZoom
                key={preset.label}
                className={twMerge(
                  'shrink-0 hover:bg-default-hover',
                  isActive ? 'text-accent' : 'text-muted hover:text-foreground',
                )}
                onMouseDown={(e) => e.stopPropagation()}
                onPress={() => onResizePreset(preset.width, preset.height)}
                aria-label={`${preset.label}サイズに変更 (${preset.width}×${preset.height})`}
              >
                <Icon style={presetIconStyle} />
              </AppButton>
            );
          })}
      </div>

      <span className="ml-auto shrink-0 text-muted">
        {width} × {height}
      </span>
    </div>
  );
}
