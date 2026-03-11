import {
  Handle,
  NodeResizeControl,
  Position,
  ResizeControlVariant,
  type NodeProps,
  useUpdateNodeInternals,
} from '@xyflow/react';
import { useReducedMotion } from 'motion/react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { WebPageNodeBottomBar } from '@/components/Node/WebPageNodeBottomBar';
import { WebPageNodeTopBar } from '@/components/Node/WebPageNodeTopBar';
import { WebPageNodeUrlForm } from '@/components/Node/WebPageNodeUrlForm';
import type { SiteboardWebPageFlowNode } from '@/components/Siteboard/flow-types';
import {
  EMPTY_POSITION_CORRECTION_ANIMATION,
  useSiteboardNodeHandlers,
  useSiteboardRuntimeStore,
} from '@/components/Siteboard/siteboard-runtime-store';
import { useWebPageWebviewLifecycle } from '@/hooks/siteboard/useWebPageWebviewLifecycle';
import { zoomPx } from '@/lib/canvas-zoom';
import { isNodeEmpty, isNodeMoved } from '@/types';

interface ResizeControlConfig {
  key: string;
  position:
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right';
  variant: ResizeControlVariant;
  resizeDirection?: 'horizontal' | 'vertical';
  cursor: string;
  style: React.CSSProperties;
}

const HANDLE_STYLE: React.CSSProperties = {
  background: 'transparent',
  borderColor: 'transparent',
};

// style を事前マージして安定した参照を持たせることで、NodeResizeControl の memo が有効に機能する。
// レンダリング時にスプレッドすると毎回新しいオブジェクトが生成され memo が無効化される。
const RESIZE_CONTROLS: ResizeControlConfig[] = [
  {
    key: 'top',
    position: 'top',
    variant: ResizeControlVariant.Line,
    resizeDirection: 'vertical',
    cursor: 'ns-resize',
    style: { ...HANDLE_STYLE, width: '100%', height: zoomPx(16), cursor: 'ns-resize' },
  },
  {
    key: 'bottom',
    position: 'bottom',
    variant: ResizeControlVariant.Line,
    resizeDirection: 'vertical',
    cursor: 'ns-resize',
    style: { ...HANDLE_STYLE, width: '100%', height: zoomPx(16), cursor: 'ns-resize' },
  },
  {
    key: 'left',
    position: 'left',
    variant: ResizeControlVariant.Line,
    resizeDirection: 'horizontal',
    cursor: 'ew-resize',
    style: { ...HANDLE_STYLE, width: zoomPx(16), height: '100%', cursor: 'ew-resize' },
  },
  {
    key: 'right',
    position: 'right',
    variant: ResizeControlVariant.Line,
    resizeDirection: 'horizontal',
    cursor: 'ew-resize',
    style: { ...HANDLE_STYLE, width: zoomPx(16), height: '100%', cursor: 'ew-resize' },
  },
  {
    key: 'top-left',
    position: 'top-left',
    variant: ResizeControlVariant.Handle,
    cursor: 'nwse-resize',
    style: { ...HANDLE_STYLE, width: zoomPx(16), height: zoomPx(16), cursor: 'nwse-resize' },
  },
  {
    key: 'top-right',
    position: 'top-right',
    variant: ResizeControlVariant.Handle,
    cursor: 'nesw-resize',
    style: { ...HANDLE_STYLE, width: zoomPx(16), height: zoomPx(16), cursor: 'nesw-resize' },
  },
  {
    key: 'bottom-left',
    position: 'bottom-left',
    variant: ResizeControlVariant.Handle,
    cursor: 'nesw-resize',
    style: { ...HANDLE_STYLE, width: zoomPx(16), height: zoomPx(16), cursor: 'nesw-resize' },
  },
  {
    key: 'bottom-right',
    position: 'bottom-right',
    variant: ResizeControlVariant.Handle,
    cursor: 'nwse-resize',
    style: { ...HANDLE_STYLE, width: zoomPx(16), height: zoomPx(16), cursor: 'nwse-resize' },
  },
];

const HANDLE_HIT_STYLE: React.CSSProperties = {
  width: zoomPx(16),
  height: zoomPx(16),
  borderRadius: '9999px',
  background: 'var(--color-accent)',
  border: `${zoomPx(2)} solid var(--color-background)`,
};

const DRAG_HANDLE_CLASS = 'siteboard-node-drag-handle';
const EMPTY_NAVIGATION_STATE = {
  can_go_back: false,
  can_go_forward: false,
};

function readCanvasZoom(element: Element | null): number {
  if (!(element instanceof HTMLElement)) return 1;

  const rawZoom = getComputedStyle(element).getPropertyValue('--canvas-zoom').trim();
  const parsedZoom = Number(rawZoom);
  return Number.isFinite(parsedZoom) && parsedZoom > 0 ? parsedZoom : 1;
}

export const WebPageNode = memo(function WebPageNode({
  id,
  data,
  selected,
}: NodeProps<SiteboardWebPageFlowNode>) {
  const prefersReducedMotion = useReducedMotion();
  const updateNodeInternals = useUpdateNodeInternals();
  const frameRef = useRef<HTMLDivElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const screenshotImgRef = useRef<HTMLImageElement>(null);
  const positionCorrectionAnimationRef = useRef<Animation | null>(null);

  const handlers = useSiteboardNodeHandlers();

  const getZoom = useCallback(
    () => readCanvasZoom(frameRef.current?.closest('[data-siteboard-container]') ?? null),
    [],
  );
  const compactControlsHidden = useSiteboardRuntimeStore((state) => state.compactControlsHidden);
  const displayMode = useSiteboardRuntimeStore(
    useCallback((state) => state.webNodes[id]?.displayMode ?? 'hidden', [id]),
  );
  const screenshotUrl = useSiteboardRuntimeStore(
    useCallback((state) => state.webNodes[id]?.screenshotUrl ?? null, [id]),
  );
  const navState = useSiteboardRuntimeStore(
    useCallback((state) => state.webNodes[id]?.navState ?? EMPTY_NAVIGATION_STATE, [id]),
  );
  const positionCorrectionAnimation = useSiteboardRuntimeStore(
    useCallback(
      (state) =>
        state.webNodes[id]?.positionCorrectionAnimation ?? EMPTY_POSITION_CORRECTION_ANIMATION,
      [id],
    ),
  );
  const onPositionCorrectionAnimationComplete = handlers.onPositionCorrectionAnimationComplete;

  useWebPageWebviewLifecycle({
    nodeId: id,
    url: data.node.url,
    placeholderRef,
    screenshotImgRef,
    screenshotUrl,
    getZoom,
    onNavigated: handlers.onNavigated,
    onTitleUpdated: handlers.onTitleUpdated,
    onWebviewCreated: handlers.onWebviewCreated,
    onWebviewDestroyed: handlers.onWebviewDestroyed,
    onWebviewLoaded: handlers.onWebviewLoaded,
    onScreenshotPresented: handlers.onScreenshotPresented,
    onScrollStarted: handlers.onScrollStarted,
    onScrollEnded: handlers.onScrollEnded,
  });

  useEffect(() => {
    updateNodeInternals(id);
  }, [data.node.height, data.node.width, id, updateNodeInternals]);

  useLayoutEffect(() => {
    const frameEl = frameRef.current;
    if (!frameEl) return;

    positionCorrectionAnimationRef.current?.cancel();
    positionCorrectionAnimationRef.current = null;
    frameEl.style.transform = 'none';

    if (positionCorrectionAnimation.token === null) return;
    if (
      positionCorrectionAnimation.fromX === null ||
      positionCorrectionAnimation.fromY === null ||
      positionCorrectionAnimation.toX === null ||
      positionCorrectionAnimation.toY === null
    ) {
      return;
    }

    const offsetX = positionCorrectionAnimation.fromX - positionCorrectionAnimation.toX;
    const offsetY = positionCorrectionAnimation.fromY - positionCorrectionAnimation.toY;
    const animationToken = positionCorrectionAnimation.token;
    let frameId: number | null = null;

    if (prefersReducedMotion) {
      frameId = window.requestAnimationFrame(() => {
        frameEl.style.transform = 'none';
        onPositionCorrectionAnimationComplete(id, animationToken);
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
      onPositionCorrectionAnimationComplete(id, animationToken);
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
    onPositionCorrectionAnimationComplete,
    id,
    positionCorrectionAnimation,
    prefersReducedMotion,
  ]);

  const handleGoBack = useCallback(() => handlers.onGoBack(id), [handlers, id]);
  const handleGoForward = useCallback(() => handlers.onGoForward(id), [handlers, id]);
  const handleReload = useCallback(() => handlers.onReload(id), [handlers, id]);
  const handlePinUrl = useCallback(() => handlers.onPinUrl(id), [handlers, id]);
  const handleResizePreset = useCallback(
    (width: number, height: number) => handlers.onResizePreset(id, width, height),
    [handlers, id],
  );
  const handleUrlSubmit = useCallback(
    (url: string) => handlers.onUrlSubmit(id, url),
    [handlers, id],
  );

  const handleStyle = useMemo(
    () => ({
      ...HANDLE_HIT_STYLE,
      width: zoomPx(14),
      height: zoomPx(14),
      marginLeft: zoomPx(-8),
      marginRight: zoomPx(-8),
    }),
    [],
  );

  return (
    <>
      <Handle
        id="target-left"
        type="target"
        position={Position.Left}
        style={handleStyle}
        className="z-30!"
      />
      <Handle
        id="source-right"
        type="source"
        position={Position.Right}
        style={handleStyle}
        className="z-30!"
      />

      <div
        ref={frameRef}
        className="relative flex flex-col shadow-lg outline-offset-0"
        style={{
          width: data.node.width,
          borderRadius: zoomPx(16),
          outline: selected
            ? `${zoomPx(2)} solid var(--color-focus)`
            : `${zoomPx(1)} solid var(--color-border)`,
        }}
        data-node-id={id}
        data-display-mode={displayMode}
      >
        <div className={DRAG_HANDLE_CLASS}>
          <WebPageNodeTopBar
            title={data.node.title}
            url={data.node.url}
            isMoved={isNodeMoved(data.node)}
            canGoBack={isNodeEmpty(data.node) ? false : navState.can_go_back}
            canGoForward={isNodeEmpty(data.node) ? false : navState.can_go_forward}
            onGoBack={isNodeEmpty(data.node) ? undefined : handleGoBack}
            onGoForward={isNodeEmpty(data.node) ? undefined : handleGoForward}
            onReload={isNodeEmpty(data.node) ? undefined : handleReload}
            onPinUrl={isNodeMoved(data.node) ? handlePinUrl : undefined}
            hideNavigationControls={compactControlsHidden}
            onMouseDown={() => undefined}
          />
        </div>

        <div
          ref={placeholderRef}
          data-webview-placeholder
          className="relative rounded-none bg-background"
          style={{
            width: data.node.width,
            height: data.node.height,
          }}
        >
          {isNodeEmpty(data.node) ? (
            <WebPageNodeUrlForm onSubmit={handleUrlSubmit} />
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
          width={data.node.width}
          height={data.node.height}
          hidePresetControls={compactControlsHidden}
          onResizePreset={handleResizePreset}
        />

        {RESIZE_CONTROLS.map((control) => (
          <NodeResizeControl
            key={control.key}
            nodeId={id}
            position={control.position}
            variant={control.variant}
            resizeDirection={control.resizeDirection}
            autoScale={false}
            className="z-20"
            style={control.style}
            onResizeStart={() => {
              handlers.onResizeStart(id);
            }}
            onResize={(_, params) => {
              handlers.onResize(id, params.width, params.height);
            }}
            onResizeEnd={(_, params) => {
              handlers.onResizeEnd(id, params.width, params.height);
            }}
          />
        ))}
      </div>
    </>
  );
});
