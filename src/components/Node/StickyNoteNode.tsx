import { motion } from 'motion/react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { twMerge } from 'tailwind-merge';

import { AppButton } from '@/components/Common/AppButton';
import { NodeResizeHandle } from '@/components/Node/NodeResizeHandle';
import { STICKY_NOTE_COLORS, STICKY_NOTE_HEADER_HEIGHT, STICKY_NOTE_MIN_HEIGHT } from '@/constants';
import type { NodeResizeDirection } from '@/hooks/siteboard/types';
import { zoomPx } from '@/lib/canvas-zoom';
import { type StickyNoteNode as StickyNoteNodeModel } from '@/types';

export interface StickyNoteNodeProps {
  node: StickyNoteNodeModel;
  isActive: boolean;
  hideColorCycleButton: boolean;
  onActivate: (nodeId: string) => void;
  onContextMenu: (e: React.MouseEvent, nodeId: string) => void;
  onResizeStart: (e: React.MouseEvent, nodeId: string, direction: NodeResizeDirection) => void;
  onContentChange: (nodeId: string, content: string) => void;
  onAutoHeightChange: (nodeId: string, height: number) => void;
  onColorCycle: (nodeId: string) => void;
}

export const StickyNoteNode = memo(function StickyNoteNode({
  node,
  isActive,
  hideColorCycleButton,
  onActivate,
  onContextMenu,
  onResizeStart,
  onContentChange,
  onAutoHeightChange,
  onColorCycle,
}: StickyNoteNodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  // 編集中テキスト。ストア反映は 500ms デバウンス + blur 時 flush で行う。
  const [editingContent, setEditingContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentMeasureRef = useRef<HTMLDivElement>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedContentRef = useRef(node.content ?? '');

  const colorIndex = node.colorIndex ?? 0;
  const color = STICKY_NOTE_COLORS[colorIndex];
  const nextColor = STICKY_NOTE_COLORS[(colorIndex + 1) % STICKY_NOTE_COLORS.length];
  const noteContent = isEditing ? editingContent : (node.content ?? '');

  useEffect(() => {
    if (!isEditing) return;
    const measureEl = contentMeasureRef.current;
    if (!measureEl) return;
    const contentHeight = Math.ceil(measureEl.getBoundingClientRect().height);
    const nextHeight = Math.max(STICKY_NOTE_MIN_HEIGHT, contentHeight);
    if (nextHeight <= node.height) return;
    onAutoHeightChange(node.id, nextHeight);
  }, [editingContent, isEditing, node.height, node.id, node.width, onAutoHeightChange]);

  useEffect(() => {
    if (!isEditing) {
      lastCommittedContentRef.current = node.content ?? '';
    }
  }, [isEditing, node.content]);

  const commitContent = useCallback(
    (content: string) => {
      if (lastCommittedContentRef.current === content) return;
      lastCommittedContentRef.current = content;
      onContentChange(node.id, content);
    },
    [node.id, onContentChange],
  );

  useEffect(() => {
    if (!isEditing) return;
    if (editingContent === lastCommittedContentRef.current) return;

    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
    }
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      commitContent(editingContent);
    }, 500);

    return () => {
      if (commitTimerRef.current) {
        clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
    };
  }, [commitContent, editingContent, isEditing]);

  useEffect(
    () => () => {
      if (commitTimerRef.current) {
        clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
    },
    [],
  );

  const handleDoubleClick = useCallback(() => {
    const nextContent = node.content ?? '';
    // 編集開始時にストアの現在値で初期化
    setEditingContent(nextContent);
    lastCommittedContentRef.current = nextContent;
    setIsEditing(true);
    // state 更新後に focus し、表示文字列を全選択するため rAF で遅延
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
  }, [node.content]);

  const handleTextareaDoubleClick = useCallback(() => {
    textareaRef.current?.select();
  }, []);

  const handleBlur = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    commitContent(editingContent);
    setIsEditing(false);
  }, [commitContent, editingContent]);

  // page.id は UUID で不変のため、親の関数参照が安定していればこれらも安定する
  const handleActivate = useCallback(() => onActivate(node.id), [node.id, onActivate]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, direction: NodeResizeDirection) => {
      handleActivate();
      onResizeStart(e, node.id, direction);
    },
    [handleActivate, node.id, onResizeStart],
  );

  const noteClassName = twMerge(
    'flex flex-col shadow-lg',
    'border-solid outline-offset-0',
    color.bgClass,
    isActive ? '' : 'border',
    color.borderClass,
  );
  const noteHeaderClassName = twMerge(
    'node-drag-handle flex shrink-0 cursor-grab items-center active:cursor-grabbing',
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
  const noteBodyColorClassName = node.content ? 'text-[#333]' : 'text-[#aaa]';
  return (
    <motion.div
      layout="position"
      className={noteClassName}
      style={{
        width: node.width,
        borderRadius: zoomPx(16),
        outline: isActive ? `${zoomPx(2)} solid var(--color-focus)` : 'none',
        borderWidth: zoomPx(1),
      }}
      data-node-id={node.id}
      onMouseDown={handleActivate}
      onContextMenu={(e) => onContextMenu(e, node.id)}
    >
      {/* タイトルバー（ドラッグハンドル） */}
      <div
        className={noteHeaderClassName}
        style={{
          height: zoomPx(STICKY_NOTE_HEADER_HEIGHT),
          paddingInlineStart: zoomPx(8),
          paddingInlineEnd: zoomPx(4),
          borderBottomWidth: zoomPx(1),
          borderBottomStyle: 'solid',
          gap: zoomPx(2),
        }}
      >
        <span
          className="min-w-0 flex-1 truncate font-medium text-[#555]"
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
            onPress={() => onColorCycle(node.id)}
            aria-label="色を切り替え"
          >
            <span />
          </AppButton>
        )}
      </div>

      {/* テキスト表示/編集エリア（usePageResize 互換のため data-webview-placeholder 属性を付与） */}
      <div
        data-webview-placeholder
        className="relative box-border min-h-0 overflow-hidden"
        style={{
          width: node.width,
          height: node.height,
        }}
        onDoubleClick={handleDoubleClick}
      >
        <div
          ref={contentMeasureRef}
          data-sticky-note-content-measure
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 box-border p-2 text-[18px] leading-normal wrap-break-word whitespace-pre-wrap opacity-0"
          style={{ width: node.width }}
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
              'size-full cursor-text p-2 text-[18px] leading-normal wrap-break-word whitespace-pre-wrap',
              noteBodyColorClassName,
            )}
          >
            {node.content || 'ダブルクリックで編集'}
          </div>
        )}
      </div>

      {/* リサイズハンドル（8方向） */}
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as NodeResizeDirection[]).map((dir) => (
        <NodeResizeHandle key={dir} direction={dir} onMouseDown={handleResizeStart} />
      ))}
    </motion.div>
  );
});
