import {
  NodeResizeControl,
  NodeToolbar,
  Position,
  ResizeControlVariant,
  type NodeProps,
  type ResizeDragEvent,
  type ResizeParams,
} from '@xyflow/react';
import { memo, useCallback } from 'react';
import { twMerge } from 'tailwind-merge';

import { AppButton } from '@/components/Common/AppButton';
import { StickyNoteNode } from '@/components/Node/StickyNoteNode';
import { selectionHandleBaseStyle } from '@/components/ReactFlowNodes/selectionChromeStyles';
import { SelectionFrameOverlay } from '@/components/ReactFlowNodes/SelectionFrameOverlay';
import {
  STICKY_NOTE_COLORS,
  STICKY_NOTE_HEADER_HEIGHT,
  STICKY_NOTE_MIN_HEIGHT,
  STICKY_NOTE_MIN_WIDTH,
} from '@/constants';

import type { StickyNoteFlowNodeData } from './types';

/**
 * React Flow 用の StickyNoteNode ラッパー。
 * - NodeToolbar: sticky header gutter に重ねる chrome 風ラベル（常時表示）+ 色変更ボタン
 *   - NodeToolbar はビューポート transform の外側に描画されるため、幅だけ canvas zoom に追従させる
 * - NodeResizeControl: 左右辺 + 四隅のハンドルだけを表示し、左右の幅リサイズとして扱う
 *   - 高さは入力内容の自動調整に委譲し、選択枠の線は軽量オーバーレイで描く
 * - nopan: パン操作がノード内で起動しないよう制御
 * - dragHandle 不使用: 付箋はノード本体全体をドラッグ可能にする
 */
export const StickyNoteFlowNode = memo(function StickyNoteFlowNode({
  id,
  data,
  selected,
}: NodeProps) {
  const { nodeProps, displayWidth, onResize, onResizeEnd, onColorCycle, colorIndex } =
    data as unknown as StickyNoteFlowNodeData;
  const toolbarWidth = `calc(${displayWidth}px * var(--canvas-zoom, 1))`;

  const handleResize = useCallback(
    (_event: ResizeDragEvent, params: ResizeParams) => {
      onResize(id, {
        ...params,
        width: Math.max(params.width, STICKY_NOTE_MIN_WIDTH),
        height: Math.max(nodeProps.node.height, STICKY_NOTE_MIN_HEIGHT),
      });
    },
    [id, nodeProps.node.height, onResize],
  );

  const handleResizeEnd = useCallback(
    (_event: ResizeDragEvent, params: ResizeParams) => {
      const bodyHeight = Math.max(nodeProps.node.height, STICKY_NOTE_MIN_HEIGHT);
      onResizeEnd(id, Math.max(params.width, STICKY_NOTE_MIN_WIDTH), bodyHeight);
    },
    [id, nodeProps.node.height, onResizeEnd],
  );

  const safeColorIndex = colorIndex ?? 0;
  const currentColor = STICKY_NOTE_COLORS[safeColorIndex];
  const nextColor = STICKY_NOTE_COLORS[(safeColorIndex + 1) % STICKY_NOTE_COLORS.length];

  const colorButtonClassName =
    'pointer-events-auto shrink-0 overflow-hidden rounded-full text-muted';
  const colorDotClassName = twMerge(
    'size-full rounded-full border-2',
    nextColor.borderClass,
    nextColor.bgClass,
  );
  const colorButtonStyle = {
    width: 24,
    minWidth: 24,
    height: 24,
    minHeight: 24,
    padding: 0,
  } as const;
  const resizeLineConfigs = [
    { key: 'left', position: 'left' as const, className: 'siteboard-sticky-resize-line' },
    { key: 'right', position: 'right' as const, className: 'siteboard-sticky-resize-line' },
  ];
  const resizeHandleConfigs = [
    {
      key: 'top-left',
      position: 'top-left' as const,
      className: 'siteboard-sticky-resize-handle',
    },
    {
      key: 'bottom-left',
      position: 'bottom-left' as const,
      className: 'siteboard-sticky-resize-handle',
    },
    {
      key: 'top-right',
      position: 'top-right' as const,
      className: 'siteboard-sticky-resize-handle',
    },
    {
      key: 'bottom-right',
      position: 'bottom-right' as const,
      className: 'siteboard-sticky-resize-handle',
    },
  ];

  return (
    <div className="nopan relative size-full">
      <NodeToolbar
        isVisible
        position={Position.Top}
        offset={-STICKY_NOTE_HEADER_HEIGHT}
        align="start"
        className="pointer-events-none"
      >
        <div
          className="flex h-8 min-w-0 items-center gap-1 overflow-hidden rounded-t-[16px] bg-transparent px-2 text-xs/4"
          style={{
            width: toolbarWidth,
            maxWidth: toolbarWidth,
            boxShadow: `inset 0 -1px 0 ${currentColor.dividerColor}`,
          }}
        >
          <span className="min-w-0 flex-1 truncate px-1 text-foreground" title="Sticky Note">
            Sticky Note
          </span>
          <AppButton
            size="xs"
            className={colorButtonClassName}
            style={{
              ...colorButtonStyle,
              visibility: selected ? 'visible' : 'hidden',
              pointerEvents: selected ? 'auto' : 'none',
            }}
            aria-hidden={!selected}
            onMouseDown={(e) => e.stopPropagation()}
            onPress={() => onColorCycle(id)}
            aria-label="色を切り替え"
          >
            <span className={colorDotClassName} />
          </AppButton>
        </div>
      </NodeToolbar>

      <StickyNoteNode {...nodeProps} node={{ ...nodeProps.node, x: 0, y: 0 }} />
      {selected && <SelectionFrameOverlay />}
      {/* 左右辺と四隅は FigJam 風の見た目に寄せつつ、実際の操作は左右幅リサイズだけに制限する */}
      {selected && (
        <>
          {resizeLineConfigs.map(({ key, position, className }) => (
            <NodeResizeControl
              key={key}
              nodeId={id}
              position={position}
              variant={ResizeControlVariant.Line}
              resizeDirection="horizontal"
              autoScale={false}
              minWidth={STICKY_NOTE_MIN_WIDTH}
              style={{ opacity: 0 }}
              className={className}
              onResize={handleResize}
              onResizeEnd={handleResizeEnd}
            />
          ))}
          {resizeHandleConfigs.map(({ key, position, className }) => (
            <NodeResizeControl
              key={key}
              nodeId={id}
              position={position}
              resizeDirection="horizontal"
              autoScale={false}
              minWidth={STICKY_NOTE_MIN_WIDTH}
              style={selectionHandleBaseStyle}
              className={className}
              onResize={handleResize}
              onResizeEnd={handleResizeEnd}
            />
          ))}
        </>
      )}
    </div>
  );
});
