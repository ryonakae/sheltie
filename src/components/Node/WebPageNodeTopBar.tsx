import ArrowRotateRight from '@gravity-ui/icons/ArrowRotateRight';
import ChevronLeft from '@gravity-ui/icons/ChevronLeft';
import ChevronRight from '@gravity-ui/icons/ChevronRight';
import Pin from '@gravity-ui/icons/Pin';

import { AppButton } from '@/components/Common/AppButton';

export interface WebPageNodeTopBarProps {
  title: string;
  url: string;
  isMoved: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onReload?: () => void;
  onPinUrl?: () => void;
  hideNavigationControls: boolean;
}

function formatDisplayUrl(url: string) {
  return url
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/g, '');
}

export function WebPageNodeTopBar({
  title,
  url,
  isMoved,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onReload,
  onPinUrl,
  hideNavigationControls,
}: WebPageNodeTopBarProps) {
  const iconStyle = {
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
    <div className="flex h-8 w-full items-center gap-0.5 overflow-hidden bg-transparent px-2 text-xs/4">
      <span className="min-w-0 flex-1 truncate px-1 text-foreground" title={url}>
        {title || formatDisplayUrl(url)}
        {isMoved && <span className="ml-1 text-muted">(Moved)</span>}
      </span>

      {!hideNavigationControls && (
        <>
          <AppButton
            size="xs"
            className="pointer-events-auto shrink-0 text-muted hover:bg-default-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            style={toolbarButtonStyle}
            isDisabled={!onGoBack || !canGoBack}
            onMouseDown={(e) => e.stopPropagation()}
            onPress={onGoBack}
            aria-label="前のページに戻る"
          >
            <ChevronLeft style={iconStyle} />
          </AppButton>

          <AppButton
            size="xs"
            className="pointer-events-auto shrink-0 text-muted hover:bg-default-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            style={toolbarButtonStyle}
            isDisabled={!onGoForward || !canGoForward}
            onMouseDown={(e) => e.stopPropagation()}
            onPress={onGoForward}
            aria-label="次のページに進む"
          >
            <ChevronRight style={iconStyle} />
          </AppButton>

          <AppButton
            size="xs"
            className="pointer-events-auto shrink-0 text-muted hover:bg-default-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            style={toolbarButtonStyle}
            isDisabled={!onReload}
            onMouseDown={(e) => e.stopPropagation()}
            onPress={onReload}
            aria-label="ページをリロード"
          >
            <ArrowRotateRight style={iconStyle} />
          </AppButton>
        </>
      )}

      {isMoved && onPinUrl && (
        <AppButton
          size="xs"
          className="pointer-events-auto shrink-0 text-muted hover:bg-default-hover hover:text-foreground"
          style={toolbarButtonStyle}
          tooltipMessage="表示中のページをデフォルトに固定"
          onMouseDown={(e) => e.stopPropagation()}
          onPress={onPinUrl}
          aria-label="表示中のページをデフォルトに固定"
        >
          <Pin style={iconStyle} />
        </AppButton>
      )}
    </div>
  );
}
