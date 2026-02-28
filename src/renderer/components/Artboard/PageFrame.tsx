import { useCallback, useEffect, useRef } from 'react';

import type { Page } from '@/renderer/types/tab';
import { webviewApi } from '@/renderer/lib/tauri-bridge';
import { PageResizeHandle } from '@/renderer/components/Artboard/PageResizeHandle';
import { PageTitleBar } from '@/renderer/components/Artboard/PageTitleBar';

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface PageFrameProps {
  page: Page;
  isActive: boolean;
  title: string;
  displayWidth: number;
  displayHeight: number;
  isInteracting: boolean;
  onActivate: () => void;
  onClose: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent, direction: ResizeDirection) => void;
  onResizePreset: (width: number, height: number) => void;
  onNavigated: (pageId: string, url: string, title: string) => void;
  onTitleUpdated: (pageId: string, title: string) => void;
  onWebviewCreated: (pageId: string, label: string) => void;
}

export function PageFrame({
  page,
  isActive,
  title,
  displayWidth,
  displayHeight,
  isInteracting,
  onActivate,
  onClose,
  onDragStart,
  onResizeStart,
  onResizePreset,
  onNavigated,
  onTitleUpdated,
  onWebviewCreated,
}: PageFrameProps) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  // Zustand の stale ラベルは参照しない（プロジェクト切替後の孤児 Webview 防止）
  const webviewLabelRef = useRef<string | null>(null);
  // IPC 実行中フラグ: StrictMode の二重マウントによる二重 create IPC を防ぐ
  const isCreatingRef = useRef(false);
  // マウント時の URL をキャプチャ（ナビゲーション後に page.url が更新されても Webview を再作成しない）
  const initialUrlRef = useRef(page.url);

  // マウント時: Rust コマンドでネイティブ Webview を作成
  useEffect(() => {
    const placeholder = placeholderRef.current;
    if (!placeholder) return;

    // 既に label が割り当て済み、または作成中なら再作成しない（HMR / StrictMode 対策）
    if (webviewLabelRef.current || isCreatingRef.current) return;

    isCreatingRef.current = true;
    // アンマウントとの競合を防ぐキャンセルフラグ
    let cancelled = false;

    const rect = placeholder.getBoundingClientRect();
    console.log(`[PageFrame] Webview 作成開始: page.id=${page.id}`);
    webviewApi
      .create(page.id, initialUrlRef.current, rect.left, rect.top, rect.width, rect.height)
      .then((label) => {
        if (cancelled) {
          // StrictMode Cleanup 済み（cancelled=true）→ 孤児化防止のため即破棄してフラグ解除
          console.log(`[PageFrame] cancelled=true → destroy(${label})`);
          void webviewApi.destroy(label);
          isCreatingRef.current = false;
          return;
        }
        webviewLabelRef.current = label;
        isCreatingRef.current = false;
        onWebviewCreated(page.id, label);
        console.log(`[PageFrame] Webview 作成完了: label=${label}`);

        // show effect は webviewLabelRef の変化を検知しないため、create 完了直後に明示表示
        const currentRect = placeholder.getBoundingClientRect();
        void webviewApi.updateBounds(
          label,
          currentRect.left,
          currentRect.top,
          currentRect.width,
          currentRect.height,
        );
        void webviewApi.show(label);
      })
      .catch((err: unknown) => {
        console.error('[PageFrame] Webview 作成に失敗:', err);
        isCreatingRef.current = false;
      });

    return () => {
      cancelled = true;
      // アンマウント時に Webview を破棄
      if (webviewLabelRef.current) {
        console.log(`[PageFrame] アンマウント → destroy(${webviewLabelRef.current})`);
        void webviewApi.destroy(webviewLabelRef.current);
        webviewLabelRef.current = null;
      }
    };
    // page.id が変わった場合のみ再実行（page.url はナビゲーションで更新されるが Webview の再作成は不要）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  // Rust → JS イベント: ナビゲーション・タイトル変更をリッスン
  useEffect(() => {
    const unlistenNav = webviewApi.onPageNavigated(page.id, ({ url }) => {
      onNavigated(page.id, url, '');
    });
    const unlistenTitle = webviewApi.onPageTitleChanged(page.id, ({ title: t }) => {
      onTitleUpdated(page.id, t);
    });

    return () => {
      void unlistenNav.then((f) => f());
      void unlistenTitle.then((f) => f());
    };
  }, [page.id, onNavigated, onTitleUpdated]);

  // 操作完了時: プレースホルダー座標をネイティブ Webview に同期して再表示
  useEffect(() => {
    if (isInteracting || !webviewLabelRef.current || !placeholderRef.current) return;

    const rect = placeholderRef.current.getBoundingClientRect();
    void webviewApi.updateBounds(
      webviewLabelRef.current,
      rect.left,
      rect.top,
      rect.width,
      rect.height,
    );
    void webviewApi.show(webviewLabelRef.current);
  }, [isInteracting, page.x, page.y, page.width, page.height]);

  const handleTitleBarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // onActivate は外側 div の onMouseDown バブリングで呼ばれるため重複して呼ばない
      onDragStart(e);
    },
    [onDragStart],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, direction: ResizeDirection) => {
      onActivate();
      onResizeStart(e, direction);
    },
    [onActivate, onResizeStart],
  );

  return (
    <div
      className="absolute flex flex-col shadow-lg"
      style={{
        left: page.x,
        top: page.y,
        width: page.width,
        borderRadius: 'calc(8px / var(--canvas-zoom, 1))',
        outline: isActive
          ? 'calc(2px / var(--canvas-zoom, 1)) solid var(--color-focus)'
          : 'calc(1px / var(--canvas-zoom, 1)) solid var(--color-border)',
        outlineOffset: 'calc(-1px / var(--canvas-zoom, 1))',
      }}
      data-page-id={page.id}
      onMouseDown={onActivate}
    >
      <PageTitleBar
        title={title}
        url={page.url}
        width={displayWidth}
        height={displayHeight}
        onClose={onClose}
        onMouseDown={handleTitleBarMouseDown}
        onResizePreset={onResizePreset}
      />

      {/* webview プレースホルダー: ネイティブ Webview の位置合わせ基準
          操作中（ドラッグ/ズーム/パン）はネイティブ Webview を hide() しているため
          このプレースホルダーが表示される */}
      <div
        ref={placeholderRef}
        data-webview-placeholder
        className="bg-background"
        style={{
          width: page.width,
          height: page.height,
          borderRadius: '0 0 calc(8px / var(--canvas-zoom, 1)) calc(8px / var(--canvas-zoom, 1))',
        }}
      />

      {/* リサイズハンドル（8方向） */}
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDirection[]).map((dir) => (
        <PageResizeHandle key={dir} direction={dir} onMouseDown={handleResizeStart} />
      ))}
    </div>
  );
}

export type { ResizeDirection };
