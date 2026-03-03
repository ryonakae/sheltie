import Xmark from '@gravity-ui/icons/Xmark';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { twMerge } from 'tailwind-merge';

import { AppButton } from '@/renderer/components/Common/AppButton';
import { NodeResizeHandle } from '@/renderer/components/Node/NodeResizeHandle';
import { STICKY_NOTE_COLORS, STICKY_NOTE_MIN_HEIGHT } from '@/renderer/constants';
import type { NodeResizeDirection } from '@/renderer/hooks/siteboard/types';
import { zoomPx } from '@/renderer/lib/canvas-zoom';
import { type Page } from '@/renderer/types/tab';

interface StickyNoteNodeProps {
  page: Page;
  isActive: boolean;
  hideColorCycleButton: boolean;
  onActivate: (pageId: string) => void;
  onClose: (pageId: string) => void;
  onDragStart: (e: React.MouseEvent, pageId: string) => void;
  onResizeStart: (e: React.MouseEvent, pageId: string, direction: NodeResizeDirection) => void;
  onContentChange: (pageId: string, content: string) => void;
  onAutoHeightChange: (pageId: string, height: number) => void;
  onColorCycle: (pageId: string) => void;
}

export const StickyNoteNode = memo(function StickyNoteNode({
  page,
  isActive,
  hideColorCycleButton,
  onActivate,
  onClose,
  onDragStart,
  onResizeStart,
  onContentChange,
  onAutoHeightChange,
  onColorCycle,
}: StickyNoteNodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  // 編集中のテキスト内容（blur 時のみストアに反映）。編集開始時に page.content で初期化する
  const [editingContent, setEditingContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentMeasureRef = useRef<HTMLDivElement>(null);

  const colorIndex = page.colorIndex ?? 0;
  const color = STICKY_NOTE_COLORS[colorIndex];
  const nextColor = STICKY_NOTE_COLORS[(colorIndex + 1) % STICKY_NOTE_COLORS.length];
  const noteContent = isEditing ? editingContent : (page.content ?? '');

  useEffect(() => {
    if (!isEditing) return;
    const measureEl = contentMeasureRef.current;
    if (!measureEl) return;
    const contentHeight = Math.ceil(measureEl.getBoundingClientRect().height);
    const nextHeight = Math.max(STICKY_NOTE_MIN_HEIGHT, contentHeight);
    if (nextHeight <= page.height) return;
    onAutoHeightChange(page.id, nextHeight);
  }, [editingContent, isEditing, onAutoHeightChange, page.height, page.id, page.width]);

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
    (e: React.MouseEvent, direction: NodeResizeDirection) => {
      handleActivate();
      onResizeStart(e, page.id, direction);
    },
    [handleActivate, onResizeStart, page.id],
  );

  const noteClassName = twMerge(
    'absolute flex flex-col shadow-lg',
    'border-solid outline-offset-0',
    color.bgClass,
    isActive ? '' : 'border',
    color.borderClass,
  );
  const noteHeaderClassName = twMerge(
    'flex shrink-0 cursor-grab items-center active:cursor-grabbing',
    color.borderClass,
  );
  const noteColorButtonClassName = twMerge(
    'flex shrink-0 cursor-pointer items-center justify-center',
    'border',
    nextColor.borderClass,
    nextColor.bgClass,
    nextColor.textClass,
    'hover:opacity-80',
  );
  const noteBodyColorClassName = page.content ? 'text-[#333]' : 'text-[#aaa]';
  const noteHeaderActionButtonStyle = {
    padding: zoomPx(2),
  };
  const closeIconStyle = {
    width: zoomPx(14),
    height: zoomPx(14),
  };

  return (
    <div
      className={noteClassName}
      style={{
        left: page.x,
        top: page.y,
        width: page.width,
        borderRadius: zoomPx(16),
        outline: isActive ? `${zoomPx(2)} solid var(--color-focus)` : 'none',
        borderWidth: zoomPx(1),
      }}
      data-page-id={page.id}
      onMouseDown={handleActivate}
    >
      {/* タイトルバー（ドラッグハンドル） */}
      <div
        className={noteHeaderClassName}
        style={{
          height: zoomPx(32),
          paddingInlineStart: zoomPx(8),
          paddingInlineEnd: zoomPx(4),
          borderBottomWidth: zoomPx(1),
          borderBottomStyle: 'solid',
          gap: zoomPx(2),
        }}
        onMouseDown={(e) => {
          // テキスト選択・ボタン操作以外でドラッグ開始
          onDragStart(e, page.id);
        }}
      >
        <span
          className="min-w-0 flex-1 truncate font-medium text-[#555] select-none"
          style={{ fontSize: zoomPx(11) }}
        >
          Sticky Note
        </span>

        {/* 色切り替えボタン（次の色をプレビュー表示） */}
        {!hideColorCycleButton && (
          <AppButton
            size="xs"
            scaleWithCanvasZoom
            className={noteColorButtonClassName}
            style={{
              width: zoomPx(18),
              minWidth: zoomPx(18),
              height: zoomPx(18),
              minHeight: zoomPx(18),
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPress={() => onColorCycle(page.id)}
            aria-label="色を切り替え"
          >
            <span />
          </AppButton>
        )}

        {/* 閉じるボタン */}
        <AppButton
          size="xs"
          scaleWithCanvasZoom
          className="shrink-0 text-muted hover:bg-default-hover hover:text-foreground"
          style={noteHeaderActionButtonStyle}
          onMouseDown={(e) => e.stopPropagation()}
          onPress={handleCloseBound}
          aria-label="付箋を削除"
        >
          <Xmark style={closeIconStyle} />
        </AppButton>
      </div>

      {/* テキスト表示/編集エリア（usePageResize 互換のため data-webview-placeholder 属性を付与） */}
      <div
        data-webview-placeholder
        className="relative box-border min-h-0 overflow-hidden"
        style={{
          width: page.width,
          height: page.height,
        }}
        onDoubleClick={handleDoubleClick}
      >
        <div
          ref={contentMeasureRef}
          data-sticky-note-content-measure
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 box-border p-2 text-[18px] leading-normal wrap-break-word whitespace-pre-wrap opacity-0"
          style={{ width: page.width }}
        >
          {noteContent || ' '}
        </div>

        {isEditing ? (
          <textarea
            ref={textareaRef}
            className="m-0 box-border block size-full min-h-0 resize-none overflow-auto border-0 bg-transparent p-2 text-[18px] leading-normal text-[#333] focus:outline-none"
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
            onBlur={handleBlur}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={handleTextareaDoubleClick}
          />
        ) : (
          <div
            className={twMerge(
              'size-full cursor-text p-2 text-[18px] leading-normal wrap-break-word whitespace-pre-wrap select-none',
              noteBodyColorClassName,
            )}
          >
            {page.content || 'ダブルクリックで編集'}
          </div>
        )}
      </div>

      {/* リサイズハンドル（8方向） */}
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as NodeResizeDirection[]).map((dir) => (
        <NodeResizeHandle key={dir} direction={dir} onMouseDown={handleResizeStart} />
      ))}
    </div>
  );
});
