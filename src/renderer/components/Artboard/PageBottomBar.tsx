import Display from '@gravity-ui/icons/Display';
import Smartphone from '@gravity-ui/icons/Smartphone';
import { twMerge } from 'tailwind-merge';

import { TabletIcon } from '@/renderer/components/Artboard/TabletIcon';
import { AppButton } from '@/renderer/components/Common/AppButton';
import {
  SIZE_PRESETS,
  TOOLBAR_BUTTON_PADDING,
  TOOLBAR_GAP,
  TOOLBAR_HEIGHT,
  TOOLBAR_ICON_SIZE,
  TOOLBAR_PADDING,
  TOOLBAR_RADIUS,
} from '@/renderer/constants';

import type { ComponentType, SVGProps } from 'react';

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>;

const PRESET_ICONS: Record<string, SvgComponent> = {
  モバイル: Smartphone,
  タブレット: TabletIcon,
  PC: Display,
};

export interface PageBottomBarProps {
  width: number;
  height: number;
  onResizePreset: (width: number, height: number) => void;
}

export function PageBottomBar({ width, height, onResizePreset }: PageBottomBarProps) {
  return (
    <div
      className="flex shrink-0 items-center border-b border-border-secondary bg-default select-none"
      style={{
        height: TOOLBAR_HEIGHT,
        paddingInline: TOOLBAR_PADDING,
        gap: TOOLBAR_GAP,
        fontSize: 'calc(11px / var(--canvas-zoom, 1))',
        lineHeight: 'calc(15px / var(--canvas-zoom, 1))',
        borderRadius: `0 0 ${TOOLBAR_RADIUS} ${TOOLBAR_RADIUS}`,
      }}
    >
      <div className="flex shrink-0 items-center" style={{ gap: TOOLBAR_BUTTON_PADDING }}>
        {SIZE_PRESETS.map((preset) => {
          const isActive = width === preset.width && height === preset.height;
          const Icon = PRESET_ICONS[preset.label];
          return (
            <AppButton
              size="xs"
              key={preset.label}
              className={twMerge(
                'shrink-0 hover:bg-default-hover',
                isActive ? 'text-accent' : 'text-muted hover:text-foreground',
              )}
              style={{
                padding: TOOLBAR_BUTTON_PADDING,
                borderRadius: 'calc(2px / var(--canvas-zoom, 1))',
              }}
              tooltipMessage={`${preset.label}サイズに変更 (${preset.width}×${preset.height})`}
              onMouseDown={(e) => e.stopPropagation()}
              onPress={() => onResizePreset(preset.width, preset.height)}
              aria-label={`${preset.label}サイズに変更 (${preset.width}×${preset.height})`}
            >
              <Icon
                style={{
                  width: TOOLBAR_ICON_SIZE,
                  height: TOOLBAR_ICON_SIZE,
                }}
              />
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
