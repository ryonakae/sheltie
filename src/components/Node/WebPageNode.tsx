import { memo, useCallback, useRef } from 'react';

import { NodeResizeHandle } from '@/components/Node/NodeResizeHandle';
import { WebPageNodeBottomBar } from '@/components/Node/WebPageNodeBottomBar';
import { WebPageNodeTopBar } from '@/components/Node/WebPageNodeTopBar';
import { WebPageNodeUrlForm } from '@/components/Node/WebPageNodeUrlForm';
import type { NodeResizeDirection } from '@/hooks/siteboard/types';
import { useWebPageWebviewLifecycle } from '@/hooks/siteboard/useWebPageWebviewLifecycle';
import { zoomPx } from '@/lib/canvas-zoom';
import { isNodeEmpty, isNodeMoved } from '@/types';
import type { DisplayMode, WebPageNode as WebPageNodeModel } from '@/types';

interface WebPageNodeProps {
  node: WebPageNodeModel;
  isActive: boolean;
  title: string;
  displayWidth: number;
  displayHeight: number;
  displayMode: DisplayMode;
  screenshotUrl: string | null;
  hideTopNavControls: boolean;
  hideBottomPresetControls: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  getZoom: () => number;
  onGoBack: (nodeId: string) => void;
  onGoForward: (nodeId: string) => void;
  onActivate: (nodeId: string) => void;
  onReload: (nodeId: string) => void;
  onPinUrl: (nodeId: string) => void;
  onContextMenu: (e: React.MouseEvent, nodeId: string) => void;
  onDragStart: (e: React.MouseEvent, nodeId: string) => void;
  onResizeStart: (e: React.MouseEvent, nodeId: string, direction: NodeResizeDirection) => void;
  onResizePreset: (nodeId: string, width: number, height: number) => void;
  onNavigated: (nodeId: string, url: string, title: string) => void;
  onTitleUpdated: (nodeId: string, title: string) => void;
  onWebviewCreated: (nodeId: string, label: string) => void;
  onWebviewDestroyed: (nodeId: string) => void;
  onWebviewLoaded: (nodeId: string) => void;
  onScreenshotPresented: (nodeId: string, url: string) => void;
  onScrollEnded: (nodeId: string) => void;
  onUrlSubmit: (nodeId: string, url: string) => void;
}

export const WebPageNode = memo(function WebPageNode({
  node,
  isActive,
  title,
  displayWidth,
  displayHeight,
  displayMode,
  screenshotUrl,
  hideTopNavControls,
  hideBottomPresetControls,
  canGoBack,
  canGoForward,
  getZoom,
  onGoBack,
  onGoForward,
  onActivate,
  onReload,
  onPinUrl,
  onContextMenu,
  onDragStart,
  onResizeStart,
  onResizePreset,
  onNavigated,
  onTitleUpdated,
  onWebviewCreated,
  onWebviewDestroyed,
  onWebviewLoaded,
  onScreenshotPresented,
  onScrollEnded,
  onUrlSubmit,
}: WebPageNodeProps) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const screenshotImgRef = useRef<HTMLImageElement>(null);

  useWebPageWebviewLifecycle({
    nodeId: node.id,
    url: node.url,
    placeholderRef,
    screenshotImgRef,
    screenshotUrl,
    getZoom,
    onNavigated,
    onTitleUpdated,
    onWebviewCreated,
    onWebviewDestroyed,
    onWebviewLoaded,
    onScreenshotPresented,
    onScrollEnded,
  });

  const handleActivate = useCallback(() => onActivate(node.id), [node.id, onActivate]);
  const handleGoBackBound = useCallback(() => onGoBack(node.id), [node.id, onGoBack]);
  const handleGoForwardBound = useCallback(() => onGoForward(node.id), [node.id, onGoForward]);
  const handleReloadBound = useCallback(() => onReload(node.id), [node.id, onReload]);
  const handlePinUrlBound = useCallback(() => onPinUrl(node.id), [node.id, onPinUrl]);
  const handleDragStartBound = useCallback(
    (e: React.MouseEvent) => onDragStart(e, node.id),
    [node.id, onDragStart],
  );
  const handleResizePresetBound = useCallback(
    (width: number, height: number) => onResizePreset(node.id, width, height),
    [node.id, onResizePreset],
  );
  const handleTitleBarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      handleDragStartBound(e);
    },
    [handleDragStartBound],
  );
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, direction: NodeResizeDirection) => {
      handleActivate();
      onResizeStart(e, node.id, direction);
    },
    [handleActivate, node.id, onResizeStart],
  );

  return (
    <div
      className="absolute flex flex-col shadow-lg outline-offset-0"
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        borderRadius: zoomPx(16),
        outline: isActive
          ? `${zoomPx(2)} solid var(--color-focus)`
          : `${zoomPx(1)} solid var(--color-border)`,
      }}
      data-node-id={node.id}
      data-display-mode={displayMode}
      onMouseDown={handleActivate}
      onContextMenu={(e) => onContextMenu(e, node.id)}
    >
      <WebPageNodeTopBar
        title={title}
        url={node.url}
        isMoved={isNodeMoved(node)}
        canGoBack={isNodeEmpty(node) ? false : canGoBack}
        canGoForward={isNodeEmpty(node) ? false : canGoForward}
        onGoBack={isNodeEmpty(node) ? undefined : handleGoBackBound}
        onGoForward={isNodeEmpty(node) ? undefined : handleGoForwardBound}
        onReload={isNodeEmpty(node) ? undefined : handleReloadBound}
        onPinUrl={isNodeMoved(node) ? handlePinUrlBound : undefined}
        hideNavigationControls={hideTopNavControls}
        onMouseDown={handleTitleBarMouseDown}
      />

      <div
        ref={placeholderRef}
        data-webview-placeholder
        className="relative rounded-none bg-background"
        style={{
          width: node.width,
          height: node.height,
        }}
      >
        {isNodeEmpty(node) ? (
          <WebPageNodeUrlForm onSubmit={(url) => onUrlSubmit(node.id, url)} />
        ) : (
          screenshotUrl && (
            <img
              ref={screenshotImgRef}
              src={screenshotUrl}
              alt=""
              className="pointer-events-none absolute inset-0 size-full object-cover object-top-left"
              data-screenshot-img
              draggable={false}
            />
          )
        )}
      </div>

      <WebPageNodeBottomBar
        width={displayWidth}
        height={displayHeight}
        hidePresetControls={hideBottomPresetControls}
        onResizePreset={handleResizePresetBound}
      />

      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as NodeResizeDirection[]).map((direction) => (
        <NodeResizeHandle key={direction} direction={direction} onMouseDown={handleResizeStart} />
      ))}
    </div>
  );
});
