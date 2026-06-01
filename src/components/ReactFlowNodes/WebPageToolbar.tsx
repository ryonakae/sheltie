import ArrowRight from '@gravity-ui/icons/ArrowRight';
import ArrowRotateRight from '@gravity-ui/icons/ArrowRotateRight';
import ChevronLeft from '@gravity-ui/icons/ChevronLeft';
import ChevronRight from '@gravity-ui/icons/ChevronRight';
import Display from '@gravity-ui/icons/Display';
import Globe from '@gravity-ui/icons/Globe';
import Pin from '@gravity-ui/icons/Pin';
import Smartphone from '@gravity-ui/icons/Smartphone';
import { Button, InputGroup, TextField } from '@heroui/react';
import { memo, useEffect, useMemo, useState, type ComponentType, type SVGProps } from 'react';
import { twMerge } from 'tailwind-merge';

import { NodeTabletIcon } from '@/components/Node/NodeTabletIcon';
import { SIZE_PRESETS } from '@/constants';
import { normalizeUrl } from '@/lib/url-utils';

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>;

const PRESET_ICONS: Record<string, SvgComponent> = {
  Mobile: Smartphone,
  Tablet: NodeTabletIcon,
  PC: Display,
};

interface WebPageToolbarProps {
  nodeId: string;
  width: number;
  height: number;
  canGoBack: boolean;
  canGoForward: boolean;
  isMoved: boolean;
  isEmpty: boolean;
  isEditingUrl: boolean;
  currentUrl: string;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onPinUrl: () => void;
  onResizePreset: (width: number, height: number) => void;
  onUrlSubmit: (url: string) => void;
}

export const WebPageToolbar = memo(function WebPageToolbar({
  nodeId,
  width,
  height,
  canGoBack,
  canGoForward,
  isMoved,
  isEmpty,
  isEditingUrl,
  currentUrl,
  onGoBack,
  onGoForward,
  onReload,
  onPinUrl,
  onResizePreset,
  onUrlSubmit,
}: WebPageToolbarProps) {
  const buttonBase =
    'nodrag flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-medium transition-colors';
  const enabledHover = 'hover:bg-white/20';
  const enabledColor = 'text-white/70';
  const activeClass = 'bg-white/25 text-white';
  const disabledClass = 'cursor-not-allowed text-white/30';

  const showUrlInput = isEmpty || isEditingUrl;

  return (
    <div
      data-node-toolbar={nodeId}
      className="flex items-center gap-0.5 rounded-lg bg-zinc-800 px-1 py-0.5 shadow-lg"
    >
      {showUrlInput ? (
        <WebPageToolbarUrlInput
          key={isEditingUrl ? `editing:${currentUrl}` : 'empty'}
          initialUrl={isEditingUrl ? currentUrl : ''}
          onSubmit={onUrlSubmit}
        />
      ) : (
        <>
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
        </>
      )}

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

interface WebPageToolbarUrlInputProps {
  initialUrl: string;
  onSubmit: (url: string) => void;
}

function WebPageToolbarUrlInput({ initialUrl, onSubmit }: WebPageToolbarUrlInputProps) {
  const [value, setValue] = useState(initialUrl);
  const normalizedUrl = useMemo(() => normalizeUrl(value), [value]);
  const isValid = normalizedUrl !== null;

  // 編集対象の URL が外部から差し替わったら入力値を同期する
  useEffect(() => {
    setValue(initialUrl);
  }, [initialUrl]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizedUrl) return;
    onSubmit(normalizedUrl);
  };

  return (
    <form onSubmit={handleSubmit} className="nodrag flex items-center">
      <TextField value={value} onChange={setValue} aria-label="URL to Open">
        <InputGroup variant="primary" className="-ml-0.5 rounded-lg">
          <InputGroup.Prefix>
            <Globe className="size-4 text-muted" />
          </InputGroup.Prefix>
          <InputGroup.Input
            autoFocus
            placeholder="Enter URL"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <InputGroup.Suffix className="pr-1">
            <Button
              isIconOnly
              type="submit"
              size="sm"
              variant="primary"
              isDisabled={!isValid}
              aria-label="Open"
              className="size-6 rounded-full"
            >
              <ArrowRight className="size-3.5" />
            </Button>
          </InputGroup.Suffix>
        </InputGroup>
      </TextField>
    </form>
  );
}
