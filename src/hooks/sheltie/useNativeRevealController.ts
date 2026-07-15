import { useCallback, useEffect, useRef } from 'react';

import { WEBVIEW_REVEAL_DELAY_MS } from '@/constants';
import { getPlatformInfo, webviewApi } from '@/lib/tauri-bridge';
import type { DisplayMode } from '@/types';

import { getWebPageElements, setDisplayModeAttribute } from './display-engine/dom';

interface UseNativeRevealControllerParams {
  containerRef: React.RefObject<HTMLDivElement | null>;
  getWebviewLabel: (nodeId: string) => string | undefined;
  setDisplayModes: React.Dispatch<React.SetStateAction<Record<string, DisplayMode>>>;
}

// macOS で screenshot→native へ復帰するときの白フラッシュ回避（opacity を 0→1 へフェード）を一手に引き受ける。
export function useNativeRevealController({
  containerRef,
  getWebviewLabel,
  setDisplayModes,
}: UseNativeRevealControllerParams) {
  const isMacOsRef = useRef(false);
  const pendingNativeRevealRef = useRef<Set<string>>(new Set());
  const nativeRevealTimersRef = useRef<Record<string, number>>({});
  const nativeRevealTokenRef = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    void getPlatformInfo()
      .then(({ platform }) => {
        if (cancelled) return;
        isMacOsRef.current = platform === 'macos';
      })
      .catch(() => {
        // no-op
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const cancelNativeReveal = useCallback(
    (nodeId: string) => {
      const label = getWebviewLabel(nodeId);
      const timerId = nativeRevealTimersRef.current[nodeId];
      const wasPending = pendingNativeRevealRef.current.delete(nodeId);
      const hadToken = nodeId in nativeRevealTokenRef.current;

      if (timerId !== undefined) {
        clearTimeout(timerId);
        delete nativeRevealTimersRef.current[nodeId];
      }
      if (hadToken) {
        delete nativeRevealTokenRef.current[nodeId];
      }

      if (isMacOsRef.current && label && (wasPending || hadToken || timerId !== undefined)) {
        void webviewApi.setOpacity(label, 1);
      }
    },
    [getWebviewLabel],
  );

  const cancelAllNativeReveals = useCallback(() => {
    const nodeIds = new Set([
      ...Object.keys(nativeRevealTimersRef.current),
      ...Object.keys(nativeRevealTokenRef.current),
      ...pendingNativeRevealRef.current,
    ]);

    for (const timerId of Object.values(nativeRevealTimersRef.current)) {
      clearTimeout(timerId);
    }
    nativeRevealTimersRef.current = {};
    nativeRevealTokenRef.current = {};
    pendingNativeRevealRef.current.clear();

    if (!isMacOsRef.current) return;
    for (const nodeId of nodeIds) {
      const label = getWebviewLabel(nodeId);
      if (!label) continue;
      void webviewApi.setOpacity(label, 1);
    }
  }, [getWebviewLabel]);

  // 通常の hide。macOS では setOpacity(1) も併せて呼び、opacity 0 のまま hide されるのを防ぐ。
  const hideNodeWebview = useCallback((label: string) => {
    if (isMacOsRef.current) {
      void webviewApi.setOpacity(label, 1);
    }
    void webviewApi.hide(label);
  }, []);

  const isNativeRevealPending = useCallback((nodeId: string) => {
    return pendingNativeRevealRef.current.has(nodeId);
  }, []);

  const hasPendingReveals = useCallback(() => {
    return pendingNativeRevealRef.current.size > 0;
  }, []);

  // macOS: screenshot→native への切り替え時に webview を opacity 0 で show し、
  // WEBVIEW_REVEAL_DELAY_MS 後に opacity 1 にして次フレームで data-display-mode を native に確定する。
  // 同一トークンでない場合（途中で cancel された等）は確定処理をスキップする。
  const beginNativeRevealFade = useCallback(
    (nodeId: string, label: string) => {
      if (pendingNativeRevealRef.current.has(nodeId)) {
        void webviewApi.show(label);
        return;
      }

      pendingNativeRevealRef.current.add(nodeId);

      const token = (nativeRevealTokenRef.current[nodeId] ?? 0) + 1;
      nativeRevealTokenRef.current[nodeId] = token;

      void webviewApi.setOpacity(label, 0);
      void webviewApi.show(label);

      nativeRevealTimersRef.current[nodeId] = window.setTimeout(() => {
        if (nativeRevealTokenRef.current[nodeId] !== token) return;
        delete nativeRevealTimersRef.current[nodeId];

        void webviewApi.setOpacity(label, 1);

        requestAnimationFrame(() => {
          if (nativeRevealTokenRef.current[nodeId] !== token) return;
          pendingNativeRevealRef.current.delete(nodeId);
          delete nativeRevealTokenRef.current[nodeId];

          const latestWrapper = getWebPageElements(containerRef.current, nodeId).wrapper;
          if (!latestWrapper) return;

          setDisplayModeAttribute(latestWrapper, 'native');
          setDisplayModes((prev) => {
            if (prev[nodeId] === 'native') return prev;
            return { ...prev, [nodeId]: 'native' };
          });
        });
      }, WEBVIEW_REVEAL_DELAY_MS);
    },
    [containerRef, setDisplayModes],
  );

  return {
    isMacOsRef,
    cancelNativeReveal,
    cancelAllNativeReveals,
    hideNodeWebview,
    isNativeRevealPending,
    hasPendingReveals,
    beginNativeRevealFade,
  };
}
