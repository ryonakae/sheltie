import {
  Handle,
  NodeResizeControl,
  Position,
  ResizeControlVariant,
  type NodeProps,
  useUpdateNodeInternals,
} from '@xyflow/react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { twMerge } from 'tailwind-merge';

import { AppButton } from '@/components/Common/AppButton';
import type { SiteboardStickyNoteFlowNode } from '@/components/Siteboard/flow-types';
import {
  useSiteboardNodeHandlers,
  useSiteboardRuntimeStore,
} from '@/components/Siteboard/siteboard-runtime-store';
import { STICKY_NOTE_COLORS, STICKY_NOTE_HEADER_HEIGHT, STICKY_NOTE_MIN_HEIGHT } from '@/constants';
import { zoomPx } from '@/lib/canvas-zoom';

const HANDLE_STYLE: React.CSSProperties = {
  width: zoomPx(16),
  height: zoomPx(16),
  borderRadius: '9999px',
  background: 'var(--color-accent)',
  border: `${zoomPx(2)} solid var(--color-background)`,
  marginLeft: zoomPx(-8),
  marginRight: zoomPx(-8),
};

const RESIZE_CONTROL_STYLE: React.CSSProperties = {
  background: 'transparent',
  borderColor: 'transparent',
};

// NodeResizeControl の style を事前マージして安定した参照を持たせる（memo 有効化）
const RESIZE_CONTROL_TOP_BOTTOM_STYLE: React.CSSProperties = {
  ...RESIZE_CONTROL_STYLE,
  width: '100%',
  height: zoomPx(16),
  cursor: 'ns-resize',
};
const RESIZE_CONTROL_LEFT_RIGHT_STYLE: React.CSSProperties = {
  ...RESIZE_CONTROL_STYLE,
  width: zoomPx(16),
  height: '100%',
  cursor: 'ew-resize',
};
const RESIZE_CONTROL_CORNER_NWSE_STYLE: React.CSSProperties = {
  ...RESIZE_CONTROL_STYLE,
  width: zoomPx(16),
  height: zoomPx(16),
  cursor: 'nwse-resize',
};
const RESIZE_CONTROL_CORNER_NESW_STYLE: React.CSSProperties = {
  ...RESIZE_CONTROL_STYLE,
  width: zoomPx(16),
  height: zoomPx(16),
  cursor: 'nesw-resize',
};

const CORNER_RESIZE_CONTROLS = [
  { position: 'top-left' as const, style: RESIZE_CONTROL_CORNER_NWSE_STYLE },
  { position: 'top-right' as const, style: RESIZE_CONTROL_CORNER_NESW_STYLE },
  { position: 'bottom-left' as const, style: RESIZE_CONTROL_CORNER_NESW_STYLE },
  { position: 'bottom-right' as const, style: RESIZE_CONTROL_CORNER_NWSE_STYLE },
];

const DRAG_HANDLE_CLASS = 'siteboard-node-drag-handle';
const INTERACTION_BLOCKER_CLASS = 'nodrag nopan';

export const StickyNoteNode = memo(function StickyNoteNode({
  id,
  data,
  selected,
}: NodeProps<SiteboardStickyNoteFlowNode>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const handlers = useSiteboardNodeHandlers();
  const compactControlsHidden = useSiteboardRuntimeStore((state) => state.compactControlsHidden);
  const [isEditing, setIsEditing] = useState(false);
  const [editingContent, setEditingContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentMeasureRef = useRef<HTMLDivElement>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedContentRef = useRef(data.node.content ?? '');

  const colorIndex = data.node.colorIndex ?? 0;
  const color = STICKY_NOTE_COLORS[colorIndex];
  const nextColor = STICKY_NOTE_COLORS[(colorIndex + 1) % STICKY_NOTE_COLORS.length];
  const noteContent = isEditing ? editingContent : (data.node.content ?? '');

  useEffect(() => {
    updateNodeInternals(id);
  }, [data.node.height, data.node.width, id, updateNodeInternals]);

  useEffect(() => {
    if (!isEditing) return;
    const measureEl = contentMeasureRef.current;
    if (!measureEl) return;
    const contentHeight = Math.ceil(measureEl.getBoundingClientRect().height);
    const nextHeight = Math.max(STICKY_NOTE_MIN_HEIGHT, contentHeight);
    if (nextHeight <= data.node.height) return;
    handlers.onAutoHeightChange(id, nextHeight);
  }, [data.node.height, editingContent, handlers, id, isEditing]);

  useEffect(() => {
    if (!isEditing) {
      lastCommittedContentRef.current = data.node.content ?? '';
    }
  }, [data.node.content, isEditing]);

  const commitContent = useCallback(
    (content: string) => {
      if (lastCommittedContentRef.current === content) return;
      lastCommittedContentRef.current = content;
      handlers.onContentChange(id, content);
    },
    [handlers, id],
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
    const nextContent = data.node.content ?? '';
    setEditingContent(nextContent);
    lastCommittedContentRef.current = nextContent;
    setIsEditing(true);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
  }, [data.node.content]);

  const handleBlur = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    commitContent(editingContent);
    setIsEditing(false);
  }, [commitContent, editingContent]);

  const noteClassName = twMerge(
    'flex flex-col shadow-lg',
    'border-solid outline-offset-0',
    color.bgClass,
    selected ? '' : 'border',
    color.borderClass,
  );
  const noteHeaderClassName = twMerge(
    DRAG_HANDLE_CLASS,
    'flex shrink-0 cursor-grab items-center active:cursor-grabbing',
    color.borderClass,
  );
  const noteColorButtonClassName = twMerge(
    INTERACTION_BLOCKER_CLASS,
    'flex shrink-0 cursor-pointer items-center justify-center',
    'border',
    nextColor.borderClass,
    nextColor.bgClass,
    nextColor.textClass,
    'hover:opacity-80',
  );
  const noteBodyColorClassName = data.node.content ? 'text-[#333]' : 'text-[#aaa]';

  return (
    <>
      <Handle
        id="target-left"
        type="target"
        position={Position.Left}
        style={HANDLE_STYLE}
        className="z-30!"
      />
      <Handle
        id="source-right"
        type="source"
        position={Position.Right}
        style={HANDLE_STYLE}
        className="z-30!"
      />

      <div
        className={noteClassName}
        style={{
          width: data.node.width,
          borderRadius: zoomPx(16),
          outline: selected ? `${zoomPx(2)} solid var(--color-focus)` : 'none',
          borderWidth: zoomPx(1),
        }}
        data-node-id={id}
      >
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

          {!compactControlsHidden && (
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
              onPress={() => handlers.onColorCycle(id)}
              aria-label="色を切り替え"
            >
              <span />
            </AppButton>
          )}
        </div>

        <div
          data-webview-placeholder
          className="relative box-border min-h-0 overflow-hidden"
          style={{
            width: data.node.width,
            height: data.node.height,
          }}
          onDoubleClick={handleDoubleClick}
        >
          <div
            ref={contentMeasureRef}
            data-sticky-note-content-measure
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 box-border p-2 text-[18px] leading-normal wrap-break-word whitespace-pre-wrap opacity-0"
            style={{ width: data.node.width }}
          >
            {noteContent || ' '}
          </div>

          {isEditing ? (
            <textarea
              ref={textareaRef}
              className={`${INTERACTION_BLOCKER_CLASS} m-0 block size-full min-h-0 resize-none overflow-auto border-0 bg-transparent p-2 text-[18px] leading-normal text-[#333] focus:outline-none`}
              value={editingContent}
              onChange={(e) => setEditingContent(e.target.value)}
              onBlur={handleBlur}
              onMouseDown={(e) => e.stopPropagation()}
            />
          ) : (
            <div
              className={twMerge(
                'size-full cursor-text p-2 text-[18px] leading-normal wrap-break-word whitespace-pre-wrap',
                noteBodyColorClassName,
              )}
            >
              {data.node.content || 'ダブルクリックで編集'}
            </div>
          )}
        </div>

        <NodeResizeControl
          nodeId={id}
          position="top"
          variant={ResizeControlVariant.Line}
          resizeDirection="vertical"
          autoScale={false}
          className="z-20"
          style={RESIZE_CONTROL_TOP_BOTTOM_STYLE}
          onResizeStart={() => handlers.onResizeStart(id)}
          onResize={(_, params) => handlers.onResize(id, params.width, params.height)}
          onResizeEnd={(_, params) => handlers.onResizeEnd(id, params.width, params.height)}
        />
        <NodeResizeControl
          nodeId={id}
          position="bottom"
          variant={ResizeControlVariant.Line}
          resizeDirection="vertical"
          autoScale={false}
          className="z-20"
          style={RESIZE_CONTROL_TOP_BOTTOM_STYLE}
          onResizeStart={() => handlers.onResizeStart(id)}
          onResize={(_, params) => handlers.onResize(id, params.width, params.height)}
          onResizeEnd={(_, params) => handlers.onResizeEnd(id, params.width, params.height)}
        />
        <NodeResizeControl
          nodeId={id}
          position="left"
          variant={ResizeControlVariant.Line}
          resizeDirection="horizontal"
          autoScale={false}
          className="z-20"
          style={RESIZE_CONTROL_LEFT_RIGHT_STYLE}
          onResizeStart={() => handlers.onResizeStart(id)}
          onResize={(_, params) => handlers.onResize(id, params.width, params.height)}
          onResizeEnd={(_, params) => handlers.onResizeEnd(id, params.width, params.height)}
        />
        <NodeResizeControl
          nodeId={id}
          position="right"
          variant={ResizeControlVariant.Line}
          resizeDirection="horizontal"
          autoScale={false}
          className="z-20"
          style={RESIZE_CONTROL_LEFT_RIGHT_STYLE}
          onResizeStart={() => handlers.onResizeStart(id)}
          onResize={(_, params) => handlers.onResize(id, params.width, params.height)}
          onResizeEnd={(_, params) => handlers.onResizeEnd(id, params.width, params.height)}
        />
        {CORNER_RESIZE_CONTROLS.map(({ position, style }) => (
          <NodeResizeControl
            key={position}
            nodeId={id}
            position={position}
            variant={ResizeControlVariant.Handle}
            autoScale={false}
            className="z-20"
            style={style}
            onResizeStart={() => handlers.onResizeStart(id)}
            onResize={(_, params) => handlers.onResize(id, params.width, params.height)}
            onResizeEnd={(_, params) => handlers.onResizeEnd(id, params.width, params.height)}
          />
        ))}
      </div>
    </>
  );
});
