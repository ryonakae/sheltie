import ArrowRotateRight from '@gravity-ui/icons/ArrowRotateRight';
import ChevronLeft from '@gravity-ui/icons/ChevronLeft';
import ChevronRight from '@gravity-ui/icons/ChevronRight';
import Pin from '@gravity-ui/icons/Pin';

import { AppButton } from '@/components/Common/AppButton';
import { WEB_PAGE_TOP_BAR_HEIGHT } from '@/constants';
import { zoomPx } from '@/lib/canvas-zoom';

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
  onMouseDown: (e: React.MouseEvent) => void;
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
  onMouseDown,
}: WebPageNodeTopBarProps) {
  const topBarStyle = {
    height: zoomPx(WEB_PAGE_TOP_BAR_HEIGHT),
    paddingInline: zoomPx(8),
    fontSize: zoomPx(12),
    lineHeight: zoomPx(16),
    borderRadius: `${zoomPx(16)} ${zoomPx(16)} 0 0`,
  };
  const iconStyle = {
    width: zoomPx(14),
    height: zoomPx(14),
  };

  return (
    <div
      className="flex shrink-0 cursor-grab items-center overflow-hidden bg-default active:cursor-grabbing"
      style={topBarStyle}
      onMouseDown={onMouseDown}
    >
      <span className="min-w-0 flex-1 truncate text-foreground" title={url}>
        {title || formatDisplayUrl(url)}
        {isMoved && <span className="ml-1 text-muted">(Moved)</span>}
      </span>

      {!hideNavigationControls && (
        <>
          <AppButton
            size="xs"
            scaleWithCanvasZoom
            className="shrink-0 text-muted hover:bg-default-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            isDisabled={!onGoBack || !canGoBack}
            onMouseDown={(e) => e.stopPropagation()}
            onPress={onGoBack}
            aria-label="前のページに戻る"
          >
            <ChevronLeft style={iconStyle} />
          </AppButton>

          <AppButton
            size="xs"
            scaleWithCanvasZoom
            className="shrink-0 text-muted hover:bg-default-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            isDisabled={!onGoForward || !canGoForward}
            onMouseDown={(e) => e.stopPropagation()}
            onPress={onGoForward}
            aria-label="次のページに進む"
          >
            <ChevronRight style={iconStyle} />
          </AppButton>

          <AppButton
            size="xs"
            scaleWithCanvasZoom
            className="shrink-0 text-muted hover:bg-default-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
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
          scaleWithCanvasZoom
          className="shrink-0 text-muted hover:bg-default-hover hover:text-foreground"
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
