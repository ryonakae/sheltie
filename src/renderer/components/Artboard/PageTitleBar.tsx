import type { ComponentType, SVGProps } from 'react';
import Display from '@gravity-ui/icons/Display';
import Smartphone from '@gravity-ui/icons/Smartphone';
import Xmark from '@gravity-ui/icons/Xmark';

import { SIZE_PRESETS } from '@/renderer/types/tab';
import { TabletIcon } from '@/renderer/components/Artboard/TabletIcon';

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>;

const PRESET_ICONS: Record<string, SvgComponent> = {
  モバイル: Smartphone,
  タブレット: TabletIcon,
  PC: Display,
};

interface PageTitleBarProps {
  title: string;
  url: string;
  width: number;
  height: number;
  onClose: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onResizePreset: (width: number, height: number) => void;
}

export function PageTitleBar({
  title,
  url,
  width,
  height,
  onClose,
  onMouseDown,
  onResizePreset,
}: PageTitleBarProps) {
  return (
    <div
      className="flex shrink-0 cursor-grab items-center border-b-0 border-border-secondary bg-default select-none active:cursor-grabbing"
      style={{
        height: 'calc(32px / var(--canvas-zoom, 1))',
        paddingInline: 'calc(8px / var(--canvas-zoom, 1))',
        gap: 'calc(8px / var(--canvas-zoom, 1))',
        fontSize: 'calc(12px / var(--canvas-zoom, 1))',
        lineHeight: 'calc(16px / var(--canvas-zoom, 1))',
        borderWidth: 'calc(1px / var(--canvas-zoom, 1))',
        borderBottomWidth: 0,
        borderRadius: 'calc(8px / var(--canvas-zoom, 1)) calc(8px / var(--canvas-zoom, 1)) 0 0',
      }}
      onMouseDown={onMouseDown}
    >
      {/* タイトル */}
      <span className="min-w-0 flex-1 truncate text-foreground" title={url}>
        {title || url}
      </span>

      {/* サイズ表示 */}
      <span className="shrink-0 text-muted">
        {width} × {height}
      </span>

      {/* デバイスプリセットボタン */}
      <div
        className="flex shrink-0 items-center"
        style={{ gap: 'calc(2px / var(--canvas-zoom, 1))' }}
      >
        {SIZE_PRESETS.map((preset) => {
          const isActive = width === preset.width && height === preset.height;
          const Icon = PRESET_ICONS[preset.label];
          return (
            <button
              key={preset.label}
              className={`shrink-0 hover:bg-default-hover ${isActive ? 'text-accent' : 'text-muted hover:text-foreground'}`}
              style={{
                padding: 'calc(2px / var(--canvas-zoom, 1))',
                borderRadius: 'calc(2px / var(--canvas-zoom, 1))',
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onResizePreset(preset.width, preset.height)}
              aria-label={`${preset.label}サイズに変更 (${preset.width}×${preset.height})`}
              title={`${preset.label} (${preset.width}×${preset.height})`}
            >
              <Icon
                style={{
                  width: 'calc(14px / var(--canvas-zoom, 1))',
                  height: 'calc(14px / var(--canvas-zoom, 1))',
                }}
              />
            </button>
          );
        })}
      </div>

      {/* 閉じるボタン */}
      <button
        className="shrink-0 text-muted hover:bg-default-hover hover:text-foreground"
        style={{
          padding: 'calc(2px / var(--canvas-zoom, 1))',
          borderRadius: 'calc(2px / var(--canvas-zoom, 1))',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onClose}
        aria-label="ページを閉じる"
      >
        <Xmark
          style={{
            width: 'calc(14px / var(--canvas-zoom, 1))',
            height: 'calc(14px / var(--canvas-zoom, 1))',
          }}
        />
      </button>
    </div>
  );
}
