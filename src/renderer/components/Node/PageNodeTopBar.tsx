import ArrowRotateRight from '@gravity-ui/icons/ArrowRotateRight';
import ChevronLeft from '@gravity-ui/icons/ChevronLeft';
import ChevronRight from '@gravity-ui/icons/ChevronRight';
import Pin from '@gravity-ui/icons/Pin';
import Xmark from '@gravity-ui/icons/Xmark';

import { AppButton } from '@/renderer/components/Common/AppButton';
import {
  TOOLBAR_BUTTON_PADDING,
  TOOLBAR_GAP,
  TOOLBAR_HEIGHT,
  TOOLBAR_ICON_SIZE,
  TOOLBAR_PADDING,
  TOOLBAR_RADIUS,
} from '@/renderer/constants';

export interface PageNodeTopBarProps {
  title: string;
  url: string;
  isMoved: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onReload?: () => void;
  onPinUrl?: () => void;
  onClose: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
}

function formatDisplayUrl(url: string) {
  return url
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/g, '');
}

export function PageNodeTopBar({
  title,
  url,
  isMoved,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onReload,
  onPinUrl,
  onClose,
  onMouseDown,
}: PageNodeTopBarProps) {
  return (
    <div
      className="flex shrink-0 cursor-grab items-center border-t border-border-secondary bg-default select-none active:cursor-grabbing"
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
        {title || formatDisplayUrl(url)}
        {isMoved && <span className="ml-1 text-muted">(Moved)</span>}
      </span>

      <AppButton
        size="xs"
        className="shrink-0 text-muted hover:bg-default-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          padding: TOOLBAR_BUTTON_PADDING,
          borderRadius: 'calc(2px / var(--canvas-zoom, 1))',
        }}
        isDisabled={!onGoBack || !canGoBack}
        onMouseDown={(e) => e.stopPropagation()}
        onPress={onGoBack}
        aria-label="前のページに戻る"
      >
        <ChevronLeft
          style={{
            width: TOOLBAR_ICON_SIZE,
            height: TOOLBAR_ICON_SIZE,
          }}
        />
      </AppButton>

      <AppButton
        size="xs"
        className="shrink-0 text-muted hover:bg-default-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          padding: TOOLBAR_BUTTON_PADDING,
          borderRadius: 'calc(2px / var(--canvas-zoom, 1))',
        }}
        isDisabled={!onGoForward || !canGoForward}
        onMouseDown={(e) => e.stopPropagation()}
        onPress={onGoForward}
        aria-label="次のページに進む"
      >
        <ChevronRight
          style={{
            width: TOOLBAR_ICON_SIZE,
            height: TOOLBAR_ICON_SIZE,
          }}
        />
      </AppButton>

      <AppButton
        size="xs"
        className="shrink-0 text-muted hover:bg-default-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          padding: TOOLBAR_BUTTON_PADDING,
          borderRadius: 'calc(2px / var(--canvas-zoom, 1))',
        }}
        isDisabled={!onReload}
        onMouseDown={(e) => e.stopPropagation()}
        onPress={onReload}
        aria-label="ページをリロード"
      >
        <ArrowRotateRight
          style={{
            width: TOOLBAR_ICON_SIZE,
            height: TOOLBAR_ICON_SIZE,
          }}
        />
      </AppButton>

      {isMoved && onPinUrl && (
        <AppButton
          size="xs"
          className="shrink-0 text-muted hover:bg-default-hover hover:text-foreground"
          style={{
            padding: TOOLBAR_BUTTON_PADDING,
            borderRadius: 'calc(2px / var(--canvas-zoom, 1))',
          }}
          tooltipMessage="表示中のページをデフォルトに固定"
          onMouseDown={(e) => e.stopPropagation()}
          onPress={onPinUrl}
          aria-label="表示中のページをデフォルトに固定"
        >
          <Pin
            style={{
              width: TOOLBAR_ICON_SIZE,
              height: TOOLBAR_ICON_SIZE,
            }}
          />
        </AppButton>
      )}

      <AppButton
        size="xs"
        className="shrink-0 text-muted hover:bg-default-hover hover:text-foreground"
        style={{
          padding: TOOLBAR_BUTTON_PADDING,
          borderRadius: 'calc(2px / var(--canvas-zoom, 1))',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPress={onClose}
        aria-label="ページを閉じる"
      >
        <Xmark
          style={{
            width: TOOLBAR_ICON_SIZE,
            height: TOOLBAR_ICON_SIZE,
          }}
        />
      </AppButton>
    </div>
  );
}
