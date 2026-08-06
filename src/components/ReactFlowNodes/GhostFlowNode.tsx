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
export const GhostFlowNode = memo(function GhostFlowNode({ data }: NodeProps) {
  const { node, screenshotUrl } = data as unknown as GhostFlowNodeData;

  if (isStickyNoteNode(node)) {
    return (
      <div className="pointer-events-none size-full">
        <StickyNoteNode
          node={{ ...(node as StickyNoteNodeModel), x: 0, y: 0 }}
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
          node={{ ...(node as TextNodeModel), x: 0, y: 0 }}
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
