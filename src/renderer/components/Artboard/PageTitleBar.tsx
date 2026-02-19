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
      className="flex h-8 shrink-0 cursor-grab items-center gap-2 rounded-t-lg border border-b-0 border-gray-300 bg-gray-100 px-2 select-none active:cursor-grabbing"
      onMouseDown={onMouseDown}
    >
      {/* タイトル */}
      <span className="min-w-0 flex-1 truncate text-xs text-gray-700" title={url}>
        {title || url}
      </span>

      {/* サイズ表示 */}
      <span className="shrink-0 text-xs text-gray-400">
        {width} × {height}
      </span>

      {/* 閉じるボタン */}
      <button
        className="shrink-0 rounded-sm p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onClose}
        aria-label="ページを閉じる"
      >
        <Xmark className="size-3.5" />
      </button>
    </div>
  );
}
