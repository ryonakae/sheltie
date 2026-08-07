import { memo } from 'react';

import { StickyNoteNode } from '@/components/Node/StickyNoteNode';
import { TextNode } from '@/components/Node/TextNode';
import { WEB_PAGE_FRAME_PADDING } from '@/constants';
import { zoomPx } from '@/lib/canvas-zoom';
import { isStickyNoteNode, isTextNode } from '@/types';
import type { StickyNoteNode as StickyNoteNodeModel, TextNode as TextNodeModel } from '@/types';

import type { GhostFlowNodeData } from './types';
import type { NodeProps } from '@xyflow/react';

const noop = () => {};

/**
 * alt ドラッグ中に元位置へ残す静的なクローン表示。
 * Webview もツールバーも持たない描画専用ノードで、永続状態には現れない。
 * WebPage のフレームは WebPageNode の見た目を写しており、あちらの外観を変えたらここも合わせる。
 */
export const GhostFlowNode = memo(function GhostFlowNode({ id, data }: NodeProps) {
  const { node, screenshotUrl } = data as unknown as GhostFlowNodeData;
  // 本体コンポーネントは `data-node-id` を出すため、元ノードと同じ id を渡すと
  // DOM 上で同じ id が 2 つ存在する。ghost 側は flow node 側の id を使って衝突を避ける
  const ghostNode = { ...node, id, x: 0, y: 0 };

  if (isStickyNoteNode(node)) {
    return (
      <div className="pointer-events-none size-full">
        <StickyNoteNode
          node={ghostNode as StickyNoteNodeModel}
          isActive={false}
          onActivate={noop}
          onContextMenu={noop}
          onContentChange={noop}
          onAutoHeightChange={noop}
        />
      </div>
    );
  }

  if (isTextNode(node)) {
    return (
      <div className="pointer-events-none size-full">
        <TextNode
          node={ghostNode as TextNodeModel}
          isActive={false}
          isEditing={false}
          onActivate={noop}
          onContextMenu={noop}
          onStartEditing={noop}
          onStopEditing={noop}
          onAutoHeightChange={noop}
          onAutoWidthChange={noop}
        />
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none flex size-full flex-col bg-surface-secondary"
      style={{
        borderRadius: `${16}px`,
        padding: `${WEB_PAGE_FRAME_PADDING}px`,
        borderWidth: zoomPx(1),
        borderStyle: 'solid',
        borderColor: 'var(--color-border)',
        boxSizing: 'border-box',
      }}
    >
      <div
        className="relative size-full overflow-hidden bg-background"
        style={{ outline: `${zoomPx(1)} solid var(--color-border)`, outlineOffset: 0 }}
      >
        {screenshotUrl && (
          <img
            src={screenshotUrl}
            alt=""
            className="absolute inset-0 size-full object-fill"
            draggable={false}
          />
        )}
      </div>
    </div>
  );
});
