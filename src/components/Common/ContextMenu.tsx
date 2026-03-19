import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { twMerge } from 'tailwind-merge';

export interface ContextMenuItem {
  id: string;
  label: string;
  /** 'danger' でテキストを赤系に変更 */
  variant?: 'danger';
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onAction: (id: string) => void;
  onClose: () => void;
}

/**
 * ポータルで body 直下に fixed 配置するコンテキストメニュー。
 * クリック外・Escape・スクロールで閉じる。
 */
export function ContextMenu({ x, y, items, onAction, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScroll = () => onClose();

    // キャプチャフェーズで拾い、メニュー外クリックを確実に検知する
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-9999 min-w-36 overflow-hidden rounded-md border border-border bg-default shadow-lg"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={twMerge(
            'flex w-full items-center px-3 py-1.5 text-left text-sm hover:bg-default-hover',
            item.variant === 'danger' ? 'text-danger' : 'text-foreground',
          )}
          onPointerDown={(e) => {
            e.stopPropagation();
            onAction(item.id);
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
