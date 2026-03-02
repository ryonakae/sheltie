import { type MouseEvent, forwardRef, useCallback, useEffect, useRef } from 'react';

import Xmark from '@gravity-ui/icons/Xmark';
import { animate, motion, useReducedMotion } from 'motion/react';

import { selectActiveProject, useProjectStore } from '@/renderer/store/tab-store';
import { AddPageForm } from '@/renderer/components/Canvas/AddPageForm';
import {
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  type Page,
  isPageMoved,
} from '@/renderer/types/tab';

interface SidebarProps {
  initialWidth: number;
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  /** サイドバー選択時にセンタリング完了したら呼ぶ */
  onCentered?: (pageId: string) => void;
}

const pageListItemVariants = {
  rest: {},
  hover: {},
} as const;

const removeButtonVariants = {
  rest: { opacity: 0 },
  hover: { opacity: 1 },
} as const;

const PAGE_CHROME_HEIGHT = 48; // PageTopBar + PageBottomBar の合計（world 座標ベース）

type CenterTarget = Pick<Page, 'id' | 'x' | 'y' | 'width' | 'height'>;

type FrameRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

/** ページ本体（タイトルバー含む）を基準にセンタリングするため、必要に応じて実 DOM 幾何を取得する */
function getPageFrameRect(artboard: HTMLElement, pageId: string | undefined): FrameRect | null {
  if (!pageId) return null;
  const frame = artboard.querySelector<HTMLElement>(`[data-page-id="${pageId}"]`);
  if (!frame) return null;

  const rect = frame.getBoundingClientRect();
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

/** 現在のビューポート中央のワールド座標を起点とした、ページの配置位置を算出する */
function getViewportCenterPos(
  viewportZoom: number,
  viewportPanX: number,
  viewportPanY: number,
): { x: number; y: number } | null {
  const artboard = document.querySelector<HTMLElement>('[data-artboard-container]');
  if (!artboard) return null;

  const rect = artboard.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || viewportZoom <= 0) return null;

  // ビューポート中央のワールド座標（ページ左上を起点とするため半サイズ分ずらす）
  const centerWorldX = (rect.width / 2 - viewportPanX) / viewportZoom;
  const centerWorldY = (rect.height / 2 - viewportPanY) / viewportZoom;
  return {
    x: centerWorldX - DEFAULT_PAGE_WIDTH / 2,
    y: centerWorldY - DEFAULT_PAGE_HEIGHT / 2,
  };
}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar(
  { initialWidth, selectedPageId, onSelectPage, onCentered },
  ref,
) {
  const activeProject = useProjectStore(selectActiveProject);
  const activeId = useProjectStore((s) => s.activeId);
  const addPage = useProjectStore((s) => s.addPage);
  const removePage = useProjectStore((s) => s.removePage);
  const updateViewport = useProjectStore((s) => s.updateViewport);
  const viewport = activeProject?.viewport;
  const centeringAnimationRef = useRef<Array<{ stop: () => void }>>([]);
  const activeIdRef = useRef<string | null>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const cancelCentering = useCallback(() => {
    centeringAnimationRef.current.forEach((animation) => animation.stop());
    centeringAnimationRef.current = [];
  }, []);

  const ensureFrameVisible = useCallback(
    (target: CenterTarget, onCentered?: () => void) => {
      const artboard = document.querySelector<HTMLElement>('[data-artboard-container]');
      if (!artboard || !viewport) return;
      const rect = artboard.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || viewport.zoom <= 0) return;

      const nextPanX = viewport.panX;
      const nextPanY = viewport.panY;
      const frameRect = getPageFrameRect(artboard, target.id);

      const left = frameRect ? frameRect.left - rect.left : target.x * viewport.zoom + nextPanX;
      const top = frameRect ? frameRect.top - rect.top : target.y * viewport.zoom + nextPanY;
      const right = frameRect ? left + frameRect.width : left + target.width * viewport.zoom;
      const bottom = frameRect
        ? top + frameRect.height
        : top + (target.height + PAGE_CHROME_HEIGHT) * viewport.zoom;
      const frameWidth = frameRect ? frameRect.width : target.width * viewport.zoom;
      const frameHeight = frameRect
        ? frameRect.height
        : (target.height + PAGE_CHROME_HEIGHT) * viewport.zoom;

      let panX = nextPanX;
      let panY = nextPanY;

      const isFullyVisible = left >= 0 && right <= rect.width && top >= 0 && bottom <= rect.height;

      if (!isFullyVisible) {
        panX = (rect.width - frameWidth) / 2 - (left - nextPanX);
        panY = (rect.height - frameHeight) / 2 - (top - nextPanY);
      }

      if (panX === nextPanX && panY === nextPanY) {
        onCentered?.();
        return;
      }

      cancelCentering();
      if (prefersReducedMotion) {
        const id = activeIdRef.current ?? activeId;
        if (id) {
          updateViewport(id, { panX, panY });
        }
        onCentered?.();
        return;
      }

      let completed = false;
      const currentId = activeIdRef.current ?? activeId;
      const latestPan = { x: nextPanX, y: nextPanY };
      const updatePan = () => {
        if (!currentId) return;
        updateViewport(currentId, { panX: latestPan.x, panY: latestPan.y });
      };
      const handleComplete = () => {
        if (completed) return;
        completed = true;
        if (!currentId) return;
        centeringAnimationRef.current = [];
        updateViewport(currentId, { panX, panY });
        onCentered?.();
      };

      const xControls = animate(nextPanX, panX, {
        duration: 0.26,
        ease: [0.215, 0.61, 0.355, 1],
        onUpdate: (latestPanX: number) => {
          latestPan.x = latestPanX;
          updatePan();
        },
        onComplete: handleComplete,
      });
      const yControls = animate(nextPanY, panY, {
        duration: 0.26,
        ease: [0.215, 0.61, 0.355, 1],
        onUpdate: (latestPanY: number) => {
          latestPan.y = latestPanY;
          updatePan();
        },
        onComplete: handleComplete,
      });

      centeringAnimationRef.current = [xControls, yControls];
    },
    [activeId, updateViewport, viewport, cancelCentering, prefersReducedMotion],
  );

  useEffect(() => cancelCentering, [cancelCentering]);

  /**
   * ページ追加後にビューポートをアニメーションしてページを中央・フィット表示する。
   * ズームとパンを同時にアニメーションし、常にアニメーションが発火する（isFullyVisible チェックなし）。
   */
  const centerOnNewPage = useCallback(
    (page: Pick<Page, 'id' | 'x' | 'y' | 'width' | 'height'>, onComplete?: () => void) => {
      const artboard = document.querySelector<HTMLElement>('[data-artboard-container]');
      if (!artboard || !viewport) return;
      const rect = artboard.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const pageHeightWithChrome = page.height + PAGE_CHROME_HEIGHT;
      // ページ全体がビューポートに 80% フィットするズームを計算（最大 1 倍）
      const targetZoom = Math.min(
        (rect.width * 0.8) / page.width,
        (rect.height * 0.8) / pageHeightWithChrome,
        1,
      );
      // ページ中心がビューポート中心に来るパンを計算
      const targetPanX = rect.width / 2 - (page.x + page.width / 2) * targetZoom;
      const targetPanY = rect.height / 2 - (page.y + pageHeightWithChrome / 2) * targetZoom;

      cancelCentering();
      const currentId = activeIdRef.current ?? activeId;

      if (prefersReducedMotion) {
        if (currentId)
          updateViewport(currentId, { zoom: targetZoom, panX: targetPanX, panY: targetPanY });
        onComplete?.();
        return;
      }

      let completed = false;
      const latestState = { x: viewport.panX, y: viewport.panY, zoom: viewport.zoom };
      const updateAll = () => {
        if (!currentId) return;
        updateViewport(currentId, {
          zoom: latestState.zoom,
          panX: latestState.x,
          panY: latestState.y,
        });
      };
      const handleComplete = () => {
        if (completed) return;
        completed = true;
        if (!currentId) return;
        centeringAnimationRef.current = [];
        updateViewport(currentId, { zoom: targetZoom, panX: targetPanX, panY: targetPanY });
        onComplete?.();
      };

      const DURATION = 0.4;
      const EASE = [0.215, 0.61, 0.355, 1] as const;
      const xControls = animate(viewport.panX, targetPanX, {
        duration: DURATION,
        ease: EASE,
        onUpdate: (v: number) => {
          latestState.x = v;
          updateAll();
        },
        onComplete: handleComplete,
      });
      const yControls = animate(viewport.panY, targetPanY, {
        duration: DURATION,
        ease: EASE,
        onUpdate: (v: number) => {
          latestState.y = v;
          updateAll();
        },
        onComplete: handleComplete,
      });
      const zoomControls = animate(viewport.zoom, targetZoom, {
        duration: DURATION,
        ease: EASE,
        onUpdate: (v: number) => {
          latestState.zoom = v;
          updateAll();
        },
        onComplete: handleComplete,
      });

      centeringAnimationRef.current = [xControls, yControls, zoomControls];
    },
    [activeId, updateViewport, viewport, cancelCentering, prefersReducedMotion],
  );

  const handleAdd = useCallback(
    (url: string) => {
      // 現在のビューポート中央を起点にして findNonOverlappingPosition で重ならない位置を探す
      const centerPos = getViewportCenterPos(
        viewport?.zoom ?? 1,
        viewport?.panX ?? 0,
        viewport?.panY ?? 0,
      );
      const created = addPage(
        activeId,
        url,
        centerPos
          ? {
              x: centerPos.x,
              y: centerPos.y,
              width: DEFAULT_PAGE_WIDTH,
              height: DEFAULT_PAGE_HEIGHT,
            }
          : undefined,
      );
      if (created) {
        onSelectPage(created.id);
        centerOnNewPage(created, () => onCentered?.(created.id));
      }
    },
    [addPage, activeId, viewport, centerOnNewPage, onSelectPage, onCentered],
  );

  const pages = activeProject?.pages ?? [];

  return (
    <aside
      ref={ref}
      className="flex shrink-0 flex-col gap-3 overflow-y-auto bg-default p-3"
      style={{ width: initialWidth }}
    >
      <AddPageForm onAdd={handleAdd} />

      {/* ページ一覧 */}
      {pages.length > 0 && (
        <ul className="flex flex-col gap-1">
          {pages.map((page) => {
            const isSelected = selectedPageId === page.id;
            const addedUrl = page.addedUrl ?? page.url;

            return (
              <motion.li
                key={page.id}
                className={`flex items-start gap-1.5 rounded-md px-2 py-1.5 text-sm ${
                  isSelected ? 'bg-default-hover/80' : ''
                } hover:bg-default-hover`}
                variants={pageListItemVariants}
                initial="rest"
                whileHover="hover"
                onClick={() => {
                  onSelectPage(page.id);
                  ensureFrameVisible(page, () => onCentered?.(page.id));
                }}
                aria-current={isSelected ? 'true' : undefined}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground" title={page.title || page.url}>
                    {page.title || page.url}
                    {isPageMoved(page) && <span className="ml-1 text-muted">(Moved)</span>}
                  </p>
                  <p className="truncate text-xs text-muted" title={addedUrl}>
                    {addedUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  </p>
                </div>
                <motion.button
                  variants={removeButtonVariants}
                  initial="rest"
                  className="shrink-0 rounded-sm p-0.5 text-muted hover:bg-background-tertiary hover:text-foreground"
                  onClick={(event: MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    removePage(activeId, page.id);
                  }}
                  aria-label="ページを削除"
                >
                  <Xmark className="size-3.5" />
                </motion.button>
              </motion.li>
            );
          })}
        </ul>
      )}
    </aside>
  );
});
