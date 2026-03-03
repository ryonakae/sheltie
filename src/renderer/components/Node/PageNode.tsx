import { memo, useCallback, useEffect, useRef, useState } from 'react';

import {
  NodeResizeHandle,
  type NodeResizeDirection,
} from '@/renderer/components/Node/NodeResizeHandle';
import { PageNodeBottomBar } from '@/renderer/components/Node/PageNodeBottomBar';
import { PageNodeTopBar } from '@/renderer/components/Node/PageNodeTopBar';
import { PageNodeUrlForm } from '@/renderer/components/Node/PageNodeUrlForm';
import { webviewApi } from '@/renderer/lib/tauri-bridge';
import type { DisplayMode, Page } from '@/renderer/types/tab';
import { isPageEmpty, isPageMoved } from '@/renderer/types/tab';

interface PageNodeProps {
  page: Page;
  isActive: boolean;
  title: string;
  displayWidth: number;
  displayHeight: number;
  /** ネイティブ Webview の表示モード（Siteboard が intersection 判定で制御） */
  displayMode: DisplayMode;
  /** スクリーンショット ObjectURL（screenshot モード時に表示） */
  screenshotUrl: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: (pageId: string) => void;
  onGoForward: (pageId: string) => void;
  onActivate: (pageId: string) => void;
  onReload: (pageId: string) => void;
  onPinUrl: (pageId: string) => void;
  onClose: (pageId: string) => void;
  onDragStart: (e: React.MouseEvent, pageId: string) => void;
  onResizeStart: (e: React.MouseEvent, pageId: string, direction: NodeResizeDirection) => void;
  onResizePreset: (pageId: string, width: number, height: number) => void;
  onNavigated: (pageId: string, url: string, title: string) => void;
  onTitleUpdated: (pageId: string, title: string) => void;
  onWebviewCreated: (pageId: string, label: string) => void;
  /** Webview のロード完了通知（スクリーンショットキャプチャのトリガー） */
  onWebviewLoaded: (pageId: string) => void;
  /** 空フレームに URL が入力・submit された時のコールバック */
  onUrlSubmit: (pageId: string, url: string) => void;
}

export const PageNode = memo(function PageNode({
  page,
  isActive,
  title,
  displayWidth,
  displayHeight,
  displayMode,
  screenshotUrl,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onActivate,
  onReload,
  onPinUrl,
  onClose,
  onDragStart,
  onResizeStart,
  onResizePreset,
  onNavigated,
  onTitleUpdated,
  onWebviewCreated,
  onWebviewLoaded,
  onUrlSubmit,
}: PageNodeProps) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  // Zustand の stale ラベルは参照しない（プロジェクト切替後の孤児 Webview 防止）
  const webviewLabelRef = useRef<string | null>(null);
  // IPC 実行中フラグ: StrictMode の二重マウントによる二重 create IPC を防ぐ
  const isCreatingRef = useRef(false);
  // StrictMode 対応: cancelled パスでインクリメントして effect を再トリガー
  const [createAttempt, setCreateAttempt] = useState(0);
  // Webview 作成時の URL をキャプチャ（ナビゲーション後に page.url が更新されても Webview を再作成しない）
  const initialUrlRef = useRef<string>('');
  // タイトル変更イベントが初回かどうかを追跡（ロード完了の指標として使用）
  const isFirstTitleRef = useRef(true);

  // マウント時: Rust コマンドでネイティブ Webview を作成（URL が空の場合はスキップ）
  useEffect(() => {
    const placeholder = placeholderRef.current;
    if (!placeholder) return;

    // URL 未設定の空フレームは Webview を作成しない
    if (!page.url) return;

    // 既に label が割り当て済み、または作成中なら再作成しない（HMR / StrictMode 対策）
    if (webviewLabelRef.current || isCreatingRef.current) return;

    // Webview 作成直前にキャプチャ（ナビゲーションで page.url が変わっても再作成しない）
    initialUrlRef.current = page.url;
    isCreatingRef.current = true;
    // アンマウントとの競合を防ぐキャンセルフラグ
    let cancelled = false;

    const rect = placeholder.getBoundingClientRect();
    console.log(`[PageNode] Webview 作成開始: page.id=${page.id}`);
    webviewApi
      .create(page.id, initialUrlRef.current, rect.left, rect.top, rect.width, rect.height)
      .then((label) => {
        if (cancelled) {
          // StrictMode Cleanup 済み（cancelled=true）→ 孤児化防止のため即破棄してフラグ解除
          console.log(`[PageNode] cancelled=true → destroy(${label})`);
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
        console.log(`[PageNode] Webview 作成完了: label=${label}`);
      })
      .catch((err: unknown) => {
        console.error('[PageNode] Webview 作成に失敗:', err);
        isCreatingRef.current = false;
      });

    return () => {
      cancelled = true;
      // アンマウント時に Webview を破棄
      if (webviewLabelRef.current) {
        console.log(`[PageNode] アンマウント → destroy(${webviewLabelRef.current})`);
        void webviewApi.destroy(webviewLabelRef.current);
        webviewLabelRef.current = null;
      }
    };
    // page.url: 空フレームに URL が設定された時に Webview を作成する（空→有効URLの遷移で再実行）
    //   ナビゲーション後の URL 変更は initialUrlRef でキャプチャ済みのため Webview 再作成は不要
    // createAttempt: StrictMode の cancelled パスで再試行トリガー
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, page.url, createAttempt]);

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
   * 操作中のリアルタイム切り替えは Siteboard 側の DOM 直接操作で行うため、
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

  // page.id は UUID で不変のため、親の関数参照が安定していればこれらも安定する
  const handleActivate = useCallback(() => onActivate(page.id), [onActivate, page.id]);
  const handleGoBackBound = useCallback(() => onGoBack(page.id), [onGoBack, page.id]);
  const handleGoForwardBound = useCallback(() => onGoForward(page.id), [onGoForward, page.id]);
  const handleReloadBound = useCallback(() => onReload(page.id), [onReload, page.id]);
  const handlePinUrlBound = useCallback(() => onPinUrl(page.id), [onPinUrl, page.id]);
  const handleCloseBound = useCallback(() => onClose(page.id), [onClose, page.id]);
  const handleDragStartBound = useCallback(
    (e: React.MouseEvent) => onDragStart(e, page.id),
    [onDragStart, page.id],
  );
  const handleResizePresetBound = useCallback(
    (w: number, h: number) => onResizePreset(page.id, w, h),
    [onResizePreset, page.id],
  );

  const handleTitleBarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // onActivate は外側 div の onMouseDown バブリングで呼ばれるため重複して呼ばない
      handleDragStartBound(e);
    },
    [handleDragStartBound],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, direction: NodeResizeDirection) => {
      handleActivate();
      onResizeStart(e, page.id, direction);
    },
    [handleActivate, onResizeStart, page.id],
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
        outlineOffset: 0,
      }}
      data-page-id={page.id}
      onMouseDown={handleActivate}
    >
      <PageNodeTopBar
        title={title}
        url={page.url}
        isMoved={isPageMoved(page)}
        canGoBack={isPageEmpty(page) ? false : canGoBack}
        canGoForward={isPageEmpty(page) ? false : canGoForward}
        onGoBack={isPageEmpty(page) ? undefined : handleGoBackBound}
        onGoForward={isPageEmpty(page) ? undefined : handleGoForwardBound}
        onReload={isPageEmpty(page) ? undefined : handleReloadBound}
        onPinUrl={isPageMoved(page) ? handlePinUrlBound : undefined}
        onClose={handleCloseBound}
        onMouseDown={handleTitleBarMouseDown}
      />

      {/* webview プレースホルダー: ネイティブ Webview の位置合わせ基準。
          URL 未設定の場合は URL 入力フォームを表示。
          displayMode=screenshot の時はスクリーンショット画像を表示。
          displayMode=native の時はネイティブ Webview が前面に重なるため透明で問題ない。 */}
      <div
        ref={placeholderRef}
        data-webview-placeholder
        className="relative bg-background"
        style={{
          width: page.width,
          height: page.height,
          borderRadius: 0,
        }}
      >
        {isPageEmpty(page) ? (
          <PageNodeUrlForm onSubmit={(url) => onUrlSubmit(page.id, url)} />
        ) : (
          /* スクリーンショット画像: data-display-mode="screenshot" の時のみ表示（CSS で制御） */
          screenshotUrl && (
            <img
              src={screenshotUrl}
              alt=""
              className="pointer-events-none absolute inset-0 hidden size-full object-cover object-top-left"
              data-screenshot-img
              draggable={false}
            />
          )
        )}
      </div>

      <PageNodeBottomBar
        width={displayWidth}
        height={displayHeight}
        onResizePreset={handleResizePresetBound}
      />

      {/* リサイズハンドル（8方向） */}
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as NodeResizeDirection[]).map((dir) => (
        <NodeResizeHandle key={dir} direction={dir} onMouseDown={handleResizeStart} />
      ))}
    </div>
  );
});

export type { NodeResizeDirection };
