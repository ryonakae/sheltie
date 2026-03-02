import { useCallback, useEffect, useRef, useState } from 'react';

import type { Page } from '@/renderer/types/tab';
import type { DisplayMode } from '@/renderer/types/tab';
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
  /** ネイティブ Webview の表示モード（Artboard が intersection 判定で制御） */
  displayMode: DisplayMode;
  /** スクリーンショット ObjectURL（screenshot モード時に表示） */
  screenshotUrl: string | null;
  onActivate: () => void;
  onClose: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent, direction: ResizeDirection) => void;
  onResizePreset: (width: number, height: number) => void;
  onNavigated: (pageId: string, url: string, title: string) => void;
  onTitleUpdated: (pageId: string, title: string) => void;
  onWebviewCreated: (pageId: string, label: string) => void;
  /** Webview のロード完了通知（スクリーンショットキャプチャのトリガー） */
  onWebviewLoaded: (pageId: string) => void;
}

export function PageFrame({
  page,
  isActive,
  title,
  displayWidth,
  displayHeight,
  displayMode,
  screenshotUrl,
  onActivate,
  onClose,
  onDragStart,
  onResizeStart,
  onResizePreset,
  onNavigated,
  onTitleUpdated,
  onWebviewCreated,
  onWebviewLoaded,
}: PageFrameProps) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  // Zustand の stale ラベルは参照しない（プロジェクト切替後の孤児 Webview 防止）
  const webviewLabelRef = useRef<string | null>(null);
  // IPC 実行中フラグ: StrictMode の二重マウントによる二重 create IPC を防ぐ
  const isCreatingRef = useRef(false);
  // StrictMode 対応: cancelled パスでインクリメントして effect を再トリガー
  const [createAttempt, setCreateAttempt] = useState(0);
  // マウント時の URL をキャプチャ（ナビゲーション後に page.url が更新されても Webview を再作成しない）
  const initialUrlRef = useRef(page.url);
  // タイトル変更イベントが初回かどうかを追跡（ロード完了の指標として使用）
  const isFirstTitleRef = useRef(true);

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
          // createAttempt をインクリメントして次マウントで再試行
          setCreateAttempt((c) => c + 1);
          return;
        }
        webviewLabelRef.current = label;
        isCreatingRef.current = false;
        isFirstTitleRef.current = true;

        // ネイティブ表示を Zustand 更新より先に試みる（初期化完了タイミングを最大化）
        const currentRect = placeholder.getBoundingClientRect();
        void webviewApi.updateBounds(
          label,
          currentRect.left,
          currentRect.top,
          currentRect.width,
          currentRect.height,
        );
        void webviewApi.show(label);
        // Zustand 更新後にフォールバック effect が念押し表示
        onWebviewCreated(page.id, label);
        console.log(`[PageFrame] Webview 作成完了: label=${label}`);
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
    // createAttempt: StrictMode の cancelled パスで再試行トリガー
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, createAttempt]);

  // Rust → JS イベント: ナビゲーション・タイトル変更をリッスン
  useEffect(() => {
    const unlistenNav = webviewApi.onPageNavigated(page.id, ({ url }) => {
      onNavigated(page.id, url, '');
    });
    const unlistenTitle = webviewApi.onPageTitleChanged(page.id, ({ title: t }) => {
      onTitleUpdated(page.id, t);
      // タイトル変更イベントをロード完了の指標として使用（最初の非空タイトルでキャプチャ）
      if (t && isFirstTitleRef.current) {
        isFirstTitleRef.current = false;
        onWebviewLoaded(page.id);
      }
    });

    return () => {
      void unlistenNav.then((f) => f());
      void unlistenTitle.then((f) => f());
    };
  }, [page.id, onNavigated, onTitleUpdated, onWebviewLoaded]);

  /**
   * displayMode が変化した時: ネイティブ Webview の show/hide と bounds 同期。
   * 操作中のリアルタイム切り替えは Artboard 側の DOM 直接操作で行うため、
   * この effect は静的状態の変化と操作完了後の再描画に対応する。
   */
  useEffect(() => {
    const label = webviewLabelRef.current;
    if (!label || !placeholderRef.current) return;

    if (displayMode === 'native') {
      const rect = placeholderRef.current.getBoundingClientRect();
      void webviewApi.updateBounds(label, rect.left, rect.top, rect.width, rect.height);
      void webviewApi.show(label);
    } else {
      void webviewApi.hide(label);
    }
    // page.webviewLabel: setPageWebviewLabel 後に effect を再実行して初期表示を念押し
  }, [displayMode, page.x, page.y, page.width, page.height, page.webviewLabel]);

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

      {/* webview プレースホルダー: ネイティブ Webview の位置合わせ基準。
          displayMode=screenshot の時はスクリーンショット画像を表示。
          displayMode=native の時はネイティブ Webview が前面に重なるため透明で問題ない。 */}
      <div
        ref={placeholderRef}
        data-webview-placeholder
        className="relative bg-background"
        style={{
          width: page.width,
          height: page.height,
          borderRadius: '0 0 calc(8px / var(--canvas-zoom, 1)) calc(8px / var(--canvas-zoom, 1))',
        }}
      >
        {/* スクリーンショット画像: data-display-mode="screenshot" の時のみ表示（CSS で制御） */}
        {screenshotUrl && (
          <img
            src={screenshotUrl}
            alt=""
            className="pointer-events-none absolute inset-0 hidden size-full object-cover object-top-left"
            data-screenshot-img
            draggable={false}
          />
        )}
      </div>

      {/* リサイズハンドル（8方向） */}
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDirection[]).map((dir) => (
        <PageResizeHandle key={dir} direction={dir} onMouseDown={handleResizeStart} />
      ))}
    </div>
  );
}

export type { ResizeDirection };
