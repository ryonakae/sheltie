import { memo, useCallback, useEffect, useRef } from 'react';

import { NodeResizeHandle } from '@/components/Node/NodeResizeHandle';
import { WebPageNodeBottomBar } from '@/components/Node/WebPageNodeBottomBar';
import { WebPageNodeTopBar } from '@/components/Node/WebPageNodeTopBar';
import { WebPageNodeUrlForm } from '@/components/Node/WebPageNodeUrlForm';
import type { NodeResizeDirection } from '@/hooks/siteboard/types';
import { zoomPx } from '@/lib/canvas-zoom';
import { webviewApi } from '@/lib/tauri-bridge';
import { isNodeEmpty, isNodeMoved } from '@/types';
import type { DisplayMode, WebPageNode as WebPageNodeModel } from '@/types';

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
  const webviewLabelRef = useRef<string | null>(null);
  const isCreatingRef = useRef(false);
  const hasUrl = node.url !== '';
  const requestedUrlRef = useRef(node.url);
  const runtimeUrlRef = useRef('');
  const isFirstTitleRef = useRef(true);
  const ownerTokenRef = useRef<symbol | null>(null);

  useEffect(() => {
    requestedUrlRef.current = node.url;
  }, [node.url]);

  useEffect(() => {
    const placeholder = placeholderRef.current;
    const initialUrl = requestedUrlRef.current;
    if (!placeholder || !initialUrl) return;
    if (webviewLabelRef.current || isCreatingRef.current) return;

    isCreatingRef.current = true;
    let cancelled = false;
    const ownerToken = Symbol(node.id);
    ownerTokenRef.current = ownerToken;
    webviewOwnerTokens.set(node.id, ownerToken);

    void (async () => {
      try {
        const pendingDestroy = pendingWebviewDestroyPromises.get(node.id);
        if (pendingDestroy) {
          await pendingDestroy;
        }

        if (cancelled || !isCurrentWebviewOwner(node.id, ownerToken)) {
          isCreatingRef.current = false;
          return;
        }

        const rect = placeholder.getBoundingClientRect();
        console.log(`[WebPageNode] Webview 作成開始: node.id=${node.id}`);
        const label = await webviewApi.create(
          node.id,
          initialUrl,
          rect.left,
          rect.top,
          rect.width,
          rect.height,
          getZoom(),
        );

        const currentOwner = webviewOwnerTokens.get(node.id);
        if (cancelled || currentOwner !== ownerToken) {
          if (!currentOwner) {
            console.log(`[WebPageNode] orphaned create -> destroy(${label})`);
            void scheduleWebviewDestroy(node.id, label);
          }
          isCreatingRef.current = false;
          return;
        }

        webviewLabelRef.current = label;
        runtimeUrlRef.current = initialUrl;
        isCreatingRef.current = false;
        isFirstTitleRef.current = true;

        const currentRect = placeholder.getBoundingClientRect();
        void webviewApi.updateBounds(
          node.id,
          currentRect.left,
          currentRect.top,
          currentRect.width,
          currentRect.height,
          getZoom(),
        );
        onWebviewCreated(node.id, label);
        console.log(`[WebPageNode] Webview 作成完了: label=${label}`);
      } catch (err: unknown) {
        console.error('[WebPageNode] Webview 作成に失敗:', err);
        isCreatingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getZoom, hasUrl, node.id, onWebviewCreated]);

  useEffect(() => {
    return () => {
      onWebviewDestroyed(node.id);
      const ownerToken = ownerTokenRef.current;
      if (ownerToken && isCurrentWebviewOwner(node.id, ownerToken)) {
        webviewOwnerTokens.delete(node.id);
      }

      const label = webviewLabelRef.current;
      if (label) {
        console.log(`[WebPageNode] アンマウント -> destroy(${label})`);
        void scheduleWebviewDestroy(node.id, label);
      }
      webviewLabelRef.current = null;
      runtimeUrlRef.current = '';
      isCreatingRef.current = false;
      ownerTokenRef.current = null;
    };
  }, [node.id, onWebviewDestroyed]);

  useEffect(() => {
    const unlistenNav = webviewApi.onPageNavigated(node.id, ({ url }) => {
      runtimeUrlRef.current = url;
      onNavigated(node.id, url, '');
    });
    const unlistenTitle = webviewApi.onPageTitleChanged(node.id, ({ title: nextTitle }) => {
      onTitleUpdated(node.id, nextTitle);
      if (nextTitle && isFirstTitleRef.current) {
        isFirstTitleRef.current = false;
        onWebviewLoaded(node.id);
      }
    });
    const unlistenScroll = webviewApi.onPageScrollEnded(node.id, () => {
      onScrollEnded(node.id);
    });

    return () => {
      void unlistenNav.then((cleanup) => cleanup());
      void unlistenTitle.then((cleanup) => cleanup());
      void unlistenScroll.then((cleanup) => cleanup());
    };
  }, [node.id, onNavigated, onScrollEnded, onTitleUpdated, onWebviewLoaded]);

  useEffect(() => {
    if (!node.url || !webviewLabelRef.current) return;
    if (runtimeUrlRef.current === node.url) return;

    runtimeUrlRef.current = node.url;
    void webviewApi.reload(node.id, node.url);
  }, [node.id, node.url]);

  useEffect(() => {
    if (!screenshotUrl) return;

    const img = screenshotImgRef.current;
    if (!img) return;

    let cancelled = false;

    const notifyPresented = () => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        onScreenshotPresented(node.id, screenshotUrl);
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
  }, [node.id, onScreenshotPresented, screenshotUrl]);

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
