import ArrowRight from '@gravity-ui/icons/ArrowRight';
import ArrowRotateRight from '@gravity-ui/icons/ArrowRotateRight';
import ChevronLeft from '@gravity-ui/icons/ChevronLeft';
import ChevronRight from '@gravity-ui/icons/ChevronRight';
import Display from '@gravity-ui/icons/Display';
import Globe from '@gravity-ui/icons/Globe';
import Pin from '@gravity-ui/icons/Pin';
import Smartphone from '@gravity-ui/icons/Smartphone';
import { Button, InputGroup, TextField } from '@heroui/react';
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from 'react';
import { twMerge } from 'tailwind-merge';

import { NodeTabletIcon } from '@/components/Node/NodeTabletIcon';
import {
  TOOLBAR_BUTTON_ACTIVE_CLASSNAME,
  TOOLBAR_BUTTON_BASE_CLASSNAME,
  TOOLBAR_BUTTON_INACTIVE_CLASSNAME,
  TOOLBAR_CONTAINER_CLASSNAME,
  TOOLBAR_DIVIDER_CLASSNAME,
} from '@/components/ReactFlowNodes/nodeToolbarStyles';
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
  // 無効状態のボタンがあるため hover は共通 base に含めず条件付きで足す
  const enabledClass = `${TOOLBAR_BUTTON_INACTIVE_CLASSNAME} hover:bg-white/20`;
  const disabledClass = 'cursor-not-allowed text-white/30';

  const showUrlInput = isEmpty || isEditingUrl;

  return (
    <div data-selection-toolbar={nodeId} className={TOOLBAR_CONTAINER_CLASSNAME}>
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
              TOOLBAR_BUTTON_BASE_CLASSNAME,
              canGoBack ? enabledClass : disabledClass,
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
              TOOLBAR_BUTTON_BASE_CLASSNAME,
              canGoForward ? enabledClass : disabledClass,
            )}
            disabled={!canGoForward}
            title="Go Forward"
            onClick={onGoForward}
          >
            <ChevronRight width={14} height={14} />
          </button>
          <button
            type="button"
            className={twMerge(TOOLBAR_BUTTON_BASE_CLASSNAME, enabledClass)}
            title="Reload Page"
            onClick={onReload}
          >
            <ArrowRotateRight width={14} height={14} />
          </button>
        </>
      )}

      <div className={TOOLBAR_DIVIDER_CLASSNAME} />

      {SIZE_PRESETS.map((preset) => {
        const isActive = width === preset.width && height === preset.height;
        const Icon = PRESET_ICONS[preset.label];
        return (
          <button
            key={preset.label}
            type="button"
            className={twMerge(
              TOOLBAR_BUTTON_BASE_CLASSNAME,
              isActive ? TOOLBAR_BUTTON_ACTIVE_CLASSNAME : enabledClass,
            )}
            title={`Resize to ${preset.label} (${preset.width}×${preset.height})`}
            onClick={() => onResizePreset(preset.width, preset.height)}
          >
            <Icon width={14} height={14} />
          </button>
        );
      })}

      <div className={TOOLBAR_DIVIDER_CLASSNAME} />

      <span className="px-1.5 text-xs text-white/70 tabular-nums">
        {width} × {height}
      </span>

      {isMoved && (
        <>
          <div className={TOOLBAR_DIVIDER_CLASSNAME} />
          <button
            type="button"
            className={twMerge(TOOLBAR_BUTTON_BASE_CLASSNAME, enabledClass)}
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
  const formRef = useRef<HTMLFormElement>(null);

  // 編集対象の URL が外部から差し替わったら入力値を同期する
  useEffect(() => {
    setValue(initialUrl);
  }, [initialUrl]);

  // タイトル段クリック経由でツールバーが新規マウントされたとき、pointer/click イベントの後に
  // ブラウザ側で焦点が移ることがあるため、autoFocus だけでは取りこぼす。次フレームで明示的に focus する
  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      const input = formRef.current?.querySelector<HTMLInputElement>('input');
      input?.focus();
    });
    return () => cancelAnimationFrame(handle);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizedUrl) return;
    onSubmit(normalizedUrl);
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="nodrag flex items-center">
      <TextField value={value} onChange={setValue} aria-label="URL to Open">
        {/* 通常モードのナビボタン群（h-7）に対し h-6 = 24px に縮め、ツールバー全体の高さ揺れを抑える。
            ツールバー本体（bg-zinc-800）に乗るためテーマに依らず常に dark 系の配色で固定する */}
        <InputGroup
          variant="secondary"
          className="min-h-6 rounded-sm border-zinc-700 bg-zinc-900 hover:bg-zinc-900"
        >
          <InputGroup.Prefix className="border-zinc-700 bg-transparent px-1.5">
            <Globe className="size-3 text-white/60" />
          </InputGroup.Prefix>
          <InputGroup.Input
            autoFocus
            placeholder="Enter URL"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="py-0 text-xs text-white placeholder:text-white/40 sm:text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <InputGroup.Suffix className="pr-0.5">
            <Button
              isIconOnly
              type="submit"
              size="sm"
              variant="primary"
              isDisabled={!isValid}
              aria-label="Open"
              className="size-5 rounded-full"
            >
              <ArrowRight className="size-3" />
            </Button>
          </InputGroup.Suffix>
        </InputGroup>
      </TextField>
    </form>
  );
}
