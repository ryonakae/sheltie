import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { twMerge } from 'tailwind-merge';

import {
  STICKY_NOTE_COLORS,
  STICKY_NOTE_MIN_HEIGHT,
  TEXT_NODE_FONT_SIZE_PRESETS,
} from '@/constants';
import { zoomPx } from '@/lib/canvas-zoom';
import { type StickyNoteNode as StickyNoteNodeModel } from '@/types';

export interface StickyNoteNodeProps {
  node: StickyNoteNodeModel;
  isActive: boolean;
  onActivate: (nodeId: string, addToSelection: boolean) => void;
  onContextMenu: (e: React.MouseEvent, nodeId: string) => void;
  onContentChange: (nodeId: string, content: string) => void;
  onAutoHeightChange: (nodeId: string, height: number) => void;
}

export const StickyNoteNode = memo(function StickyNoteNode({
  node,
  isActive,
  onActivate,
  onContextMenu,
  onContentChange,
  onAutoHeightChange,
}: StickyNoteNodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  // 編集中テキスト。ストア反映は 500ms デバウンス + blur 時 flush で行う。
  const [editingContent, setEditingContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentMeasureRef = useRef<HTMLTextAreaElement>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedContentRef = useRef(node.content ?? '');
  const contentClickStateRef = useRef({
    wasActive: false,
    startX: 0,
    startY: 0,
    moved: false,
  });

  const colorIndex = node.colorIndex ?? 0;
  const color = STICKY_NOTE_COLORS[colorIndex];
  const fontSize = TEXT_NODE_FONT_SIZE_PRESETS[node.fontSizePreset ?? 1];
  const noteContent = isEditing ? editingContent : (node.content ?? '');

  useEffect(() => {
    const measureEl = contentMeasureRef.current;
    if (!measureEl) return;
    const contentHeight = Math.ceil(measureEl.scrollHeight);
    const nextHeight = Math.max(STICKY_NOTE_MIN_HEIGHT, contentHeight);
    if (nextHeight === node.height) return;
    onAutoHeightChange(node.id, nextHeight);
  }, [node.height, node.id, node.width, noteContent, onAutoHeightChange]);

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

  const beginEditing = useCallback(() => {
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

  const handleContentMouseDownCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      contentClickStateRef.current = {
        wasActive: isActive,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
    },
    [isActive],
  );

  const handleContentMouseMoveCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.buttons & 1) === 0) return;
    const { startX, startY, moved } = contentClickStateRef.current;
    if (moved) return;
    const deltaX = Math.abs(event.clientX - startX);
    const deltaY = Math.abs(event.clientY - startY);
    if (deltaX >= 3 || deltaY >= 3) {
      contentClickStateRef.current.moved = true;
    }
  }, []);

  const handleContentClick = useCallback(() => {
    const { wasActive, moved } = contentClickStateRef.current;
    if (!wasActive || moved || isEditing) return;
    beginEditing();
  }, [beginEditing, isEditing]);

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
  const handleActivate = useCallback(
    (e: React.MouseEvent) => onActivate(node.id, e.shiftKey),
    [node.id, onActivate],
  );

  const noteClassName = twMerge(
    'overflow-hidden shadow-lg',
    'border-solid outline-offset-0',
    isActive ? '' : 'border',
    color.borderClass,
    isEditing ? 'cursor-text' : '',
  );
  const noteBodyColorClassName = node.content ? 'text-[#333]' : 'text-[#aaa]';
  return (
    <div
      className={twMerge('size-full', noteClassName)}
      style={{
        borderWidth: zoomPx(1),
      }}
      data-node-id={node.id}
      onMouseDown={handleActivate}
      onContextMenu={(e) => onContextMenu(e, node.id)}
    >
      {/* テキスト表示/編集エリア */}
      <div
        data-webview-placeholder
        className={twMerge('relative box-border size-full overflow-hidden', color.bgClass)}
        onMouseDownCapture={handleContentMouseDownCapture}
        onMouseMoveCapture={handleContentMouseMoveCapture}
        onClick={handleContentClick}
      >
        <textarea
          ref={contentMeasureRef}
          data-sticky-note-content-measure
          aria-hidden
          readOnly
          tabIndex={-1}
          value={noteContent}
          className="pointer-events-none absolute top-0 left-0 m-0 box-border block min-h-0 resize-none overflow-hidden border-0 bg-transparent p-3 leading-normal text-transparent focus:outline-none"
          style={{ width: '100%', height: 0, fontFamily: 'inherit', fontSize: `${fontSize}px` }}
        />

        {isEditing ? (
          <textarea
            ref={textareaRef}
            className="nodrag m-0 box-border block size-full min-h-0 resize-none overflow-auto border-0 bg-transparent p-3 leading-normal text-[#333] focus:outline-none"
            style={{ fontFamily: 'inherit', fontSize: `${fontSize}px` }}
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
            onBlur={handleBlur}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={handleTextareaDoubleClick}
          />
        ) : (
          <div
            className={twMerge(
              'size-full p-3 leading-normal wrap-break-word whitespace-pre-wrap',
              noteBodyColorClassName,
            )}
            style={{ fontSize: `${fontSize}px` }}
          >
            {node.content || 'Type anything'}
          </div>
        )}
      </div>
    </div>
  );
});
