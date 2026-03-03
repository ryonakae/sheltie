import Sticker from '@gravity-ui/icons/Sticker';
import Xmark from '@gravity-ui/icons/Xmark';
import { memo, useCallback, useRef, useState } from 'react';
import { twMerge } from 'tailwind-merge';

import { AppButton } from '@/renderer/components/Common/AppButton';
import { PageResizeHandle } from '@/renderer/components/Siteboard/PageResizeHandle';
import { STICKY_NOTE_COLORS } from '@/renderer/constants';
import { type Page } from '@/renderer/types/tab';

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface StickyNoteFrameProps {
  page: Page;
  isActive: boolean;
  onActivate: (pageId: string) => void;
  onClose: (pageId: string) => void;
  onDragStart: (e: React.MouseEvent, pageId: string) => void;
  onResizeStart: (e: React.MouseEvent, pageId: string, direction: ResizeDirection) => void;
  onContentChange: (pageId: string, content: string) => void;
  onColorCycle: (pageId: string) => void;
}

export const StickyNoteFrame = memo(function StickyNoteFrame({
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
    // state 更新後に focus し、表示文字列を全選択するため rAF で遅延
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
  }, [page.content]);

  const handleTextareaDoubleClick = useCallback(() => {
    textareaRef.current?.select();
  }, []);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    onContentChange(page.id, editingContent);
  }, [page.id, editingContent, onContentChange]);

  // page.id は UUID で不変のため、親の関数参照が安定していればこれらも安定する
  const handleActivate = useCallback(() => onActivate(page.id), [onActivate, page.id]);
  const handleCloseBound = useCallback(() => onClose(page.id), [onClose, page.id]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, direction: ResizeDirection) => {
      handleActivate();
      onResizeStart(e, page.id, direction);
    },
    [handleActivate, onResizeStart, page.id],
  );

  const noteClassName = twMerge(
    'absolute flex flex-col shadow-lg',
    color.bgClass,
    isActive ? '' : 'border',
    color.borderClass,
  );
  const noteHeaderClassName = twMerge(
    'flex shrink-0 cursor-grab items-center gap-1 active:cursor-grabbing',
    color.borderClass,
  );
  const noteColorButtonClassName = twMerge(
    'flex shrink-0 cursor-pointer items-center justify-center rounded-sm',
    'border',
    nextColor.borderClass,
    nextColor.bgClass,
    nextColor.textClass,
    'hover:opacity-80',
  );

  return (
    <div
      className={noteClassName}
      style={{
        left: page.x,
        top: page.y,
        width: page.width,
        borderRadius: 'calc(8px / var(--canvas-zoom, 1))',
        outline: isActive ? 'calc(2px / var(--canvas-zoom, 1)) solid var(--color-focus)' : 'none',
        borderWidth: isActive ? undefined : 'calc(1px / var(--canvas-zoom, 1))',
        borderStyle: isActive ? undefined : 'solid',
        outlineOffset: 0,
      }}
      data-page-id={page.id}
      onMouseDown={handleActivate}
    >
      {/* タイトルバー（ドラッグハンドル） */}
      <div
        className={noteHeaderClassName}
        style={{
          height: 'calc(28px / var(--canvas-zoom, 1))',
          paddingLeft: 'calc(8px / var(--canvas-zoom, 1))',
          paddingRight: 'calc(4px / var(--canvas-zoom, 1))',
          borderBottomWidth: 'calc(1px / var(--canvas-zoom, 1))',
          borderBottomStyle: 'solid',
        }}
        onMouseDown={(e) => {
          // テキスト選択・ボタン操作以外でドラッグ開始
          onDragStart(e, page.id);
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
        <AppButton
          size="xs"
          className={noteColorButtonClassName}
          style={{
            width: 'calc(18px / var(--canvas-zoom, 1))',
            height: 'calc(18px / var(--canvas-zoom, 1))',
            borderWidth: 'calc(1px / var(--canvas-zoom, 1))',
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPress={() => onColorCycle(page.id)}
          aria-label="色を切り替え"
        >
          <Sticker
            className={nextColor.textClass}
            style={{
              width: 'calc(10px / var(--canvas-zoom, 1))',
              height: 'calc(10px / var(--canvas-zoom, 1))',
            }}
          />
        </AppButton>

        {/* 閉じるボタン */}
        <AppButton
          size="xs"
          className="flex shrink-0 cursor-pointer items-center justify-center rounded-sm hover:opacity-80"
          style={{
            width: 'calc(18px / var(--canvas-zoom, 1))',
            height: 'calc(18px / var(--canvas-zoom, 1))',
            color: '#888',
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPress={handleCloseBound}
          aria-label="付箋を削除"
        >
          <Xmark
            style={{
              width: 'calc(12px / var(--canvas-zoom, 1))',
              height: 'calc(12px / var(--canvas-zoom, 1))',
            }}
          />
        </AppButton>
      </div>

      {/* テキスト表示/編集エリア（usePageResize 互換のため data-webview-placeholder 属性を付与） */}
      <div
        data-webview-placeholder
        className="relative overflow-hidden"
        style={{
          width: page.width,
          height: page.height,
          boxSizing: 'border-box',
          minHeight: 0,
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
              height: '100%',
              display: 'block',
              boxSizing: 'border-box',
              color: '#333',
              lineHeight: 1.5,
              minHeight: 0,
              margin: 0,
              border: 'none',
              overflow: 'auto',
            }}
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
            onBlur={handleBlur}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={handleTextareaDoubleClick}
          />
        ) : (
          <div
            className="size-full wrap-break-word whitespace-pre-wrap select-none"
            style={{
              fontSize: 'calc(13px / var(--canvas-zoom, 1))',
              padding: 'calc(8px / var(--canvas-zoom, 1))',
              height: '100%',
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
});
