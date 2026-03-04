import { animate, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  STICKY_NOTE_MIN_HEIGHT,
  STICKY_NOTE_MIN_WIDTH,
  ZOOM_ANIMATION_EASE,
  ZOOM_RESET_DURATION_SEC,
  ZOOM_RESET_TARGET,
} from '@/constants';
import { usePageDrag } from '@/hooks/usePageDrag';
import { usePageResize } from '@/hooks/usePageResize';
import { useSiteboardPan } from '@/hooks/useSiteboardPan';
import { useSiteboardZoom } from '@/hooks/useSiteboardZoom';
import type { Viewport } from '@/types';

import type { InteractionType } from './types';

interface UseSiteboardViewportEngineParams {
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  zoomRef: React.RefObject<number>;
  panXRef: React.RefObject<number>;
  panYRef: React.RefObject<number>;
  activeId: string;
  viewport?: Viewport;
  onInteractionChange: (active: boolean, cursor: string, type: InteractionType) => void;
  onPageResizeStart?: (pageId: string) => void;
  onPageResizeEnd?: (pageId: string) => void;
  scheduleInteractionUpdate: () => void;
  computeInteractionModes: () => void;
  computeDisplayModes: () => void;
  cancelZoomRestore: () => void;
  scheduleZoomRestoreAfterReflow: () => void;
  updateViewport: (projectId: string, viewport: Partial<Viewport>) => void;
  updatePagePosition: (projectId: string, pageId: string, x: number, y: number) => void;
  updatePageSize: (projectId: string, pageId: string, width: number, height: number) => void;
}

export function useSiteboardViewportEngine({
  containerRef,
  canvasRef,
  zoomRef,
  panXRef,
  panYRef,
  activeId,
  viewport,
  onInteractionChange,
  onPageResizeStart,
  onPageResizeEnd,
  scheduleInteractionUpdate,
  computeInteractionModes,
  computeDisplayModes,
  cancelZoomRestore,
  scheduleZoomRestoreAfterReflow,
  updateViewport,
  updatePagePosition,
  updatePageSize,
}: UseSiteboardViewportEngineParams) {
  const zoomResetAnimationRef = useRef<{ stop: () => void } | null>(null);

  const [uiZoom, setUiZoom] = useState(() => viewport?.zoom ?? 1);
  const [resizingSize, setResizingSize] = useState<{
    pageId: string;
    width: number;
    height: number;
  } | null>(null);

  const prefersReducedMotion = useReducedMotion();

  const applyBackgroundGrid = useCallback(() => {
    if (!containerRef.current) return;
    containerRef.current.style.setProperty('--siteboard-dot-scale', String(zoomRef.current));
    containerRef.current.style.setProperty('--siteboard-bg-x', `${panXRef.current}px`);
    containerRef.current.style.setProperty('--siteboard-bg-y', `${panYRef.current}px`);
  }, [containerRef, panXRef, panYRef, zoomRef]);

  const applyCanvasTransform = useCallback(() => {
    if (!canvasRef.current) return;
    canvasRef.current.style.transform = `translate(${panXRef.current}px, ${panYRef.current}px) scale(${zoomRef.current})`;
    canvasRef.current.style.setProperty('--canvas-zoom', String(zoomRef.current));
    applyBackgroundGrid();
  }, [applyBackgroundGrid, canvasRef, panXRef, panYRef, zoomRef]);

  const handleZoomMove = useCallback(() => {
    scheduleInteractionUpdate();
    setUiZoom(zoomRef.current);
  }, [scheduleInteractionUpdate, zoomRef]);

  const handleResetZoom = useCallback(() => {
    if (!containerRef.current) return;
    if (Math.abs(zoomRef.current - ZOOM_RESET_TARGET) < 0.0001) return;

    const nextContainerRect = containerRef.current.getBoundingClientRect();
    if (nextContainerRect.width <= 0 || nextContainerRect.height <= 0) return;

    const startZoom = zoomRef.current;
    const startPanX = panXRef.current;
    const startPanY = panYRef.current;
    // ビューポート中央を focal point としてパン補正する
    const cx = nextContainerRect.width / 2;
    const cy = nextContainerRect.height / 2;

    if (prefersReducedMotion) {
      zoomResetAnimationRef.current?.stop();
      zoomResetAnimationRef.current = null;
      cancelZoomRestore();
      const scaleRatio = ZOOM_RESET_TARGET / startZoom;
      zoomRef.current = ZOOM_RESET_TARGET;
      panXRef.current = cx - (cx - startPanX) * scaleRatio;
      panYRef.current = cy - (cy - startPanY) * scaleRatio;
      setUiZoom(ZOOM_RESET_TARGET);
      applyCanvasTransform();
      updateViewport(activeId, {
        zoom: ZOOM_RESET_TARGET,
        panX: panXRef.current,
        panY: panYRef.current,
      });
      scheduleZoomRestoreAfterReflow();
      return;
    }

    zoomResetAnimationRef.current?.stop();

    const controls = animate(startZoom, ZOOM_RESET_TARGET, {
      duration: ZOOM_RESET_DURATION_SEC,
      ease: ZOOM_ANIMATION_EASE,
      onUpdate: (nextZoom) => {
        const scaleRatio = nextZoom / startZoom;
        zoomRef.current = nextZoom;
        panXRef.current = cx - (cx - startPanX) * scaleRatio;
        panYRef.current = cy - (cy - startPanY) * scaleRatio;
        applyCanvasTransform();
        computeInteractionModes();
        setUiZoom(nextZoom);
      },
      onComplete: () => {
        zoomResetAnimationRef.current = null;
        const scaleRatio = ZOOM_RESET_TARGET / startZoom;
        zoomRef.current = ZOOM_RESET_TARGET;
        panXRef.current = cx - (cx - startPanX) * scaleRatio;
        panYRef.current = cy - (cy - startPanY) * scaleRatio;
        setUiZoom(ZOOM_RESET_TARGET);
        applyCanvasTransform();
        updateViewport(activeId, {
          zoom: ZOOM_RESET_TARGET,
          panX: panXRef.current,
          panY: panYRef.current,
        });
        scheduleZoomRestoreAfterReflow();
      },
    });

    zoomResetAnimationRef.current = controls;
  }, [
    activeId,
    applyCanvasTransform,
    cancelZoomRestore,
    containerRef,
    computeInteractionModes,
    panXRef,
    panYRef,
    prefersReducedMotion,
    scheduleZoomRestoreAfterReflow,
    updateViewport,
    zoomRef,
  ]);

  const { isPanMode } = useSiteboardPan({
    canvasRef,
    backgroundRef: containerRef,
    zoom: zoomRef,
    panX: panXRef,
    panY: panYRef,
    onPanEnd: useCallback(
      (px, py) => updateViewport(activeId, { panX: px, panY: py }),
      [activeId, updateViewport],
    ),
    onInteractionChange: useCallback(
      (active: boolean) => onInteractionChange(active, 'grabbing', 'pan'),
      [onInteractionChange],
    ),
    onPanMove: scheduleInteractionUpdate,
  });

  useSiteboardZoom({
    containerRef,
    canvasRef,
    backgroundRef: containerRef,
    zoom: zoomRef,
    panX: panXRef,
    panY: panYRef,
    onZoomEnd: useCallback(
      (z, px, py) => updateViewport(activeId, { zoom: z, panX: px, panY: py }),
      [activeId, updateViewport],
    ),
    onInteractionChange: useCallback(
      (active: boolean) => onInteractionChange(active, 'default', 'zoom'),
      [onInteractionChange],
    ),
    onBoundsUpdate: handleZoomMove,
  });

  const { startDrag } = usePageDrag({
    zoom: zoomRef,
    onDragEnd: useCallback(
      (pageId, x, y) => {
        updatePagePosition(activeId, pageId, x, y);
      },
      [activeId, updatePagePosition],
    ),
    onInteractionChange: useCallback(
      (active) => onInteractionChange(active, 'grabbing', 'drag'),
      [onInteractionChange],
    ),
  });

  const { startResize } = usePageResize({
    zoom: zoomRef,
    onResizeStart: useCallback(
      (pageId: string) => {
        onPageResizeStart?.(pageId);
      },
      [onPageResizeStart],
    ),
    onResizeMove: useCallback((pageId: string, width: number, height: number) => {
      setResizingSize({ pageId, width, height });
    }, []),
    onResizeEnd: useCallback(
      (pageId, width, height) => {
        updatePageSize(activeId, pageId, width, height);
        setResizingSize(null);
        onPageResizeEnd?.(pageId);
      },
      [activeId, onPageResizeEnd, updatePageSize],
    ),
    onInteractionChange: useCallback(
      (active) => onInteractionChange(active, 'default', 'resize'),
      [onInteractionChange],
    ),
  });

  const resolveStickyNoteMinHeight = useCallback(
    ({ frameEl, width }: { frameEl: HTMLElement; width: number }) => {
      const measureEl = frameEl.querySelector(
        '[data-sticky-note-content-measure]',
      ) as HTMLElement | null;
      if (!measureEl) return STICKY_NOTE_MIN_HEIGHT;

      const prevWidth = measureEl.style.width;
      measureEl.style.width = `${Math.max(width, STICKY_NOTE_MIN_WIDTH)}px`;
      const contentHeight = Math.ceil(measureEl.getBoundingClientRect().height);
      measureEl.style.width = prevWidth;

      return Math.max(STICKY_NOTE_MIN_HEIGHT, contentHeight);
    },
    [],
  );

  const { startResize: startStickyNoteResize } = usePageResize({
    zoom: zoomRef,
    onResizeStart: useCallback(
      (pageId: string) => {
        onPageResizeStart?.(pageId);
      },
      [onPageResizeStart],
    ),
    onResizeEnd: useCallback(
      (pageId, width, height) => {
        updatePageSize(activeId, pageId, width, height);
        onPageResizeEnd?.(pageId);
      },
      [activeId, onPageResizeEnd, updatePageSize],
    ),
    onInteractionChange: useCallback(
      (active) => onInteractionChange(active, 'default', 'resize'),
      [onInteractionChange],
    ),
    minWidth: STICKY_NOTE_MIN_WIDTH,
    minHeight: STICKY_NOTE_MIN_HEIGHT,
    resolveMinHeight: resolveStickyNoteMinHeight,
  });

  useEffect(() => {
    if (!canvasRef.current) return;
    applyCanvasTransform();
    requestAnimationFrame(() => computeDisplayModes());
  }, [applyCanvasTransform, canvasRef, computeDisplayModes]);

  useEffect(() => {
    const nextZoom = viewport?.zoom ?? 1;
    const nextPanX = viewport?.panX ?? 0;
    const nextPanY = viewport?.panY ?? 0;
    const zoomChanged = zoomRef.current !== nextZoom;

    const shouldUpdate =
      zoomChanged || panXRef.current !== nextPanX || panYRef.current !== nextPanY;
    if (!shouldUpdate) return;

    zoomRef.current = nextZoom;
    panXRef.current = nextPanX;
    panYRef.current = nextPanY;

    if (!canvasRef.current) return;
    applyCanvasTransform();
    if (zoomChanged) {
      scheduleZoomRestoreAfterReflow();
    } else {
      requestAnimationFrame(() => computeDisplayModes());
    }
    requestAnimationFrame(() => setUiZoom(nextZoom));
  }, [
    applyCanvasTransform,
    canvasRef,
    computeDisplayModes,
    panXRef,
    panYRef,
    scheduleZoomRestoreAfterReflow,
    viewport,
    zoomRef,
  ]);

  useEffect(() => {
    return () => {
      zoomResetAnimationRef.current?.stop();
      zoomResetAnimationRef.current = null;
      cancelZoomRestore();
    };
  }, [cancelZoomRestore]);

  return {
    handleResetZoom,
    isPanMode,
    resizingSize,
    startDrag,
    startResize,
    startStickyNoteResize,
    uiZoom,
  };
}
