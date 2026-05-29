import { useReducedMotion } from 'motion/react';
import { memo, useCallback, useLayoutEffect, useRef } from 'react';

import { WebPageNodeUrlForm } from '@/components/Node/WebPageNodeUrlForm';
import { WEB_PAGE_FRAME_PADDING } from '@/constants';
import { useWebPageWebviewLifecycle } from '@/hooks/siteboard/useWebPageWebviewLifecycle';
import { zoomPx } from '@/lib/canvas-zoom';
import { isNodeEmpty } from '@/types';
import type { DisplayMode, WebPageNode as WebPageNodeModel } from '@/types';

export interface WebPageNodeProps {
  node: WebPageNodeModel;
  isActive: boolean;
  displayMode: DisplayMode;
  screenshotUrl: string | null;
  getZoom: () => number;
  onActivate: (nodeId: string, addToSelection: boolean) => void;
  onContextMenu: (e: React.MouseEvent, nodeId: string) => void;
  onNavigated: (nodeId: string, url: string, title: string) => void;
  onTitleUpdated: (nodeId: string, title: string) => void;
  onWebviewCreated: (nodeId: string, label: string) => void;
  onWebviewDestroyed: (nodeId: string) => void;
  onWebviewLoaded: (nodeId: string) => void;
  onScreenshotPresented: (nodeId: string, url: string) => void;
  onScrollEnded: (nodeId: string) => void;
  onUrlSubmit: (nodeId: string, url: string) => void;
  isEditingUrl: boolean;
  positionCorrectionAnimationToken: number | null;
  positionCorrectionFromX: number | null;
  positionCorrectionFromY: number | null;
  positionCorrectionToX: number | null;
  positionCorrectionToY: number | null;
  onPositionCorrectionAnimationComplete: (nodeId: string, token: number) => void;
}

export const WebPageNode = memo(function WebPageNode({
  node,
  displayMode,
  screenshotUrl,
  getZoom,
  onActivate,
  onContextMenu,
  onNavigated,
  onTitleUpdated,
  onWebviewCreated,
  onWebviewDestroyed,
  onWebviewLoaded,
  onScreenshotPresented,
  onScrollEnded,
  onUrlSubmit,
  isEditingUrl,
  positionCorrectionAnimationToken,
  positionCorrectionFromX,
  positionCorrectionFromY,
  positionCorrectionToX,
  positionCorrectionToY,
  onPositionCorrectionAnimationComplete,
}: WebPageNodeProps) {
  const prefersReducedMotion = useReducedMotion();
  const frameRef = useRef<HTMLDivElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const screenshotImgRef = useRef<HTMLImageElement>(null);
  const positionCorrectionAnimationRef = useRef<Animation | null>(null);

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

  const handleActivate = useCallback(
    (e: React.MouseEvent) => onActivate(node.id, e.shiftKey),
    [node.id, onActivate],
  );
  useLayoutEffect(() => {
    const frameEl = frameRef.current;
    if (!frameEl) return;

    positionCorrectionAnimationRef.current?.cancel();
    positionCorrectionAnimationRef.current = null;
    frameEl.style.transform = 'none';

    if (positionCorrectionAnimationToken === null) return;
    if (
      positionCorrectionFromX === null ||
      positionCorrectionFromY === null ||
      positionCorrectionToX === null ||
      positionCorrectionToY === null
    ) {
      return;
    }

    const offsetX = positionCorrectionFromX - positionCorrectionToX;
    const offsetY = positionCorrectionFromY - positionCorrectionToY;
    let frameId: number | null = null;

    if (prefersReducedMotion) {
      frameId = window.requestAnimationFrame(() => {
        frameEl.style.transform = 'none';
        onPositionCorrectionAnimationComplete(node.id, positionCorrectionAnimationToken);
      });
      return () => {
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
        }
        frameEl.style.transform = 'none';
      };
    }

    frameEl.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    const animation = frameEl.animate(
      [
        { transform: `translate(${offsetX}px, ${offsetY}px)` },
        { transform: 'translate(0px, 0px)' },
      ],
      {
        duration: 180,
        easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
        fill: 'forwards',
      },
    );
    positionCorrectionAnimationRef.current = animation;

    animation.onfinish = () => {
      if (positionCorrectionAnimationRef.current !== animation) return;
      positionCorrectionAnimationRef.current = null;
      frameEl.style.transform = 'none';
      onPositionCorrectionAnimationComplete(node.id, positionCorrectionAnimationToken);
    };
    animation.oncancel = () => {
      if (positionCorrectionAnimationRef.current !== animation) return;
      positionCorrectionAnimationRef.current = null;
      frameEl.style.transform = 'none';
    };

    return () => {
      animation.cancel();
      frameEl.style.transform = 'none';
    };
  }, [
    node.id,
    onPositionCorrectionAnimationComplete,
    positionCorrectionAnimationToken,
    positionCorrectionFromX,
    positionCorrectionFromY,
    positionCorrectionToX,
    positionCorrectionToY,
    prefersReducedMotion,
  ]);

  return (
    <div
      ref={frameRef}
      className="node-drag-handle relative flex size-full flex-col bg-surface-secondary"
      style={{
        // border-radius と padding は world 固定（拡大すると太く/大きく見える）
        borderRadius: `${16}px`,
        padding: `${WEB_PAGE_FRAME_PADDING}px`,
        borderWidth: zoomPx(1),
        borderStyle: 'solid',
        borderColor: 'var(--color-border)',
        boxSizing: 'border-box',
      }}
      data-node-id={node.id}
      data-display-mode={displayMode}
      onMouseDown={handleActivate}
      onContextMenu={(e) => onContextMenu(e, node.id)}
    >
      <div
        ref={placeholderRef}
        data-webview-placeholder
        className="relative size-full overflow-hidden bg-background"
        style={{
          outline: `${zoomPx(1)} solid var(--color-border)`,
          outlineOffset: 0,
        }}
      >
        {isNodeEmpty(node) || isEditingUrl ? (
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
    </div>
  );
});
