import {
  NodeResizer,
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
import { STICKY_NOTE_COLORS, STICKY_NOTE_MIN_HEIGHT, STICKY_NOTE_MIN_WIDTH } from '@/constants';

import type { StickyNoteFlowNodeData } from './types';

/**
 * React Flow 用の StickyNoteNode ラッパー。
 * - NodeToolbar: Figma フレーム名ライクな外側ラベル（常時表示）+ 色変更ボタン（選択時のみ）
 *   - NodeToolbar はビューポート transform の外側（ポータル）にレンダリングされるため、
 *     コンテンツは最初から画面固定サイズ。scale 補正は不要。
 * - NodeResizer: React Flow ネイティブのリサイズ UI（選択時のみ表示）
 * - nopan: パン操作がノード内で起動しないよう制御
 * - dragHandle 不使用: NodeToolbar はポータル外レンダリングのため、ノード全体をドラッグ可能とする
 */
export const StickyNoteFlowNode = memo(function StickyNoteFlowNode({
  id,
  data,
  selected,
}: NodeProps) {
  const { nodeProps, onResize, onResizeEnd, onColorCycle, colorIndex } =
    data as unknown as StickyNoteFlowNodeData;

  const handleResize = useCallback(
    (_event: ResizeDragEvent, params: ResizeParams) => {
      onResize(id, params);
    },
    [id, onResize],
  );

  const handleResizeEnd = useCallback(
    (_event: ResizeDragEvent, params: ResizeParams) => {
      const bodyHeight = Math.max(params.height, STICKY_NOTE_MIN_HEIGHT);
      onResizeEnd(id, params.width, bodyHeight);
    },
    [id, onResizeEnd],
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

  return (
    <div className="nopan size-full">
      {/* Figma フレーム名ライクな外側ラベル。
          NodeToolbar はビューポート transform 外（ポータル）でレンダリングされるため
          コンテンツは画面固定サイズ。offset も画面 px 単位。 */}
      <NodeToolbar isVisible position={Position.Top} offset={4} align="start">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-[#555] select-none">Sticky Note</span>
          {selected && (
            <AppButton
              size="xs"
              className={colorButtonClassName}
              style={{ width: 18, minWidth: 18, height: 18, minHeight: 18 }}
              onMouseDown={(e) => e.stopPropagation()}
              onPress={() => onColorCycle(id)}
              aria-label="色を切り替え"
            >
              <span />
            </AppButton>
          )}
        </div>
      </NodeToolbar>

      <StickyNoteNode {...nodeProps} node={{ ...nodeProps.node, x: 0, y: 0 }} />
      {/* NodeResizer は StickyNoteNode より後に配置し stacking order を上にすることで
          size-full のコンテンツに覆われずポインターイベントを受け取れるようにする */}
      <NodeResizer
        minWidth={STICKY_NOTE_MIN_WIDTH}
        minHeight={STICKY_NOTE_MIN_HEIGHT}
        isVisible={selected}
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
      />
    </div>
  );
});
