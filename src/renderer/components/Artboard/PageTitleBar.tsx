import type { ComponentType, SVGProps } from 'react';
import Display from '@gravity-ui/icons/Display';
import Smartphone from '@gravity-ui/icons/Smartphone';
import ArrowRotateRight from '@gravity-ui/icons/ArrowRotateRight';
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
  isMoved: boolean;
  width: number;
  height: number;
  onReload: () => void;
  onClose: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onResizePreset: (width: number, height: number) => void;
}

const TOOLBAR_HEIGHT = 'calc(24px / var(--canvas-zoom, 1))';
const TOOLBAR_RADIUS = 'calc(8px / var(--canvas-zoom, 1))';
const TOOLBAR_ICON_SIZE = 'calc(14px / var(--canvas-zoom, 1))';
const TOOLBAR_PADDING = 'calc(8px / var(--canvas-zoom, 1))';
const TOOLBAR_BUTTON_PADDING = 'calc(2px / var(--canvas-zoom, 1))';
const TOOLBAR_GAP = 'calc(6px / var(--canvas-zoom, 1))';

export function PageTopBar({
  title,
  url,
  isMoved,
  onReload,
  onClose,
  onMouseDown,
}: Pick<PageTitleBarProps, 'title' | 'url' | 'isMoved' | 'onReload' | 'onClose' | 'onMouseDown'>) {
  return (
    <div
      className="flex shrink-0 cursor-grab items-center border border-b-0 border-border-secondary bg-default select-none active:cursor-grabbing"
      style={{
        height: TOOLBAR_HEIGHT,
        paddingInline: TOOLBAR_PADDING,
        gap: TOOLBAR_GAP,
        fontSize: 'calc(12px / var(--canvas-zoom, 1))',
        lineHeight: 'calc(16px / var(--canvas-zoom, 1))',
        borderRadius: `${TOOLBAR_RADIUS} ${TOOLBAR_RADIUS} 0 0`,
      }}
      onMouseDown={onMouseDown}
    >
      <span className="min-w-0 flex-1 truncate text-foreground" title={url}>
        {title || url}
        {isMoved && <span className="ml-1 text-muted">(Moved)</span>}
      </span>

      <button
        className="shrink-0 text-muted hover:bg-default-hover hover:text-foreground"
        style={{
          padding: TOOLBAR_BUTTON_PADDING,
          borderRadius: 'calc(2px / var(--canvas-zoom, 1))',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onReload}
        aria-label="ページをリロード"
      >
        <ArrowRotateRight
          style={{
            width: TOOLBAR_ICON_SIZE,
            height: TOOLBAR_ICON_SIZE,
          }}
        />
      </button>

      <button
        className="shrink-0 text-muted hover:bg-default-hover hover:text-foreground"
        style={{
          padding: TOOLBAR_BUTTON_PADDING,
          borderRadius: 'calc(2px / var(--canvas-zoom, 1))',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onClose}
        aria-label="ページを閉じる"
      >
        <Xmark
          style={{
            width: TOOLBAR_ICON_SIZE,
            height: TOOLBAR_ICON_SIZE,
          }}
        />
      </button>
    </div>
  );
}

export function PageBottomBar({
  width,
  height,
  onResizePreset,
}: Pick<PageTitleBarProps, 'width' | 'height' | 'onResizePreset'>) {
  return (
    <div
      className="flex shrink-0 items-center border border-t-0 border-border-secondary bg-default select-none"
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
            <button
              key={preset.label}
              className={`shrink-0 hover:bg-default-hover ${isActive ? 'text-accent' : 'text-muted hover:text-foreground'}`}
              style={{
                padding: TOOLBAR_BUTTON_PADDING,
                borderRadius: 'calc(2px / var(--canvas-zoom, 1))',
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onResizePreset(preset.width, preset.height)}
              aria-label={`${preset.label}サイズに変更 (${preset.width}×${preset.height})`}
              title={`${preset.label} (${preset.width}×${preset.height})`}
            >
              <Icon
                style={{
                  width: TOOLBAR_ICON_SIZE,
                  height: TOOLBAR_ICON_SIZE,
                }}
              />
            </button>
          );
        })}
      </div>

      <span className="ml-auto shrink-0 text-muted">
        {width} × {height}
      </span>
    </div>
  );
}

export function PageTitleBar({
  title,
  url,
  isMoved,
  onReload,
  onClose,
  onMouseDown,
  width,
  height,
  onResizePreset,
}: PageTitleBarProps) {
  return (
    <>
      <PageTopBar
        title={title}
        url={url}
        isMoved={isMoved}
        onReload={onReload}
        onClose={onClose}
        onMouseDown={onMouseDown}
      />
      <PageBottomBar width={width} height={height} onResizePreset={onResizePreset} />
    </>
  );
}
