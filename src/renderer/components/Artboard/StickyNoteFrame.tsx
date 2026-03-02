import { useCallback, useRef, useState } from 'react';

import Sticker from '@gravity-ui/icons/Sticker';
import Xmark from '@gravity-ui/icons/Xmark';

import { STICKY_NOTE_COLORS, type Page } from '@/renderer/types/tab';
import { PageResizeHandle } from '@/renderer/components/Artboard/PageResizeHandle';

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface StickyNoteFrameProps {
  page: Page;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent, direction: ResizeDirection) => void;
  onContentChange: (pageId: string, content: string) => void;
  onColorCycle: (pageId: string) => void;
}

export function StickyNoteFrame({
  page,
  isActive,
  onActivate,
  onClose,
  onDragStart,
  onResizeStart,
  onContentChange,
  onColorCycle,
}: StickyNoteFrameProps) {
  const [isEditing, setIsEditing] = useState(false);
  // 編集中のテキスト内容（blur 時のみストアに反映）。編集開始時に page.content で初期化する
  const [editingContent, setEditingContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const colorIndex = page.colorIndex ?? 0;
  const color = STICKY_NOTE_COLORS[colorIndex];
  const nextColor = STICKY_NOTE_COLORS[(colorIndex + 1) % STICKY_NOTE_COLORS.length];

  const handleDoubleClick = useCallback(() => {
    // 編集開始時にストアの現在値で初期化
    setEditingContent(page.content ?? '');
    setIsEditing(true);
    // state 更新後に focus するため rAF で遅延
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [page.content]);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    onContentChange(page.id, editingContent);
  }, [page.id, editingContent, onContentChange]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, direction: ResizeDirection) => {
      onActivate();
      onResizeStart(e, direction);
    },
    [onActivate, onResizeStart],
  );

  return (
    <div
      className="absolute flex flex-col shadow-lg"
      style={{
        left: page.x,
        top: page.y,
        width: page.width,
        backgroundColor: color.bg,
        borderRadius: 'calc(8px / var(--canvas-zoom, 1))',
        outline: isActive
          ? 'calc(2px / var(--canvas-zoom, 1)) solid var(--color-focus)'
          : `calc(1px / var(--canvas-zoom, 1)) solid ${color.border}`,
        outlineOffset: 0,
      }}
      data-page-id={page.id}
      onMouseDown={onActivate}
    >
      {/* タイトルバー（ドラッグハンドル） */}
      <div
        className="flex shrink-0 cursor-grab items-center gap-1 active:cursor-grabbing"
        style={{
          height: 'calc(28px / var(--canvas-zoom, 1))',
          paddingLeft: 'calc(8px / var(--canvas-zoom, 1))',
          paddingRight: 'calc(4px / var(--canvas-zoom, 1))',
          borderBottom: `calc(1px / var(--canvas-zoom, 1)) solid ${color.border}`,
        }}
        onMouseDown={(e) => {
          // テキスト選択・ボタン操作以外でドラッグ開始
          onDragStart(e);
        }}
      >
        <span
          className="min-w-0 flex-1 truncate select-none"
          style={{
            fontSize: 'calc(11px / var(--canvas-zoom, 1))',
            color: '#555',
            fontWeight: 500,
          }}
        >
          Sticky Note
        </span>

        {/* 色切り替えボタン（次の色をプレビュー表示） */}
        <button
          className="flex shrink-0 cursor-pointer items-center justify-center rounded-sm hover:opacity-80"
          style={{
            width: 'calc(18px / var(--canvas-zoom, 1))',
            height: 'calc(18px / var(--canvas-zoom, 1))',
            backgroundColor: nextColor.bg,
            border: `calc(1px / var(--canvas-zoom, 1)) solid ${nextColor.border}`,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onColorCycle(page.id);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="色を切り替え"
        >
          <Sticker
            style={{
              width: 'calc(10px / var(--canvas-zoom, 1))',
              height: 'calc(10px / var(--canvas-zoom, 1))',
              color: nextColor.border,
            }}
          />
        </button>

        {/* 閉じるボタン */}
        <button
          className="flex shrink-0 cursor-pointer items-center justify-center rounded-sm hover:opacity-80"
          style={{
            width: 'calc(18px / var(--canvas-zoom, 1))',
            height: 'calc(18px / var(--canvas-zoom, 1))',
            color: '#888',
          }}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="付箋を削除"
        >
          <Xmark
            style={{
              width: 'calc(12px / var(--canvas-zoom, 1))',
              height: 'calc(12px / var(--canvas-zoom, 1))',
            }}
          />
        </button>
      </div>

      {/* テキスト表示/編集エリア（usePageResize 互換のため data-webview-placeholder 属性を付与） */}
      <div
        data-webview-placeholder
        className="relative flex-1 overflow-hidden"
        style={{
          width: page.width,
          height: page.height,
        }}
        onDoubleClick={handleDoubleClick}
      >
        {isEditing ? (
          <textarea
            ref={textareaRef}
            className="size-full resize-none bg-transparent focus:outline-none"
            style={{
              fontSize: 'calc(13px / var(--canvas-zoom, 1))',
              padding: 'calc(8px / var(--canvas-zoom, 1))',
              color: '#333',
              lineHeight: 1.5,
            }}
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
            onBlur={handleBlur}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="size-full wrap-break-word whitespace-pre-wrap select-none"
            style={{
              fontSize: 'calc(13px / var(--canvas-zoom, 1))',
              padding: 'calc(8px / var(--canvas-zoom, 1))',
              color: page.content ? '#333' : '#aaa',
              lineHeight: 1.5,
              cursor: 'text',
            }}
          >
            {page.content || 'ダブルクリックで編集'}
          </div>
        )}
      </div>

      {/* リサイズハンドル（8方向） */}
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDirection[]).map((dir) => (
        <PageResizeHandle key={dir} direction={dir} onMouseDown={handleResizeStart} />
      ))}
    </div>
  );
}
