import Xmark from '@gravity-ui/icons/Xmark';

interface PageTitleBarProps {
  title: string;
  url: string;
  width: number;
  height: number;
  onClose: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
}

export function PageTitleBar({
  title,
  url,
  width,
  height,
  onClose,
  onMouseDown,
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
