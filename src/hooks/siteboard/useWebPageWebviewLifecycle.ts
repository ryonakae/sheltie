import { useEffect, useRef, type RefObject } from 'react';

import { webviewApi } from '@/lib/tauri-bridge';

const webviewOwnerTokens = new Map<string, symbol>();
const pendingWebviewDestroyPromises = new Map<string, Promise<void>>();

function isCurrentWebviewOwner(nodeId: string, token: symbol): boolean {
  return webviewOwnerTokens.get(nodeId) === token;
}

function scheduleWebviewDestroy(nodeId: string, label: string): Promise<void> {
  const destroyPromise = webviewApi.destroy(label).finally(() => {
    if (pendingWebviewDestroyPromises.get(nodeId) === destroyPromise) {
      pendingWebviewDestroyPromises.delete(nodeId);
    }
  });
  pendingWebviewDestroyPromises.set(nodeId, destroyPromise);
  return destroyPromise;
}

function roundDebugValue(value: number): number {
  return Number(value.toFixed(2));
}

function serializeRect(rect: DOMRect | null) {
  if (!rect) return null;
  return {
    left: roundDebugValue(rect.left),
    top: roundDebugValue(rect.top),
    width: roundDebugValue(rect.width),
    height: roundDebugValue(rect.height),
    right: roundDebugValue(rect.right),
    bottom: roundDebugValue(rect.bottom),
  };
}

function readCanvasZoomDebugValue(element: HTMLElement | null): string | null {
  if (!element) return null;
  const container = element.closest('[data-siteboard-container]') as HTMLElement | null;
  if (!container) return null;
  const computedValue = window.getComputedStyle(container).getPropertyValue('--canvas-zoom').trim();
  return computedValue || container.style.getPropertyValue('--canvas-zoom') || null;
}

function logWebviewLifecycleDebug(message: string, details: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  console.info(`[webview-layout][lifecycle] ${message}`, details);
}

interface UseWebPageWebviewLifecycleParams {
  nodeId: string;
  url: string;
  placeholderRef: RefObject<HTMLDivElement | null>;
  screenshotImgRef: RefObject<HTMLImageElement | null>;
  screenshotUrl: string | null;
  getZoom: () => number;
  onNavigated: (nodeId: string, url: string, title: string) => void;
  onTitleUpdated: (nodeId: string, title: string) => void;
  onWebviewCreated: (nodeId: string, label: string) => void;
  onWebviewDestroyed: (nodeId: string) => void;
  onWebviewLoaded: (nodeId: string) => void;
  onScreenshotPresented: (nodeId: string, url: string) => void;
  onScrollEnded: (nodeId: string) => void;
}

export function useWebPageWebviewLifecycle({
  nodeId,
  url,
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
}: UseWebPageWebviewLifecycleParams): void {
  const webviewLabelRef = useRef<string | null>(null);
  const isCreatingRef = useRef(false);
  const requestedUrlRef = useRef(url);
  const runtimeUrlRef = useRef('');
  const isFirstTitleRef = useRef(true);
  const ownerTokenRef = useRef<symbol | null>(null);

  useEffect(() => {
    requestedUrlRef.current = url;
  }, [nodeId, url]);

  useEffect(() => {
    const placeholder = placeholderRef.current;
    const initialUrl = requestedUrlRef.current;
    if (!placeholder || !initialUrl) return;
    if (webviewLabelRef.current || isCreatingRef.current) return;

    isCreatingRef.current = true;
    let cancelled = false;
    const ownerToken = Symbol(nodeId);
    ownerTokenRef.current = ownerToken;
    webviewOwnerTokens.set(nodeId, ownerToken);

    void (async () => {
      try {
        const pendingDestroy = pendingWebviewDestroyPromises.get(nodeId);
        if (pendingDestroy) {
          await pendingDestroy;
        }

        if (cancelled || !isCurrentWebviewOwner(nodeId, ownerToken)) {
          isCreatingRef.current = false;
          return;
        }

        const rect = placeholder.getBoundingClientRect();
        logWebviewLifecycleDebug('create:start', {
          nodeId,
          url: initialUrl,
          zoom: roundDebugValue(getZoom()),
          canvasZoom: readCanvasZoomDebugValue(placeholder),
          placeholderRect: serializeRect(rect),
          wrapperRect: serializeRect(
            (
              placeholder.closest('[data-node-id]') as HTMLElement | null
            )?.getBoundingClientRect() ?? null,
          ),
        });
        const label = await webviewApi.create(
          nodeId,
          initialUrl,
          rect.left,
          rect.top,
          rect.width,
          rect.height,
          getZoom(),
        );

        const currentOwner = webviewOwnerTokens.get(nodeId);
        if (cancelled || currentOwner !== ownerToken) {
          if (!currentOwner) {
            void scheduleWebviewDestroy(nodeId, label);
          }
          isCreatingRef.current = false;
          return;
        }

        webviewLabelRef.current = label;
        runtimeUrlRef.current = initialUrl;
        isCreatingRef.current = false;
        isFirstTitleRef.current = true;
        logWebviewLifecycleDebug('create:success', {
          nodeId,
          label,
          url: initialUrl,
        });

        const currentRect = placeholder.getBoundingClientRect();
        logWebviewLifecycleDebug('create:initial-updateBounds', {
          nodeId,
          label,
          zoom: roundDebugValue(getZoom()),
          canvasZoom: readCanvasZoomDebugValue(placeholder),
          placeholderRect: serializeRect(currentRect),
          wrapperRect: serializeRect(
            (
              placeholder.closest('[data-node-id]') as HTMLElement | null
            )?.getBoundingClientRect() ?? null,
          ),
        });
        void webviewApi.updateBounds(
          label,
          currentRect.left,
          currentRect.top,
          currentRect.width,
          currentRect.height,
          getZoom(),
        );
        onWebviewCreated(nodeId, label);
      } catch (error: unknown) {
        console.error('[WebPageNode] failed to create Webview:', error);
        isCreatingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getZoom, nodeId, onWebviewCreated, placeholderRef]);

  useEffect(() => {
    return () => {
      onWebviewDestroyed(nodeId);
      const ownerToken = ownerTokenRef.current;
      if (ownerToken && isCurrentWebviewOwner(nodeId, ownerToken)) {
        webviewOwnerTokens.delete(nodeId);
      }

      const label = webviewLabelRef.current;
      if (label) {
        logWebviewLifecycleDebug('destroy:schedule', {
          nodeId,
          label,
        });
        void scheduleWebviewDestroy(nodeId, label);
      }
      webviewLabelRef.current = null;
      runtimeUrlRef.current = '';
      isCreatingRef.current = false;
      ownerTokenRef.current = null;
    };
  }, [nodeId, onWebviewDestroyed]);

  useEffect(() => {
    const unlistenNav = webviewApi.onPageNavigated(nodeId, ({ url: nextUrl }) => {
      runtimeUrlRef.current = nextUrl;
      onNavigated(nodeId, nextUrl, '');
    });
    const unlistenTitle = webviewApi.onPageTitleChanged(nodeId, ({ title }) => {
      onTitleUpdated(nodeId, title);
      if (title && isFirstTitleRef.current) {
        isFirstTitleRef.current = false;
        onWebviewLoaded(nodeId);
      }
    });
    const unlistenScroll = webviewApi.onPageScrollEnded(nodeId, () => {
      onScrollEnded(nodeId);
    });

    return () => {
      void unlistenNav.then((cleanup) => cleanup());
      void unlistenTitle.then((cleanup) => cleanup());
      void unlistenScroll.then((cleanup) => cleanup());
    };
  }, [nodeId, onNavigated, onScrollEnded, onTitleUpdated, onWebviewLoaded]);

  useEffect(() => {
    const label = webviewLabelRef.current;
    if (!url || !label) return;
    if (runtimeUrlRef.current === url) return;

    runtimeUrlRef.current = url;
    logWebviewLifecycleDebug('reload', {
      nodeId,
      label,
      url,
    });
    void webviewApi.reload(label, url);
  }, [nodeId, url]);

  useEffect(() => {
    if (!screenshotUrl) return;

    const img = screenshotImgRef.current;
    if (!img) return;

    let cancelled = false;

    const notifyPresented = () => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        onScreenshotPresented(nodeId, screenshotUrl);
      });
    };

    const handleLoad = () => {
      if (img.getAttribute('src') !== screenshotUrl) return;
      notifyPresented();
    };

    if (img.complete && img.naturalWidth > 0 && img.getAttribute('src') === screenshotUrl) {
      notifyPresented();
    } else {
      img.addEventListener('load', handleLoad);
    }

    return () => {
      cancelled = true;
      img.removeEventListener('load', handleLoad);
    };
  }, [nodeId, onScreenshotPresented, screenshotImgRef, screenshotUrl]);
}
