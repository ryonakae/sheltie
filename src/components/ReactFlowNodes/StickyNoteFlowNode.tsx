import {
  NodeResizeControl,
  NodeToolbar,
  Position,
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
import { STICKY_NOTE_COLORS, STICKY_NOTE_MIN_HEIGHT, STICKY_NOTE_MIN_WIDTH } from '@/constants';

import type { StickyNoteFlowNodeData } from './types';

/**
 * React Flow 用の StickyNoteNode ラッパー。
 * - NodeToolbar: Figma フレーム名ライクな外側ラベル（常時表示）+ 色変更ボタン（選択時のみ）
 *   - NodeToolbar はビューポート transform の外側（ポータル）にレンダリングされるため、
 *     コンテンツは最初から画面固定サイズ。scale 補正は不要。
 * - NodeResizeControl: 四隅のハンドルだけを表示し、左右の幅リサイズとして扱う
 *   - 高さは入力内容の自動調整に委譲し、選択枠の線は軽量オーバーレイで描く
 * - nopan: パン操作がノード内で起動しないよう制御
 * - dragHandle 不使用: NodeToolbar はポータル外レンダリングのため、ノード全体をドラッグ可能とする
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
  const nextColor = STICKY_NOTE_COLORS[(safeColorIndex + 1) % STICKY_NOTE_COLORS.length];

  const colorButtonClassName = twMerge(
    'flex shrink-0 cursor-pointer items-center justify-center border',
    nextColor.borderClass,
    nextColor.bgClass,
    nextColor.textClass,
    'hover:opacity-80',
  );
  const resizeHandleConfigs = [
    { key: 'top-left', position: 'left' as const, style: { top: 0 } },
    { key: 'bottom-left', position: 'left' as const, style: { top: '100%' } },
    { key: 'top-right', position: 'right' as const, style: { top: 0 } },
    { key: 'bottom-right', position: 'right' as const, style: { top: '100%' } },
  ];

  return (
    <div className="nopan relative size-full">
      {/* Figma フレーム名ライクな外側ラベル。
          NodeToolbar はビューポート transform 外（ポータル）でレンダリングされるため
          コンテンツは画面固定サイズ。offset も画面 px 単位。 */}
      <NodeToolbar isVisible position={Position.Top} offset={4} align="start">
        <div
          className="flex min-w-0 items-center gap-1.5 overflow-hidden"
          style={{ width: toolbarWidth, maxWidth: toolbarWidth }}
        >
          <span
            className="min-w-0 flex-1 truncate text-[11px] font-medium text-[#555] select-none"
            title="Sticky Note"
          >
            Sticky Note
          </span>
          <AppButton
            size="xs"
            className={twMerge('shrink-0', colorButtonClassName)}
            style={{
              width: 18,
              minWidth: 18,
              height: 18,
              minHeight: 18,
              visibility: selected ? 'visible' : 'hidden',
              pointerEvents: selected ? 'auto' : 'none',
            }}
            aria-hidden={!selected}
            onMouseDown={(e) => e.stopPropagation()}
            onPress={() => onColorCycle(id)}
            aria-label="色を切り替え"
          >
            <span />
          </AppButton>
        </div>
      </NodeToolbar>

      <StickyNoteNode {...nodeProps} node={{ ...nodeProps.node, x: 0, y: 0 }} />
      {selected && <SelectionFrameOverlay />}
      {/* 四隅のハンドルは FigJam 風の見た目に寄せつつ、実際の操作は左右幅リサイズだけに制限する */}
      {selected && (
        <>
          {resizeHandleConfigs.map(({ key, position, style }) => (
            <NodeResizeControl
              key={key}
              nodeId={id}
              position={position}
              resizeDirection="horizontal"
              autoScale={false}
              minWidth={STICKY_NOTE_MIN_WIDTH}
              style={{ ...selectionHandleBaseStyle, ...style, cursor: 'ew-resize' }}
              onResize={handleResize}
              onResizeEnd={handleResizeEnd}
            />
          ))}
        </>
      )}
    </div>
  );
});
